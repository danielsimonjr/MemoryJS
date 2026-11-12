/**
 * Secret scanner for the Agent Memory Repo (AMR). It finds secret-shaped text by line and pattern
 * id. A hit never holds the matched text. The default patterns can be replaced by a JSON file
 * named in an environment variable. A bad file fails loudly; the defaults are never used then.
 *
 * @module features/amr/SecretScanner
 * @experimental
 */
import { readFileSync } from 'node:fs';
import { ValidationError } from '../../utils/errors.js';

/** One secret pattern. `source` is the text of a regular expression. */
export interface SecretPattern {
  /** Pattern id. It appears in every hit. */
  id: string;
  /** Regular expression source text. */
  source: string;
  /** Optional regular expression flags. The flags `g` and `y` are removed. */
  flags?: string;
}

/** One line that matches a secret pattern. */
export interface SecretHit {
  /** Line where the match is, starting at 1. */
  line: number;
  /** Id of the pattern that matched. */
  patternId: string;
}

/** Environment variable that names a JSON file with the secret patterns. */
const SECRET_PATTERNS_FILE_ENV = 'MEMORY_AMR_SECRET_PATTERNS_FILE';

/**
 * Built-in patterns. Each source is anchored on a fixed prefix and has no nested repeat, so a
 * match runs in linear time. The scan works line by line: a key that a line break or a zero-width
 * character splits is not found.
 */
export const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: 'aws-access-key', source: '(?:AKIA|ASIA)[0-9A-Z]{16}' },
  { id: 'github-token', source: 'gh[pousr]_[A-Za-z0-9]{36}' },
  { id: 'anthropic-key', source: 'sk-ant-[A-Za-z0-9_-]{20,}' },
  { id: 'openai-key', source: '(?<![A-Za-z0-9])sk-(?!ant-)(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{20,})' },
  { id: 'github-pat', source: 'github_pat_[A-Za-z0-9_]{50,}' },
  { id: 'slack-token', source: 'xox[baprs]-[A-Za-z0-9-]{10,}' },
  { id: 'google-api-key', source: 'AIza[0-9A-Za-z_-]{35}' },
  { id: 'npm-token', source: 'npm_[A-Za-z0-9]{36}' },
  { id: 'private-key-block', source: '-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----' },
];

/**
 * Check one pattern entry of a pattern file and return it without the `g` and `y` flags.
 * @param raw - One entry from the file.
 * @param index - Position of the entry, for the error code.
 * @returns The checked pattern.
 * @throws ValidationError when the entry is not valid.
 */
function checkEntry(raw: unknown, index: number): SecretPattern {
  const at = `patterns:entry-${index}`;
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('secret pattern entry is not an object', [at]);
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id === '') throw new ValidationError('secret pattern has no id', [`${at}:id`]);
  if (typeof e.source !== 'string' || e.source === '') {
    throw new ValidationError('secret pattern has no source', [`${at}:source`]);
  }
  if (e.flags !== undefined && typeof e.flags !== 'string') {
    throw new ValidationError('secret pattern flags are not text', [`${at}:flags`]);
  }
  const flags = typeof e.flags === 'string' ? e.flags.replace(/[gy]/g, '') : undefined;
  try {
    new RegExp(e.source, flags);
  } catch {
    throw new ValidationError('secret pattern source does not compile', [`${at}:source`]);
  }
  return flags === undefined ? { id: e.id, source: e.source } : { id: e.id, source: e.source, flags };
}

/**
 * Check a parsed list of secret patterns.
 * @param raw - Value from a pattern file, or from an option. Any type is allowed.
 * @returns The checked patterns.
 * @throws ValidationError when the value is not a list of valid patterns, or the list is empty.
 */
export function validateSecretPatterns(raw: unknown): SecretPattern[] {
  if (!Array.isArray(raw)) throw new ValidationError('secret patterns must be a list', ['patterns:not-array']);
  if (raw.length === 0) throw new ValidationError('secret pattern list is empty', ['patterns:empty']);
  return raw.map((entry, index) => checkEntry(entry, index));
}

/**
 * Load the secret patterns. The defaults are used when the environment variable is unset or empty.
 * @param env - Environment to read. Defaults to the process environment.
 * @returns The defaults, or the checked patterns of the file that the variable names.
 * @throws ValidationError when the file is unreadable, not valid JSON, or holds an invalid list.
 */
export function loadSecretPatterns(env: NodeJS.ProcessEnv = process.env): SecretPattern[] {
  const file = env[SECRET_PATTERNS_FILE_ENV];
  if (file === undefined || file === '') return DEFAULT_SECRET_PATTERNS.map((p) => ({ ...p }));
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new ValidationError(`${SECRET_PATTERNS_FILE_ENV} file cannot be read`, ['patterns:unreadable']);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError(`${SECRET_PATTERNS_FILE_ENV} file is not valid JSON`, ['patterns:bad-json']);
  }
  return validateSecretPatterns(parsed);
}

/**
 * Scan text for secret patterns. Lines start at 1. Hits come in line order, then in pattern order.
 * @param text - Text to scan. Lines end with LF or CRLF.
 * @param patterns - Patterns to use. Defaults to {@link DEFAULT_SECRET_PATTERNS}.
 * @returns One hit per line and pattern. A hit never holds the matched text.
 */
export function scanForSecrets(text: string, patterns: readonly SecretPattern[] = DEFAULT_SECRET_PATTERNS): SecretHit[] {
  const compiled = patterns.map((p) => ({
    id: p.id,
    re: new RegExp(p.source, (p.flags ?? '').replace(/[gy]/g, '')),
  }));
  const hits: SecretHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { id, re } of compiled) {
      if (re.test(lines[i])) hits.push({ line: i + 1, patternId: id });
    }
  }
  return hits;
}
