/**
 * EvidencePathBuilder Unit Tests
 *
 * R2: traceable evidence paths — bounded BFS from query anchors to results.
 */

import { describe, it, expect } from 'vitest';
import {
  EvidencePathBuilder,
  DEFAULT_EVIDENCE_MAX_DEPTH,
  DEFAULT_EVIDENCE_MAX_PATHS_PER_RESULT,
  type EvidenceAnchor,
} from '../../../src/search/EvidencePathBuilder.js';
import type { EvidencePath } from '../../../src/types/search.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../../src/types/index.js';

const entity = (name: string): Entity => ({
  name,
  entityType: 'node',
  observations: [`about ${name}`],
});

const graphOf = (
  names: string[],
  relations: Array<[string, string, string?]>
): ReadonlyKnowledgeGraph => ({
  entities: names.map(entity),
  relations: relations.map(([from, to, relationType]) => ({
    from,
    to,
    relationType: relationType ?? 'connects',
  })),
});

/** Assert structural validity: endpoints chain and every relation exists in the graph. */
function assertPathValid(path: EvidencePath, graph: ReadonlyKnowledgeGraph): void {
  expect(path.nodes.length).toBe(path.relations.length + 1);
  expect(path.nodes[0]).toBe(path.anchor);
  path.relations.forEach((rel, i) => {
    const a = path.nodes[i];
    const b = path.nodes[i + 1];
    // Relation connects consecutive nodes in either stored direction
    expect((rel.from === a && rel.to === b) || (rel.from === b && rel.to === a)).toBe(true);
    // Relation exists verbatim in the graph
    expect(
      graph.relations.some(
        r => r.from === rel.from && r.to === rel.to && r.relationType === rel.relationType
      )
    ).toBe(true);
  });
}

const anchor = (name: string, viaLayer: EvidenceAnchor['viaLayer'] = 'lexical', score?: number) =>
  ({ name, viaLayer, score }) as EvidenceAnchor;

describe('EvidencePathBuilder', () => {
  it('exports the documented default caps', () => {
    expect(DEFAULT_EVIDENCE_MAX_DEPTH).toBe(3);
    expect(DEFAULT_EVIDENCE_MAX_PATHS_PER_RESULT).toBe(3);
  });

  it('returns a trivial single-node path when the result is itself an anchor', () => {
    const graph = graphOf(['A', 'B'], [['A', 'B']]);
    const builder = new EvidencePathBuilder(graph);

    const { paths, truncated } = builder.buildForResult('A', [anchor('A', 'semantic')]);

    expect(paths).toEqual([
      { nodes: ['A'], relations: [], anchor: 'A', viaLayer: 'semantic' },
    ]);
    expect(truncated).toBe(false);
  });

  it('finds the shortest path from an anchor to the result', () => {
    // Two routes B -> ... -> D: direct (1 hop) and via C (2 hops)
    const graph = graphOf(
      ['B', 'C', 'D'],
      [
        ['B', 'C'],
        ['C', 'D'],
        ['B', 'D', 'shortcut'],
      ]
    );
    const builder = new EvidencePathBuilder(graph);

    const { paths } = builder.buildForResult('D', [anchor('B')]);

    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['B', 'D']);
    expect(paths[0].relations).toEqual([{ from: 'B', to: 'D', relationType: 'shortcut' }]);
    assertPathValid(paths[0], graph);
  });

  it('traverses relations in either direction while preserving stored direction', () => {
    // Stored direction points result -> anchor; traversal must still connect them
    const graph = graphOf(['R', 'X', 'A'], [
      ['R', 'X', 'derived_from'],
      ['X', 'A', 'cites'],
    ]);
    const builder = new EvidencePathBuilder(graph);

    const { paths } = builder.buildForResult('R', [anchor('A', 'symbolic')]);

    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['A', 'X', 'R']);
    expect(paths[0].viaLayer).toBe('symbolic');
    assertPathValid(paths[0], graph);
  });

  it('produces one path per anchor, strongest anchors first', () => {
    const graph = graphOf(['R', 'A1', 'A2'], [
      ['A1', 'R'],
      ['A2', 'R'],
    ]);
    const builder = new EvidencePathBuilder(graph);

    const { paths, truncated } = builder.buildForResult('R', [
      anchor('A1', 'lexical', 0.2),
      anchor('A2', 'semantic', 0.9),
    ]);

    expect(paths.map(p => p.anchor)).toEqual(['A2', 'A1']);
    expect(paths[0].viaLayer).toBe('semantic');
    expect(paths[1].viaLayer).toBe('lexical');
    expect(truncated).toBe(false);
  });

  it('caps paths at maxPathsPerResult and sets truncated when anchors remain', () => {
    const graph = graphOf(['R', 'A1', 'A2', 'A3'], [
      ['A1', 'R'],
      ['A2', 'R'],
      ['A3', 'R'],
    ]);
    const builder = new EvidencePathBuilder(graph, { maxPathsPerResult: 2 });

    const { paths, truncated } = builder.buildForResult('R', [
      anchor('A1', 'lexical', 3),
      anchor('A2', 'lexical', 2),
      anchor('A3', 'lexical', 1),
    ]);

    expect(paths).toHaveLength(2);
    expect(paths.map(p => p.anchor)).toEqual(['A1', 'A2']);
    expect(truncated).toBe(true);
  });

  it('respects maxDepth and sets truncated when a deeper path may exist', () => {
    // A - M1 - M2 - R : 3 hops, cap at 2
    const graph = graphOf(['A', 'M1', 'M2', 'R'], [
      ['A', 'M1'],
      ['M1', 'M2'],
      ['M2', 'R'],
    ]);
    const builder = new EvidencePathBuilder(graph, { maxDepth: 2 });

    const { paths, truncated } = builder.buildForResult('R', [anchor('A')]);

    expect(paths).toHaveLength(0);
    expect(truncated).toBe(true);
  });

  it('finds the same path once maxDepth admits it', () => {
    const graph = graphOf(['A', 'M1', 'M2', 'R'], [
      ['A', 'M1'],
      ['M1', 'M2'],
      ['M2', 'R'],
    ]);
    const builder = new EvidencePathBuilder(graph, { maxDepth: 3 });

    const { paths, truncated } = builder.buildForResult('R', [anchor('A')]);

    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['A', 'M1', 'M2', 'R']);
    expect(truncated).toBe(false);
    assertPathValid(paths[0], graph);
  });

  it('does not set truncated for a genuinely unreachable anchor (graph exhausted)', () => {
    // Anchor component fully explored within depth; no connection to R
    const graph = graphOf(['A', 'B', 'R'], [['A', 'B']]);
    const builder = new EvidencePathBuilder(graph);

    const { paths, truncated } = builder.buildForResult('R', [anchor('A')]);

    expect(paths).toHaveLength(0);
    expect(truncated).toBe(false);
  });

  it('deduplicates anchors by name (first occurrence wins)', () => {
    const graph = graphOf(['R', 'A'], [['A', 'R']]);
    const builder = new EvidencePathBuilder(graph);

    const { paths } = builder.buildForResult('R', [
      anchor('A', 'semantic', 0.9),
      anchor('A', 'lexical', 0.5),
    ]);

    expect(paths).toHaveLength(1);
    expect(paths[0].viaLayer).toBe('semantic');
  });

  it('ignores self-loop relations', () => {
    const graph = graphOf(['R', 'A'], [
      ['A', 'A', 'self'],
      ['A', 'R'],
    ]);
    const builder = new EvidencePathBuilder(graph);

    const { paths } = builder.buildForResult('R', [anchor('A')]);

    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['A', 'R']);
  });

  it('handles anchors with no edges at all', () => {
    const graph = graphOf(['R', 'Lonely'], []);
    const builder = new EvidencePathBuilder(graph);

    const { paths, truncated } = builder.buildForResult('R', [anchor('Lonely')]);

    expect(paths).toHaveLength(0);
    expect(truncated).toBe(false);
  });
});
