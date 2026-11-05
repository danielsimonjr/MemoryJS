/**
 * Tests for the shared window helper behind `createdInLastHours` and
 * `createdInLastDays` (CL-8). The start date is read from the builder's
 * private `startDate` field, which is the only observable effect of these methods.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SessionQueryBuilder } from '../../../src/agent/SessionQueryBuilder.js';
import type { IGraphStorage } from '../../../src/types/types.js';
import type { SessionManager } from '../../../src/agent/SessionManager.js';

const NOW = new Date('2026-11-05T12:00:00.000Z');

function makeBuilder(): SessionQueryBuilder {
  return new SessionQueryBuilder({} as IGraphStorage, {} as SessionManager);
}

function startDateOf(builder: SessionQueryBuilder): string | undefined {
  return (builder as unknown as { startDate?: string }).startDate;
}

describe('SessionQueryBuilder createdInLast* window (CL-8)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('createdInLastHours sets the start date that many hours before now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const builder = makeBuilder();
    expect(builder.createdInLastHours(12)).toBe(builder);
    expect(startDateOf(builder)).toBe('2026-11-05T00:00:00.000Z');
  });

  it('createdInLastDays sets the start date that many days before now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const builder = makeBuilder();
    expect(builder.createdInLastDays(3)).toBe(builder);
    expect(startDateOf(builder)).toBe('2026-11-02T12:00:00.000Z');
  });

  it('a zero-length window starts at now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const hours = makeBuilder();
    hours.createdInLastHours(0);
    expect(startDateOf(hours)).toBe(NOW.toISOString());
    const days = makeBuilder();
    days.createdInLastDays(0);
    expect(startDateOf(days)).toBe(NOW.toISOString());
  });

  it('hours and days agree when the windows are equal', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const hours = makeBuilder();
    hours.createdInLastHours(24);
    const days = makeBuilder();
    days.createdInLastDays(1);
    expect(startDateOf(hours)).toBe(startDateOf(days));
  });

  it('a later call overwrites an earlier window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const builder = makeBuilder();
    builder.createdInLastDays(7).createdInLastHours(1);
    expect(startDateOf(builder)).toBe('2026-11-05T11:00:00.000Z');
  });
});
