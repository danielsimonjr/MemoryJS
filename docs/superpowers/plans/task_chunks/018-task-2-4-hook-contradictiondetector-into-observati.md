### Task 2.4: Hook ContradictionDetector into ObservationManager

**Files:**
- Modify: `src/core/ObservationManager.ts`
- Modify: `src/core/ManagerContext.ts`
- Test: `tests/integration/core/observation-manager-contradiction.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/core/observation-manager-contradiction.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ObservationManager triggers contradiction detection', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-om-cd-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    const mockDetector = new ContradictionDetector(
      { calculateSimilarity: async () => 0.95 } as any,
      0.85
    );
    ctx.observationManager.setContradictionDetector(mockDetector, ctx.entityManager);

    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Lives in NYC'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates new version instead of appending when contradiction detected', async () => {
    await ctx.observationManager.addObservations([
      { entityName: 'alice', contents: ['Lives in SF'] },
    ]);

    const newVersion = await ctx.entityManager.getEntity('alice-v2');
    expect(newVersion).toBeDefined();
    expect(newVersion!.observations).toContain('Lives in SF');

    const oldVersion = await ctx.entityManager.getEntity('alice');
    expect(oldVersion!.isLatest).toBe(false);
    expect(oldVersion!.supersededBy).toBe('alice-v2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/core/observation-manager-contradiction.test.ts`
Expected: FAIL — `setContradictionDetector` does not exist.

- [ ] **Step 3: Add setter and detection hook to ObservationManager**

In `src/core/ObservationManager.ts`:

```typescript
import type { ContradictionDetector } from '../features/ContradictionDetector.js';
import type { EntityManager } from './EntityManager.js';

export class ObservationManager {
  private contradictionDetector?: ContradictionDetector;
  private linkedEntityManager?: EntityManager;

  // ... existing constructor ...

  setContradictionDetector(
    detector: ContradictionDetector,
    entityManager: EntityManager
  ): void {
    this.contradictionDetector = detector;
    this.linkedEntityManager = entityManager;
  }
}
```

In `addObservations`, around line 67 (after the `newObservations` filter, before `entity.observations.push(...)`):

```typescript
      if (this.contradictionDetector && this.linkedEntityManager) {
        const contradictions = await this.contradictionDetector.detect(
          entity,
          newObservations
        );
        if (contradictions.length > 0) {
          await this.contradictionDetector.supersede(
            entity,
            newObservations,
            this.linkedEntityManager
          );
          continue;
        }
      }
```

- [ ] **Step 4: Wire detector in ManagerContext when enabled**

In `src/core/ManagerContext.ts`:
- Add `enableContradictionDetection?: boolean` and `contradictionThreshold?: number` to `ManagerContextOptions`
- Add a private `initContradictionDetection()` method that, when the option is set and `semanticSearch` is configured, constructs a `ContradictionDetector` and calls `observationManager.setContradictionDetector(detector, this.entityManager)`
- Call `initContradictionDetection()` once during first access to observationManager, or eagerly in the constructor if safe

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/core/observation-manager-contradiction.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 7: Commit**

Message: `feat(core): Hook ContradictionDetector into ObservationManager`

---
