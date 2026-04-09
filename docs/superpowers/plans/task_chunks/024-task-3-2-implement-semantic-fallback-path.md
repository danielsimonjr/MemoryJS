### Task 3.2: Implement semantic fallback path

**Files:**
- Modify: `src/features/SemanticForget.ts`
- Test: `tests/unit/features/semantic-forget-semantic.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/semantic-forget-semantic.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { SemanticForget } from '../../../src/features/SemanticForget.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SemanticForget semantic fallback path', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sfs-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Resides in New York City', 'Enjoys espresso'],
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds and deletes semantically similar observation', async () => {
    const mockSearch = {
      search: vi.fn(async () => [
        { entity: { name: 'alice', observations: ['Resides in New York City', 'Enjoys espresso'] }, similarity: 0.89 },
      ]),
      calculateSimilarity: vi.fn(async (a: string, b: string) => {
        if (a === 'Lives in NYC' && b === 'Resides in New York City') return 0.91;
        if (a === 'Lives in NYC' && b === 'Enjoys espresso') return 0.05;
        return 0;
      }),
    } as unknown as SemanticSearch;

    const forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager,
      mockSearch
    );

    const result = await forget.forgetByContent('Lives in NYC', { threshold: 0.85 });
    expect(result.method).toBe('semantic');
    expect(result.deletedObservations).toHaveLength(1);
    expect(result.deletedObservations[0].observation).toBe('Resides in New York City');
    expect(result.similarity).toBeCloseTo(0.91, 2);
  });

  it('returns not_found when no observation passes threshold', async () => {
    const mockSearch = {
      search: vi.fn(async () => [
        { entity: { name: 'alice', observations: ['Resides in New York City'] }, similarity: 0.4 },
      ]),
      calculateSimilarity: vi.fn(async () => 0.4),
    } as unknown as SemanticSearch;

    const forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager,
      mockSearch
    );

    const result = await forget.forgetByContent('Lives in Mars', { threshold: 0.85 });
    expect(result.method).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/semantic-forget-semantic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement semanticFallback**

Replace the stub in `src/features/SemanticForget.ts`:

```typescript
  private async semanticFallback(
    content: string,
    options: ForgetOptions
  ): Promise<ForgetResult> {
    if (!this.semanticSearch) {
      return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
    }

    const threshold = options.threshold ?? 0.85;
    const graph = await this.storage.loadGraph();

    const searchResults = await this.semanticSearch.search(
      graph,
      content,
      5,
      threshold
    );

    if (searchResults.length === 0) {
      return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
    }

    let bestMatch: { entity: Entity; observation: string; similarity: number } | null = null;

    for (const result of searchResults) {
      const entity = result.entity;
      if (options.projectId !== undefined && entity.projectId !== options.projectId) {
        continue;
      }
      for (const obs of entity.observations) {
        const sim = await this.semanticSearch.calculateSimilarity(content, obs);
        if (sim >= threshold && (!bestMatch || sim > bestMatch.similarity)) {
          bestMatch = { entity, observation: obs, similarity: sim };
        }
      }
    }

    if (!bestMatch) {
      return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
    }

    return this.executeDelete(
      [bestMatch.entity],
      bestMatch.observation,
      'semantic',
      options.dryRun ?? false,
      options,
      bestMatch.similarity
    );
  }
```

- [ ] **Step 4: Run test + full SemanticForget suite**

Run: `npx vitest run tests/unit/features/semantic-forget-*.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

Message: `feat(features): Implement SemanticForget semantic fallback`

---
