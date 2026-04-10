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
