/**
 * Characterization tests for the shared invalid_type / invalid_value issue shells in
 * `src/utils/schema.ts`. Each expectation is the exact issue shape the current (pre-extract)
 * code produces: code, expected/received presence, input echo and message text.
 *
 * @module tests/unit/utils/schema.failures
 */

import { describe, expect, it } from 'vitest';
import { z } from '../../../src/utils/schema.js';

type Issue = {
  code: string;
  expected?: unknown;
  received?: unknown;
  input?: unknown;
  message: string;
  path: unknown[];
};

function firstIssue(result: unknown): Issue {
  const failure = result as { success: boolean; error?: { issues: Issue[] } };
  expect(failure.success).toBe(false);
  const issue = failure.error!.issues[0];
  expect(issue).toBeDefined();
  return issue as Issue;
}

describe('invalid_type shell — string, number, boolean', () => {
  it('string rejects a non-string with the expected/received message', () => {
    const issue = firstIssue(z.string().safeParse(7));
    expect(issue.code).toBe('invalid_type');
    expect(issue.expected).toBe('string');
    expect(issue.received).toBeUndefined();
    expect(issue.input).toBe(7);
    expect(issue.message).toBe('Invalid input: expected string, received number');
    expect(issue.path).toEqual([]);
  });

  it('boolean rejects a non-boolean with the expected/received message', () => {
    const issue = firstIssue(z.boolean().safeParse('yes'));
    expect(issue.code).toBe('invalid_type');
    expect(issue.expected).toBe('boolean');
    expect(issue.received).toBeUndefined();
    expect(issue.input).toBe('yes');
    expect(issue.message).toBe('Invalid input: expected boolean, received string');
  });

  it('number rejects NaN and names it in both received and message', () => {
    const issue = firstIssue(z.number().safeParse(NaN));
    expect(issue.code).toBe('invalid_type');
    expect(issue.expected).toBe('number');
    expect(issue.received).toBe('NaN');
    expect(issue.message).toBe('Invalid input: expected number, received NaN');
  });

  it('number rejects Infinity with a stringified received value', () => {
    const issue = firstIssue(z.number().safeParse(Infinity));
    expect(issue.code).toBe('invalid_type');
    expect(issue.expected).toBe('number');
    expect(issue.received).toBe('Infinity');
    expect(issue.message).toBe('Invalid input: expected number, received Infinity');
  });

  it('number omits received for a non-number input', () => {
    const issue = firstIssue(z.number().safeParse('7'));
    expect(issue.expected).toBe('number');
    expect(issue.received).toBeUndefined();
    expect(issue.message).toBe('Invalid input: expected number, received string');
  });

  it('number accepts a finite number', () => {
    expect(z.number().safeParse(3.5).success).toBe(true);
  });
});

describe('invalid_value shell — literal and enum', () => {
  it('literal rejects a non-member and echoes the allowed value', () => {
    const issue = firstIssue(z.literal('a').safeParse('b'));
    expect(issue.code).toBe('invalid_value');
    expect(issue.input).toBe('b');
    expect(issue.message).toBe('Invalid input: expected "a"');
  });

  it('literal with several values names them all', () => {
    const issue = firstIssue(z.literal(['a', 'b'] as unknown as 'a').safeParse('c'));
    expect(issue.code).toBe('invalid_value');
    expect(issue.message).toBe('Invalid input: expected a,b');
  });

  it('enum rejects a non-member and echoes the allowed values', () => {
    const issue = firstIssue(z.enum(['a', 'b']).safeParse('c'));
    expect(issue.code).toBe('invalid_value');
    expect(issue.input).toBe('c');
    expect(issue.message).toContain('Invalid option: expected one of');
  });

  it('literal and enum accept a member', () => {
    expect(z.literal('a').safeParse('a').success).toBe(true);
    expect(z.enum(['a', 'b']).safeParse('b').success).toBe(true);
  });
});
