# Dependency Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `rimraf`, `chalk`, `async-mutex`, `cli-table3`, and `chrono-node` from `@danielsimonjr/memoryjs` by replacing the call sites this repo actually uses. Sprint 5 replaces chrono-node with an in-repo English date parser. Daniel decided that on 2026-11-10 (9:12 AM CT). Parity holds, so the release is a minor and there is no optional peer and no 5.0.0.

**Architecture:** One sprint is one PR. Each sprint adds a focused module, pins its behavior with tests written against the old package, switches call sites, then deletes the dependency and regenerates `bun.lock`. Library public types do not change. `RunExclusiveMutex` is a new class; it does not wrap `AsyncMutex`.

**Tech Stack:** TypeScript, Node >=22.12.0, Bun 1.4.2, Vitest, tsup, oxlint. Published types come from `tsc` via `scripts/emit-dts.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-10-dependency-reduction-design.md`

## Global Constraints

- Node production runtime remains `>=22.12.0`. Bun remains `>=1.4.2` and `packageManager` remains `bun@1.4.2`.
- `bun.lock` is the lockfile that changes. Do not add a root `package-lock.json`.
- Public exports in `package.json` `exports` stay. No exported TypeScript name is removed or retyped.
- `overrides.esbuild` stays `^0.28.1`.
- `better-sqlite3` stays external in `tsup.config.ts`.
- Storage file formats, SQLite schema, and environment-variable names stay.
- Each sprint is one PR. The builder is deepseek-v41-flash-1017. The challenger is glm-5p3-flash. The build reviewer is composer-2.5. The build checker/fixer is grok-4.6. The final PR reviewer is grok-4.7.
- The build reviewer reconciles the challenger's findings, then hands the PR to the build checker/fixer. The build checker/fixer checks everything in the PR against this plan and fixes all remaining issues, then hands the PR to the final PR reviewer.
- Merge the sprint PR only after the final PR reviewer reports PASS and CI is green. This planning branch does not merge.
- Tests that describe the old dependency's behavior land in the same PR as the removal, and they are written to fail before the new module exists.
- Verification for every sprint: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, `bun run build`. Do not commit `dist/`.
- `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` and `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` must exit 0 when a sprint adds an exported symbol. New exports need a JSDoc block whose first sentence says what the function does.
- No force-push, rebase, amend, or `--no-verify`. No publish.
- The builder commits on the sprint branch. The build checker/fixer commits the fixes for anything still wrong against this plan. The final PR reviewer does not merge.

## Roles

Per sprint, in this order:

| Role | Model | Job on each sprint |
|---|---|---|
| Builder | deepseek-v41-flash-1017 | Implements the tasks in order. Writes the failing test first. |
| Challenger | glm-5p3-flash | After the builder's tests pass, tries to break the parity claim. Leaves findings and, when a finding is real, a failing test (timeout, ANSI width, missing peer, non-TTY, wide character). Does not widen the sprint. |
| Build Reviewer | composer-2.5 | Reviews the challenger's findings and failing tests and reconciles them. Fixes a valid finding. Rebuts an invalid one with a written reason on the PR. Rejects a sprint that imports `AsyncMutex` to replace `async-mutex`, or that edits KEEP packages. Hands the PR to the build checker/fixer. |
| Build Checker/Fixer | grok-4.6 | After the build reviewer, checks everything in the PR against this plan and fixes all remaining issues, including verification failures. Re-runs the verification block on a clean `bun install --frozen-lockfile`. Hands the PR to the final PR reviewer. |
| Final PR reviewer | grok-4.7 | After the build checker/fixer, reviews the PR and reports PASS or FAIL. Merge waits for PASS and green CI. |

Handoff on every sprint: builder, then challenger, then the build reviewer reconciles the challenger's findings, then the build checker/fixer checks the whole PR against the plan and fixes every remaining issue, then the final PR reviewer. Merge only after grok-4.7 PASS and green CI.

## File map

| File | Sprint | Responsibility |
|---|---|---|
| `scripts/clean-dist.mjs` | 1 | Delete `dist/` with `node:fs`. |
| `package.json` `scripts.clean` | 1 | Call the script instead of `rimraf`. |
| `src/cli/ansi.ts` | 2 | The six chalk styles the CLI uses. |
| `src/cli/formatters.ts`, `src/cli/interactive.ts` | 2 | Import `ansi` instead of `chalk`. |
| `src/cli/plainTable.ts` | 3 | `head` / `colWidths` / `wordWrap` / `push` / `toString`. `colWidths` include padding. |
| `src/utils/RunExclusiveMutex.ts` | 4 | FIFO `runExclusive` with no timeout, no queue cap, and no reentrancy. |
| Storage, column, tier, and interaction-log call sites | 4 | Construct `RunExclusiveMutex`. The legacy-delete test uses `AsyncMutex`. |
| `src/search/enDate/` | 5 | English date parsers and refiners. Replaces `chrono-node`. |
| `src/search/TemporalQueryParser.ts` | 5 | Call the in-repo parser. Same results, including throws. |

## Sprint 1 — REBUILD `rimraf`

**Semver:** none. Dev dependency only. Consumers of `^4.5.0` do not install it.
**Scope:** `clean` deletes `dist` and nothing else. `prepublishOnly` still runs `bun run clean`.
**Acceptance:** `rg rimraf package.json bun.lock` finds no matches. `bun run clean` removes a `dist/` directory and exits 0 when `dist/` is already absent.

### Task 1: Replace the clean script

**Files:**
- Create: `scripts/clean-dist.mjs`
- Create: `tests/unit/scripts/clean-dist.test.ts`
- Modify: `package.json` (script `clean`, delete devDependency `rimraf`)
- Modify: `bun.lock` (regenerated)

**Interfaces:**
- Consumes: nothing
- Produces: `node scripts/clean-dist.mjs` removes `<cwd>/dist` recursively. No exports.

- [ ] **Step 1: Write the failing test**

```typescript
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('scripts/clean-dist.mjs', () => {
  it('removes dist and succeeds when dist is already gone', async () => {
    const root = join(tmpdir(), `memoryjs-clean-${Date.now()}`);
    const dist = join(root, 'dist');
    await mkdir(join(dist, 'nested'), { recursive: true });
    await writeFile(join(dist, 'nested', 'index.js'), 'x');
    const script = join(process.cwd(), 'scripts/clean-dist.mjs');
    await execFileAsync(process.execPath, [script], { cwd: root });
    await expect(access(dist)).rejects.toMatchObject({ code: 'ENOENT' });
    await execFileAsync(process.execPath, [script], { cwd: root });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/unit/scripts/clean-dist.test.ts`
Expected: FAIL because `scripts/clean-dist.mjs` does not exist.

- [ ] **Step 3: Write the script and point `clean` at it**

`scripts/clean-dist.mjs`:

```javascript
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

await rm(join(process.cwd(), 'dist'), { recursive: true, force: true });
```

`package.json`:

```json
"clean": "node scripts/clean-dist.mjs"
```

Delete the `"rimraf": "^6.1.4"` entry from `devDependencies`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/unit/scripts/clean-dist.test.ts`
Expected: PASS

- [ ] **Step 5: Regenerate the lockfile and confirm the chain is gone**

Run:

```bash
bun install
rg "rimraf|minimatch" bun.lock package.json
```

Expected: no matches. `overrides.esbuild` is still `^0.28.1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/clean-dist.mjs tests/unit/scripts/clean-dist.test.ts package.json bun.lock
git commit -m "build: delete dist with node:fs instead of rimraf"
```

### Task 2: Sprint 1 verification

- [ ] **Step 1: Checker commands**

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
bun run clean
test ! -d dist && echo "dist removed"
```

Expected: each command exits 0, then `dist removed`.

## Sprint 2 — REBUILD `chalk`

**Semver:** patch. No public type changes. CLI color codes for the six styles stay the same when color is enabled.
**Scope:** `src/cli/ansi.ts` plus the two CLI importers. Do not add chalk styles the call sites do not use.
**Acceptance:** `rg "from 'chalk'" src tests` finds no matches. `dependencies` has no `chalk`. A forced-color string equals chalk 6.0.0's string for each style before chalk is removed. `NO_COLOR=1` returns the input unchanged.

### Task 3: Parity test against chalk, then the helper

**Files:**
- Create: `src/cli/ansi.ts`
- Create: `tests/unit/cli/ansi.test.ts`
- Modify: `src/cli/formatters.ts`
- Modify: `src/cli/interactive.ts`
- Modify: `tests/unit/cli/interactive.test.ts` (the `vi.mock('chalk')` block)
- Modify: `package.json`, `bun.lock`

**Interfaces:**
- Consumes: nothing
- Produces:

```typescript
export const ansi: {
  cyan: (text: string) => string;
  bold: (text: string) => string;
  green: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  gray: (text: string) => string;
};
```

- [ ] **Step 1: Write the failing test while chalk is still installed**

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import chalk from 'chalk';
import { ansi } from '../../../src/cli/ansi.js';

const STYLES = ['cyan', 'bold', 'green', 'red', 'yellow', 'gray'] as const;

describe('ansi', () => {
  const previous: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['NO_COLOR', 'FORCE_COLOR']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it('matches chalk when color is forced', () => {
    previous.FORCE_COLOR = process.env.FORCE_COLOR;
    previous.NO_COLOR = process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    chalk.level = 1;
    for (const style of STYLES) {
      expect(ansi[style]('Name')).toBe(chalk[style]('Name'));
    }
  });

  it('returns plain text when NO_COLOR is set, including when FORCE_COLOR is also set', () => {
    previous.NO_COLOR = process.env.NO_COLOR;
    previous.FORCE_COLOR = process.env.FORCE_COLOR;
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';
    expect(ansi.red('x')).toBe('x');
    expect(chalk.red('x')).toBe('x');
  });

  it('does not treat an empty NO_COLOR as disable, and honors FORCE_COLOR true and false', () => {
    previous.NO_COLOR = process.env.NO_COLOR;
    previous.FORCE_COLOR = process.env.FORCE_COLOR;
    process.env.NO_COLOR = '';
    process.env.FORCE_COLOR = 'true';
    chalk.level = 1;
    expect(ansi.red('x')).toBe(chalk.red('x'));
    process.env.FORCE_COLOR = 'false';
    expect(ansi.red('x')).toBe('x');
    expect(chalk.red('x')).toBe('x');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/unit/cli/ansi.test.ts`
Expected: FAIL with cannot find module `src/cli/ansi.js`.

- [ ] **Step 3: Implement the helper**

```typescript
/**
 * CLI colors for the six styles MemoryJS prints.
 *
 * Enabled when FORCE_COLOR is 1, 2, or 3. Disabled when NO_COLOR is set
 * or FORCE_COLOR is 0. Otherwise enabled only when stdout is a TTY.
 */
const CODES = { bold: 1, red: 31, green: 32, yellow: 33, cyan: 36, gray: 90 } as const;

function enabled(): boolean {
  // Match chalk 6 / supports-color. A non-empty NO_COLOR wins.
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (!Object.prototype.hasOwnProperty.call(process.env, 'FORCE_COLOR')) {
    return Boolean(process.stdout.isTTY);
  }
  const force = process.env.FORCE_COLOR ?? '';
  if (force === 'false' || force === '0') return false;
  if (force === '' || force === 'true') return true;
  const level = Number.parseInt(force, 10);
  if (level === 0) return false;
  if (level >= 1 && level <= 3) return true;
  return Boolean(process.stdout.isTTY);
}

function paint(code: number, text: string): string {
  if (!enabled()) return text;
  return `\u001b[${code}m${text}\u001b[39m`;
}

export const ansi = {
  bold: (text: string) => (enabled() ? `\u001b[1m${text}\u001b[22m` : text),
  red: (text: string) => paint(CODES.red, text),
  green: (text: string) => paint(CODES.green, text),
  yellow: (text: string) => paint(CODES.yellow, text),
  cyan: (text: string) => paint(CODES.cyan, text),
  gray: (text: string) => paint(CODES.gray, text),
};
```

Bold uses reset `22`, not `39`. The parity test is the authority: if a code disagrees with chalk 6.0.0 under `FORCE_COLOR=1` and `chalk.level = 1`, change the helper, not the test.

- [ ] **Step 4: Run the parity test**

Run: `bunx vitest run tests/unit/cli/ansi.test.ts`
Expected: PASS

- [ ] **Step 5: Switch call sites**

In `src/cli/formatters.ts` and `src/cli/interactive.ts`, replace `import chalk from 'chalk'` with `import { ansi } from './ansi.js'` and replace `chalk.` with `ansi.`.

In `tests/unit/cli/interactive.test.ts`, delete the `vi.mock('chalk', ...)` factory. The test's assertions must still pass against real `ansi` output. Where a test asserted on the mock's plain-text return, set `process.env.NO_COLOR = '1'` in that file's `beforeEach` so the text stays uncolored, and restore the variable in `afterEach`.

- [ ] **Step 6: Drop chalk and rewrite the parity test so it no longer imports chalk**

Remove `chalk` from `dependencies`. Run `bun install`.

Replace the chalk comparison in `tests/unit/cli/ansi.test.ts` with the codes the passing parity run recorded. Expected forced-color values at level 1:

```typescript
expect(ansi.bold('Name')).toBe('\u001b[1mName\u001b[22m');
expect(ansi.red('Name')).toBe('\u001b[31mName\u001b[39m');
expect(ansi.green('Name')).toBe('\u001b[32mName\u001b[39m');
expect(ansi.yellow('Name')).toBe('\u001b[33mName\u001b[39m');
expect(ansi.cyan('Name')).toBe('\u001b[36mName\u001b[39m');
expect(ansi.gray('Name')).toBe('\u001b[90mName\u001b[39m');
```

If Step 4 showed chalk 6.0.0 emits different close codes, keep those recorded codes. Delete the `chalk` import.

Run: `bunx vitest run tests/unit/cli/ansi.test.ts tests/unit/cli/formatters.test.ts tests/unit/cli/interactive.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/ansi.ts src/cli/formatters.ts src/cli/interactive.ts tests/unit/cli/ansi.test.ts tests/unit/cli/interactive.test.ts package.json bun.lock
git commit -m "refactor: replace chalk with a six-style CLI painter"
```

### Task 4: Sprint 2 verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
rg "chalk" dist/cli/index.js package.json
```

Expected: commands exit 0. `package.json` has no chalk. The CLI bundle contains the SGR sequences and does not contain `node_modules/chalk`.

## Sprint 3 — REBUILD `cli-table3`

**Semver:** patch. JSON and CSV formatter output stays byte-identical. Border glyphs may differ from `cli-table3`. Daniel can reject this sprint if a downstream tool snapshots those borders.
**Scope:** `src/cli/formatters.ts` table construction only. `wordWrap: true` is passed only by the entity table and the search-results table. The relation table and the centrality table omit it.
**Acceptance:** `cli-table3` is gone from `package.json` and `bun.lock`. `formatEntities(..., 'json')` tests still pass. `colWidths` stay cli-table3 full column widths (content width is `max(1, colWidth - 2)`). A fullwidth character counts as width 2. A token wider than the content width hard-breaks when `wordWrap` is true. ANSI in a header does not change the border width.

### Task 5: Plain table used by the formatters

**Files:**
- Create: `src/cli/plainTable.ts`
- Create: `tests/unit/cli/plainTable.test.ts`
- Modify: `src/cli/formatters.ts`
- Modify: `package.json`, `bun.lock`

**Interfaces:**
- Consumes: Sprint 2 `ansi` only as cell content (the table must not import chalk)
- Produces:

```typescript
export interface PlainTableOptions {
  head: string[];
  colWidths: number[];
  wordWrap?: boolean;
}
export class PlainTable {
  constructor(options: PlainTableOptions);
  push(cells: string[]): void;
  toString(): string;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { PlainTable } from '../../../src/cli/plainTable.js';

describe('PlainTable', () => {
  it('renders a border, a header, and a row', () => {
    const table = new PlainTable({
      head: ['A', 'B'],
      colWidths: [5, 5],
    });
    table.push(['1', '2']);
    const text = table.toString();
    expect(text).toContain('| A');
    expect(text).toContain('| 1');
    expect(text.split('\n')[0].startsWith('+')).toBe(true);
  });

  it('wraps on whitespace when wordWrap is true and ignores ANSI in the width', () => {
    const table = new PlainTable({
      head: ['\u001b[36mH\u001b[39m'],
      colWidths: [6],
      wordWrap: true,
    });
    table.push(['one two']);
    const text = table.toString();
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text.split('\n')[0]).toBe('+------+');
  });

  it('counts a fullwidth character as two columns and hard-breaks a long token', () => {
    const table = new PlainTable({
      head: ['H'],
      colWidths: [6],
      wordWrap: true,
    });
    table.push(['你ab']);
    const text = table.toString();
    expect(text.split('\n')[3]).toBe('| 你ab |');
  });
});
```

`colWidths: [6]` means six dashes between the `+` characters, matching cli-table3. Content width is 4. The colored header `H` and an uncolored header `H` produce the same border. A fullwidth character uses two of those four columns. `你ab` is width 4 and fits one line; change the cell to `你abcd` in the challenger's test if a hard break is not obvious from `你ab`. The build reviewer keeps a hard-break assertion: a single token wider than the content width splits instead of overflowing the border.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/unit/cli/plainTable.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the table**

```typescript
/**
 * Renders the bordered text tables the CLI formatters print.
 */
export interface PlainTableOptions {
  head: string[];
  colWidths: number[];
  wordWrap?: boolean;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Display width. Fullwidth code points and emoji are 2. Combining marks are 0. */
function charWidth(char: string): number {
  const cp = char.codePointAt(0) ?? 0;
  if (cp >= 0x1100 && (
    cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff)
  )) return 2;
  if (cp >= 0x0300 && cp <= 0x036f) return 0;
  return 1;
}

function visibleWidth(value: string): number {
  const plain = stripAnsi(value);
  let width = 0;
  for (const char of plain) width += charWidth(char);
  return width;
}

function pad(value: string, width: number): string {
  const gap = width - visibleWidth(value);
  return gap > 0 ? value + ' '.repeat(gap) : value;
}

function hardBreak(token: string, width: number): string[] {
  const parts: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const char of token) {
    const w = charWidth(char);
    if (currentWidth + w > width && current.length > 0) {
      parts.push(current);
      current = char;
      currentWidth = w;
    } else {
      current += char;
      currentWidth += w;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.length > 0 ? parts : [''];
}

function wrap(value: string, width: number, wordWrap: boolean): string[] {
  const plain = stripAnsi(value);
  if (!wordWrap || visibleWidth(plain) <= width) return [plain];
  const lines: string[] = [];
  let current = '';
  for (const word of plain.split(' ')) {
    for (const piece of hardBreak(word, width)) {
      const next = current.length === 0 ? piece : `${current} ${piece}`;
      if (visibleWidth(next) > width && current.length > 0) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export class PlainTable {
  private readonly rows: string[][] = [];

  constructor(private readonly options: PlainTableOptions) {}

  push(cells: string[]): void {
    this.rows.push(cells.map((cell) => String(cell)));
  }

  toString(): string {
    const widths = this.options.colWidths;
    const wordWrap = this.options.wordWrap === true;
    const contentWidth = (colWidth: number) => Math.max(1, colWidth - 2);
    const border = `+${widths.map((w) => '-'.repeat(Math.max(1, w))).join('+')}+`;
    const paint = (cells: string[]): string[] => {
      const wrapped = cells.map((cell, i) => wrap(cell, contentWidth(widths[i] ?? 10), wordWrap));
      const height = Math.max(1, ...wrapped.map((lines) => lines.length));
      const out: string[] = [];
      for (let line = 0; line < height; line++) {
        const cols = widths.map((width, i) => pad(wrapped[i]?.[line] ?? '', contentWidth(width)));
        out.push(`| ${cols.join(' | ')} |`);
      }
      return out;
    };
    return [border, ...paint(this.options.head), border, ...this.rows.flatMap((row) => paint(row)), border].join('\n');
  }
}
```

`colWidths` include cli-table3's default one-space padding on each side, so the border dash count equals `colWidth` and the text is padded to `colWidth - 2`. Headers keep their ANSI; `visibleWidth` ignores those codes. Body cells are plain text today. Colored body wrap is out of scope. `wordWrap` omitted means no wrap. The width helper is the narrow replacement for `string-width` 4, not a full Unicode width library. If a challenger test shows a character whose width disagrees with `string-width` 4 for a real CLI cell, the build reviewer fixes `charWidth`.

- [ ] **Step 4: Run the table test**

Run: `bunx vitest run tests/unit/cli/plainTable.test.ts`
Expected: PASS

- [ ] **Step 5: Switch formatters and drop the dependency**

In `src/cli/formatters.ts`:

```typescript
import { PlainTable } from './plainTable.js';
```

Replace `new Table({ ... })` with `new PlainTable({ ... })`. Keep `head`, `colWidths`, and `wordWrap` arguments as they are. `table.push` and `table.toString()` stay.

Remove `cli-table3` from `dependencies`. Run `bun install`.

Run: `bunx vitest run tests/unit/cli/formatters.test.ts tests/unit/cli/plainTable.test.ts`
Expected: PASS. JSON and CSV cases in the existing formatter tests are the byte-identity check. If a table-format assertion compares an exact `cli-table3` border, update that assertion to the `PlainTable` border and leave the JSON assertion untouched.

- [ ] **Step 6: Commit**

```bash
git add src/cli/plainTable.ts src/cli/formatters.ts tests/unit/cli/plainTable.test.ts tests/unit/cli/formatters.test.ts package.json bun.lock
git commit -m "refactor: render CLI tables without cli-table3"
```

### Task 6: Sprint 3 verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
rg "cli-table3|string-width" package.json bun.lock dist/cli/index.js
```

Expected: exit 0, no matches.

## Sprint 4 — REBUILD `async-mutex`

**Semver:** patch. No new public export is required. `RunExclusiveMutex` may stay unexported from `src/utils/index.ts`. If the builder exports it, add a JSDoc first sentence and re-run repo-tools.
**Scope:** Replace `new Mutex()` / `runExclusive` only. Do not change `src/utils/AsyncMutex.ts` or any `graphMutex.acquire` call. `AsyncMutex` times out; `async-mutex` does not. Mixing them will fail storage tests under load.
**Acceptance:** `rg "async-mutex" src tests package.json bun.lock` finds no matches. Two `runExclusive` calls on one mutex run in order. A thrown error releases the mutex. There is no 30s timer.

### Task 7: Failing parity test and implementation

**Files:**
- Create: `src/utils/RunExclusiveMutex.ts`
- Create: `tests/unit/utils/RunExclusiveMutex.test.ts`
- Modify: the eight `async-mutex` files listed in the spec. Seven construct or type a `runExclusive` mutex. `tests/unit/core/EntityManager.legacyDelete.test.ts` is the eighth and must switch to `AsyncMutex`, because `EntityManager` calls `graphMutex.acquire()`.
- Modify: `package.json`, `bun.lock`

**Interfaces:**
- Consumes: nothing from `AsyncMutex`
- Produces:

```typescript
export class RunExclusiveMutex {
  runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { RunExclusiveMutex } from '../../../src/utils/RunExclusiveMutex.js';

describe('RunExclusiveMutex', () => {
  it('runs critical sections one at a time, in call order', async () => {
    const mutex = new RunExclusiveMutex();
    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = mutex.runExclusive(() => new Promise<void>((resolve) => {
      releaseFirst = () => {
        order.push(1);
        resolve();
      };
    }));
    const second = mutex.runExclusive(async () => {
      order.push(2);
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst!();
    await first;
    await second;
    expect(order).toEqual([1, 2]);
  });

  it('releases the mutex when the callback throws', async () => {
    const mutex = new RunExclusiveMutex();
    await expect(mutex.runExclusive(() => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await expect(mutex.runExclusive(() => 'after')).resolves.toBe('after');
  });

  it('does not arm a timeout timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const mutex = new RunExclusiveMutex();
    let releaseFirst: (() => void) | undefined;
    const first = mutex.runExclusive(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    const second = mutex.runExclusive(async () => 'ok');
    await vi.advanceTimersByTimeAsync(60_000);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseFirst!();
    await first;
    await expect(second).resolves.toBe('ok');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/unit/utils/RunExclusiveMutex.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the mutex**

```typescript
/**
 * FIFO mutex whose runExclusive matches async-mutex: no timeout and no queue cap.
 */
export class RunExclusiveMutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }
}
```

A synchronous throw inside `fn` must still reach the `finally`. The `async` executor does that because `await fn()` rejects. Do not add `isLocked`, `acquire`, `cancel`, or a queue limit.

- [ ] **Step 4: Run the unit test**

Run: `bunx vitest run tests/unit/utils/RunExclusiveMutex.test.ts`
Expected: PASS

- [ ] **Step 5: Switch imports**

Replace `import { Mutex } from 'async-mutex'` with `import { RunExclusiveMutex } from '<relative>/utils/RunExclusiveMutex.js'` (from `src/agent/harness/InteractionLogBlobs.ts` the relative path is `../../utils/RunExclusiveMutex.js`).

Replace `new Mutex()` with `new RunExclusiveMutex()`.

In `src/agent/harness/InteractionLog.ts`, replace `import type { Mutex } from 'async-mutex'` with `import type { RunExclusiveMutex } from '../../utils/RunExclusiveMutex.js'` and type the field as `RunExclusiveMutex`.

In `tests/unit/core/EntityManager.legacyDelete.test.ts`, replace `new Mutex()` with `new AsyncMutex()` imported from `src/utils/AsyncMutex.ts`. Do not use `RunExclusiveMutex` there. `EntityManager` calls `acquire()`, and `RunExclusiveMutex` does not implement it.

`runExclusive(...)` call text stays. Do not edit `this.storage.graphMutex.acquire` sites. Do not add `acquire` to `RunExclusiveMutex`. Nested `runExclusive` on the same instance deadlocks, which matches `async-mutex` 0.5.0. No production call site re-enters.

- [ ] **Step 6: Remove the dependency**

Delete `async-mutex` from `dependencies`. Run `bun install`. `bun.lock` must not contain `async-mutex`. `tslib` stays: `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, and `@tybys/wasm-util` also depend on it.

Run:

```bash
bunx vitest run tests/unit/utils/RunExclusiveMutex.test.ts tests/unit/core/GraphStorage.test.ts tests/unit/core/RefIndex.test.ts tests/unit/agent/harness/InteractionLog.test.ts
```

Expected: PASS. If a filename differs, run the test file that imports the class you edited. Do not skip a failing storage test.

- [ ] **Step 7: Commit**

```bash
git add src/utils/RunExclusiveMutex.ts tests/unit/utils/RunExclusiveMutex.test.ts src/core src/search/tiered src/agent/harness tests/unit/core/EntityManager.legacyDelete.test.ts package.json bun.lock
git commit -m "refactor: replace async-mutex with RunExclusiveMutex"
```

### Task 8: Sprint 4 verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
rg "async-mutex" src dist package.json
```

Expected: exit 0, and `rg` prints no matches. `src/utils/AsyncMutex.ts` still exists.

Challenger adds a test where 100 `runExclusive` callbacks append to an array and the array is `0..99`. That test must pass without fake timers.

## Sprint 5 — REBUILD `chrono-node`

**Decision:** Daniel, 2026-11-10, 9:12 AM CT. Rebuild. Not an optional peer. Not gated. Not a 5.0.0.
**Semver:** minor, and only after parity holds. No consumer-visible behavior change. Changelog under `## [Unreleased]` says the English date parser is in-repo and results match chrono-node 2.9.1. Do not bump `package.json` `version` in this sprint unless the release process for that minor is already the PR's job.
**Scope:** `src/search/enDate/` plus `TemporalQueryParser`. Comments in `TemporalSearch.ts`, `SearchManager.ts`, and `SearchFacade.ts` that name chrono-node are updated to name the in-repo parser. No other module imports chrono-node.
**Acceptance:** `rg "chrono-node" src package.json bun.lock` finds no matches except a MIT attribution line if a pattern table was adapted. Custom phrases and the chrono fallback phrases return the same start and end instants as chrono-node 2.9.1 at reference `2026-01-15T12:00:00.000Z` with `TZ=UTC`. Text chrono cannot parse still returns `undefined`. A throw from today's `parse` or `parseDate` path still throws. The dependency is removed only after that parity run is green.

### Task 9: Inventory and failing phrase tests

**Files:**
- Create: `tests/unit/search/enDate.inventory.test.ts`
- Modify: `tests/unit/search/TemporalQueryParser.test.ts` only if a phrase it already covers is missing from the inventory list

**Interfaces:**
- Consumes: the installed `chrono-node` 2.9.1 and `TemporalQueryParser`
- Produces: a checked-in list of phrases. No new production export yet.

The inventory is the phrases below. The test parses each one with `TemporalQueryParser` at `new Date('2026-01-15T12:00:00.000Z')` and records `start.toISOString()` and `end.toISOString()`. Run the test with `TZ=UTC`.

Custom phrases, already implemented in `parseCustomPattern`:

- `last hour`, `past hour`, `the last hour`
- `last week`, `past week`, `last month`, `past month`, `last year`, `past year`
- `past 3 days`, `last 2 hours`, `in the past 5 minutes`
- `this week`, `this month`, `this year`, `today`, `yesterday`
- `3 days ago`, `1 hour ago`

Chrono fallback phrases, used today by `parse` / `parseDate`:

- `since yesterday`, `since January 1`, `since 2026-01-01`
- `between Monday and Wednesday`, `Jan 1 to Jan 7`
- `tomorrow`, `tonight`, `noon`, `next Friday`, `3 days from now`
- `2026-01-15`, `2026-01-15T12:00:00Z`, `January 15, 2026`

Unparseable, must stay `undefined` (chrono returns no result; the parser does not throw):

- `not a date`
- empty string after trim

- [ ] **Step 1: Write the inventory test against the current parser**

The test imports `chrono-node` only as a comment naming version 2.9.1. It calls `TemporalQueryParser`. It asserts each custom and fallback phrase returns a defined range, and the two unparseable inputs return `undefined`.

- [ ] **Step 2: Run it**

Run: `TZ=UTC bunx vitest run tests/unit/search/enDate.inventory.test.ts`
Expected: PASS against today's chrono-backed parser. This test is the inventory. It must stay green for the rest of the sprint.

### Task 10: Parser, then parity against chrono-node

**Files:**
- Create: `src/search/enDate/types.ts`, `src/search/enDate/parsers.ts`, `src/search/enDate/refiners.ts`, `src/search/enDate/parseEnDate.ts`
- Create: `tests/unit/search/enDate.parity.test.ts`

**Interfaces:**
- Consumes: nothing from chrono at runtime after Task 11. During this task the parity test imports both.
- Produces:

```typescript
export interface EnDateResult {
  start: Date;
  end?: Date;
  index: number;
  text: string;
}
export function parseEnDate(text: string, ref: Date, options?: { forwardDate?: boolean }): EnDateResult[];
export function parseEnDateStart(text: string, ref: Date, options?: { forwardDate?: boolean }): Date | undefined;
```

`parseEnDate` follows chrono's shape: parsers propose components, refiners fill implied fields and merge ranges. Casual parsers cover today, tomorrow, yesterday, tonight, noon. Relative parsers cover `N units ago`, `in N units`, `next <weekday>`, `last <weekday>`, `this <week|month|year>`. Absolute parsers cover ISO dates, ISO instants, and `Month D, YYYY`. A range parser covers `between A and B` and `A to B`.

- [ ] **Step 1: Write the parity test while chrono-node is still installed**

```typescript
import { describe, expect, it } from 'vitest';
import * as chrono from 'chrono-node';
import { parseEnDate, parseEnDateStart } from '../../../src/search/enDate/parseEnDate.js';

const REF = new Date('2026-01-15T12:00:00.000Z');
const PHRASES = [
  'last hour', 'past 3 days', 'this week', 'today', 'yesterday', '3 days ago',
  'since yesterday', 'between Monday and Wednesday', 'Jan 1 to Jan 7',
  'tomorrow', 'tonight', 'noon', 'next Friday', '3 days from now',
  '2026-01-15', '2026-01-15T12:00:00Z', 'January 15, 2026',
];

describe('enDate parity with chrono-node 2.9.1', () => {
  it('matches start and end at the fixed UTC reference', () => {
    for (const phrase of PHRASES) {
      const ours = parseEnDate(phrase, REF, { forwardDate: false });
      const theirs = chrono.parse(phrase, REF, { forwardDate: false });
      expect(ours.length > 0).toBe(theirs.length > 0);
      if (ours[0] && theirs[0]) {
        expect(ours[0].start.toISOString()).toBe(theirs[0].start.date().toISOString());
        expect(ours[0].end?.toISOString() ?? null).toBe(theirs[0].end?.date().toISOString() ?? null);
      }
    }
  });

  it('matches parseDate for since-clauses', () => {
    expect(parseEnDateStart('January 1', REF, { forwardDate: false })?.toISOString())
      .toBe(chrono.parseDate('January 1', REF, { forwardDate: false })?.toISOString());
  });
});
```

Add at least twenty more casual, relative, and ISO phrases to `PHRASES` before calling the test done. Keep the reference date and `TZ=UTC`. If chrono returns no result, the in-repo parser returns no result. If `chrono.parse` throws on an input, do not catch it in the parser and do not map it to `undefined`. The parity test records that throw.

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `TZ=UTC bunx vitest run tests/unit/search/enDate.parity.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement parsers and refiners**

Write new code. Do not paste chrono-node's source. The file layout mirrors chrono (parsers, then refiners). If a weekday table or a month table is copied from chrono, put this header on that file:

```typescript
// Adapted from chrono-node (https://github.com/wanasit/chrono), MIT License.
// Copyright (c) 2014 Wanasit Ranasinghe and contributors.
```

Also add the same notice to `THIRD_PARTY_NOTICES` if that file is created. If no table is copied, do not add the notice.

- [ ] **Step 4: Run parity**

Run: `TZ=UTC bunx vitest run tests/unit/search/enDate.parity.test.ts tests/unit/search/enDate.inventory.test.ts`
Expected: PASS. Do not remove `chrono-node` in this task.

### Task 11: Switch the call site, record results, then delete the dependency

**Files:**
- Modify: `src/search/TemporalQueryParser.ts`
- Modify: `src/search/TemporalSearch.ts`, `src/search/SearchManager.ts`, `src/core/context/SearchFacade.ts` (comments only)
- Modify: `tests/unit/search/enDate.parity.test.ts` so it no longer imports `chrono-node`. Replace each comparison with the ISO strings the green Task 10 run printed.
- Modify: `package.json`, `bun.lock`, `CHANGELOG.md`
- Create when a table was copied: `THIRD_PARTY_NOTICES`

- [ ] **Step 1: Point `parseWithChrono` and `since` at `parseEnDate` / `parseEnDateStart`**

Keep the public methods. Keep `{ forwardDate: false }` and the forward retry. Keep the single-result range against the reference date, and the first-to-last range when there are two results. Delete `loadChrono`, `requireChronoSync`, and the `chrono-node` import. Do not wrap the new parser in `try/catch` that returns `undefined`.

- [ ] **Step 2: Re-run the inventory**

Run: `TZ=UTC bunx vitest run tests/unit/search/enDate.inventory.test.ts tests/unit/search/TemporalQueryParser.test.ts tests/unit/search/TemporalSearch.test.ts`
Expected: PASS, still with `chrono-node` installed, because the inventory test uses `TemporalQueryParser` and the parity test has not dropped its import yet.

- [ ] **Step 3: Freeze the corpus and remove the package**

Replace the live chrono assertions with the ISO strings from the passing run. Delete the `chrono-node` import from tests. Delete `chrono-node` from `dependencies`. It must not be added to `devDependencies`. Run `bun install`. `bun.lock` must not contain `chrono-node`.

Run: `TZ=UTC bunx vitest run tests/unit/search/enDate.parity.test.ts tests/unit/search/enDate.inventory.test.ts`
Expected: PASS without the package installed.

- [ ] **Step 4: Changelog**

Under `## [Unreleased]`:

```markdown
### Changed
- English natural-language dates are parsed in-repo. Results match chrono-node 2.9.1 for the supported phrases. `chrono-node` is no longer a dependency.
```

- [ ] **Step 5: Commit**

```bash
git add src/search/enDate src/search/TemporalQueryParser.ts src/search/TemporalSearch.ts src/search/SearchManager.ts src/core/context/SearchFacade.ts tests/unit/search package.json bun.lock CHANGELOG.md THIRD_PARTY_NOTICES
git commit -m "feat: parse English dates without chrono-node"
```

Omit `THIRD_PARTY_NOTICES` from `git add` when no chrono text was adapted.

### Task 12: Sprint 5 verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
node -e "const p=require('./package.json'); if((p.dependencies||{})['chrono-node']||(p.devDependencies||{})['chrono-node']) process.exit(1)"
rg "chrono-node" src package.json bun.lock
```

Expected: the node check exits 0. `rg` prints nothing, or only a MIT attribution line. `src/search/enDate/parseEnDate.ts` exists.

The build checker/fixer checks this sprint against the six requirements: inventory, parity corpus at the fixed instant, throw behavior unchanged, dependency removed only after parity, MIT notice when text is adapted, and minor semver with no behavior change.

## Packages with no tasks

The builder does not open a PR for these. The spec records why.

| Package | Decision |
|---|---|
| `commander` | KEEP. CLI parser, help, and `InvalidArgumentError`. |
| `zod` | KEEP. Public schemas and `formatZodErrors(ZodError)`. |
| `better-sqlite3` | KEEP. Native speed and FTS5. The `node:sqlite` shim is not a replacement. |
| `@danielsimonjr/workerpool` | KEEP. First-party worker protocol. |
| `@huggingface/transformers`, `pg`, `yaml` | KEEP. Already optional peers. |
| `@types/node`, `@types/better-sqlite3`, `typescript`, `tsup`, `tsx`, `vitest`, `@vitest/coverage-v8`, `oxlint`, `oxlint-tsgolint`, `oxc-parser` | KEEP. Toolchain. |
| `overrides.esbuild` | KEEP. Security pin. |
| `tools/*` | Out of scope. Not published. |

## Plan self-review

- Spec decisions that are REBUILD each have a sprint. MAKE OPTIONAL has no sprint. VENDOR has no sprint. KEEP has a table and no tasks.
- Sprint 4's interface is `RunExclusiveMutex.runExclusive`, not `AsyncMutex.acquire`. The legacy-delete fake uses `AsyncMutex.acquire`.
- Sprint 2's `ansi` keys match the call sites (`cyan`, `bold`, `green`, `red`, `yellow`, `gray`).
- Sprint 3's `PlainTable` options match `formatters.ts` (`head`, `colWidths`, `wordWrap`). `colWidths` include the two padding cells.
- Sprint 5 rebuilds chrono-node. It is not gated. It is the only sprint that edits `CHANGELOG.md`, and the note is a minor with no behavior change.
- No step says TBD. Verification commands are exact.
- Per sprint the handoff is builder deepseek-v41-flash-1017, challenger glm-5p3-flash, build reviewer composer-2.5, build checker/fixer grok-4.6, final PR reviewer grok-4.7.
