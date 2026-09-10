/**
 * Completion-provider adapter and budgeted complete for Procedural Graph guidance.
 *
 * Reuses the repository's optional usage-reporting convention (`getLastUsage`).
 * A timeout discards a late response but cannot guarantee that the external
 * billable request was canceled (feature plan 8.6).
 *
 * @module agent/procedural/graph/CompletionProvider
 * @experimental
 */

import type { LLMProvider } from '../../../search/LLMQueryPlanner.js';

export interface PGCompletionProvider {
  complete(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>;
  getLastUsage?(): { inputTokens: number; outputTokens: number } | undefined;
  readonly identity?: string;
}

/**
 * Adapt a search-layer {@link LLMProvider} (optional `getLastUsage`) to
 * {@link PGCompletionProvider}. The base `complete(prompt)` signature has no
 * AbortSignal; budgeted cancellation is enforced by {@link completeWithBudget}.
 */
export function adaptLLMProvider(
  p: LLMProvider & { getLastUsage?(): { inputTokens: number; outputTokens: number } | undefined },
): PGCompletionProvider {
  const identity = (p as PGCompletionProvider).identity;
  const adapted: PGCompletionProvider = {
    complete: (prompt: string): Promise<string> => p.complete(prompt),
  };
  if (typeof p.getLastUsage === 'function') {
    adapted.getLastUsage = () => p.getLastUsage?.();
  }
  if (typeof identity === 'string') {
    Object.assign(adapted, { identity });
  }
  return adapted;
}

function usageFromProvider(
  p: PGCompletionProvider,
  prompt: string,
  outputText: string,
): { input: number; output: number; approximate: boolean } {
  const exact = p.getLastUsage?.();
  if (exact) {
    return {
      input: exact.inputTokens,
      output: exact.outputTokens,
      approximate: false,
    };
  }
  return {
    input: Math.ceil(prompt.length / 4),
    output: Math.ceil(outputText.length / 4),
    approximate: true,
  };
}

/**
 * Complete with a wall-clock timeout and output-character budget.
 *
 * A response that arrives after `timeoutMs` is discarded (`ok: false`).
 * When `getLastUsage` is absent or returns undefined, usage is
 * `ceil(chars / 4)` marked `approximate: true`. Output longer than
 * `maxOutputChars` is truncated; the returned text is the prefix and
 * truncation is visible to the caller (`text.length === maxOutputChars`
 * while generation was longer).
 */
export async function completeWithBudget(
  p: PGCompletionProvider,
  prompt: string,
  opts: { timeoutMs: number; maxOutputChars: number; signal?: AbortSignal },
): Promise<
  | { ok: true; text: string; usage: { input: number; output: number; approximate: boolean } }
  | { ok: false; error: string; usage?: { input: number; output: number; approximate: boolean } }
> {
  if (opts.signal?.aborted) {
    return { ok: false, error: 'aborted' };
  }

  const controller = new AbortController();
  const onExternalAbort = (): void => {
    controller.abort();
  };
  opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const completionPromise = p
    .complete(prompt, { signal: controller.signal })
    .then((text) => ({ kind: 'ok' as const, text }))
    .catch((err: unknown) => ({ kind: 'err' as const, err }));

  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ kind: 'timeout' });
    }, opts.timeoutMs);
  });

  try {
    const winner = await Promise.race([completionPromise, timeoutPromise]);

    if (winner.kind === 'timeout' || timedOut) {
      return { ok: false, error: 'timeout' };
    }

    if (winner.kind === 'err') {
      if (opts.signal?.aborted) {
        return { ok: false, error: 'aborted' };
      }
      const message = winner.err instanceof Error ? winner.err.message : String(winner.err);
      return { ok: false, error: message };
    }

    const text = winner.text;
    const usage = usageFromProvider(p, prompt, text);
    if (opts.maxOutputChars >= 0 && text.length > opts.maxOutputChars) {
      return { ok: true, text: text.slice(0, opts.maxOutputChars), usage };
    }
    return { ok: true, text, usage };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}
