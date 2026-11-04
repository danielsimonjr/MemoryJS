/**
 * Direct unit tests for beginUnrefInterval / stopUnrefInterval (CMP-5).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  beginUnrefInterval,
  stopUnrefInterval,
  type IntervalRunState,
} from '../../../src/utils/unrefInterval.js';

describe('unrefInterval', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts an interval, marks the state running and unrefs the handle', () => {
    vi.useFakeTimers();
    const unref = vi.fn();
    const fakeHandle = { unref } as unknown as ReturnType<typeof setInterval>;
    const setSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(fakeHandle);
    const state: IntervalRunState = { running: false };

    const started = beginUnrefInterval(state, 1000, () => {});

    expect(started).toBe(true);
    expect(state.running).toBe(true);
    expect(state.intervalId).toBe(fakeHandle);
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('returns false and does not start a second interval when already running', () => {
    vi.useFakeTimers();
    const state: IntervalRunState = { running: false };
    const tick = vi.fn();
    expect(beginUnrefInterval(state, 500, tick)).toBe(true);
    const firstId = state.intervalId;
    const setSpy = vi.spyOn(globalThis, 'setInterval');

    expect(beginUnrefInterval(state, 500, tick)).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();
    expect(state.intervalId).toBe(firstId);
    stopUnrefInterval(state);
  });

  it('invokes tick on each interval elapse', async () => {
    vi.useFakeTimers();
    const state: IntervalRunState = { running: false };
    const tick = vi.fn();
    beginUnrefInterval(state, 100, tick);

    vi.advanceTimersByTime(350);
    expect(tick).toHaveBeenCalledTimes(3);
    stopUnrefInterval(state);
  });

  it('stopUnrefInterval clears the timer, clears the id and marks stopped', () => {
    vi.useFakeTimers();
    const state: IntervalRunState = { running: false };
    const tick = vi.fn();
    beginUnrefInterval(state, 100, tick);

    stopUnrefInterval(state);

    expect(state.running).toBe(false);
    expect(state.intervalId).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(tick).not.toHaveBeenCalled();
  });

  it('stopUnrefInterval is safe to call on a never-started state', () => {
    const state: IntervalRunState = { running: false };
    expect(() => stopUnrefInterval(state)).not.toThrow();
    expect(state.running).toBe(false);
    expect(state.intervalId).toBeUndefined();
  });

  it('allows restarting after stop', () => {
    vi.useFakeTimers();
    const state: IntervalRunState = { running: false };
    const tick = vi.fn();
    beginUnrefInterval(state, 100, tick);
    stopUnrefInterval(state);
    expect(beginUnrefInterval(state, 100, tick)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(1);
    stopUnrefInterval(state);
  });
});
