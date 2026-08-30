/**
 * Heuristic CLI command coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerHeuristicCommands } from '../../../src/cli/commands/heuristic.js';
import { createCliHarness, cleanupCliHarness, type CliHarness } from './helpers/cliTestHarness.js';

describe('heuristic CLI', () => {
  let h: CliHarness;

  beforeEach(async () => {
    h = await createCliHarness(registerHeuristicCommands);
  });

  afterEach(async () => {
    await cleanupCliHarness(h);
  });

  it('add → list → get → match → reinforce → contradict → conflicts → remove → clear', async () => {
    await h.parse(['heuristic', 'add', 'when error', 'retry once', '-p', '2', '-c', '0.5']);
    const added = h.lastJson<{ id: string }>();
    expect(added.id).toBeTruthy();

    await h.parse(['heuristic', 'list']);
    expect(h.lastJson<{ count: number }>().count).toBe(1);

    await h.parse(['heuristic', 'count']);
    expect(h.lastJson<{ count: number }>().count).toBe(1);

    await h.parse(['heuristic', 'get', added.id]);
    expect(h.lastJson<{ heuristic: unknown }>().heuristic).not.toBeNull();

    await h.parse(['heuristic', 'match', 'error', 'occurred', '-l', '5']);
    expect(h.lastJson<{ count: number }>().count).toBeGreaterThanOrEqual(0);

    await h.parse(['heuristic', 'reinforce', added.id]);
    expect(h.lastJson<{ result: unknown }>().result).toBeTruthy();

    await h.parse(['heuristic', 'contradict', added.id]);
    expect(h.lastJson<{ result: unknown }>().result).toBeTruthy();

    await h.parse(['heuristic', 'conflicts']);
    expect(h.lastJson<{ count: number }>().count).toBeGreaterThanOrEqual(0);

    await h.parse(['heuristic', 'remove', added.id]);
    expect(h.lastJson<{ removed: boolean }>().removed).toBe(true);

    await h.parse(['heuristic', 'clear']);
    expect(h.lastJson<{ cleared: boolean }>().cleared).toBe(true);
  });
});
