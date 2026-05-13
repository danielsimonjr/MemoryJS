/**
 * HeuristicManager Smoke Tests
 *
 * Closes the last unshipped Phase 3B item per
 * docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md.
 */

import { describe, it, expect } from 'vitest';
import { HeuristicManager } from '../../../src/agent/HeuristicManager.js';

describe('HeuristicManager', () => {
  it('add returns a new id and the heuristic is retrievable', () => {
    const mgr = new HeuristicManager();
    const id = mgr.add({
      condition: 'user asks for code review',
      action: 'request the PR URL first',
    });
    const h = mgr.get(id);
    expect(h).toBeDefined();
    expect(h?.condition).toBe('user asks for code review');
    expect(h?.confidence).toBeCloseTo(0.5, 5);
    expect(mgr.size()).toBe(1);
  });

  it('match returns heuristics overlapping the input by token, sorted by score', () => {
    const mgr = new HeuristicManager();
    const id1 = mgr.add({
      condition: 'user asks for code review',
      action: 'request PR URL',
      initialConfidence: 0.9,
    });
    mgr.add({
      condition: 'user asks for cookery advice',
      action: 'recommend recipe',
      initialConfidence: 0.5,
    });
    const matches = mgr.match('please review my code now');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.heuristic.id).toBe(id1);
  });

  it('reinforce raises confidence asymptotically toward 1', () => {
    const mgr = new HeuristicManager();
    const id = mgr.add({ condition: 'x', action: 'y', initialConfidence: 0.5 });
    mgr.reinforce(id);
    const h = mgr.get(id)!;
    expect(h.support).toBe(1);
    expect(h.confidence).toBeGreaterThan(0.5);
    expect(h.confidence).toBeLessThan(1);
  });

  it('recordContradiction lowers confidence and bumps contradictions', () => {
    const mgr = new HeuristicManager();
    const id = mgr.add({ condition: 'x', action: 'y', initialConfidence: 0.5 });
    mgr.recordContradiction(id);
    const h = mgr.get(id)!;
    expect(h.contradictions).toBe(1);
    expect(h.confidence).toBeLessThan(0.5);
  });

  it('detectConflicts surfaces opposing-action overlap pairs as contradictions', () => {
    const mgr = new HeuristicManager();
    mgr.add({ condition: 'review pull request', action: 'merge after one approval' });
    mgr.add({ condition: 'review pull request', action: "don't merge after one approval" });
    const conflicts = mgr.detectConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('contradiction');
  });

  it('detectConflicts flags overlapping conditions with different actions as overlap', () => {
    const mgr = new HeuristicManager();
    mgr.add({ condition: 'production deploy gate', action: 'require two approvals' });
    mgr.add({ condition: 'production deploy gate', action: 'require integration tests' });
    const conflicts = mgr.detectConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('overlap');
  });

  it('match respects the minScore threshold', () => {
    const mgr = new HeuristicManager();
    mgr.add({
      condition: 'totally unrelated keywords here',
      action: 'something',
      initialConfidence: 0.9,
    });
    const matches = mgr.match('cookery recipe onion', { minScore: 0.5 });
    expect(matches).toEqual([]);
  });

  it('remove and clear behave as expected', () => {
    const mgr = new HeuristicManager();
    const id = mgr.add({ condition: 'x', action: 'y' });
    expect(mgr.remove(id)).toBe(true);
    expect(mgr.remove('does-not-exist')).toBe(false);
    mgr.add({ condition: 'a', action: 'b' });
    mgr.clear();
    expect(mgr.size()).toBe(0);
  });
});
