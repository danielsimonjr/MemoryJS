/**
 * Deterministic rubric audit (Recursa spec RS-26).
 *
 * Flags rubric defects for human review: placeholder references, filename-only
 * criteria, concepts absent from the task, set members the sources do not cover,
 * and set members excluded by the task's category. Checks are pure string
 * heuristics. A rubric is never rewritten. `contradicts` is advisory: it ignores
 * bracketed spans, backtick code, filename tokens and pure numbers, and a hit may
 * still be legitimate.
 *
 * @module agent/evaluation/RubricAudit
 * @experimental Part of the Recursa evaluation work (spec RS-26). Heuristics may be tuned as real rubrics arrive.
 */

import type { Criterion, TaskRecord } from '../../types/learning.js';
import { ENGLISH_STOPWORDS_SMALL, tokenSetWithoutStopwords } from '../../utils/textSimilarity.js';

/** Kind of rubric defect reported by {@link auditRubrics}. */
export type RubricIssueKind = 'placeholder' | 'files' | 'contradicts' | 'omits' | 'admits';

/** One rubric defect for human review. */
export interface RubricIssue {
  /** Task whose rubric contains the defect. */
  taskId: string;
  /** Criterion that contains the defect. */
  criterionId: string;
  /** Defect class. */
  kind: RubricIssueKind;
  /** Short human-readable explanation. */
  detail: string;
}

/** Options for {@link auditRubrics}. */
export interface RubricAuditOptions {
  /**
   * Set members that the task's category excludes, keyed by category.
   * A set criterion that lists one of these members is reported as `admits`.
   */
  excludedByCategory?: Record<string, string[]>;
}

/** Words that signal a back-reference inside brackets (`[see above]`, `[the list]`). */
const REFERENCE_WORDS: ReadonlySet<string> = new Set([
  'same', 'see', 'above', 'below', 'list', 'lists', 'listed', 'set', 'sets', 'previous',
  'prior', 'following', 'ditto', 'mentioned', 'earlier', 'later', 'these', 'those', 'again',
]);

/** Generic rubric wording that is not a concept of the task. */
const RUBRIC_META_WORDS: ReadonlySet<string> = new Set([
  'answer', 'answers', 'correct', 'correctly', 'accurately', 'clearly', 'states', 'state',
  'mentions', 'mention', 'includes', 'include', 'contains', 'contain', 'response', 'output',
  'cites', 'cite', 'explains', 'explain', 'provides', 'provide', 'returns', 'return',
  'identifies', 'identify', 'gives', 'give', 'reports', 'report', 'names', 'name', 'says',
  'addresses', 'address', 'should', 'must', 'would', 'also', 'given', 'using', 'uses',
  'lists', 'list', 'set', 'member', 'members', 'value', 'values',
]);

/** Filename pattern for common source, data and document extensions. */
const FILE_RE = /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|txt|py|ya?ml|csv|html?|css|go|rs|java|sh|toml|xml)\b/gi;

/** Stopword set for concept extraction: English function words plus rubric wording. */
const CONCEPT_STOPWORDS: ReadonlySet<string> = new Set([...ENGLISH_STOPWORDS_SMALL, ...RUBRIC_META_WORDS]);

/**
 * Whether bracketed text is a back-reference with no concrete members.
 * Brackets with a capitalised word, a number or a quoted string are legitimate
 * (`[Smith 2020]`, `[3 items]`); bare punctuation or ellipses are placeholders.
 */
function isPlaceholderBracket(content: string): boolean {
  if (!/[A-Za-z0-9]/.test(content)) return true;
  const words = content.match(/[A-Za-z]+/g) ?? [];
  const refHits = words.some((w) => REFERENCE_WORDS.has(w.toLowerCase()));
  const others = words.filter((w) => !REFERENCE_WORDS.has(w.toLowerCase()));
  const memberLike =
    others.some((w) => /^[A-Z]/.test(w)) || /\d/.test(content) || /"[^"]+"|“[^”]+”/.test(content);
  return refHits && !memberLike;
}

/** Whether the text names specific files and nothing else of content. */
function isFilesOnly(text: string): boolean {
  if (!text.match(FILE_RE)) return false;
  const rest = text.replace(FILE_RE, ' ');
  return tokenSetWithoutStopwords(rest, ENGLISH_STOPWORDS_SMALL, 1).size === 0;
}

/**
 * Criterion text with non-concept spans removed for the advisory `contradicts` check:
 * bracketed spans (`[Smith 2020]`, `a[0]`), backtick code spans, filename tokens
 * (`README.md`) and pure-number tokens.
 */
function conceptText(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^[\]]*\]/g, ' ')
    .replace(/\b\w+\.\w{1,5}\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)*\b/g, ' ');
}

/** Singular-ish stem used to match plural and singular forms. */
function stem(token: string): string {
  return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
}

/** Normalise text for substring matching: lowercase, collapsed whitespace. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Expected members of a set criterion, as strings. */
function membersOf(criterion: Criterion): string[] {
  const { expected } = criterion;
  if (Array.isArray(expected)) return expected.map(String);
  if (typeof expected === 'string') return [expected];
  return [];
}

/**
 * Audit every criterion of every task and return the defects found. Pure and
 * deterministic: the same input always yields the same issues, in task then
 * criterion order.
 *
 * @param tasks - Task records to audit.
 * @param opts - Optional category exclusions for the `admits` check.
 * @returns Defects for human review (empty when the rubrics are clean).
 * @example
 * ```typescript
 * const issues = auditRubrics(tasks, { excludedByCategory: { hardware: ['Pixel'] } });
 * ```
 */
export function auditRubrics(tasks: readonly TaskRecord[], opts: RubricAuditOptions = {}): RubricIssue[] {
  const issues: RubricIssue[] = [];
  for (const task of tasks) {
    const sources = task.sources ?? [];
    const sourceText = sources.flatMap((s) => [s.ref, s.excerpt ?? '']).join(' ');
    const contextRaw = normalise(`${task.input} ${sourceText}`);
    const contextStems = new Set(
      [...tokenSetWithoutStopwords(`${task.input} ${sourceText}`, ENGLISH_STOPWORDS_SMALL, 1)].map(stem),
    );
    const exclusions = opts.excludedByCategory;
    const category = task.category;
    const excluded = new Set(
      (category !== undefined && exclusions && Object.hasOwn(exclusions, category) ? exclusions[category] ?? [] : []).map(
        normalise,
      ),
    );

    for (const criterion of task.rubric) {
      const push = (kind: RubricIssueKind, detail: string): void => {
        issues.push({ taskId: task.id, criterionId: criterion.id, kind, detail });
      };

      for (const [, content] of criterion.text.matchAll(/\[([^[\]]*)\]/g)) {
        if (isPlaceholderBracket(content ?? '')) {
          push('placeholder', `bracketed reference "[${content}]" has no concrete members`);
          break;
        }
      }

      if (isFilesOnly(criterion.text)) {
        push('files', `criterion names only files: ${criterion.text.match(FILE_RE)?.join(', ')}`);
      }

      // Advisory: a concept absent from the task may still be legitimate; review, do not auto-reject.
      const concepts = [...tokenSetWithoutStopwords(conceptText(criterion.text), CONCEPT_STOPWORDS, 4)];
      const absent = concepts.filter((t) => !contextStems.has(stem(t)));
      if (absent.length > 0) {
        push('contradicts', `concept(s) absent from task input and sources: ${absent.join(', ')}`);
      }

      if (criterion.kind !== 'set-exact' && criterion.kind !== 'set-precision') continue;
      const members = membersOf(criterion);

      const missing = members.filter((m) => {
        if (contextRaw.includes(normalise(m))) return false;
        const toks = [...tokenSetWithoutStopwords(m, ENGLISH_STOPWORDS_SMALL, 1)];
        return !(toks.length > 0 && toks.every((t) => contextStems.has(stem(t))));
      });
      if (missing.length > 0) {
        push('omits', `members not referenced by sources or input: ${missing.join(', ')}`);
      }

      const admitted = members.filter((m) => excluded.has(normalise(m)));
      if (admitted.length > 0) {
        push('admits', `includes members excluded for category "${task.category}": ${admitted.join(', ')}`);
      }
    }
  }
  return issues;
}

/**
 * Class wrapper over {@link auditRubrics} with default options, for symmetry
 * with the other manager classes.
 *
 * @example
 * ```typescript
 * const audit = new RubricAudit({ excludedByCategory: { hardware: ['Pixel'] } });
 * const issues = audit.auditRubrics(tasks);
 * ```
 */
export class RubricAudit {
  private readonly defaults: RubricAuditOptions;

  /**
   * Create an auditor with default options.
   *
   * @param defaults - Options applied to every call unless overridden per call.
   */
  constructor(defaults: RubricAuditOptions = {}) {
    this.defaults = defaults;
  }

  /**
   * Audit task rubrics. Same semantics as the module-level {@link auditRubrics}.
   *
   * @param tasks - Task records to audit.
   * @param opts - Per-call options; merged over the constructor defaults.
   * @returns Defects for human review.
   */
  auditRubrics(tasks: readonly TaskRecord[], opts: RubricAuditOptions = {}): RubricIssue[] {
    return auditRubrics(tasks, { ...this.defaults, ...opts });
  }
}
