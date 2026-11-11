import { describe, it, expect } from 'vitest';
import { ABORTED, describeError, raceAbort } from '../../../../src/agent/learning/llmJson.js';

describe('raceAbort', () => {
  it('returns the work promise when signal is omitted', async () => {
    await expect(raceAbort(Promise.resolve(7))).resolves.toBe(7);
  });

  it('passes through a rejection when signal is omitted', async () => {
    const boom = new Error('boom');
    await expect(raceAbort(Promise.reject(boom))).rejects.toBe(boom);
  });

  it('resolves ABORTED when the signal fires first', async () => {
    const c = new AbortController();
    const work = new Promise<string>(() => undefined);
    const p = raceAbort(work, c.signal);
    c.abort();
    await expect(p).resolves.toBe(ABORTED);
  });

  it('ignores a late resolve after abort', async () => {
    const c = new AbortController();
    let settle: (v: string) => void = () => undefined;
    const work = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const p = raceAbort(work, c.signal);
    c.abort();
    settle('too late');
    await expect(p).resolves.toBe(ABORTED);
  });

  it('ignores a late reject after abort', async () => {
    const c = new AbortController();
    let fail: (e: unknown) => void = () => undefined;
    const work = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const p = raceAbort(work, c.signal);
    c.abort();
    fail(new Error('too late'));
    await expect(p).resolves.toBe(ABORTED);
  });

  it('resolves the work value when it settles before abort', async () => {
    const c = new AbortController();
    await expect(raceAbort(Promise.resolve('ok'), c.signal)).resolves.toBe('ok');
  });

  it('rejects with the work error when it rejects before abort', async () => {
    const c = new AbortController();
    const boom = new Error('boom');
    await expect(raceAbort(Promise.reject(boom), c.signal)).rejects.toBe(boom);
  });
});

describe('describeError', () => {
  it('returns the message of an Error', () => {
    expect(describeError(new Error('kaboom'))).toBe('kaboom');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(describeError('plain')).toBe('plain');
    expect(describeError(42)).toBe('42');
  });
});
