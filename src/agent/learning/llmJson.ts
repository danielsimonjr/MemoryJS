/**
 * Shared helpers for LLM-backed learning steps: JSON extraction from model output,
 * abort racing, and error text. Mirrors the pattern in
 * `src/agent/evaluation/LLMRubricJudge.ts` (whose helpers are not exported).
 *
 * @module agent/learning/llmJson
 * @experimental Part of the Recursa self-improvement work (spec RS-15, RS-16).
 */

/** Sentinel resolved when the abort signal fires before the provider settles. */
export const ABORTED: unique symbol = Symbol('aborted');

/**
 * Extract a JSON object from model output, tolerating code fences and surrounding prose.
 *
 * Tries the whole trimmed text first, then scans balanced `{...}` spans starting at each `{`
 * (string-aware), returning the first candidate that parses.
 *
 * @param text - Model output
 * @returns Parsed JSON value
 * @throws Error when no candidate parses
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the span scan
  }
  for (let start = trimmed.indexOf('{'); start >= 0; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('no JSON object in output');
}

/**
 * Race a promise against an abort signal so an ignoring provider cannot hang a step.
 * A late result or rejection after abort is ignored.
 *
 * @param work - Provider call
 * @param signal - Optional abort signal
 * @returns The provider result, or {@link ABORTED}
 */
export function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T | typeof ABORTED> {
  if (!signal) return work;
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Message text of an unknown thrown value.
 *
 * @param err - Thrown value
 * @returns Human-readable message
 */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Make untrusted text safe to place inside a fenced block: every run of three backticks
 * becomes `` ` ` ` `` so the text cannot close the fence.
 *
 * @param text - Untrusted text (task input, solver output, model output)
 * @returns Text that contains no triple backtick
 */
export function escapeFenceContent(text: string): string {
  return text.split('```').join('` ` `');
}

/**
 * Render untrusted text as a fenced `text` block. Internal triple backticks are escaped
 * and `---` at the start of a line (after `\n` or a bare `\r`) is neutralised, so the block
 * can never close early or start YAML front matter.
 *
 * @param text - Untrusted text
 * @returns Fenced Markdown block
 */
export function fencedText(text: string): string {
  const body = escapeFenceContent(text)
    .split('\n')
    .map((line) => line.replace(/(^|\r)---/g, '$1\\-\\-\\-'))
    .join('\n');
  return ['```text', body, '```'].join('\n');
}

/**
 * Neutralise untrusted text placed outside a fence: no triple backtick and no `---` anywhere,
 * so the text can neither open a fence nor start front matter.
 *
 * @param text - Untrusted text
 * @returns Escaped text
 */
export function escapeProse(text: string): string {
  return escapeFenceContent(text).split('---').join('\\-\\-\\-');
}

/**
 * Neutralise untrusted text placed outside a fence as a single line.
 *
 * @param text - Untrusted text
 * @param max - Maximum length in characters
 * @returns Single-line, escaped, truncated text
 */
export function inlineSafe(text: string, max: number): string {
  const single = escapeProse(text).replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
