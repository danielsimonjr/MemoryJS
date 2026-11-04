/**
 * Direct unit tests for selectWeightedTurns (CMP-5).
 */

import { describe, it, expect } from 'vitest';
import { selectWeightedTurns } from '../../../src/agent/selectWeightedTurns.js';
import type { WeightedTurn } from '../../../src/agent/MemoryBackend.js';

interface Item {
  id: string;
  score: number;
}

const project = (item: Item): WeightedTurn =>
  ({ turn: { id: item.id }, score: item.score }) as unknown as WeightedTurn;

const ids = (turns: WeightedTurn[]): string[] =>
  turns.map(t => (t.turn as unknown as { id: string }).id);

describe('selectWeightedTurns', () => {
  const items: Item[] = [
    { id: 'low', score: 0.1 },
    { id: 'mid', score: 0.5 },
    { id: 'high', score: 0.9 },
    { id: 'edge', score: 0.3 },
  ];

  it('filters out scores below the threshold', () => {
    const out = selectWeightedTurns(items, project, 0.3, 10);
    expect(ids(out)).toEqual(['high', 'mid', 'edge']);
  });

  it('keeps a score exactly equal to the threshold (inclusive)', () => {
    const out = selectWeightedTurns(items, project, 0.5, 10);
    expect(ids(out)).toEqual(['high', 'mid']);
  });

  it('sorts descending by score', () => {
    const out = selectWeightedTurns(items, project, 0, 10);
    expect(out.map(t => t.score)).toEqual([0.9, 0.5, 0.3, 0.1]);
  });

  it('applies the limit after sorting, keeping the highest scores', () => {
    const out = selectWeightedTurns(items, project, 0, 2);
    expect(ids(out)).toEqual(['high', 'mid']);
  });

  it('returns an empty array when nothing passes the threshold', () => {
    expect(selectWeightedTurns(items, project, 1, 5)).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(selectWeightedTurns([] as Item[], project, 0, 5)).toEqual([]);
  });

  it('returns nothing when limit is 0', () => {
    expect(selectWeightedTurns(items, project, 0, 0)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const copy = items.map(i => ({ ...i }));
    selectWeightedTurns(items, project, 0, 10);
    expect(items).toEqual(copy);
  });

  it('calls project once per item', () => {
    let calls = 0;
    selectWeightedTurns(items, item => {
      calls++;
      return project(item);
    }, 0, 10);
    expect(calls).toBe(items.length);
  });
});
