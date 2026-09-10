import { describe, it, expect } from 'vitest';
import {
  adaptLLMProvider,
  completeWithBudget,
  type PGCompletionProvider,
} from '../../../../../src/agent/procedural/graph/CompletionProvider.js';
import type { LLMProvider } from '../../../../../src/search/LLMQueryPlanner.js';

describe('CompletionProvider', () => {
  it('timeout discards a late response and reports ok:false', async () => {
    let resolveLate!: (value: string) => void;
    const provider: PGCompletionProvider = {
      complete: () =>
        new Promise<string>((resolve) => {
          resolveLate = resolve;
        }),
    };

    const result = await completeWithBudget(provider, 'prompt', {
      timeoutMs: 20,
      maxOutputChars: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timeout/i);
    }

    resolveLate('late-response-must-be-discarded');
    await new Promise((r) => setTimeout(r, 15));
    expect(result.ok).toBe(false);
    if (result.ok) {
      expect(result.text).not.toBe('late-response-must-be-discarded');
    }
  });

  it('usage is approximate when getLastUsage is absent', async () => {
    const prompt = 'abcd';
    const response = 'abcdefgh';
    const provider: PGCompletionProvider = {
      complete: async () => response,
    };

    const result = await completeWithBudget(provider, prompt, {
      timeoutMs: 5000,
      maxOutputChars: 1000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.approximate).toBe(true);
      expect(result.usage.input).toBe(Math.ceil(prompt.length / 4));
      expect(result.usage.output).toBe(Math.ceil(response.length / 4));
      expect(result.text).toBe(response);
    }
  });

  it('usage is exact when getLastUsage is present', async () => {
    const provider: PGCompletionProvider = {
      complete: async () => 'hello world',
      getLastUsage: () => ({ inputTokens: 12, outputTokens: 34 }),
    };

    const result = await completeWithBudget(provider, 'prompt', {
      timeoutMs: 5000,
      maxOutputChars: 1000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.approximate).toBe(false);
      expect(result.usage.input).toBe(12);
      expect(result.usage.output).toBe(34);
      expect(result.text).toBe('hello world');
    }

    const adapted = adaptLLMProvider({
      complete: async () => 'via-adapter',
      getLastUsage: () => ({ inputTokens: 7, outputTokens: 9 }),
    } as LLMProvider & { getLastUsage(): { inputTokens: number; outputTokens: number } });

    const adaptedResult = await completeWithBudget(adapted, 'p', {
      timeoutMs: 5000,
      maxOutputChars: 1000,
    });
    expect(adaptedResult.ok).toBe(true);
    if (adaptedResult.ok) {
      expect(adaptedResult.usage.approximate).toBe(false);
      expect(adaptedResult.usage.input).toBe(7);
      expect(adaptedResult.usage.output).toBe(9);
    }
  });

  it('maxOutputChars truncation is reported', async () => {
    const full = 'ABCDEFGHIJ';
    const provider: PGCompletionProvider = {
      complete: async () => full,
    };

    const result = await completeWithBudget(provider, 'p', {
      timeoutMs: 5000,
      maxOutputChars: 4,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('ABCD');
      expect(result.text.length).toBe(4);
      expect(result.text).not.toBe(full);
      expect(result.usage.output).toBe(Math.ceil(full.length / 4));
    }
  });
});
