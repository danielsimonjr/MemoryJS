import { describe, it, expect } from 'vitest';
import { ImportanceScorer } from '../../../src/agent/ImportanceScorer.js';

describe('ImportanceScorer', () => {
  const scorer = new ImportanceScorer();

  it('returns integer in [0, 10]', () => {
    const score = scorer.score('hello world');
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('log-scaled length: longer content scores higher (all else equal)', () => {
    const short = scorer.score('hi');
    const long = scorer.score('a'.repeat(5000));
    expect(long).toBeGreaterThan(short);
  });

  it('keyword signal contributes when domainKeywords are configured', () => {
    const withKeywords = new ImportanceScorer({
      domainKeywords: new Set(['auth', 'login', 'token']),
      lengthWeight: 0.2,
      keywordWeight: 0.6,
      overlapWeight: 0.2,
    });
    expect(withKeywords.score('user auth token rotated'))
      .toBeGreaterThan(withKeywords.score('user ate a sandwich okay'));
  });

  it('recentTurns overlap is computed (PRD MEM-02 compliance)', () => {
    expect(scorer.score('database migration failing', { recentTurns: ['database migration ran'] }))
      .toBeGreaterThan(scorer.score('database migration failing', { recentTurns: ['weather is nice'] }));
  });

  it('queryContext alone contributes to overlap', () => {
    expect(scorer.score('hotel booking', { queryContext: 'hotel search' }))
      .toBeGreaterThan(scorer.score('hotel booking', { queryContext: 'movie showtimes' }));
  });

  it('queryContext + recentTurns combine their tokens', () => {
    expect(scorer.score('alpha beta gamma', { queryContext: 'alpha', recentTurns: ['gamma delta'] }))
      .toBeGreaterThan(scorer.score('alpha beta gamma', { queryContext: 'zeta', recentTurns: ['eta theta'] }));
  });

  it('no overlap corpus → neutral 0.5 signal', () => {
    const score = scorer.score('anything goes here');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(10);
  });

  it('empty content → score 0', () => {
    expect(scorer.score('')).toBe(0);
  });

  it('deterministic: identical input → identical output', () => {
    const a = scorer.score('hello there friend', { recentTurns: ['friend says hi'] });
    const b = scorer.score('hello there friend', { recentTurns: ['friend says hi'] });
    expect(a).toBe(b);
  });

  it('clamps to [0, 10] when weights sum > 1', () => {
    const aggressive = new ImportanceScorer({ lengthWeight: 5, keywordWeight: 5, overlapWeight: 5 });
    const score = aggressive.score('a'.repeat(10000));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('zero weights → score 0', () => {
    const zero = new ImportanceScorer({ lengthWeight: 0, keywordWeight: 0, overlapWeight: 0 });
    expect(zero.score('anything at all', { queryContext: 'anything' })).toBe(0);
  });

  it('handles punctuation and mixed case in tokenisation', () => {
    expect(scorer.score('Database, Migration!', { recentTurns: ['database migration'] }))
      .toBeGreaterThan(scorer.score('Database, Migration!', { recentTurns: ['unrelated content'] }));
  });
});
