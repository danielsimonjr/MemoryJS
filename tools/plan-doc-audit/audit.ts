/**
 * Plan-Doc Audit
 *
 * Walks every `docs/superpowers/plans/**\/*.md` and `docs/roadmap/**\/*.md`,
 * extracts code symbols mentioned in each `- [ ]` task line, and reports
 * whether the symbol exists in `src/` as real shipped code (vs. a stub
 * that throws "Not implemented"). The stub-vs-real distinction is the
 * load-bearing lesson from the 2026-04-24 reconciliation: `git grep`
 * matches whether a function is real or just a placeholder, so the
 * audit must read function bodies, not just symbol names.
 *
 * Modes:
 *   --dry-run (default)  — report only
 *   --apply              — rewrite plan files, flipping `- [ ]` to `- [x]`
 *                          for tasks where every named symbol is shipped.
 *
 * Usage:
 *   npx tsx tools/plan-doc-audit/audit.ts [--apply]
 *
 * Exit codes:
 *   0 — no flip-eligible items, or --apply succeeded
 *   1 — flip-eligible items found in --dry-run mode (signals work to do)
 *   2 — execution error
 *
 * @module tools/plan-doc-audit
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';

export type SymbolStatus = 'shipped' | 'stub' | 'absent';

export interface SymbolCheck {
  symbol: string;
  status: SymbolStatus;
  evidence?: string;  // First match line for human review
}

export interface AuditFinding {
  file: string;       // Plan-doc path (relative)
  line: number;       // 1-indexed line number of the unchecked task
  task: string;       // Raw task text (without checkbox marker)
  symbols: SymbolCheck[];
  recommendation: 'flip' | 'leave';
  reason: string;
}

/** Symbol extraction is intentionally conservative: only backtick-quoted
 * code spans count. PascalCase identifiers in prose are too noisy
 * (e.g., "Memory Engine Core", "Cross-session recall test") and produce
 * many false positives that cause spurious flip recommendations.
 */
const RE_BACKTICK_CODE = /`([^`]+)`/g;

/** Stub markers — when the matched function body contains these, the
 * symbol is NOT shipped. The first one is the load-bearing case from
 * the 2026-04-24 reconciliation: stubs that throw "Not implemented"
 * must NOT count as shipped, even though git grep finds them. */
const STUB_MARKERS = [
  /throw new Error\(['"`].*[Nn]ot implemented/,
  /throw new (?:TypeError|ReferenceError)\(['"`].*[Nn]ot implemented/,
  /\/\/\s*TODO:\s*implement/i,
  /\/\*\*?\s*@deprecated stub/,
];

export function extractSymbols(taskText: string): string[] {
  const found = new Set<string>();

  // Only backtick-quoted code spans count. Inside the span:
  // - Reject paths (containing /, \, or .md/.ts/.json/etc. extensions)
  //   because turning `baselines.json` into `json` creates false positives.
  // - Strip trailing parens "(args)" so methodName()/methodName(x, y) → methodName.
  // - For dotted access "foo.bar.baz", keep the leaf identifier.
  // - Reject anything that isn't a valid identifier, plus a small noise
  //   filter (English words/keywords/method names like "skip"/"true").
  let m: RegExpExecArray | null;
  while ((m = RE_BACKTICK_CODE.exec(taskText)) !== null) {
    const inner = m[1].trim();
    if (inner.includes('/') || inner.includes('\\')) continue;          // file path
    if (/\.(md|ts|js|json|jsonl|db|html|css|yaml|yml|toml)$/i.test(inner)) continue;
    const cleaned = inner.replace(/\(.*$/, '').replace(/^.*\./, '');
    if (cleaned.length < 3) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) continue;
    if (PROSE_INSIDE_BACKTICKS.has(cleaned.toLowerCase())) continue;
    found.add(cleaned);
  }

  return Array.from(found);
}

/** Words that occasionally appear backtick-quoted but are not symbols
 * (file-extension placeholders, generic terms, language keywords,
 * test-framework primitives). */
const PROSE_INSIDE_BACKTICKS = new Set([
  'true', 'false', 'null', 'undefined',
  'foo', 'bar', 'baz', 'qux',
  'string', 'number', 'boolean', 'object', 'array',
  'todo', 'fixme', 'note', 'warning',
  // Test-framework / common method names that aren't useful as symbols
  'skip', 'only', 'each', 'todo',
  // Generic "do" verbs that often appear in `\`add()\`` etc.
  'add', 'set', 'get', 'put', 'pop', 'top', 'run',
]);

/** Verbs that almost always indicate future work, not completed work,
 * even when the task text mentions existing symbols as the *target* of
 * the new work. A task starting with one of these is left unchecked
 * even if every named symbol is already shipped. */
const FUTURE_WORK_VERBS = [
  /\bImplement\b/i,
  /\bCreate\b/i,
  /\bBuild\b/i,
  /\bAdd\b/i,
  /\bWire\b/i,
  /\bWrite\b/i,
  /\bExtend\b/i,
  /\bDesign\b/i,
  /\bRefactor\b/i,
  /\bIntegrate\b/i,
  /\bGenerate\b/i,
  /\bPropagate\b/i,
];

/** Check whether a symbol is shipped, a stub, or absent. The optional
 * `cwd` lets tests point at a synthetic repo without changing the
 * process-wide cwd (which is unsafe under vitest workers). */
export function checkSymbol(
  symbol: string,
  srcRoot: string,
  cwd: string = process.cwd(),
): SymbolCheck {
  // Run git grep to find candidate matches
  let stdout = '';
  try {
    stdout = execSync(
      `git grep -n -w "${symbol.replace(/"/g, '\\"')}" -- ${srcRoot}`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], cwd },
    );
  } catch {
    // git grep returns non-zero when no matches found
    return { symbol, status: 'absent' };
  }

  const lines = stdout.split('\n').filter(Boolean);
  if (lines.length === 0) return { symbol, status: 'absent' };

  // For each match, look at a small window around the line to detect stubs.
  for (const matchLine of lines) {
    const colon1 = matchLine.indexOf(':');
    const colon2 = matchLine.indexOf(':', colon1 + 1);
    if (colon1 < 0 || colon2 < 0) continue;
    const file = matchLine.slice(0, colon1);
    const lineNo = parseInt(matchLine.slice(colon1 + 1, colon2), 10);
    if (Number.isNaN(lineNo)) continue;

    // Resolve the file path against the same cwd we ran git grep from
    // so the stub-marker check reads the right file.
    const absFile = isAbsolute(file) ? file : join(cwd, file);
    const stubFound = isStubAtLocation(absFile, lineNo);
    if (!stubFound) {
      // Real implementation found — symbol is shipped.
      return { symbol, status: 'shipped', evidence: `${file}:${lineNo}` };
    }
  }

  // Every match was inside a stub.
  return {
    symbol,
    status: 'stub',
    evidence: lines[0]?.slice(0, 120),
  };
}

/** Check whether the matched line is part of a stub. The window is
 * tight (matched line + 2 lines after) so that a multi-class file like
 * `class A { real() } class B { throw() }` does not false-positive on
 * A's class-declaration line because B's stub falls within an
 * over-eager window. Single-line `method() { throw new Error(...) }`
 * stubs are still caught because the throw is on the same or next line. */
function isStubAtLocation(filePath: string, lineNo: number): boolean {
  let body: string;
  try {
    body = readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }
  const lines = body.split('\n');
  const startIdx = Math.max(0, lineNo - 1);
  const endIdx = Math.min(lines.length, lineNo + 2);
  const window = lines.slice(startIdx, endIdx).join('\n');
  return STUB_MARKERS.some((re) => re.test(window));
}

export function auditFile(
  planFile: string,
  srcRoot: string,
  cwd: string = process.cwd(),
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const text = readFileSync(planFile, 'utf-8');
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^[ \t]*-[ \t]*\[ \][ \t]*(.+)$/);
    if (!m) continue;
    const taskText = m[1];
    const symbols = extractSymbols(taskText);
    if (symbols.length === 0) {
      // No symbols to verify — leave the box unchecked (we can't know).
      findings.push({
        file: planFile,
        line: i + 1,
        task: taskText.slice(0, 100),
        symbols: [],
        recommendation: 'leave',
        reason: 'no-symbols-extracted',
      });
      continue;
    }
    const checks = symbols.map((s) => checkSymbol(s, srcRoot, cwd));
    const allShipped = checks.length > 0 && checks.every((c) => c.status === 'shipped');
    // Safety: tasks that begin with a future-work verb almost always
    // reference existing symbols (e.g. "Wire X into ContextWindowManager")
    // as the *target* of new work, not as evidence the task is done.
    // Leave them unchecked even if every symbol is shipped.
    const isFutureWork = FUTURE_WORK_VERBS.some((re) => re.test(taskText));
    const recommendation: 'flip' | 'leave' =
      allShipped && !isFutureWork ? 'flip' : 'leave';
    const reason = allShipped
      ? isFutureWork
        ? 'task-describes-future-work'
        : 'every-symbol-shipped'
      : checks.some((c) => c.status === 'stub')
        ? 'has-stub'
        : 'symbol-absent';
    findings.push({
      file: planFile,
      line: i + 1,
      task: taskText.slice(0, 100),
      symbols: checks,
      recommendation,
      reason,
    });
  }

  return findings;
}

export function applyFlips(findings: AuditFinding[]): { filesUpdated: number; flipped: number } {
  // Group flip-recommended findings by file
  const flipsByFile = new Map<string, Set<number>>();
  for (const f of findings) {
    if (f.recommendation !== 'flip') continue;
    if (!flipsByFile.has(f.file)) flipsByFile.set(f.file, new Set());
    flipsByFile.get(f.file)!.add(f.line);
  }

  let flipped = 0;
  for (const [file, lineSet] of flipsByFile) {
    const text = readFileSync(file, 'utf-8');
    const lines = text.split('\n');
    for (const lineNo of lineSet) {
      const idx = lineNo - 1;
      const m = lines[idx].match(/^([ \t]*-[ \t]*\[) (\][ \t]*)(.+)$/);
      if (m) {
        lines[idx] = `${m[1]}x${m[2]}${m[3]}`;
        flipped += 1;
      }
    }
    writeFileSync(file, lines.join('\n'), 'utf-8');
  }

  return { filesUpdated: flipsByFile.size, flipped };
}

function walkMd(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (stat.isFile() && e.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out;
}

export function runAudit(opts: {
  planRoots?: string[];
  srcRoot?: string;
  apply?: boolean;
  cwd?: string;
} = {}): { findings: AuditFinding[]; flipsApplied?: number } {
  const cwd = opts.cwd ?? process.cwd();
  const planRoots = opts.planRoots ?? ['docs/superpowers/plans', 'docs/roadmap'];
  const srcRoot = opts.srcRoot ?? 'src';
  // Resolve plan roots against cwd so the walker finds the right tree.
  const absRoots = planRoots.map((p) => (isAbsolute(p) ? p : join(cwd, p)));
  const planFiles = absRoots.flatMap(walkMd);

  const findings: AuditFinding[] = [];
  for (const f of planFiles) {
    findings.push(...auditFile(f, srcRoot, cwd));
  }

  if (opts.apply) {
    const { flipped } = applyFlips(findings);
    return { findings, flipsApplied: flipped };
  }

  return { findings };
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');

  const { findings, flipsApplied } = runAudit({ apply });

  // Summary
  const flipCount = findings.filter((f) => f.recommendation === 'flip').length;
  const stubCount = findings.filter((f) => f.symbols.some((s) => s.status === 'stub')).length;
  const totalUnchecked = findings.length;

  console.log(`Plan-doc audit summary:`);
  console.log(`  Total unchecked items scanned: ${totalUnchecked}`);
  console.log(`  Flip-eligible (every symbol shipped):  ${flipCount}`);
  console.log(`  Has stub (NOT eligible — body throws):  ${stubCount}`);
  console.log(`  Mode: ${apply ? '--apply' : '--dry-run'}`);
  if (apply) {
    console.log(`  Flips applied: ${flipsApplied ?? 0}`);
  }

  // Detail per flip-eligible item
  if (flipCount > 0 && !apply) {
    console.log(`\nFlip-eligible items (run with --apply to flip them):\n`);
    for (const f of findings) {
      if (f.recommendation !== 'flip') continue;
      const rel = relative(process.cwd(), f.file).split(sep).join('/');
      const symList = f.symbols.map((s) => s.symbol).join(', ');
      console.log(`  ${rel}:${f.line}  [${symList}]`);
      console.log(`    ${f.task}`);
    }
  }

  // Detail per stub-blocked item
  if (stubCount > 0) {
    console.log(`\nStub-blocked items (left unchecked because impl is a stub):\n`);
    for (const f of findings) {
      const stubs = f.symbols.filter((s) => s.status === 'stub');
      if (stubs.length === 0) continue;
      const rel = relative(process.cwd(), f.file).split(sep).join('/');
      console.log(`  ${rel}:${f.line}  stubs=[${stubs.map((s) => s.symbol).join(', ')}]`);
      console.log(`    ${f.task}`);
    }
  }

  // Exit code: 1 if dry-run found work, 0 otherwise
  if (!apply && flipCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

// Run as CLI when invoked directly
const isMain = (() => {
  try {
    return import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    main();
  } catch (err) {
    console.error('plan-doc-audit error:', err);
    process.exit(2);
  }
}
