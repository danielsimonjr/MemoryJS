/**
 * RelationConsolidator — R3 unit tests (real GraphStorage backend).
 *
 * Covers:
 * - tier-1 spelling-variant detection + canonical merge (graph asserted)
 * - tier-1 canonical rewrite when the graph-wide spelling is absent on the pair
 * - bidirectional inverse-duplicate handling
 * - tier-2 semantic dedup with a deterministic fake embedding provider
 *   (merge semantics + threshold boundary)
 * - tier-3 LLM validation with mixed verdicts → report-only (graph untouched)
 * - no-provider tiers skip silently
 * - apply:false never mutates
 * - circuit breakers (maxGroups, maxLlmBatch)
 * - RelationConsolidationStage registration + StageResult shape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { ConsolidationPipeline } from '../../../src/agent/ConsolidationPipeline.js';
import {
  RelationConsolidator,
  RelationConsolidationStage,
  normalizeRelationType,
  relationKey,
  type RelationEmbeddingProvider,
} from '../../../src/agent/RelationConsolidator.js';
import type { Relation } from '../../../src/types/types.js';
import type { LLMProvider } from '../../../src/search/LLMQueryPlanner.js';
import type { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import type { DecayEngine } from '../../../src/agent/DecayEngine.js';
import type { ConsolidateOptions } from '../../../src/types/agent-memory.js';

const emptyOptions: ConsolidateOptions = {} as ConsolidateOptions;

describe('RelationConsolidator (R3)', () => {
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `relcons-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  async function seedEntities(names: string[]): Promise<void> {
    await entityManager.createEntities(
      names.map((name) => ({ name, entityType: 'test', observations: [] }))
    );
  }

  async function allRelations(): Promise<Relation[]> {
    const graph = await storage.loadGraph();
    return graph.relations;
  }

  // ==================== helpers under test ====================

  it('normalizeRelationType collapses case/hyphen/underscore/camelCase variants', () => {
    expect(normalizeRelationType('works_at')).toBe('works_at');
    expect(normalizeRelationType('works-at')).toBe('works_at');
    expect(normalizeRelationType('WorksAt')).toBe('works_at');
    expect(normalizeRelationType('Works At')).toBe('works_at');
    expect(normalizeRelationType('WORKS_AT')).toBe('works_at');
  });

  // ==================== Tier 1 — spelling variants ====================

  it('detects tier-1 spelling variants and merges onto the canonical (most-used) spelling', async () => {
    await seedEntities(['Alice', 'Acme', 'Carol']);
    await relationManager.createRelations([
      { from: 'Alice', to: 'Acme', relationType: 'works_at' },
      {
        from: 'Alice',
        to: 'Acme',
        relationType: 'works-at',
        properties: { confirmationCount: 2 },
      },
      {
        from: 'Alice',
        to: 'Acme',
        relationType: 'WorksAt',
        properties: { confirmationCount: 3 },
      },
      // Second graph-wide usage makes 'works_at' the most-used spelling.
      { from: 'Carol', to: 'Acme', relationType: 'works_at' },
    ]);

    const consolidator = new RelationConsolidator(relationManager, entityManager);
    const report = await consolidator.analyze();

    expect(report.relationsScanned).toBe(4);
    expect(report.exactDuplicates).toHaveLength(1);
    const group = report.exactDuplicates[0];
    expect(group.canonicalType).toBe('works_at');
    expect(group.normalizedType).toBe('works_at');
    expect(group.members).toHaveLength(3);
    expect(group.merged.relationType).toBe('works_at');
    expect(group.merged.properties?.confirmationCount).toBe(5);

    const result = await consolidator.consolidate({ apply: true });
    expect(result.applied).toBe(true);
    expect(result.relationsDeleted).toBe(3);
    expect(result.relationsCreated).toBe(1);

    // Graph asserted: exactly one Alice->Acme relation left, canonical spelling,
    // summed confirmationCount; the unrelated Carol->Acme relation is untouched.
    const after = await allRelations();
    const alice = after.filter((r) => r.from === 'Alice' && r.to === 'Acme');
    expect(alice).toHaveLength(1);
    expect(alice[0].relationType).toBe('works_at');
    expect(alice[0].properties?.confirmationCount).toBe(5);
    expect(
      after.some((r) => r.from === 'Carol' && r.to === 'Acme' && r.relationType === 'works_at')
    ).toBe(true);
    expect(after).toHaveLength(2);
  });

  it('rewrites to the graph-wide canonical spelling even when absent on the pair', async () => {
    await seedEntities(['Bob', 'Initech', 'Dana', 'Eve']);
    await relationManager.createRelations([
      // The pair only has non-canonical spellings…
      { from: 'Bob', to: 'Initech', relationType: 'works-at' },
      { from: 'Bob', to: 'Initech', relationType: 'WorksAt' },
      // …while 'works_at' dominates graph-wide (2 usages elsewhere).
      { from: 'Dana', to: 'Initech', relationType: 'works_at' },
      { from: 'Eve', to: 'Initech', relationType: 'works_at' },
    ]);

    const consolidator = new RelationConsolidator(relationManager, entityManager);
    const result = await consolidator.consolidate({ apply: true });

    expect(result.exactDuplicates).toHaveLength(1);
    expect(result.exactDuplicates[0].canonicalType).toBe('works_at');

    const bob = (await allRelations()).filter((r) => r.from === 'Bob');
    expect(bob).toHaveLength(1);
    expect(bob[0].relationType).toBe('works_at');
  });

  // ==================== Tier 1 — bidirectional inverse duplicates ====================

  it('flags and merges inverse duplicates when a relation is marked bidirectional', async () => {
    await seedEntities(['Ann', 'Ben']);
    await relationManager.createRelations([
      {
        from: 'Ann',
        to: 'Ben',
        relationType: 'married_to',
        properties: { bidirectional: true, confirmationCount: 1 },
      },
      {
        from: 'Ben',
        to: 'Ann',
        relationType: 'married_to',
        properties: { confirmationCount: 2 },
      },
    ]);

    const consolidator = new RelationConsolidator(relationManager, entityManager);
    const report = await consolidator.analyze();

    expect(report.inverseDuplicates).toHaveLength(1);
    const pair = report.inverseDuplicates[0];
    // The bidirectional-marked side survives.
    expect(pair.kept.from).toBe('Ann');
    expect(pair.dropped.from).toBe('Ben');
    expect(pair.merged.properties?.confirmationCount).toBe(3);

    const result = await consolidator.consolidate({ apply: true });
    expect(result.relationsCreated).toBe(1);

    const after = await allRelations();
    expect(after).toHaveLength(1);
    expect(after[0].from).toBe('Ann');
    expect(after[0].to).toBe('Ben');
    expect(after[0].properties?.bidirectional).toBe(true);
    expect(after[0].properties?.confirmationCount).toBe(3);
  });

  it('keeps the older relation when both directions are marked bidirectional', async () => {
    await seedEntities(['Cy', 'Di']);
    await relationManager.createRelations([
      {
        from: 'Di',
        to: 'Cy',
        relationType: 'partners_with',
        createdAt: '2024-01-01T00:00:00.000Z',
        properties: { bidirectional: true },
      },
      {
        from: 'Cy',
        to: 'Di',
        relationType: 'partners_with',
        createdAt: '2025-06-01T00:00:00.000Z',
        properties: { bidirectional: true },
      },
    ]);

    const consolidator = new RelationConsolidator(relationManager, entityManager);
    const report = await consolidator.analyze();
    expect(report.inverseDuplicates).toHaveLength(1);
    expect(report.inverseDuplicates[0].kept.from).toBe('Di');
    expect(report.inverseDuplicates[0].dropped.from).toBe('Cy');
  });

  // ==================== Tier 2 — semantic (embedding-gated) ====================

  /**
   * Deterministic fake: vectors chosen so cos(works_at, employed_by) is
   * exactly 24/25 = 0.96 (perfect-square norms → no fp noise) and both are
   * orthogonal to 'founded'.
   */
  function fakeEmbedding(): RelationEmbeddingProvider {
    return {
      async embed(text: string): Promise<number[]> {
        if (text.includes('works_at')) return [4, 3];
        if (text.includes('employed_by')) return [3, 4];
        if (text.includes('founded')) return [0, 0.001];
        return [1, 1];
      },
    };
  }

  async function seedSemanticPair(): Promise<void> {
    await seedEntities(['Fay', 'Globex']);
    await relationManager.createRelations([
      { from: 'Fay', to: 'Globex', relationType: 'works_at', confidence: 0.5 },
      {
        from: 'Fay',
        to: 'Globex',
        relationType: 'employed_by',
        confidence: 0.9,
        properties: { confirmationCount: 4 },
      },
      { from: 'Fay', to: 'Globex', relationType: 'founded', confidence: 0.99 },
    ]);
  }

  it('merges same-pair semantic duplicates, keeping the higher-confidence relation', async () => {
    await seedSemanticPair();
    const consolidator = new RelationConsolidator(relationManager, entityManager, {
      embedding: fakeEmbedding(),
      thresholds: { semantic: 0.95 },
    });

    const report = await consolidator.analyze();
    expect(report.semanticTierSkipped).toBe(false);
    expect(report.semanticDuplicates).toHaveLength(1);
    const group = report.semanticDuplicates[0];
    expect(group.kept.relationType).toBe('employed_by'); // confidence 0.9 > 0.5
    expect(group.dropped.map((r) => r.relationType)).toEqual(['works_at']);
    expect(group.similarity).toBeCloseTo(0.96, 10);
    expect(group.merged.properties?.confirmationCount).toBe(4);
    expect(group.merged.confidence).toBe(0.9);

    const result = await consolidator.consolidate({ apply: true });
    expect(result.relationsDeleted).toBe(2);
    expect(result.relationsCreated).toBe(1);

    const after = await allRelations();
    const types = after.map((r) => r.relationType).sort();
    expect(types).toEqual(['employed_by', 'founded']); // 'founded' dissimilar → untouched
  });

  it('respects the semantic threshold boundary (inclusive >=)', async () => {
    await seedSemanticPair();

    // sim (0.96) exactly at threshold → flagged (>= is inclusive).
    const atBoundary = new RelationConsolidator(relationManager, entityManager, {
      embedding: fakeEmbedding(),
      thresholds: { semantic: 0.96 },
    });
    expect((await atBoundary.analyze()).semanticDuplicates).toHaveLength(1);

    // Just above the pair's similarity → not flagged.
    const aboveBoundary = new RelationConsolidator(relationManager, entityManager, {
      embedding: fakeEmbedding(),
      thresholds: { semantic: 0.9601 },
    });
    expect((await aboveBoundary.analyze()).semanticDuplicates).toHaveLength(0);
  });

  it('skips tier 2 silently when no embedding provider is configured', async () => {
    await seedSemanticPair();
    const consolidator = new RelationConsolidator(relationManager, entityManager);
    const report = await consolidator.analyze();
    expect(report.semanticTierSkipped).toBe(true);
    expect(report.semanticDuplicates).toHaveLength(0);
    expect(report.errors).toEqual([]);
  });

  // ==================== Tier 3 — LLM neighborhood validation ====================

  async function seedChain(): Promise<void> {
    await seedEntities(['A', 'B', 'C', 'D']);
    await relationManager.createRelations([
      { from: 'A', to: 'B', relationType: 'r1' },
      { from: 'B', to: 'C', relationType: 'r2' },
      { from: 'C', to: 'D', relationType: 'r3' },
    ]);
  }

  it('returns mixed LLM verdicts as report-only feedback; graph never mutated by tier 3', async () => {
    await seedChain();
    const newRelations: Relation[] = [
      { from: 'A', to: 'B', relationType: 'collaborates_with' },
      { from: 'B', to: 'A', relationType: 'reports_to' },
    ];
    const prompts: string[] = [];
    const llm: LLMProvider = {
      async complete(prompt: string): Promise<string> {
        prompts.push(prompt);
        return [
          'Here are my verdicts:',
          '```json',
          JSON.stringify([
            { relationKey: relationKey(newRelations[0]), verdict: 'ok', reason: 'consistent' },
            {
              relationKey: relationKey(newRelations[1]),
              verdict: 'wrong',
              reason: 'contradicts r1',
              suggestedFix: 'A -[manages]-> B',
            },
            { relationKey: 'bogus|x|y', verdict: 'nonsense', reason: 'invalid verdict' },
            'not-an-object',
          ]),
          '```',
        ].join('\n');
      },
    };

    const consolidator = new RelationConsolidator(relationManager, entityManager, { llm });
    const before = await allRelations();
    const result = await consolidator.consolidate({ apply: true, newRelations });

    expect(result.llmTierSkipped).toBe(false);
    expect(result.feedback).toBeDefined();
    expect(result.feedback!.batchSize).toBe(2);
    expect(result.feedback!.truncated).toBe(false);
    // Tolerant parse: invalid verdict value and non-object entries filtered.
    expect(result.feedback!.verdicts).toHaveLength(2);
    expect(result.feedback!.verdicts[0].verdict).toBe('ok');
    expect(result.feedback!.verdicts[1].verdict).toBe('wrong');
    expect(result.feedback!.verdicts[1].suggestedFix).toBe('A -[manages]-> B');

    // 2-hop neighborhood reaches C -[r3]-> D from endpoints {A, B}.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('C -[r3]-> D');

    // Tier 3 never mutates — no tier-1/2 findings here, so even apply:true
    // leaves the graph byte-identical.
    expect(result.relationsDeleted).toBe(0);
    expect(result.relationsCreated).toBe(0);
    expect(await allRelations()).toEqual(before);
  });

  it('skips tier 3 silently when no LLM provider or no newRelations', async () => {
    await seedChain();
    const noLlm = new RelationConsolidator(relationManager, entityManager);
    const r1 = await noLlm.analyze({
      newRelations: [{ from: 'A', to: 'B', relationType: 'x' }],
    });
    expect(r1.llmTierSkipped).toBe(true);
    expect(r1.feedback).toBeUndefined();

    const llm: LLMProvider = { complete: vi.fn(async () => '[]') };
    const withLlm = new RelationConsolidator(relationManager, entityManager, { llm });
    const r2 = await withLlm.analyze(); // no newRelations
    expect(r2.llmTierSkipped).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('records an error (not a throw) when the LLM call fails', async () => {
    await seedChain();
    const llm: LLMProvider = {
      complete: vi.fn(async () => {
        throw new Error('provider down');
      }),
    };
    const consolidator = new RelationConsolidator(relationManager, entityManager, { llm });
    const report = await consolidator.analyze({
      newRelations: [{ from: 'A', to: 'B', relationType: 'x' }],
    });
    expect(report.feedback).toBeUndefined();
    expect(report.errors.some((e) => e.includes('LLM validation failed'))).toBe(true);
  });

  // ==================== apply:false never mutates ====================

  it('analyze() and consolidate() without apply never mutate the graph', async () => {
    await seedEntities(['Gia', 'Hooli']);
    await relationManager.createRelations([
      { from: 'Gia', to: 'Hooli', relationType: 'works_at' },
      { from: 'Gia', to: 'Hooli', relationType: 'works-at' },
    ]);
    const consolidator = new RelationConsolidator(relationManager, entityManager, {
      embedding: fakeEmbedding(),
    });

    const before = await allRelations();
    const report = await consolidator.analyze();
    expect(report.exactDuplicates).toHaveLength(1);

    const dryRun = await consolidator.consolidate(); // apply defaults to false
    expect(dryRun.applied).toBe(false);
    expect(dryRun.relationsDeleted).toBe(0);
    expect(dryRun.relationsCreated).toBe(0);
    expect(await allRelations()).toEqual(before);
  });

  // ==================== Circuit breakers ====================

  it('maxGroups truncates the (from, to) group scan', async () => {
    await seedEntities(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
    await relationManager.createRelations([
      { from: 'a1', to: 'a2', relationType: 'linked_to' },
      { from: 'a1', to: 'a2', relationType: 'linked-to' },
      { from: 'b1', to: 'b2', relationType: 'linked_to' },
      { from: 'b1', to: 'b2', relationType: 'linked-to' },
      { from: 'c1', to: 'c2', relationType: 'linked_to' },
      { from: 'c1', to: 'c2', relationType: 'linked-to' },
    ]);

    const consolidator = new RelationConsolidator(relationManager, entityManager, {
      maxGroups: 2,
    });
    const report = await consolidator.analyze();
    expect(report.groupsScanned).toBe(2);
    expect(report.groupsTruncated).toBe(true);
    expect(report.exactDuplicates).toHaveLength(2);
  });

  it('maxLlmBatch clips the batch sent to the LLM tier', async () => {
    await seedChain();
    const newRelations: Relation[] = [
      { from: 'A', to: 'B', relationType: 'n1' },
      { from: 'B', to: 'C', relationType: 'n2' },
      { from: 'C', to: 'D', relationType: 'n3' },
    ];
    const prompts: string[] = [];
    const llm: LLMProvider = {
      async complete(prompt: string): Promise<string> {
        prompts.push(prompt);
        return '[]';
      },
    };
    const consolidator = new RelationConsolidator(relationManager, entityManager, {
      llm,
      maxLlmBatch: 2,
    });
    const report = await consolidator.analyze({ newRelations });
    expect(report.feedback!.batchSize).toBe(2);
    expect(report.feedback!.truncated).toBe(true);
    expect(prompts[0]).toContain(relationKey(newRelations[0]));
    expect(prompts[0]).toContain(relationKey(newRelations[1]));
    expect(prompts[0]).not.toContain(relationKey(newRelations[2]));
  });

  // ==================== No entity source ====================

  it('skips the tier-1/2 scan with an [info] diagnostic when no entity source is given', async () => {
    const consolidator = new RelationConsolidator(relationManager);
    const report = await consolidator.analyze();
    expect(report.relationsScanned).toBe(0);
    expect(report.exactDuplicates).toHaveLength(0);
    expect(report.errors.some((e) => e.startsWith('[info]'))).toBe(true);
  });

  // ==================== RelationConsolidationStage ====================

  describe('RelationConsolidationStage', () => {
    it('exposes the expected stage name and registers on ConsolidationPipeline', async () => {
      const consolidator = new RelationConsolidator(relationManager, entityManager);
      const stage = new RelationConsolidationStage(consolidator);
      expect(stage.name).toBe('relation-consolidation');

      const workingMemory = {
        getSessionMemories: vi.fn(async () => []),
      } as unknown as WorkingMemoryManager;
      const decayEngine = {
        reinforceMemory: vi.fn(async () => ({})),
      } as unknown as DecayEngine;
      const pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);
      pipeline.registerStage(stage);
      expect(pipeline.getStages().map((s) => s.name)).toContain('relation-consolidation');
    });

    it('report-only by default: emits [info] entries, transformed 0, graph untouched', async () => {
      await seedEntities(['Ida', 'Jax']);
      await relationManager.createRelations([
        { from: 'Ida', to: 'Jax', relationType: 'mentors' },
        { from: 'Ida', to: 'Jax', relationType: 'Mentors' },
      ]);
      const consolidator = new RelationConsolidator(relationManager, entityManager);
      const stage = new RelationConsolidationStage(consolidator);

      const before = await allRelations();
      const result = await stage.process([], emptyOptions);

      // StageResult shape
      expect(result).toEqual({
        processed: expect.any(Number),
        transformed: 0,
        errors: expect.any(Array),
      });
      expect(result.processed).toBe(2);
      const infoLines = result.errors.filter((e) =>
        e.startsWith('[info] RelationConsolidationStage')
      );
      expect(infoLines).toHaveLength(1);
      expect(infoLines[0]).toContain('tier=exact');
      expect(infoLines[0]).not.toContain('applied');
      expect(await allRelations()).toEqual(before);
    });

    it('apply:true applies tier-1/2 merges and reports transformed count', async () => {
      await seedEntities(['Kim', 'Lex']);
      await relationManager.createRelations([
        { from: 'Kim', to: 'Lex', relationType: 'advises' },
        { from: 'Kim', to: 'Lex', relationType: 'Advises' },
      ]);
      const consolidator = new RelationConsolidator(relationManager, entityManager);
      const stage = new RelationConsolidationStage(consolidator, { apply: true });

      const result = await stage.process([], emptyOptions);
      expect(result.transformed).toBe(1);
      expect(
        result.errors.some((e) => e.startsWith('[info]') && e.includes('applied'))
      ).toBe(true);

      const after = await allRelations();
      expect(after).toHaveLength(1);
    });
  });
});
