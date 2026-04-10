# MemPalace Gap-Closing (v1.9.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 features from mempalace gap analysis to memoryjs v1.9.0, extending existing managers (Approach A — no new classes).

**Architecture:** All features are methods added to existing classes: `RelationManager` (temporal KG), `ContextWindowManager` (wake-up), `IOManager` (ingest), `AgentMemoryManager` (diary). Plus config changes (zero-config semantic) and tooling (hooks, benchmarks).

**Tech Stack:** TypeScript, Vitest, better-sqlite3, ChromaDB-compatible local embeddings (ONNX), Zod. Branch `feature/mempalace-gap` off master.

**Source spec:** `docs/superpowers/specs/2026-04-10-mempalace-gap-closing-design.md`

---

## Prerequisites

```bash
cd C:/Users/danie/Dropbox/Github/memoryjs
git checkout feature/mempalace-gap
npm run typecheck  # must pass
SKIP_BENCHMARKS=true npm test 2>&1 | tail -5  # ~5681 pass, 2 pre-existing failures OK
```

---

## Task 1: Add `invalidateRelation` to RelationManager

**Files:**
- Modify: `src/core/RelationManager.ts`
- Test: `tests/unit/core/relation-manager-temporal.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/relation-manager-temporal.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('RelationManager.invalidateRelation', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-rt-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-06-01' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets validUntil on matching active relation', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
    const rels = await ctx.relationManager.getRelations('kai');
    const r = rels.find(r => r.relationType === 'works_on');
    expect(r?.properties?.validUntil).toBe('2026-03-01');
  });

  it('defaults ended to current ISO timestamp', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion');
    const rels = await ctx.relationManager.getRelations('kai');
    const r = rels.find(r => r.relationType === 'works_on');
    expect(r?.properties?.validUntil).toBeDefined();
    expect(r?.properties?.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws when no active relation found', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
    await expect(
      ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-04-01')
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`

- [ ] **Step 3: Implement invalidateRelation**

Add to `src/core/RelationManager.ts`:

```typescript
  /**
   * Mark a relation as no longer valid by setting properties.validUntil.
   * Finds the matching active relation (no validUntil set) and stamps it.
   */
  async invalidateRelation(
    from: string,
    relationType: string,
    to: string,
    ended?: string
  ): Promise<void> {
    const graph = await this.storage.loadGraph();
    const match = graph.relations.find(
      r =>
        r.from === from &&
        r.relationType === relationType &&
        r.to === to &&
        !r.properties?.validUntil
    );
    if (!match) {
      throw new Error(
        `No active relation found: ${from} -[${relationType}]-> ${to}`
      );
    }
    if (!match.properties) {
      match.properties = {};
    }
    match.properties.validUntil = ended ?? new Date().toISOString();
    match.lastModified = new Date().toISOString();
    await this.storage.saveGraph(graph);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```
feat(core): Add RelationManager.invalidateRelation()

Marks a relation as no longer valid by setting properties.validUntil.
Temporal KG convenience method inspired by mempalace's KG.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 2: Add `queryAsOf` and `timeline` to RelationManager

**Files:**
- Modify: `src/core/RelationManager.ts`
- Modify: `tests/unit/core/relation-manager-temporal.test.ts` (add tests)

- [ ] **Step 1: Add tests to existing file**

Append to `tests/unit/core/relation-manager-temporal.test.ts`:

```typescript
describe('RelationManager.queryAsOf', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-qa-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
      { name: 'nova', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-01-01', validUntil: '2025-12-31' },
      },
      {
        from: 'kai',
        to: 'nova',
        relationType: 'works_on',
        properties: { validFrom: '2026-01-01' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only relations valid at the given date', async () => {
    const mid2025 = await ctx.relationManager.queryAsOf('kai', '2025-06-15');
    expect(mid2025.map(r => r.to)).toEqual(['orion']);

    const mid2026 = await ctx.relationManager.queryAsOf('kai', '2026-06-15');
    expect(mid2026.map(r => r.to)).toEqual(['nova']);
  });

  it('includes relations without validFrom (always valid start)', async () => {
    await ctx.relationManager.createRelations([
      { from: 'kai', to: 'kai', relationType: 'self', properties: {} },
    ]);
    const result = await ctx.relationManager.queryAsOf('kai', '2020-01-01');
    expect(result.some(r => r.relationType === 'self')).toBe(true);
  });

  it('supports direction filter', async () => {
    const outgoing = await ctx.relationManager.queryAsOf('kai', '2026-06-15', {
      direction: 'outgoing',
    });
    expect(outgoing.length).toBeGreaterThan(0);
    expect(outgoing.every(r => r.from === 'kai')).toBe(true);
  });
});

describe('RelationManager.timeline', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-tl-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
      { name: 'nova', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'nova',
        relationType: 'works_on',
        properties: { validFrom: '2026-01-01' },
      },
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-01-01', validUntil: '2025-12-31' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all relations sorted chronologically by validFrom', async () => {
    const tl = await ctx.relationManager.timeline('kai');
    expect(tl.length).toBe(2);
    expect(tl[0].to).toBe('orion'); // 2025 first
    expect(tl[1].to).toBe('nova');  // 2026 second
  });

  it('includes expired and current relations', async () => {
    const tl = await ctx.relationManager.timeline('kai');
    expect(tl.some(r => r.properties?.validUntil)).toBe(true); // expired
    expect(tl.some(r => !r.properties?.validUntil)).toBe(true); // current
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`

- [ ] **Step 3: Implement queryAsOf and timeline**

Add to `src/core/RelationManager.ts`:

```typescript
  /**
   * Query relations valid at a specific point in time.
   * Filters: validFrom <= asOf AND (validUntil is undefined OR validUntil >= asOf).
   */
  async queryAsOf(
    entityName: string,
    asOf: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' }
  ): Promise<Relation[]> {
    const direction = options?.direction ?? 'both';
    const graph = await this.storage.loadGraph();

    return graph.relations.filter(r => {
      // Direction check
      const matchesDirection =
        direction === 'both'
          ? r.from === entityName || r.to === entityName
          : direction === 'outgoing'
            ? r.from === entityName
            : r.to === entityName;
      if (!matchesDirection) return false;

      // Validity window check
      const vf = r.properties?.validFrom;
      const vu = r.properties?.validUntil;
      if (vf && vf > asOf) return false;     // hasn't started yet
      if (vu && vu < asOf) return false;     // already ended
      return true;
    });
  }

  /**
   * Chronological relation history for an entity.
   * Returns ALL relations (current + expired) sorted by validFrom ascending.
   */
  async timeline(
    entityName: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' }
  ): Promise<Relation[]> {
    const direction = options?.direction ?? 'both';
    const graph = await this.storage.loadGraph();

    const rels = graph.relations.filter(r => {
      if (direction === 'both') return r.from === entityName || r.to === entityName;
      if (direction === 'outgoing') return r.from === entityName;
      return r.to === entityName;
    });

    rels.sort((a, b) => {
      const aFrom = a.properties?.validFrom ?? '';
      const bFrom = b.properties?.validFrom ?? '';
      if (!aFrom && !bFrom) return 0;
      if (!aFrom) return 1;  // nulls last
      if (!bFrom) return -1;
      return aFrom.localeCompare(bFrom);
    });

    return rels;
  }
```

- [ ] **Step 4: Run all temporal tests**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`
Expected: 8 PASS (3 invalidate + 3 queryAsOf + 2 timeline).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```
feat(core): Add RelationManager.queryAsOf() and timeline()

queryAsOf filters relations by validity window at a point in time.
timeline returns all relations chronologically (current + expired).
Both support direction filtering (outgoing/incoming/both).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 3: Add `wakeUp` to ContextWindowManager

**Files:**
- Modify: `src/agent/ContextWindowManager.ts`
- Modify: `src/agent/AgentMemoryConfig.ts` (add wakeUp config)
- Test: `tests/unit/agent/context-window-manager-wakeup.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent/context-window-manager-wakeup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ContextWindowManager.wakeUp', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));

    // Create some entities with observations
    await ctx.entityManager.createEntities([
      { name: 'proj-alpha', entityType: 'project', observations: ['Uses React', 'Deployed on AWS'], importance: 8 },
      { name: 'proj-beta', entityType: 'project', observations: ['Uses Vue'], importance: 5 },
    ]);

    // Create a profile with static facts
    const amm = ctx.agentMemory();
    await amm.profileManager.addFact('Senior developer', 'static');
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns L0 with profile static facts', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l0).toContain('Senior developer');
    expect(result.l0).toContain('Prefers TypeScript');
  });

  it('returns L1 with top entities by salience', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l1).toBeTruthy();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('respects maxL0Tokens budget', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp({ maxL0Tokens: 10 });
    // With only 10 tokens, L0 should be truncated
    expect(result.totalTokens).toBeLessThan(50);
  });

  it('returns empty L0 when no profile exists', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu2-'));
    const ctx2 = new ManagerContext(path.join(tmpDir2, 'memory.jsonl'));
    const amm2 = ctx2.agentMemory();
    const result = await amm2.contextWindowManager.wakeUp();
    expect(result.l0).toBe('');
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/context-window-manager-wakeup.test.ts`

- [ ] **Step 3: Add wakeUp config to AgentMemoryConfig**

In `src/agent/AgentMemoryConfig.ts`, add to the `AgentMemoryConfig` interface:

```typescript
  /** Wake-up context configuration */
  wakeUp?: {
    defaultMaxL0Tokens?: number;  // default 100
    defaultMaxL1Tokens?: number;  // default 500
  };
```

- [ ] **Step 4: Implement wakeUp**

Add to `src/agent/ContextWindowManager.ts`:

First add the types near the top of the file:

```typescript
export interface WakeUpOptions {
  projectId?: string;
  maxL0Tokens?: number;
  maxL1Tokens?: number;
  includeL1?: boolean;
}

export interface WakeUpResult {
  l0: string;
  l1: string;
  totalTokens: number;
  entityCount: number;
}
```

Then add the method to the class:

```typescript
  /**
   * Generate compact wake-up context for LLM system prompts.
   * L0 (~100 tokens): identity from ProfileManager static facts.
   * L1 (~500 tokens): top entities by salience, formatted compactly.
   */
  async wakeUp(options: WakeUpOptions = {}): Promise<WakeUpResult> {
    const maxL0 = options.maxL0Tokens ?? this.config.wakeUp?.defaultMaxL0Tokens ?? 100;
    const maxL1 = options.maxL1Tokens ?? this.config.wakeUp?.defaultMaxL1Tokens ?? 500;
    const includeL1 = options.includeL1 ?? true;

    // L0: Profile static facts
    let l0 = '';
    try {
      const profileManager = new (await import('./ProfileManager.js')).ProfileManager(
        this.storage as any,
        new (await import('../core/EntityManager.js')).EntityManager(this.storage as any),
        new (await import('../core/ObservationManager.js')).ObservationManager(this.storage as any),
      );
      const profile = await profileManager.getProfile({ projectId: options.projectId });
      if (profile.static.length > 0) {
        l0 = profile.static.join('. ') + '.';
        // Truncate to token budget
        while (this.estimateTokens(l0) > maxL0 && l0.length > 10) {
          const lastDot = l0.lastIndexOf('.', l0.length - 2);
          if (lastDot <= 0) break;
          l0 = l0.slice(0, lastDot + 1);
        }
      }
    } catch {
      // ProfileManager not available — L0 stays empty
    }

    // L1: Top entities by importance (simplified salience)
    let l1 = '';
    let entityCount = 0;
    if (includeL1) {
      try {
        const graph = await this.storage.loadGraph();
        let entities = graph.entities
          .filter((e: any) => e.isLatest !== false && e.entityType !== 'profile' && e.entityType !== 'diary');

        if (options.projectId) {
          entities = entities.filter((e: any) => e.projectId === options.projectId);
        }

        // Sort by importance descending, take top entities fitting in budget
        entities.sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0));

        const lines: string[] = [];
        let tokenCount = 0;
        for (const e of entities) {
          const obs = e.observations?.slice(0, 3).join('; ') ?? '';
          const line = `[${e.entityType}] ${e.name}: ${obs}`;
          const lineTokens = this.estimateTokens(line);
          if (tokenCount + lineTokens > maxL1) break;
          lines.push(line);
          tokenCount += lineTokens;
          entityCount++;
        }
        l1 = lines.join('\n');
      } catch {
        // Storage not available
      }
    }

    const totalTokens = this.estimateTokens(l0) + this.estimateTokens(l1);
    return { l0, l1, totalTokens, entityCount };
  }
```

**NOTE**: The dynamic imports are a pragmatic approach to avoid adding constructor dependencies. The ContextWindowManager already has `storage` — we create lightweight ProfileManager/EntityManager/ObservationManager instances from it. If the implementer finds a cleaner way to access ProfileManager (e.g. via a setter like ContradictionDetector uses), prefer that.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent/context-window-manager-wakeup.test.ts`
Expected: 4 PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```
feat(agent): Add ContextWindowManager.wakeUp() for memory stack

4-layer memory stack inspired by mempalace. L0 loads profile
identity (~100 tokens), L1 loads top entities by importance
(~500 tokens). L2/L3 are on-demand search (existing methods).
Wake-up cost: ~600 tokens, leaving 95%+ of context free.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 4: Add `ingest` to IOManager

**Files:**
- Modify: `src/features/IOManager.ts`
- Test: `tests/unit/features/io-manager-ingest.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/io-manager-ingest.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('IOManager.ingest', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-ing-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates entities from exchange-chunked messages', async () => {
    const result = await ctx.ioManager.ingest({
      messages: [
        { role: 'user', content: 'Why did we switch to GraphQL?' },
        { role: 'assistant', content: 'We switched for better type safety and fewer round trips.' },
        { role: 'user', content: 'What about auth?' },
        { role: 'assistant', content: 'Auth uses JWT with refresh tokens.' },
      ],
      source: 'chat-2026-04-10',
    });
    expect(result.entitiesCreated).toBe(2); // 2 exchange pairs
    expect(result.entityNames).toHaveLength(2);
  });

  it('stores verbatim content as observations', async () => {
    await ctx.ioManager.ingest({
      messages: [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
      ],
      source: 'test',
    });
    const entity = await ctx.entityManager.getEntity('test-001');
    expect(entity).toBeDefined();
    expect(entity!.observations.some(o => o.includes('Hello world'))).toBe(true);
    expect(entity!.observations.some(o => o.includes('Hi there'))).toBe(true);
  });

  it('stamps projectId and tags from options', async () => {
    await ctx.ioManager.ingest(
      {
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' },
        ],
        source: 'tagged',
      },
      { projectId: 'proj-1', tags: ['imported'] }
    );
    const entity = await ctx.entityManager.getEntity('tagged-001');
    expect(entity?.projectId).toBe('proj-1');
    expect(entity?.tags).toContain('imported');
    expect(entity?.tags).toContain('ingested');
  });

  it('dryRun returns counts without creating entities', async () => {
    const result = await ctx.ioManager.ingest(
      {
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' },
        ],
        source: 'dry',
      },
      { dryRun: true }
    );
    expect(result.entitiesCreated).toBe(1);
    const entity = await ctx.entityManager.getEntity('dry-001');
    expect(entity).toBeNull();
  });

  it('skips exact duplicates', async () => {
    const input = {
      messages: [
        { role: 'user', content: 'duplicate content' },
        { role: 'assistant', content: 'duplicate response' },
      ],
      source: 'dup',
    };
    await ctx.ioManager.ingest(input);
    const result2 = await ctx.ioManager.ingest(input);
    expect(result2.skippedDuplicates).toBe(1);
    expect(result2.entitiesCreated).toBe(0);
  });

  it('handles multiple IngestInput items', async () => {
    const result = await ctx.ioManager.ingest([
      {
        messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
        source: 'batch1',
      },
      {
        messages: [{ role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }],
        source: 'batch2',
      },
    ]);
    expect(result.entitiesCreated).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/io-manager-ingest.test.ts`

- [ ] **Step 3: Implement ingest**

Add types at the top of `src/features/IOManager.ts` (after imports):

```typescript
export interface IngestInput {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestOptions {
  projectId?: string;
  entityType?: string;
  tags?: string[];
  chunkBy?: 'exchange' | 'paragraph' | 'fixed';
  maxChunkSize?: number;
  deduplicateThreshold?: number;
  dryRun?: boolean;
}

export interface IngestResult {
  entitiesCreated: number;
  observationsAdded: number;
  skippedDuplicates: number;
  entityNames: string[];
}
```

Add the method to the `IOManager` class:

```typescript
  /**
   * Ingest pre-normalized conversation data into the knowledge graph.
   * Format-agnostic: users normalize chat exports before calling.
   */
  async ingest(
    input: IngestInput | IngestInput[],
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    const inputs = Array.isArray(input) ? input : [input];
    const entityType = options.entityType ?? 'memory';
    const chunkBy = options.chunkBy ?? 'exchange';
    const dryRun = options.dryRun ?? false;
    const baseTags = [...(options.tags ?? []), 'ingested'];

    const result: IngestResult = {
      entitiesCreated: 0,
      observationsAdded: 0,
      skippedDuplicates: 0,
      entityNames: [],
    };

    const graph = await this.storage.loadGraph();
    const existingObsSet = new Set(
      graph.entities.flatMap(e => e.observations.join('||'))
    );

    for (const inp of inputs) {
      const chunks = this.chunkMessages(inp.messages, chunkBy, options.maxChunkSize);
      const source = inp.source ?? `ingest-${new Date().toISOString().slice(0, 10)}`;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const entityName = `${source}-${String(i + 1).padStart(3, '0')}`;
        const observations = chunk.map(m => `[${m.role}] ${m.content}`);
        const obsKey = observations.join('||');

        // Dedup check
        if (existingObsSet.has(obsKey)) {
          result.skippedDuplicates++;
          continue;
        }

        result.entitiesCreated++;
        result.observationsAdded += observations.length;
        result.entityNames.push(entityName);

        if (!dryRun) {
          await this.storage.loadGraph().then(async () => {
            const { EntityManager } = await import('../core/EntityManager.js');
            const em = new EntityManager(this.storage);
            await em.createEntities([
              {
                name: entityName,
                entityType,
                observations,
                tags: [...baseTags],
                projectId: options.projectId,
              },
            ]);
          });
          existingObsSet.add(obsKey);
        }
      }
    }

    return result;
  }

  private chunkMessages(
    messages: IngestInput['messages'],
    strategy: string,
    maxSize?: number
  ): IngestInput['messages'][] {
    if (strategy === 'exchange') {
      // Group by user+assistant pairs
      const chunks: IngestInput['messages'][] = [];
      let current: IngestInput['messages'] = [];
      for (const msg of messages) {
        current.push(msg);
        if (msg.role === 'assistant' && current.length >= 2) {
          chunks.push(current);
          current = [];
        }
      }
      if (current.length > 0) chunks.push(current);
      return chunks;
    }

    if (strategy === 'paragraph') {
      // Each message is its own chunk
      return messages.map(m => [m]);
    }

    // Fixed size
    const max = maxSize ?? 2000;
    const chunks: IngestInput['messages'][] = [];
    let current: IngestInput['messages'] = [];
    let size = 0;
    for (const msg of messages) {
      if (size + msg.content.length > max && current.length > 0) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(msg);
      size += msg.content.length;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }
```

**NOTE**: The `EntityManager` is instantiated inline since `IOManager` only has `storage`. The implementer should check if `IOManager` already has access to an `EntityManager` via a different path — if so, use that instead of creating a new one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/io-manager-ingest.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Export new types from index**

In `src/features/index.ts`, add:

```typescript
export type { IngestInput, IngestOptions, IngestResult } from './IOManager.js';
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```
feat(features): Add IOManager.ingest() for conversation ingestion

Format-agnostic ingestion pipeline. Accepts pre-normalized messages,
chunks by exchange pairs (user+assistant), creates entities with
verbatim observations. Supports projectId, tags, dedup, dryRun.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 5: Add `writeDiary` and `readDiary` to AgentMemoryManager

**Files:**
- Modify: `src/agent/AgentMemoryManager.ts`
- Modify: `src/core/EntityManager.ts` (reserve diary-* namespace)
- Test: `tests/unit/agent/agent-memory-manager-diary.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent/agent-memory-manager-diary.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager diary', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-diary-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeDiary creates diary entity on first write', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Found auth bypass in PR#42');
    const entity = await ctx.entityManager.getEntity('diary-reviewer');
    expect(entity).toBeDefined();
    expect(entity!.entityType).toBe('diary');
    expect(entity!.importance).toBe(8);
  });

  it('writeDiary appends timestamped observations', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Entry one');
    await amm.writeDiary('reviewer', 'Entry two');
    const entity = await ctx.entityManager.getEntity('diary-reviewer');
    expect(entity!.observations).toHaveLength(2);
    expect(entity!.observations[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
  });

  it('readDiary returns entries in reverse chronological order', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'First');
    await amm.writeDiary('reviewer', 'Second');
    const entries = await amm.readDiary('reviewer');
    expect(entries[0]).toContain('Second');
    expect(entries[1]).toContain('First');
  });

  it('readDiary filters by topic', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Auth issue', { topic: 'security' });
    await amm.writeDiary('reviewer', 'Style issue', { topic: 'style' });
    const security = await amm.readDiary('reviewer', { topic: 'security' });
    expect(security).toHaveLength(1);
    expect(security[0]).toContain('Auth issue');
  });

  it('readDiary returns empty for nonexistent agent', async () => {
    const amm = ctx.agentMemory();
    const entries = await amm.readDiary('nonexistent');
    expect(entries).toEqual([]);
  });

  it('diary-* namespace is reserved for non-diary entities', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'diary-test', entityType: 'person', observations: [] },
      ])
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/agent-memory-manager-diary.test.ts`

- [ ] **Step 3: Reserve diary-* namespace in EntityManager**

In `src/core/EntityManager.ts`, find the existing `profile-*` namespace check (added in v1.8.0) and extend it:

```typescript
    // Reserve the profile-* and diary-* namespaces
    for (const e of validation.data) {
      if (e.name.startsWith('profile-') && e.entityType !== 'profile') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the profile system. ` +
          `Use entityType='profile' or choose a different name.`,
          []
        );
      }
      if (e.name.startsWith('diary-') && e.entityType !== 'diary') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the diary system. ` +
          `Use entityType='diary' or choose a different name.`,
          []
        );
      }
    }
```

- [ ] **Step 4: Implement writeDiary and readDiary**

Add to `src/agent/AgentMemoryManager.ts`:

```typescript
  /**
   * Write a timestamped diary entry for a specialist agent.
   * Stored as an observation on entity 'diary-{agentId}'.
   */
  async writeDiary(
    agentId: string,
    entry: string,
    options?: { topic?: string; tags?: string[] }
  ): Promise<void> {
    const entityName = `diary-${agentId}`;
    const timestamp = new Date().toISOString();
    const topicPrefix = options?.topic ? ` [${options.topic}]` : '';
    const formatted = `[${timestamp}]${topicPrefix} ${entry}`;

    const graph = await this.storage.loadGraph();
    const existing = graph.entities.find((e: any) => e.name === entityName);

    if (!existing) {
      const { EntityManager } = await import('../core/EntityManager.js');
      const em = new EntityManager(this.storage as any);
      await em.createEntities([{
        name: entityName,
        entityType: 'diary',
        observations: [formatted],
        importance: 8,
      }]);
    } else {
      const { ObservationManager } = await import('../core/ObservationManager.js');
      const om = new ObservationManager(this.storage as any);
      await om.addObservations([{ entityName, contents: [formatted] }]);
    }
  }

  /**
   * Read recent diary entries for a specialist agent.
   * Returns entries in reverse chronological order.
   */
  async readDiary(
    agentId: string,
    options?: { lastN?: number; topic?: string }
  ): Promise<string[]> {
    const entityName = `diary-${agentId}`;
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find((e: any) => e.name === entityName);

    if (!entity) return [];

    let entries = [...entity.observations];

    // Filter by topic
    if (options?.topic) {
      entries = entries.filter(e => e.includes(`[${options.topic}]`));
    }

    // Sort reverse-chronological (timestamps at start make lexicographic sort work)
    entries.sort((a, b) => b.localeCompare(a));

    // Limit
    const limit = options?.lastN ?? 10;
    return entries.slice(0, limit);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent/agent-memory-manager-diary.test.ts`
Expected: 6 PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```
feat(agent): Add AgentMemoryManager.writeDiary/readDiary

Specialist agent diary system. Each agent gets a diary-{agentId}
entity with timestamped, topic-tagged observations. Supports
reverse-chronological reading with topic filtering.
diary-* namespace reserved in EntityManager.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 6: Zero-config semantic search

**Files:**
- Modify: `src/core/ManagerContext.ts`
- Test: `tests/unit/core/manager-context-default-embedding.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/manager-context-default-embedding.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Zero-config semantic search default', () => {
  const originalEnv = process.env.MEMORY_EMBEDDING_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MEMORY_EMBEDDING_PROVIDER;
    } else {
      process.env.MEMORY_EMBEDDING_PROVIDER = originalEnv;
    }
  });

  it('defaults embedding provider to local when env var not set', () => {
    delete process.env.MEMORY_EMBEDDING_PROVIDER;
    // Re-import to pick up changed env
    const { getEmbeddingConfig } = require('../../../src/utils/constants.js');
    const config = getEmbeddingConfig();
    expect(config.provider).toBe('local');
  });

  it('respects explicit none setting', () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const { getEmbeddingConfig } = require('../../../src/utils/constants.js');
    const config = getEmbeddingConfig();
    expect(config.provider).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/manager-context-default-embedding.test.ts`

- [ ] **Step 3: Change default in constants**

Find `src/utils/constants.ts` or wherever `getEmbeddingConfig` is defined. Change the default provider from `'none'` to `'local'`:

```typescript
// Before:
const provider = process.env.MEMORY_EMBEDDING_PROVIDER || 'none';

// After:
const provider = process.env.MEMORY_EMBEDDING_PROVIDER || 'local';
```

Also add a graceful fallback in the `SemanticSearch` constructor or `EmbeddingService` initialization: if `local` provider fails to initialize (ONNX not available), log a warning and fall back to `none`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/manager-context-default-embedding.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -5`
Expected: no new failures (some existing tests may need `MEMORY_EMBEDDING_PROVIDER=none` if they don't want embeddings).

- [ ] **Step 6: Commit**

```
feat(search): Default embedding provider to local (zero-config semantic)

Semantic search now works out of the box without setting
MEMORY_EMBEDDING_PROVIDER. Defaults to 'local' (ONNX MiniLM model).
Falls back to 'none' if ONNX runtime unavailable.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 7: Auto-save hooks

**Files:**
- Create: `hooks/memoryjs_save_hook.sh`
- Create: `hooks/memoryjs_precompact_hook.sh`
- Create: `hooks/README.md`

- [ ] **Step 1: Create save hook**

Create `hooks/memoryjs_save_hook.sh`:

```bash
#!/bin/bash
# Auto-save hook for Claude Code — fires on Stop event
# Creates a session-save entity with timestamp

MEMORY_FILE="${MEMORY_FILE_PATH:-$HOME/.memoryjs/memory.jsonl}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

memoryjs entity create \
  --name "session-save-${TIMESTAMP}" \
  --type "session-save" \
  --observation "Auto-saved at ${TIMESTAMP}" \
  --tag "auto-save" \
  --storage "$MEMORY_FILE" 2>/dev/null || true
```

- [ ] **Step 2: Create precompact hook**

Create `hooks/memoryjs_precompact_hook.sh`:

```bash
#!/bin/bash
# Emergency save hook — fires before context compression
# Synchronous (blocks until complete)

MEMORY_FILE="${MEMORY_FILE_PATH:-$HOME/.memoryjs/memory.jsonl}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

memoryjs entity create \
  --name "precompact-save-${TIMESTAMP}" \
  --type "session-save" \
  --observation "Emergency save before compaction at ${TIMESTAMP}" \
  --tag "auto-save" --tag "precompact" \
  --storage "$MEMORY_FILE" || true
```

- [ ] **Step 3: Create README**

Create `hooks/README.md`:

```markdown
# MemoryJS Auto-Save Hooks

Shell scripts for Claude Code that automatically save memories during work.

## Setup

Add to your Claude Code `settings.json`:

\`\`\`json
{
  "hooks": {
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/hooks/memoryjs_save_hook.sh"}]}],
    "PreCompact": [{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/hooks/memoryjs_precompact_hook.sh"}]}]
  }
}
\`\`\`

## Hooks

- **Save Hook**: Fires on every Stop event. Creates a session-save entity.
- **PreCompact Hook**: Fires before context compression. Synchronous emergency save.

Both use `$MEMORY_FILE_PATH` env var (default: `~/.memoryjs/memory.jsonl`).
```

- [ ] **Step 4: Make scripts executable**

```bash
chmod +x hooks/memoryjs_save_hook.sh hooks/memoryjs_precompact_hook.sh
```

- [ ] **Step 5: Commit**

```
feat(hooks): Add auto-save hooks for Claude Code

Save hook (Stop event) and PreCompact hook for automatic
session memory preservation. Shell scripts calling memoryjs CLI.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Task 8: Release prep (v1.9.0)

**Files:**
- Modify: `package.json` (version bump)
- Modify: `CHANGELOG.md`
- Modify: `docs/roadmap/GAP_ANALYSIS_VS_MEMPALACE.md` (status update)

- [ ] **Step 1: Bump version**

In `package.json`, change version to `"1.9.0"`.

- [ ] **Step 2: Add CHANGELOG entry**

Add at top of CHANGELOG.md:

```markdown
## [1.9.0] - 2026-04-10

### Added — MemPalace Gap-Closing

- **Temporal KG Methods**: `RelationManager.invalidateRelation()`, `queryAsOf()`, `timeline()` — temporal validity convenience methods over existing Relation properties.
- **Memory Stack Wake-up**: `ContextWindowManager.wakeUp()` — 4-layer memory stack. L0 (~100 tokens) loads profile identity, L1 (~500 tokens) loads top entities by importance.
- **Conversation Ingestion**: `IOManager.ingest()` — format-agnostic pipeline accepting pre-normalized messages. Exchange-pair chunking, dedup, dryRun support.
- **Agent Diary**: `AgentMemoryManager.writeDiary()` / `readDiary()` — per-agent persistent journal with timestamped, topic-tagged entries. `diary-*` namespace reserved.
- **Zero-Config Semantic Search**: Default embedding provider changed from `none` to `local`. Semantic search works out of the box without API keys.
- **Auto-Save Hooks**: `hooks/memoryjs_save_hook.sh` and `hooks/memoryjs_precompact_hook.sh` for Claude Code.
```

- [ ] **Step 3: Update gap analysis status**

In `docs/roadmap/GAP_ANALYSIS_VS_MEMPALACE.md`, update the implementation order table rows 1-5 from "Not started" to "✅ v1.9.0". Leave Benchmarking and AAAK as "Not started".

- [ ] **Step 4: Final verification**

```bash
npm run typecheck
SKIP_BENCHMARKS=true npm test 2>&1 | tail -5
npm run build
```

- [ ] **Step 5: Commit**

```
chore(release): Bump version to 1.9.0

MemPalace gap-closing complete:
- Temporal KG methods
- Memory Stack wake-up
- Conversation Ingestion
- Agent Diary
- Zero-config semantic search
- Auto-save hooks

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Self-Review

- [x] **Spec coverage**: All 7 features have tasks. Feature 7 (Benchmarks) deferred to separate effort — it's an L-effort standalone tool, not a library change.
- [x] **No placeholders**: All code steps have actual code blocks.
- [x] **Type consistency**: `IngestInput`, `IngestOptions`, `IngestResult` used consistently. `WakeUpOptions`, `WakeUpResult` stable. `invalidateRelation`, `queryAsOf`, `timeline` signatures match between test and implementation.
- [x] **TDD**: Every task has Test → Fail → Implement → Pass → Commit.
- [x] **Frequent commits**: 7 commits across 8 tasks (hooks and release are non-TDD).
