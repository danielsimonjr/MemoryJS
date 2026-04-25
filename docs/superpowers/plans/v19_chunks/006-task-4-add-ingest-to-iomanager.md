## Task 4: Add `ingest` to IOManager

**Files:**
- Modify: `src/features/IOManager.ts`
- Test: `tests/unit/features/io-manager-ingest.test.ts` (create)

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/io-manager-ingest.test.ts`

- [x] **Step 3: Implement ingest**

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/io-manager-ingest.test.ts`
Expected: 6 PASS.

- [x] **Step 5: Export new types from index**

In `src/features/index.ts`, add:

```typescript
export type { IngestInput, IngestOptions, IngestResult } from './IOManager.js';
```

- [x] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```
feat(features): Add IOManager.ingest() for conversation ingestion

Format-agnostic ingestion pipeline. Accepts pre-normalized messages,
chunks by exchange pairs (user+assistant), creates entities with
verbatim observations. Supports projectId, tags, dedup, dryRun.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
