/**
 * AnomalyDetector Unit Tests
 *
 * Covers Phase 5 step 51: structural + semantic anomaly detection.
 */

import { describe, it, expect } from 'vitest';
import {
  detectStructuralAnomalies,
  detectSemanticAnomalies,
  detectAllAnomalies,
} from '../../../src/features/AnomalyDetector.js';
import type { Entity, Relation, KnowledgeGraph } from '../../../src/types/types.js';

function ent(name: string): Entity {
  return { name, entityType: 'node', observations: [] };
}

function hubGraph(): KnowledgeGraph {
  // Hub: `hub` connects to 10 spokes, each spoke connects only to hub.
  const entities = [ent('hub'), ...Array.from({ length: 10 }, (_, i) => ent(`s${i}`))];
  const relations: Relation[] = entities
    .filter((e) => e.name !== 'hub')
    .map((e) => ({ from: 'hub', to: e.name, relationType: 'connects' }));
  return { entities, relations };
}

describe('detectStructuralAnomalies', () => {
  it('returns [] when all degrees are equal (zero variance)', () => {
    const entities = [ent('a'), ent('b'), ent('c'), ent('d')];
    const relations: Relation[] = [
      { from: 'a', to: 'b', relationType: 'link' },
      { from: 'b', to: 'c', relationType: 'link' },
      { from: 'c', to: 'd', relationType: 'link' },
      { from: 'd', to: 'a', relationType: 'link' },
    ];
    // Each node has in=1, out=1, total=2 — no variance.
    const reports = detectStructuralAnomalies({ entities, relations });
    expect(reports).toEqual([]);
  });

  it('flags the hub as a high-degree outlier', () => {
    const reports = detectStructuralAnomalies(hubGraph(), { zThreshold: 2 });
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]!.entityName).toBe('hub');
    expect(reports[0]!.kind).toBe('high-degree');
    expect(reports[0]!.zScore).toBeGreaterThan(2);
  });

  it('respects metric=in vs metric=out', () => {
    const reports = detectStructuralAnomalies(hubGraph(), {
      metric: 'in',
      zThreshold: 2,
    });
    // In hubGraph, the hub has in=0 but each spoke has in=1; no in-degree variance puts hub
    // as the only outlier on the low side, since hub.in=0 and avg.in=10/11.
    const hub = reports.find((r) => r.entityName === 'hub');
    expect(hub).toBeDefined();
  });

  it('topK caps result count', () => {
    const reports = detectStructuralAnomalies(hubGraph(), { zThreshold: 0.5, topK: 1 });
    expect(reports).toHaveLength(1);
  });

  it('respects zThreshold (raising the bar suppresses results)', () => {
    const high = detectStructuralAnomalies(hubGraph(), { zThreshold: 100 });
    expect(high).toEqual([]);
  });

  it('topK truncates after sorting by magnitude', () => {
    // Graph where multiple nodes deviate, but topK=1 only keeps the strongest.
    const graph: KnowledgeGraph = {
      entities: [
        ...Array.from({ length: 10 }, (_, i) => ent(`s${i}`)),
        ent('hub'),
        ent('isolate'),
      ],
      relations: Array.from({ length: 10 }, (_, i) => ({
        from: 'hub',
        to: `s${i}`,
        relationType: 'connects',
      })),
    };
    const reports = detectStructuralAnomalies(graph, { zThreshold: 0, topK: 1 });
    expect(reports).toHaveLength(1);
  });
});

describe('detectSemanticAnomalies', () => {
  it('returns [] when corpus is too small for k', () => {
    const e = new Map<string, Float32Array>([['a', new Float32Array([1, 0])]]);
    const reports = detectSemanticAnomalies(e, { k: 5 });
    expect(reports).toEqual([]);
  });

  it('flags a clear outlier in 2D embedding space', () => {
    const embeddings = new Map<string, Float32Array>();
    // 30 points clustered around (1, 0).
    for (let i = 0; i < 30; i++) {
      const theta = (Math.random() * 0.1 - 0.05);
      const v = new Float32Array([Math.cos(theta), Math.sin(theta)]);
      embeddings.set(`c${i}`, v);
    }
    // Outlier at (0, 1).
    embeddings.set('outlier', new Float32Array([0, 1]));

    const reports = detectSemanticAnomalies(embeddings, { k: 5, zThreshold: 2 });
    expect(reports.some((r) => r.entityName === 'outlier')).toBe(true);
  });

  it('returns [] when all distances are identical (zero variance)', () => {
    const embeddings = new Map<string, Float32Array>();
    // All point in the same direction.
    for (let i = 0; i < 20; i++) {
      embeddings.set(`v${i}`, new Float32Array([1, 0, 0]));
    }
    const reports = detectSemanticAnomalies(embeddings);
    expect(reports).toEqual([]);
  });
});

describe('detectAllAnomalies', () => {
  it('combines structural + semantic results', () => {
    const graph = hubGraph();
    const embeddings = new Map<string, Float32Array>();
    for (const e of graph.entities) {
      embeddings.set(e.name, new Float32Array([Math.random(), Math.random()]));
    }
    const reports = detectAllAnomalies(graph, embeddings, { zThreshold: 1 }, { zThreshold: 1 });
    expect(reports.length).toBeGreaterThan(0);
    // Sorted by magnitude descending.
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i - 1]!.magnitude).toBeGreaterThanOrEqual(reports[i]!.magnitude);
    }
  });

  it('skips semantic stage when embeddings=null', () => {
    const reports = detectAllAnomalies(hubGraph(), null, { zThreshold: 1 });
    for (const r of reports) {
      expect(r.kind).not.toBe('semantic-outlier');
    }
  });
});
