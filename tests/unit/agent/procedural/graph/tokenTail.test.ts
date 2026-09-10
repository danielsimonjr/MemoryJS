import { describe, it, expect } from 'vitest';
import {
  concatTrajectories,
  tokenTail,
  type PGTokenizer,
} from '../../../../../src/agent/procedural/graph/tokenTail.js';
import type { PGTrajectory } from '../../../../../src/types/proceduralGraph.js';

/** Whitespace tokenizer defined in this test file (plan Section 2.4 / 5.3). */
function createWhitespaceTokenizer(): PGTokenizer {
  const vocab: string[] = [];
  const index = new Map<string, number>();

  function idFor(word: string): number {
    const existing = index.get(word);
    if (existing !== undefined) {
      return existing;
    }
    const id = vocab.length;
    vocab.push(word);
    index.set(word, id);
    return id;
  }

  return {
    encode(text: string): number[] {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return [];
      }
      return trimmed.split(/\s+/).map(idFor);
    },
    decode(tokens: number[]): string {
      return tokens.map((t) => vocab[t] ?? '').join(' ');
    },
  };
}

function trajectory(
  taskId: string,
  score: number,
  steps: Array<{ action: string; observation?: string }>,
): PGTrajectory {
  return {
    taskId,
    revisionId: 'rev-1',
    score,
    steps,
  };
}

describe('tokenTail', () => {
  it('keeps the final N tokens in order', () => {
    const tokenizer = createWhitespaceTokenizer();
    expect(tokenTail('one two three four five', 3, tokenizer)).toBe('three four five');
  });

  it('leaves shorter input unchanged', () => {
    const tokenizer = createWhitespaceTokenizer();
    const short = 'one  two';
    expect(tokenTail(short, 10, tokenizer)).toBe(short);
  });

  it('concatTrajectories preserves input order and is deterministic', () => {
    const first = trajectory('b-task', 0.2, [
      { action: 'search', observation: 'hit' },
      { action: 'finish' },
    ]);
    const second = trajectory('a-task', 0.9, [{ action: 'lookup', observation: 'ok' }]);

    const once = concatTrajectories([first, second]);
    const twice = concatTrajectories([first, second]);
    const reversed = concatTrajectories([second, first]);

    expect(once).toBe(twice);
    expect(once).toBe(
      [
        '### Task b-task (score 0.2)',
        'Action: search',
        'Observation: hit',
        'Action: finish',
        'Observation: ',
        '### Task a-task (score 0.9)',
        'Action: lookup',
        'Observation: ok',
      ].join('\n'),
    );
    expect(once.indexOf('### Task b-task')).toBeLessThan(once.indexOf('### Task a-task'));
    expect(reversed.indexOf('### Task a-task')).toBeLessThan(reversed.indexOf('### Task b-task'));
    expect(once).not.toBe(reversed);
  });
});
