/**
 * SynonymManager Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SynonymManager } from '../../../src/search/SynonymManager.js';

describe('SynonymManager', () => {
  let storage: GraphStorage;
  let dir: string;
  const ORIGINAL_ENV = process.env.MEMORY_SYNONYM_EXPANSION;

  beforeEach(async () => {
    dir = join(tmpdir(), `synonym-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storage = new GraphStorage(join(dir, 'mem.jsonl'));
    await storage.saveGraph({
      entities: [
        { name: 'A', entityType: 'note', observations: ['cars automobile vehicle highway'] },
        { name: 'B', entityType: 'note', observations: ['cars automobile fuel mileage'] },
        { name: 'C', entityType: 'note', observations: ['cookery onion garlic recipe'] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
    if (ORIGINAL_ENV === undefined) delete process.env.MEMORY_SYNONYM_EXPANSION;
    else process.env.MEMORY_SYNONYM_EXPANSION = ORIGINAL_ENV;
  });

  it('add() registers a symmetric synonym group', () => {
    process.env.MEMORY_SYNONYM_EXPANSION = 'true';
    const m = new SynonymManager(storage);
    m.add(['car', 'automobile', 'vehicle']);
    expect(m.lookup('car').sort()).toEqual(['automobile', 'vehicle']);
    expect(m.lookup('automobile').sort()).toEqual(['car', 'vehicle']);
    expect(m.lookup('vehicle').sort()).toEqual(['automobile', 'car']);
    expect(m.size()).toBe(3);
  });

  it('lookup returns [] when expansion is disabled', () => {
    delete process.env.MEMORY_SYNONYM_EXPANSION;
    const m = new SynonymManager(storage);
    m.add(['car', 'automobile']);
    expect(m.lookup('car')).toEqual([]);
    expect(m.enabled).toBe(false);
  });

  it('expand() inserts each token plus its synonyms grouped in parentheses', () => {
    process.env.MEMORY_SYNONYM_EXPANSION = 'true';
    const m = new SynonymManager(storage);
    m.add(['car', 'automobile']);
    const result = m.expand('car cheap');
    expect(result.hadExpansion).toBe(true);
    expect(result.expanded).toContain('(car automobile)');
    // 'cheap' has no synonyms; passes through verbatim.
    expect(result.expanded).toContain('cheap');
  });

  it('expand() is a no-op when disabled', () => {
    delete process.env.MEMORY_SYNONYM_EXPANSION;
    const m = new SynonymManager(storage);
    m.add(['car', 'automobile']);
    const result = m.expand('car cheap');
    expect(result.hadExpansion).toBe(false);
    expect(result.expanded).toBe('car cheap');
  });

  it('autoDetectFromGraph adds frequent co-occurrence pairs', async () => {
    process.env.MEMORY_SYNONYM_EXPANSION = 'true';
    const m = new SynonymManager(storage);
    // 'cars' + 'automobile' co-occur in entities A and B (twice).
    const added = await m.autoDetectFromGraph({ minSupport: 2 });
    expect(added).toBeGreaterThan(0);
    expect(m.lookup('cars')).toContain('automobile');
  });

  it('autoDetectFromGraph respects minSupport (sparse pairs not added)', async () => {
    process.env.MEMORY_SYNONYM_EXPANSION = 'true';
    const m = new SynonymManager(storage);
    // Onion+garlic only appear in entity C — single observation. minSupport=2.
    await m.autoDetectFromGraph({ minSupport: 2 });
    expect(m.lookup('onion')).not.toContain('garlic');
  });

  it('add() with a group of < 2 terms is a no-op', () => {
    process.env.MEMORY_SYNONYM_EXPANSION = 'true';
    const m = new SynonymManager(storage);
    m.add(['singleton']);
    expect(m.size()).toBe(0);
  });

  it('clear() drops every mapping', () => {
    process.env.MEMORY_SYNONYM_EXPANSION = 'true';
    const m = new SynonymManager(storage);
    m.add(['x', 'y']);
    expect(m.size()).toBe(2);
    m.clear();
    expect(m.size()).toBe(0);
  });
});
