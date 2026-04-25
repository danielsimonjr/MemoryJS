import { describe, it, expect } from 'vitest';
import {
  ExperienceExtractor,
  type Trajectory,
  type Outcome,
} from '../../../src/agent/ExperienceExtractor.js';
import { PatternDetector } from '../../../src/agent/PatternDetector.js';

function makeTrajectory(
  id: string,
  outcome: Outcome,
  observations: string[],
  actions: { name: string }[] = [],
): Trajectory {
  return {
    id,
    sessionId: 's',
    observations,
    actions,
    outcome,
    context: {},
    timestamp: new Date().toISOString(),
  };
}

describe('ExperienceExtractor.extractFromContrastivePairs', () => {
  it('returns empty when either side is empty', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    expect(await extractor.extractFromContrastivePairs([], [])).toEqual([]);
    expect(
      await extractor.extractFromContrastivePairs(
        [makeTrajectory('s', 'success', ['ok'])],
        [],
      ),
    ).toEqual([]);
  });

  it('extracts a rule when a token strongly correlates with success', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const success = [
      makeTrajectory('s1', 'success', ['used checkpoint before risky operation'], [{ name: 'checkpoint' }]),
      makeTrajectory('s2', 'success', ['used checkpoint to save state'], [{ name: 'checkpoint' }]),
      makeTrajectory('s3', 'success', ['used checkpoint regularly'], [{ name: 'checkpoint' }]),
    ];
    const failure = [
      makeTrajectory('f1', 'failure', ['skipped backup before deploy'], [{ name: 'deploy' }]),
    ];
    const rules = await extractor.extractFromContrastivePairs(success, failure);
    expect(rules.length).toBeGreaterThan(0);
    // The recommended action is the most-common action in success
    // trajectories — should be "checkpoint" since every success has it.
    const top = rules[0];
    expect(top.action).toBe('checkpoint');
    // The condition references a success-distinguishing token. Multiple
    // tokens qualify here ("used", "checkpoint", etc.) — assert that at
    // least one rule across the result set names "checkpoint".
    expect(rules.some((r) => /checkpoint/i.test(r.condition))).toBe(true);
    expect(top.confidence).toBeGreaterThan(0);
    expect(top.supportCount).toBeGreaterThan(0);
  });
});

describe('ExperienceExtractor.abstractPattern', () => {
  it('returns empty when no patterns are found', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const out = await extractor.abstractPattern(
      [makeTrajectory('a', 'success', ['unique single observation'])],
      0.5,
    );
    expect(out.pattern).toBe('');
    expect(out.occurrences).toBe(0);
  });

  it('lifts the most-frequent pattern from PatternDetector', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const trajectories = [
      makeTrajectory('t1', 'success', ['User prefers Italian food']),
      makeTrajectory('t2', 'success', ['User prefers Mexican food']),
      makeTrajectory('t3', 'success', ['User prefers Japanese food']),
    ];
    const out = await extractor.abstractPattern(trajectories, 0.5);
    expect(out.pattern.length).toBeGreaterThan(0);
    expect(out.occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('ExperienceExtractor.learnDecisionBoundary', () => {
  it('separates positive vs negative tokens from outcome field', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const trajectories = [
      makeTrajectory('t1', 'success', ['validation passed cleanly']),
      makeTrajectory('t2', 'success', ['validation passed gracefully']),
      makeTrajectory('t3', 'success', ['validation succeeded']),
      makeTrajectory('f1', 'failure', ['timeout occurred during deploy']),
      makeTrajectory('f2', 'failure', ['timeout caused rollback']),
    ];
    const rule = await extractor.learnDecisionBoundary(trajectories, 'outcome');
    expect(rule.presenceTokens).toContain('validation');
    expect(rule.absenceTokens).toContain('timeout');
    expect(rule.outcomeIfPresent).toBe('success');
    expect(rule.outcomeIfAbsent).toBe('failure');
  });

  it('returns confidence 0 for empty input', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const rule = await extractor.learnDecisionBoundary([], 'outcome');
    expect(rule.confidence).toBe(0);
  });
});

describe('ExperienceExtractor.clusterTrajectories', () => {
  it('clusters by outcome correctly', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const trajectories = [
      makeTrajectory('t1', 'success', ['a']),
      makeTrajectory('t2', 'success', ['b']),
      makeTrajectory('t3', 'failure', ['c']),
    ];
    const clusters = await extractor.clusterTrajectories(trajectories, 'outcome');
    expect(clusters.length).toBe(2); // success + failure
    expect(clusters.every((c) => c.cohesion === 1.0)).toBe(true);
  });

  it('semantic clustering groups similar observations', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector(), { similarityThreshold: 0.3 });
    const trajectories = [
      makeTrajectory('t1', 'success', ['the quick brown fox jumps']),
      makeTrajectory('t2', 'success', ['the quick brown fox runs']),
      makeTrajectory('t3', 'success', ['totally different topic here']),
    ];
    const clusters = await extractor.clusterTrajectories(trajectories, 'semantic');
    // t1 and t2 should cluster; t3 should be alone.
    const sizes = clusters.map((c) => c.trajectories.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('returns empty for empty input', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const clusters = await extractor.clusterTrajectories([], 'outcome');
    expect(clusters).toEqual([]);
  });
});

describe('ExperienceExtractor.synthesizeExperience', () => {
  it('produces an Experience artifact with sourceTrajectories', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const cluster = {
      id: 'cluster-1',
      method: 'semantic' as const,
      trajectories: [
        makeTrajectory('t1', 'success', ['hello world']),
        makeTrajectory('t2', 'success', ['hello universe']),
      ],
      cohesion: 0.7,
    };
    const exp = await extractor.synthesizeExperience(cluster);
    expect(exp.id).toMatch(/^exp-/);
    expect(['heuristic', 'procedure', 'constraint', 'preference']).toContain(exp.type);
    expect(exp.sourceTrajectories.sort()).toEqual(['t1', 't2']);
    expect(exp.confidence).toBe(0.7);
  });

  it('classifies action-heavy clusters as procedural', async () => {
    const extractor = new ExperienceExtractor(new PatternDetector());
    const cluster = {
      id: 'cluster-1',
      method: 'structural' as const,
      trajectories: [
        makeTrajectory('t1', 'success', ['x'], [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
        makeTrajectory('t2', 'success', ['y'], [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
      ],
      cohesion: 0.8,
    };
    const exp = await extractor.synthesizeExperience(cluster);
    expect(exp.type).toBe('procedure');
  });
});
