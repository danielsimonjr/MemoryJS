/**
 * Pin tests for ProximitySearch.findProximity and its position scan.
 *
 * Each golden value is the output of findProximity on a fixed text.
 * A Map of positions compares as a plain object here.
 */
import { describe, it, expect } from 'vitest';
import { ProximitySearch } from '../../../src/search/ProximitySearch.js';
import type { Entity } from '../../../src/types/index.js';
import type { ProximityNode } from '../../../src/types/search.js';

const entities: Entity[] = [
  { name: 'Alpha notes', entityType: 'note', observations: ['x alpha y z beta', 'gamma alpha'] },
  { name: 'Other', entityType: 'note', observations: ['alpha', 'beta gamma'] },
  { name: 'Full', entityType: 'note', observations: ['alpha x gamma beta y'] },
  { name: 'Zed', entityType: 'note', observations: ['nothing here'] },
];

/** Replace each Map of positions with a plain object, for comparison. */
const plain = (matches: ReturnType<ProximitySearch['search']>) =>
  matches.map(match => ({
    ...match,
    matches: match.matches.map(location => ({
      ...location,
      positions: Object.fromEntries(location.positions),
    })),
  }));

const node = (terms: string[], distance: number): ProximityNode => ({
  type: 'proximity',
  terms,
  distance,
});

describe('ProximitySearch findProximity pins', () => {
  it('matches two terms in one observation and returns the golden span', () => {
    const matches = plain(new ProximitySearch().search(entities, node(['alpha', 'gamma'], 3)));

    expect(matches).toStrictEqual([
      {
        entity: entities[0],
        score: 0.5,
        minDistance: 1,
        matches: [
          { field: 'observation', positions: { alpha: [1], gamma: [0] }, distance: 1 },
        ],
      },
      {
        entity: entities[2],
        score: 0.3333333333333333,
        minDistance: 2,
        matches: [
          { field: 'observation', positions: { alpha: [0], gamma: [2] }, distance: 2 },
        ],
      },
    ]);
  });

  it('returns distance 0 for a single term and keeps empty position lists', () => {
    const matches = plain(new ProximitySearch().search(entities, node(['beta'], 0)));

    expect(matches.map(match => match.entity.name)).toStrictEqual([
      'Alpha notes',
      'Other',
      'Full',
      'Zed',
    ]);
    expect(matches[0]).toStrictEqual({
      entity: entities[0],
      score: 1,
      minDistance: 0,
      matches: [
        { field: 'name', positions: { beta: [] }, distance: 0 },
        { field: 'observation', positions: { beta: [4] }, distance: 0 },
        { field: 'observation', positions: { beta: [] }, distance: 0 },
      ],
    });
  });

  it('returns no match when one term is absent from every field', () => {
    expect(new ProximitySearch().search(entities, node(['alpha', 'missing'], 9))).toStrictEqual([]);
  });

  it('returns the golden span for three terms in one observation', () => {
    const matches = plain(
      new ProximitySearch().search(entities, node(['alpha', 'beta', 'gamma'], 5)),
    );

    expect(matches).toStrictEqual([
      {
        entity: entities[2],
        score: 0.25,
        minDistance: 3,
        matches: [
          {
            field: 'observation',
            positions: { alpha: [0], beta: [3], gamma: [2] },
            distance: 3,
          },
        ],
      },
    ]);
  });

  it('returns no match for an empty term list', () => {
    expect(new ProximitySearch().search(entities, node([], 5))).toStrictEqual([]);
  });

  it('stops at the first absent term and never reads a later term', () => {
    const later = {
      toString() {
        throw new Error('a later term was read');
      },
    } as unknown as string;
    const search = new ProximitySearch();

    expect(search.search(entities, node(['missing', later], 9))).toStrictEqual([]);
    expect(() => search.search(entities, node(['alpha', later], 9))).toThrow('a later term was read');
  });

  it('keeps the two-term span of calculateProximityScore', () => {
    expect(ProximitySearch.calculateProximityScore('x alpha y z beta', 'alpha', 'beta', 5)).toBe(0.25);
  });
});
