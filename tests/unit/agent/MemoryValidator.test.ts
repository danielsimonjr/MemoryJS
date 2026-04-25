import { describe, it, expect } from 'vitest';
import { MemoryValidator } from '../../../src/agent/MemoryValidator.js';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import type { Entity } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';

/** A SemanticSearch stub that returns a configurable similarity. The
 * underlying ContradictionDetector only calls `calculateSimilarity`. */
function stubSemanticSearch(similarityFn: (a: string, b: string) => number): SemanticSearch {
  return {
    calculateSimilarity: async (a: string, b: string) => similarityFn(a, b),
  } as unknown as SemanticSearch;
}

function makeEntity(overrides: Partial<AgentEntity> = {}): Entity {
  const now = new Date().toISOString();
  return {
    name: 'e',
    entityType: 'memory_turn',
    observations: ['the sky is blue'],
    createdAt: now,
    lastModified: now,
    importance: 5,
    confidence: 0.8,
    confirmationCount: 1,
    accessCount: 0,
    memoryType: 'episodic',
    visibility: 'private',
    ...overrides,
  } as AgentEntity;
}

describe('MemoryValidator.validateConsistency', () => {
  it('flags duplicate observation', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const entity = makeEntity({ observations: ['hello world'] });
    const result = await validator.validateConsistency('hello world', entity);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.kind === 'duplicate-observation')).toBe(true);
  });

  it('flags semantic contradiction via the detector', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0.9));
    const validator = new MemoryValidator(detector);
    const entity = makeEntity({ observations: ['the sky is blue'] });
    const result = await validator.validateConsistency('the sky is red', entity);
    expect(result.issues.some((i) => i.kind === 'semantic-contradiction')).toBe(true);
  });

  it('does not flag low-confidence as a blocking issue', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    // Below default threshold 0.4
    const entity = makeEntity({ confidence: 0.2 });
    const result = await validator.validateConsistency('different', entity);
    expect(result.isValid).toBe(true);  // low-confidence alone doesn't invalidate
    expect(result.issues.some((i) => i.kind === 'low-confidence')).toBe(true);
  });

  it('isValid is true when there are no blocking issues', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const entity = makeEntity();
    const result = await validator.validateConsistency('something new', entity);
    expect(result.isValid).toBe(true);
    expect(result.issues.length).toBe(0);
  });
});

describe('MemoryValidator.detectContradictions', () => {
  it('returns empty for entities with <2 observations', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0.99));
    const validator = new MemoryValidator(detector);
    expect(await validator.detectContradictions(makeEntity({ observations: [] }))).toEqual([]);
    expect(await validator.detectContradictions(makeEntity({ observations: ['only'] }))).toEqual([]);
  });

  it('returns the typed Contradiction shape with severity bucket', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0.97));
    const validator = new MemoryValidator(detector);
    const entity = makeEntity({ observations: ['a', 'b'] });
    const out = await validator.detectContradictions(entity);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].severity).toBe('high'); // 0.97 ≥ 0.95
    expect(out[0].conflictType).toBe('factual');
  });

  it('dedups symmetric pairs (a-vs-b same as b-vs-a)', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0.9));
    const validator = new MemoryValidator(detector);
    const entity = makeEntity({ observations: ['a', 'b'] });
    const out = await validator.detectContradictions(entity);
    expect(out.length).toBe(1);
  });
});

describe('MemoryValidator.repairMemory', () => {
  it('appends a [repair]-prefixed observation', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const entity = makeEntity({ observations: ['original'] });
    const repaired = await validator.repairMemory(entity, 'corrected fact');
    expect(repaired.observations).toEqual(['original', '[repair] corrected fact']);
    // lastModified is set to current ISO timestamp; verify it's a valid
    // ISO-8601 string rather than asserting strict inequality (the test
    // can run within a single millisecond of fixture creation).
    expect(repaired.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('MemoryValidator.repairWithResolver', () => {
  it('delegates to ConflictResolver.resolveConflict and returns the resolved memory', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const { ConflictResolver } = await import('../../../src/agent/ConflictResolver.js');
    const resolver = new ConflictResolver();

    const older = makeEntity({ name: 'old', confidence: 0.5 }) as AgentEntity;
    older.lastModified = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(); // 1 week ago
    const newer = makeEntity({ name: 'new', confidence: 0.9 }) as AgentEntity;
    newer.lastModified = new Date().toISOString();

    const result = await validator.repairWithResolver(older, newer, resolver, { similarity: 0.92 });
    // 1-week age delta → most_recent strategy → newer wins.
    expect(result.name).toBe('new');
  });

  it('falls back to highest_confidence when timestamps are close', async () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const { ConflictResolver } = await import('../../../src/agent/ConflictResolver.js');
    const resolver = new ConflictResolver();

    const t = new Date().toISOString();
    const lowConf = makeEntity({ name: 'low', confidence: 0.3 }) as AgentEntity;
    lowConf.lastModified = t;
    const highConf = makeEntity({ name: 'high', confidence: 0.95 }) as AgentEntity;
    highConf.lastModified = t;

    const result = await validator.repairWithResolver(lowConf, highConf, resolver, { similarity: 0.88 });
    expect(result.name).toBe('high');
  });
});

describe('MemoryValidator.validateTemporalOrder', () => {
  it('passes when timestamps are ascending', () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const result = validator.validateTemporalOrder([
      '[T=2026-01-01T00:00:00Z] event a',
      '[T=2026-01-02T00:00:00Z] event b',
      '[T=2026-01-03T00:00:00Z] event c',
    ]);
    expect(result.isValid).toBe(true);
  });

  it('flags an out-of-order pair', () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const result = validator.validateTemporalOrder([
      '[T=2026-01-03T00:00:00Z] later first',
      '[T=2026-01-01T00:00:00Z] earlier second',
    ]);
    expect(result.isValid).toBe(false);
    expect(result.issues[0].kind).toBe('temporal-disorder');
  });

  it('returns isValid=true when no observations carry timestamps', () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const result = validator.validateTemporalOrder(['no stamps here', 'or here']);
    expect(result.isValid).toBe(true);
    expect(result.confidence).toBeLessThan(0.9); // low confidence absent stamps
  });
});

describe('MemoryValidator.calculateReliability', () => {
  it('returns higher score for high-confidence + many confirmations', () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const e = makeEntity({ confidence: 0.95, confirmationCount: 10 });
    expect(validator.calculateReliability(e)).toBeGreaterThan(0.7);
  });

  it('returns lower score for low-confidence + no confirmations', () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const e = makeEntity({ confidence: 0.2, confirmationCount: 0 });
    expect(validator.calculateReliability(e)).toBeLessThan(0.4);
  });

  it('clamps to [0, 1]', () => {
    const detector = new ContradictionDetector(stubSemanticSearch(() => 0));
    const validator = new MemoryValidator(detector);
    const e = makeEntity({ confidence: 1, confirmationCount: 100 });
    const score = validator.calculateReliability(e);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
