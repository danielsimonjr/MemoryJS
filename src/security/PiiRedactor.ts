/**
 * PII Redactor (η.6.3)
 *
 * Pluggable regex-based redactor for personally identifiable
 * information. Applied on export only — no storage mutation. Default
 * pattern bank covers the common five (email, phone, SSN, credit card,
 * IP address); callers can replace or extend the pattern list via
 * constructor options.
 *
 * Design rule: redactors REPLACE, never delete. Replacement preserves
 * length-class so downstream tooling (length checks, char counts) still
 * sees roughly the same shape — `<EMAIL>` for emails, `<SSN>` for SSNs,
 * etc. Caller can override per-pattern.
 *
 * @module security/PiiRedactor
 */

/** Single redaction rule. */
export interface PiiPattern {
  /** Stable name for diagnostics / metrics. */
  name: string;
  /** Regex matched against text. Use `/.../g` for multiple matches. */
  regex: RegExp;
  /** Replacement string. May reference capture groups via `$1` etc. */
  replacement: string;
}

/**
 * Default pattern bank. ASCII-only, conservative — false positives are
 * preferred over false negatives for PII. Callers exporting to a
 * regulated environment should layer additional patterns.
 */
export const DEFAULT_PII_PATTERNS: ReadonlyArray<PiiPattern> = [
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '<EMAIL>',
  },
  {
    name: 'ssn',
    // U.S. SSN: 3-2-4 digits with dashes. NOT a complete validator —
    // intentional false-positive bias.
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '<SSN>',
  },
  {
    name: 'credit-card',
    // 13-19 unbroken digits OR 4-digit groups separated by space/dash
    // (3-4 separator-joined groups, ≥13 total digits). Won't catch
    // numbers with embedded letters or unusual formatting.
    regex: /\b(?:\d{13,19}|\d{4}(?:[ -]\d{4}){2,4})\b/g,
    replacement: '<CC>',
  },
  {
    name: 'phone',
    // North American phone: optional country code, area code, 7 digits.
    // Format-tolerant (parens, dashes, dots, spaces).
    regex: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
    replacement: '<PHONE>',
  },
  {
    name: 'ipv4',
    // IPv4 dotted-quad. Not strictly validated (300.300.300.300 matches);
    // sufficient for PII redaction.
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '<IP>',
  },
];

export interface PiiRedactorOptions {
  /** Replace the default pattern bank entirely. */
  patterns?: ReadonlyArray<PiiPattern>;
  /** Append additional patterns to the default (or to `patterns` when set). */
  additionalPatterns?: ReadonlyArray<PiiPattern>;
}

/** Per-call redaction stats. */
export interface RedactionStats {
  /** Total bytes redacted across all patterns. */
  totalRedactedBytes: number;
  /** Per-pattern counts. */
  countsByPattern: Map<string, number>;
}

/** Result returned by `redactWithStats`. */
export interface RedactionResult {
  text: string;
  stats: RedactionStats;
}

export class PiiRedactor {
  private readonly patterns: ReadonlyArray<PiiPattern>;

  constructor(options?: PiiRedactorOptions) {
    const base = options?.patterns ?? DEFAULT_PII_PATTERNS;
    const extras = options?.additionalPatterns ?? [];
    this.patterns = [...base, ...extras];
  }

  /**
   * Redact PII in `text`. Returns the cleaned string.
   * Patterns are applied in declaration order.
   */
  redact(text: string): string {
    let out = text;
    for (const p of this.patterns) {
      // Reset regex lastIndex on global patterns to avoid cross-call state.
      out = out.replace(p.regex, p.replacement);
    }
    return out;
  }

  /**
   * Redact PII and return per-pattern statistics. Useful for compliance
   * audit trails — proves how many SSNs / emails / etc. were stripped
   * from an export without surfacing the actual values.
   */
  redactWithStats(text: string): RedactionResult {
    const countsByPattern = new Map<string, number>();
    let totalRedactedBytes = 0;
    let out = text;
    for (const p of this.patterns) {
      let count = 0;
      let bytes = 0;
      out = out.replace(p.regex, (match) => {
        count++;
        bytes += match.length;
        return p.replacement;
      });
      if (count > 0) countsByPattern.set(p.name, count);
      totalRedactedBytes += bytes;
    }
    return { text: out, stats: { totalRedactedBytes, countsByPattern } };
  }

  /**
   * Redact every observation on every entity in a graph-shaped object.
   * Returns a shallow clone with redacted observations — does NOT touch
   * the input. Accepts both mutable `Entity[]` and `ReadonlyArray<Entity>`
   * shapes (e.g. `ReadonlyKnowledgeGraph` from `storage.loadGraph()`).
   */
  redactGraph<T extends { entities: ReadonlyArray<{ observations: ReadonlyArray<string> }> }>(graph: T): T {
    return {
      ...graph,
      entities: graph.entities.map(e => ({
        ...e,
        observations: e.observations.map(obs => this.redact(obs)),
      })),
    } as unknown as T;
  }
}
