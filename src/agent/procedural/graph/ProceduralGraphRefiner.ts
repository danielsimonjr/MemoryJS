/**
 * Procedural Graph refiner — prompt assembly, rejection-memory
 * serialization, and strict parse of model-proposed edit sets.
 *
 * Online guidance never calls this module. Offline self-evolution feeds
 * the retained graph, a token-tailed trajectory block, and bounded
 * rejection memory into the paper's refiner prompt (feature plan 9.4 /
 * 8.5) and accepts only a raw JSON object with the four PG-06 arrays.
 *
 * PG-11 leak heuristic: after a successful parse, any `add_edges`
 * guidance/pitfalls field whose 12+ character substring appears
 * verbatim in `attemptsBlock` is reported as warning
 * `possible-trajectory-leak`. Warnings never flip `ok` to false.
 *
 * Sibling modules (`prompts`, `CompletionProvider`,
 * `ProceduralGraphSchemas`) are owned by other agents; this file codes
 * against their Section 4 signatures.
 *
 * @module agent/procedural/graph/ProceduralGraphRefiner
 * @experimental
 */

import type { PGCompletionProvider } from './CompletionProvider.js';
import { completeWithBudget } from './CompletionProvider.js';
import { parseEditSet } from './ProceduralGraphSchemas.js';
import { REFINER_PROMPT_TEMPLATE, renderTemplate, withDataHandlingNote } from './prompts.js';
import type {
  PGDiagnostic,
  PGEditSet,
  PGEdge,
  PGRefinementMode,
  PGRejectionRecord,
} from '../../../types/proceduralGraph.js';

/** Minimum contiguous length for the PG-11 trajectory-leak heuristic. */
const LEAK_SUBSTRING_MIN = 12;

/** How many diagnostics from each rejection record enter the prompt. */
const REJECTION_DIAGNOSTIC_CAP = 3;

/** Usage accounting forwarded from `completeWithBudget` (Section 4.8). */
type PGRefinerUsage = {
  input: number;
  output: number;
  approximate: boolean;
};

/**
 * Bindings for the paper refiner prompt (feature plan 8.5).
 *
 * Placeholders: `{task_description}`, `{mode}`, `{available_tools_list}`,
 * `{attempts_block}`, `{current_graph_json}`, `{rejected_block}`.
 */
export interface PGRefinerInput {
  /**
   * When true the prompt is the paper template verbatim. Otherwise the
   * MemoryJS data-handling note is appended (default: false).
   */
  paperCompatible?: boolean;
  taskDescription: string;
  mode: PGRefinementMode;
  toolCatalog: readonly string[];
  attemptsBlock: string;
  currentGraphJson: string;
  rejectedBlock: string;
}

export function buildRefinerPrompt(input: PGRefinerInput): string {
  return withDataHandlingNote(
    renderTemplate(REFINER_PROMPT_TEMPLATE, {
      task_description: input.taskDescription,
      mode: input.mode,
      available_tools_list: input.toolCatalog.join(', '),
      attempts_block: input.attemptsBlock,
      current_graph_json: input.currentGraphJson,
      rejected_block: input.rejectedBlock,
    }),
    input.paperCompatible ?? false,
  );
}

/**
 * Serialize rejection memory for `{rejected_block}` (feature plan 9.8).
 *
 * Newest records first (`recordedAt` descending, then `round`). Each
 * record lists reason, optional `candidateMean`, `retainedMean`, edit
 * summary counts, and the first three diagnostics. `omitted` counts
 * records dropped by `maxRecords` or by the `maxChars` budget.
 */
export function serializeRejections(
  records: readonly PGRejectionRecord[],
  opts: { maxRecords: number; maxChars: number },
): { text: string; omitted: number } {
  const maxRecords = Math.max(0, opts.maxRecords);
  const maxChars = Math.max(0, opts.maxChars);

  if (records.length === 0 || maxRecords === 0 || maxChars === 0) {
    return {
      text: '',
      omitted: records.length,
    };
  }

  const newestFirst = [...records].sort(compareNewestFirst);
  const considered = newestFirst.slice(0, maxRecords);
  let omitted = records.length - considered.length;

  const separator = '\n---\n';
  const parts: string[] = [];
  let used = 0;

  for (let i = 0; i < considered.length; i++) {
    const formatted = formatRejectionRecord(considered[i]!);
    const extra = i === 0 ? formatted.length : separator.length + formatted.length;

    if (used + extra <= maxChars) {
      parts.push(formatted);
      used += extra;
      continue;
    }

    if (i === 0) {
      parts.push(formatted.slice(0, maxChars));
      omitted += considered.length - 1;
      break;
    }

    omitted += considered.length - i;
    break;
  }

  return { text: parts.join(separator), omitted };
}

export async function proposeEdits(
  provider: PGCompletionProvider,
  input: PGRefinerInput,
  budget: { timeoutMs: number; maxOutputChars: number },
): Promise<
  | { ok: true; raw: string; edits: PGEditSet; usage: PGRefinerUsage; diagnostics: PGDiagnostic[] }
  | { ok: false; raw?: string; diagnostics: PGDiagnostic[]; usage?: PGRefinerUsage }
> {
  const prompt = buildRefinerPrompt(input);
  const completed = await completeWithBudget(provider, prompt, {
    timeoutMs: budget.timeoutMs,
    maxOutputChars: budget.maxOutputChars,
  });

  if (!completed.ok) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'provider-error',
          message: completed.error,
        },
      ],
      usage: completed.usage,
    };
  }

  const parsed = parseEditSet(completed.text);
  if (!parsed.ok) {
    const diagnostics = completed.truncated
      ? [
          {
            severity: 'error' as const,
            code: 'output-truncated',
            message: `Refiner output exceeded maxOutputChars (${budget.maxOutputChars}) and was cut before parsing`,
          },
          ...parsed.diagnostics,
        ]
      : parsed.diagnostics;
    return {
      ok: false,
      raw: completed.text,
      diagnostics,
      usage: completed.usage,
    };
  }

  // PG-11: warning-only; never fatal.
  const leakDiagnostics = detectTrajectoryLeaks(parsed.value, input.attemptsBlock);
  return {
    ok: true,
    raw: completed.text,
    edits: parsed.value,
    usage: completed.usage,
    diagnostics: leakDiagnostics,
  };
}

function compareNewestFirst(a: PGRejectionRecord, b: PGRejectionRecord): number {
  if (a.recordedAt !== b.recordedAt) {
    return a.recordedAt < b.recordedAt ? 1 : -1;
  }
  return b.round - a.round;
}

function formatRejectionRecord(record: PGRejectionRecord): string {
  const lines: string[] = [`reason: ${record.reason}`];
  if (record.candidateMean !== undefined) {
    lines.push(`candidateMean: ${record.candidateMean}`);
  }
  lines.push(`retainedMean: ${record.retainedMean === null ? 'null' : String(record.retainedMean)}`);
  lines.push(
    `edits: add_nodes=${record.edits.add_nodes.length} delete_nodes=${record.edits.delete_nodes.length} add_edges=${record.edits.add_edges.length} delete_edges=${record.edits.delete_edges.length}`,
  );

  const preview = record.diagnostics.slice(0, REJECTION_DIAGNOSTIC_CAP);
  if (preview.length > 0) {
    lines.push('diagnostics:');
    for (const diagnostic of preview) {
      lines.push(`  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Flag `add_edges` guidance/pitfalls that copy a 12+ character
 * substring of the trajectory block (PG-11). Warning-only.
 *
 * The naive form (`attemptsBlock.includes(window)` for every window of every
 * field) is O(|field| × |attemptsBlock|) per field — seconds for a 4 KB
 * guidance string against a 400 KB trajectory block. Instead the block's
 * 12-grams are indexed once per proposal with a rolling hash; each field is
 * then scanned in O(|field|) and only hash hits pay for an exact `includes`
 * confirmation, so there are no false positives.
 */
function detectTrajectoryLeaks(edits: PGEditSet, attemptsBlock: string): PGDiagnostic[] {
  if (attemptsBlock.length < LEAK_SUBSTRING_MIN) {
    return [];
  }

  const index = buildNgramIndex(attemptsBlock, LEAK_SUBSTRING_MIN);
  const diagnostics: PGDiagnostic[] = [];
  edits.add_edges.forEach((edge, editIndex) => {
    for (const field of ['guidance', 'pitfalls'] as const) {
      const value = edge[field];
      if (typeof value !== 'string' || !containsLeakedSubstring(value, attemptsBlock, index)) {
        continue;
      }
      diagnostics.push(leakDiagnostic(edge, field, editIndex));
    }
  });
  return diagnostics;
}

/** Polynomial rolling hash over UTF-16 code units, modulo 2^32. */
const NGRAM_BASE = 257;

/**
 * Invoke `visit(hash, endIndex)` for every `n`-code-unit window of `text`,
 * where `endIndex` is the index of the window's last code unit. The hash
 * is a pure function of the window contents (Rabin–Karp: multiply, add the
 * incoming unit, subtract the outgoing unit scaled by BASE^n), so equal
 * windows hash equally regardless of position.
 */
function forEachNgramHash(
  text: string,
  n: number,
  visit: (hash: number, endIndex: number) => boolean | void,
): void {
  let powerN = 1;
  for (let i = 0; i < n; i++) {
    powerN = Math.imul(powerN, NGRAM_BASE);
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(hash, NGRAM_BASE) + text.charCodeAt(i)) | 0;
    if (i >= n) {
      hash = (hash - Math.imul(text.charCodeAt(i - n), powerN)) | 0;
    }
    if (i >= n - 1 && visit(hash >>> 0, i) === true) {
      return;
    }
  }
}

function buildNgramIndex(text: string, n: number): Set<number> {
  const hashes = new Set<number>();
  forEachNgramHash(text, n, (hash) => {
    hashes.add(hash);
  });
  return hashes;
}

function containsLeakedSubstring(field: string, attemptsBlock: string, index: Set<number>): boolean {
  const n = LEAK_SUBSTRING_MIN;
  if (field.length < n) {
    return false;
  }
  let found = false;
  forEachNgramHash(field, n, (hash, end) => {
    // Hash hit: confirm with an exact substring check to rule out collisions.
    if (index.has(hash) && attemptsBlock.includes(field.slice(end - n + 1, end + 1))) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

function leakDiagnostic(edge: PGEdge, field: 'guidance' | 'pitfalls', editIndex: number): PGDiagnostic {
  return {
    severity: 'warning',
    code: 'possible-trajectory-leak',
    message: `add_edges[${editIndex}].${field} copies a ${LEAK_SUBSTRING_MIN}+ character substring from the trajectory block`,
    edge: { source: edge.source, target: edge.target, relation: edge.relation },
    editIndex,
  };
}
