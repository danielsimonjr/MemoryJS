/**
 * In-repo English natural-language date parser.
 *
 * This is a focused rebuild of the part of chrono-node 2.9.1 that MemoryJS
 * used: English casual, relative, and absolute date phrases resolved against
 * a reference instant. It follows chrono's architecture (parsers propose
 * components, refiners fill implied fields and merge ranges) so behaviour is
 * recognisable, but it is original code covering only the phrases MemoryJS
 * accepts.
 *
 * All calendar math uses UTC fields, so a parse yields the same instant
 * regardless of the host timezone.
 *
 * @module search/enDate/parseEnDate
 * @internal
 */

import type { EnDateOptions, EnDateResult, ParseContext, ParsedResult } from './types.js';
import { createParsers, type EnParser } from './parsers.js';
import { createRefiners, type EnRefiner } from './refiners.js';
import { toDate } from './components.js';

/** Parsers are stateless; build them once. */
const parsers: EnParser[] = createParsers();
/** Refiners are stateless; build them once. */
const refiners: EnRefiner[] = createRefiners();

/**
 * Run one parser over the whole text, collecting a result per match.
 *
 * The scan resumes at the end of each accepted match, so a parser cannot
 * report overlapping matches of its own pattern.
 *
 * @param context - Parse context for this call
 * @param parser - Parser to run
 */
function executeParser(context: ParseContext, parser: EnParser): ParsedResult[] {
  const results: ParsedResult[] = [];
  const pattern = parser.pattern(context);
  const originalText = context.text;
  let remainingText = originalText;
  let match = pattern.exec(remainingText);

  while (match) {
    match.index += originalText.length - remainingText.length;
    const extracted = parser.extract(context, match);
    if (!extracted) {
      remainingText = originalText.substring(match.index + 1);
      match = pattern.exec(remainingText);
      continue;
    }

    let parsed: ParsedResult;
    if (isParsedResult(extracted)) {
      parsed = extracted;
    } else {
      parsed = { index: match.index, text: match[0], start: extracted };
    }

    results.push(parsed);
    remainingText = originalText.substring(parsed.index + parsed.text.length);
    match = pattern.exec(remainingText);
  }
  return results;
}

/** A parser may return components or a full result. */
function isParsedResult(value: ParsedResult | import('./types.js').Components): value is ParsedResult {
  return 'start' in value && 'index' in value && 'text' in value;
}

/**
 * Parse every English date expression in `text`.
 *
 * Results are returned left to right. An empty array means the text held no
 * date expression.
 *
 * @param text - Input text
 * @param ref - Reference instant for relative expressions
 * @param options - `forwardDate` prefers the next occurrence of a passed time
 */
export function parseEnDate(text: string, ref: Date, options: EnDateOptions = {}): EnDateResult[] {
  const context: ParseContext = { text, refDate: ref, options };

  let results: ParsedResult[] = [];
  for (const parser of parsers) {
    results = results.concat(executeParser(context, parser));
  }
  results.sort((a, b) => a.index - b.index);

  for (const refiner of refiners) {
    results = refiner.refine(context, results);
  }

  return results.map((result) => {
    const resolved: EnDateResult = {
      start: toDate(result.start),
      index: result.index,
      text: result.text,
    };
    if (result.end) resolved.end = toDate(result.end);
    return resolved;
  });
}

/**
 * Parse the first English date expression in `text` and return its start.
 *
 * @param text - Input text
 * @param ref - Reference instant for relative expressions
 * @param options - `forwardDate` prefers the next occurrence of a passed time
 */
export function parseEnDateStart(text: string, ref: Date, options: EnDateOptions = {}): Date | undefined {
  const results = parseEnDate(text, ref, options);
  return results.length > 0 ? results[0].start : undefined;
}
