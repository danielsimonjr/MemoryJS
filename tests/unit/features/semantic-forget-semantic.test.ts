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
