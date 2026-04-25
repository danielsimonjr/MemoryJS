### Task 2.1: Create ContradictionDetector class (detection only)

**Files:**
- Create: `src/features/ContradictionDetector.ts`
- Test: `tests/unit/features/contradiction-detector-detect.test.ts` (create)

- [x] **Step 1: Write the failing test**

Create `tests/unit/features/contradiction-detector-detect.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import type { Entity } from '../../../src/types/types.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';

function mockSemanticSearch(similarityMap: Record<string, number>): SemanticSearch {
  return {
    calculateSimilarity: vi.fn(async (a: string, b: string) => {
      return similarityMap[`${a}|${b}`] ?? 0;
    }),
  } as unknown as SemanticSearch;
}

describe('ContradictionDetector.detect', () => {
  const entity: Entity = {
    name: 'alice',
    entityType: 'person',
    observations: ['Lives in NYC', 'Works at TechCorp'],
  };

  it('detects high-similarity contradiction', async () => {
    const sem = mockSemanticSearch({
      'Lives in SF|Lives in NYC': 0.92,
      'Lives in SF|Works at TechCorp': 0.1,
    });
    const detector = new ContradictionDetector(sem, 0.85);
    const results = await detector.detect(entity, ['Lives in SF']);
    expect(results).toHaveLength(1);
    expect(results[0].existingObservation).toBe('Lives in NYC');
    expect(results[0].newObservation).toBe('Lives in SF');
    expect(results[0].similarity).toBe(0.92);
  });

  it('does not flag low-similarity additions', async () => {
    const sem = mockSemanticSearch({
      'Enjoys hiking|Lives in NYC': 0.05,
      'Enjoys hiking|Works at TechCorp': 0.1,
    });
    const detector = new ContradictionDetector(sem, 0.85);
    const results = await detector.detect(entity, ['Enjoys hiking']);
    expect(results).toHaveLength(0);
  });

  it('respects custom threshold', async () => {
    const sem = mockSemanticSearch({
      'Kinda similar|Lives in NYC': 0.75,
      'Kinda similar|Works at TechCorp': 0.2,
    });
    const low = new ContradictionDetector(sem, 0.7);
    expect(await low.detect(entity, ['Kinda similar'])).toHaveLength(1);

    const high = new ContradictionDetector(sem, 0.9);
    expect(await high.detect(entity, ['Kinda similar'])).toHaveLength(0);
  });

  it('returns empty when entity has no observations', async () => {
    const empty: Entity = { name: 'empty', entityType: 'x', observations: [] };
    const sem = mockSemanticSearch({});
    const detector = new ContradictionDetector(sem, 0.85);
    expect(await detector.detect(empty, ['foo'])).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/contradiction-detector-detect.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Create ContradictionDetector**

Create `src/features/ContradictionDetector.ts`:

```typescript
/**
 * Contradiction Detector
 *
 * Detects when new observations contradict existing ones using semantic
 * similarity. Feature 2 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/ContradictionDetector
 */

import type { Entity } from '../types/types.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';

export interface Contradiction {
  existingObservation: string;
  newObservation: string;
  similarity: number;
}

export class ContradictionDetector {
  constructor(
    private semanticSearch: SemanticSearch,
    private threshold: number = 0.85
  ) {}

  async detect(
    entity: Entity,
    newObservations: string[]
  ): Promise<Contradiction[]> {
    if (entity.observations.length === 0) return [];
    if (newObservations.length === 0) return [];

    const contradictions: Contradiction[] = [];

    for (const newObs of newObservations) {
      for (const existingObs of entity.observations) {
        if (newObs === existingObs) continue;
        const similarity = await this.semanticSearch.calculateSimilarity(
          newObs,
          existingObs
        );
        if (similarity >= this.threshold) {
          contradictions.push({
            existingObservation: existingObs,
            newObservation: newObs,
            similarity,
          });
        }
      }
    }

    return contradictions;
  }
}
```

- [x] **Step 4: Ensure SemanticSearch has calculateSimilarity method**

Check `src/search/SemanticSearch.ts`. If a `calculateSimilarity(a: string, b: string): Promise<number>` method does not exist, add one that embeds both strings via `this.embeddingService.embed()` and returns cosine similarity. Reuse any existing `cosineSimilarity` helper in the module.

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/contradiction-detector-detect.test.ts`
Expected: PASS (4 tests).

- [x] **Step 6: Commit**

Message: `feat(features): Add ContradictionDetector.detect() with semantic similarity`

---
