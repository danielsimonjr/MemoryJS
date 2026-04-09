### Task 3.1: Create SemanticForget class (exact-match path)

**Files:**
- Create: `src/features/SemanticForget.ts`
- Test: `tests/unit/features/semantic-forget-exact.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/semantic-forget-exact.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { SemanticForget } from '../../../src/features/SemanticForget.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SemanticForget exact match path', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let forget: SemanticForget;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sf-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC', 'Likes coffee'],
      },
      {
        name: 'bob',
        entityType: 'person',
        observations: ['Lives in NYC', 'Hates tea'],
      },
    ]);
    forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes exact-matching observation across all entities', async () => {
    const result = await forget.forgetByContent('Lives in NYC');
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(2);
    expect(result.deletedObservations.map(d => d.entityName).sort()).toEqual(['alice', 'bob']);
  });

  it('returns not_found for missing content', async () => {
    const result = await forget.forgetByContent('Lives in Mars');
    expect(result.method).toBe('not_found');
    expect(result.deletedObservations).toHaveLength(0);
  });

  it('dryRun does not mutate storage', async () => {
    const result = await forget.forgetByContent('Lives in NYC', { dryRun: true });
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(2);

    const alice = await ctx.entityManager.getEntity('alice');
    expect(alice!.observations).toContain('Lives in NYC');
  });

  it('deletes entity when all observations are removed', async () => {
    await ctx.entityManager.createEntities([
      { name: 'carol', entityType: 'person', observations: ['Only fact'] },
    ]);
    const result = await forget.forgetByContent('Only fact');
    expect(result.deletedEntities).toContain('carol');

    const carol = await ctx.entityManager.getEntity('carol');
    expect(carol).toBeNull();
  });

  it('respects projectId filter', async () => {
    await ctx.entityManager.createEntities([
      { name: 'dan', entityType: 'person', observations: ['Lives in NYC'], projectId: 'p1' },
    ]);
    const result = await forget.forgetByContent('Lives in NYC', { projectId: 'p1' });
    expect(result.deletedObservations).toHaveLength(1);
    expect(result.deletedObservations[0].entityName).toBe('dan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/semantic-forget-exact.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create SemanticForget module**

Create `src/features/SemanticForget.ts`:

```typescript
/**
 * Semantic Forget
 *
 * Two-tier deletion: exact match first, then semantic search fallback.
 * Feature 3 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/SemanticForget
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { AuditLog } from './AuditLog.js';
import type { Entity } from '../types/types.js';

export interface ForgetResult {
  method: 'exact' | 'semantic' | 'not_found';
  deletedObservations: { entityName: string; observation: string }[];
  deletedEntities: string[];
  similarity?: number;
}

export interface ForgetOptions {
  threshold?: number;
  projectId?: string;
  dryRun?: boolean;
  agentId?: string;
}

export class SemanticForget {
  constructor(
    private storage: GraphStorage,
    private observationManager: ObservationManager,
    private entityManager: EntityManager,
    private semanticSearch?: SemanticSearch,
    private auditLog?: AuditLog
  ) {}

  async forgetByContent(
    content: string,
    options: ForgetOptions = {}
  ): Promise<ForgetResult> {
    const projectId = options.projectId;
    const dryRun = options.dryRun ?? false;

    const graph = await this.storage.loadGraph();
    const candidates = graph.entities.filter(e =>
      (projectId === undefined || e.projectId === projectId) &&
      e.observations.includes(content)
    );

    if (candidates.length > 0) {
      return this.executeDelete(candidates, content, 'exact', dryRun, options);
    }

    if (this.semanticSearch) {
      return this.semanticFallback(content, options);
    }

    return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
  }

  private async executeDelete(
    entities: Entity[],
    content: string,
    method: 'exact' | 'semantic',
    dryRun: boolean,
    options: ForgetOptions,
    similarity?: number
  ): Promise<ForgetResult> {
    const deletedObservations: { entityName: string; observation: string }[] = [];
    const deletedEntities: string[] = [];

    for (const entity of entities) {
      deletedObservations.push({ entityName: entity.name, observation: content });

      if (dryRun) continue;

      const before = { ...entity, observations: [...entity.observations] };

      await this.observationManager.deleteObservations([
        { entityName: entity.name, observations: [content] },
      ]);

      const reloaded = await this.entityManager.getEntity(entity.name);
      if (reloaded && reloaded.observations.length === 0) {
        await this.entityManager.deleteEntities([entity.name]);
        deletedEntities.push(entity.name);
      }

      if (this.auditLog) {
        await this.auditLog.append({
          operation: 'delete',
          entityName: entity.name,
          agentId: options.agentId,
          before,
          after: undefined,
          status: 'committed',
        });
      }
    }

    return {
      method,
      deletedObservations,
      deletedEntities,
      ...(similarity !== undefined && { similarity }),
    };
  }

  private async semanticFallback(
    content: string,
    options: ForgetOptions
  ): Promise<ForgetResult> {
    // Implemented in Task 3.2
    return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/features/semantic-forget-exact.test.ts && npm run typecheck`
Expected: PASS (5 tests), no type errors.

- [ ] **Step 5: Commit**

Message: `feat(features): Add SemanticForget with exact-match path`

---
