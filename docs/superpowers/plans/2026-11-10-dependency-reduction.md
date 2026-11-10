# Dependency Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `rimraf`, `chalk`, `async-mutex`, and `cli-table3` from `@danielsimonjr/memoryjs` by replacing the call sites this repo actually uses, and (only if Daniel accepts) make `chrono-node` an optional peer.

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
- Each sprint is one PR. The builder is deepseek-v41-flash-1017. The challenger is glm-5p3-flash. The reviewer is composer-2.5. The checker is grok-4.6.
- Tests that describe the old dependency's behavior land in the same PR as the removal, and they are written to fail before the new module exists.
- Verification for every sprint: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run test:ci`, `bun run build`. Do not commit `dist/`.
- `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` and `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` must exit 0 when a sprint adds an exported symbol. New exports need a JSDoc block whose first sentence says what the function does.
- No force-push, rebase, amend, or `--no-verify`. No publish.
- The builder commits on the sprint branch. The checker is the one who reports the commands above as pass or fail.

## Roles

| Role | Model | Job on each sprint |
|---|---|---|
| Builder | deepseek-v41-flash-1017 | Implements the tasks in order. Writes the failing test first. |
| Challenger | glm-5p3-flash | After the builder's tests pass, adds one adversarial test (timeout, ANSI width, missing peer, non-TTY). Does not widen the sprint. |
| Reviewer | composer-2.5 | Reads the diff against the spec decision for that package. Rejects a sprint that imports `AsyncMutex` to replace `async-mutex`, or that edits KEEP packages. |
| Checker | grok-4.6 | Runs the verification block at the end of the sprint on a clean `bun install --frozen-lockfile`. |

## File map

| File | Sprint | Responsibility |
|---|---|---|
| `scripts/clean-dist.mjs` | 1 | Delete `dist/` with `node:fs`. |
| `package.json` `scripts.clean` | 1 | Call the script instead of `rimraf`. |
| `src/cli/ansi.ts` | 2 | The six chalk styles the CLI uses. |
| `src/cli/formatters.ts`, `src/cli/interactive.ts` | 2 | Import `ansi` instead of `chalk`. |
| `src/utils/RunExclusiveMutex.ts` | 3 | FIFO `runExclusive` with no timeout and no queue cap. |
| Storage, column, tier, and interaction-log call sites | 3 | Construct `RunExclusiveMutex`. |
| `src/cli/plainTable.ts` | 4 | `head` / `colWidths` / `wordWrap` / `push` / `toString`. |
| `src/search/TemporalQueryParser.ts` | 5 | Treat a missing `chrono-node` as "not parseable" plus one warning. |

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

  it('returns plain text when NO_COLOR is set', () => {
    previous.NO_COLOR = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    expect(ansi.red('x')).toBe('x');
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
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  const force = process.env.FORCE_COLOR;
  if (force === '0') return false;
  if (force === '1' || force === '2' || force === '3') return true;
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

## Sprint 3 — REBUILD `async-mutex`

**Semver:** patch. No new public export is required. `RunExclusiveMutex` may stay unexported from `src/utils/index.ts`. If the builder exports it, add a JSDoc first sentence and re-run repo-tools.
**Scope:** Replace `new Mutex()` / `runExclusive` only. Do not change `src/utils/AsyncMutex.ts` or any `graphMutex.acquire` call. `AsyncMutex` times out; `async-mutex` does not. Mixing them will fail storage tests under load.
**Acceptance:** `rg "async-mutex" src tests package.json bun.lock` finds no matches. Two `runExclusive` calls on one mutex run in order. A thrown error releases the mutex. There is no 30s timer.

### Task 5: Failing parity test and implementation

**Files:**
- Create: `src/utils/RunExclusiveMutex.ts`
- Create: `tests/unit/utils/RunExclusiveMutex.test.ts`
- Modify: the seven `async-mutex` import sites listed in the spec
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
    vi.useFakeTimers();
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

In `tests/unit/core/EntityManager.legacyDelete.test.ts`, construct `RunExclusiveMutex` the same way.

`runExclusive(...)` call text stays. Do not edit `this.storage.graphMutex.acquire` sites.

- [ ] **Step 6: Remove the dependency**

Delete `async-mutex` from `dependencies`. Run `bun install`. `bun.lock` must not contain `async-mutex` or a direct `tslib` edge that existed only for it. If `tslib` remains because another package needs it, leave it; today only `async-mutex` pulls it.

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

### Task 6: Sprint 3 verification

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

## Sprint 4 — REBUILD `cli-table3`

**Semver:** patch. JSON and CSV formatter output stays byte-identical. Table-format text may differ in padding from `cli-table3` and is pinned by new tests. Daniel can reject this sprint if a downstream tool snapshots `cli-table3` borders.
**Scope:** `src/cli/formatters.ts` table construction only.
**Acceptance:** `cli-table3` is gone from `package.json` and `bun.lock`. `formatEntities(..., 'json')` tests still pass. Table output contains the header text and the cell text, wraps when `wordWrap` is true, and measures visible width with ANSI codes stripped.

### Task 7: Plain table used by the formatters

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
    for (const line of text.split('\n')) {
      const visible = line.replace(/\u001b\[[0-9;]*m/g, '');
      expect(visible.length).toBeLessThanOrEqual(8);
    }
  });
});
```

The visible-length cap of 8 is the width 6 plus two border characters (`|` and the closing `|` is the 8th once padding is counted). If the implementation uses `| ` and ` |`, set the assertion to the exact border width the implementation documents in a comment, and keep the test. The requirement is: a colored header is not wider than an uncolored header of the same letters.

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

function visibleLength(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function pad(value: string, width: number): string {
  const gap = width - visibleLength(value);
  return gap > 0 ? value + ' '.repeat(gap) : value;
}

function wrap(value: string, width: number, wordWrap: boolean): string[] {
  const plain = value.replace(/\u001b\[[0-9;]*m/g, '');
  if (!wordWrap || plain.length <= width) return [value];
  const words = plain.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length > width && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = next;
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
    const border = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
    const paint = (cells: string[]): string[] => {
      const wrapped = cells.map((cell, i) => wrap(cell, widths[i] ?? 10, wordWrap));
      const height = Math.max(1, ...wrapped.map((lines) => lines.length));
      const out: string[] = [];
      for (let line = 0; line < height; line++) {
        const cols = widths.map((width, i) => pad(wrapped[i]?.[line] ?? '', width));
        out.push(`| ${cols.join(' | ')} |`);
      }
      return out;
    };
    return [border, ...paint(this.options.head), border, ...this.rows.flatMap((row) => paint(row)), border].join('\n');
  }
}
```

Word wrap strips ANSI for the wrapped lines. Formatters pass ANSI only in headers, which are short, so header wrap is not required. Cell wrap of colored body text is out of scope.

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

### Task 8: Sprint 4 verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
rg "cli-table3|string-width" package.json bun.lock dist/cli/index.js
```

Expected: exit 0, no matches.

## Sprint 5 — MAKE OPTIONAL `chrono-node` (gated)

**Do not open this PR until Daniel has accepted the behavior change in writing.** If he declines, skip the sprint and leave `chrono-node` in `dependencies`. The decision then becomes KEEP.

**Semver:** minor, not patch. Changelog must say: natural-language dates outside `TemporalQueryParser`'s custom patterns require the optional peer `chrono-node`. Without it, those phrases return `undefined` and the process emits one warning. Custom patterns (`last hour`, `past N days`, `this week`, `today`, `yesterday`, `N units ago`) stay dependency-free and keep their current results.

**Flag:** this changes `searchByTime` for phrases such as `between Monday and Wednesday` and `since January 1` when the peer is not installed. `danielsimonjr/episodic-memory` 1.7.3 does not depend on MemoryJS. Other `^4.5.0` consumers who called those phrases will see `undefined` until they install `chrono-node`.

**Acceptance after accept:** `chrono-node` is under `peerDependencies` and `peerDependenciesMeta.chrono-node.optional` is true. It is not under `dependencies`. Custom-pattern tests pass with the module uninstalled. A chrono-only phrase returns `undefined` and warns once when the module is absent. When the module is installed, `between Monday and Wednesday` still returns a range.

### Task 9: Missing-peer behavior

**Files:**
- Modify: `src/search/TemporalQueryParser.ts`
- Modify: `tests/unit/search/TemporalQueryParser.test.ts` (create the file if the suite lives under another name; search `parseTemporalExpression` first and edit that file)
- Modify: `package.json`, `bun.lock`
- Modify: `CHANGELOG.md` with one minor-version note. Do not bump `package.json` `version` in this sprint unless the release process for that minor is already the PR's job. Default: changelog entry under `Unreleased`, version bump left to Daniel.

**Interfaces:**
- Consumes: existing `parse`, `parseDate`
- Produces: no new exported function. `requireChronoSync` returns the module or `undefined` after one warning. `parseWithChrono` returns `undefined` when the module is missing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { TemporalQueryParser } from '../../../src/search/TemporalQueryParser.js';

describe('TemporalQueryParser without chrono-node', () => {
  it('still parses a custom pattern', () => {
    const parser = new TemporalQueryParser();
    const range = parser.parseTemporalExpression('last hour', new Date('2026-01-15T12:00:00Z'));
    expect(range?.end.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('returns undefined and warns once when chrono cannot be loaded', async () => {
    vi.resetModules();
    vi.doMock('chrono-node', () => {
      throw new Error('cannot find module');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { TemporalQueryParser: Parser } = await import('../../../src/search/TemporalQueryParser.js');
    const parser = new Parser();
    expect(parser.parseTemporalExpression('between Monday and Wednesday', new Date('2026-01-15T12:00:00Z'))).toBeUndefined();
    expect(parser.parseTemporalExpression('Jan 1 to Jan 7', new Date('2026-01-15T12:00:00Z'))).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    vi.doUnmock('chrono-node');
  });
});
```

The mock throws on import. The implementation must catch a failed `require` of `chrono-node` and a failed dynamic `import()`. If Vitest's `vi.doMock` cannot intercept `createRequire`, the test may inject the failure by setting no mock and running in a worktree where `chrono-node` is not installed (`bun remove chrono-node` after the custom-pattern test is already green). The uninstalled-package form is the acceptance test the checker runs:

```bash
bun remove chrono-node
bunx vitest run tests/unit/search/TemporalQueryParser.test.ts
```

Expected: custom patterns pass, chrono-only phrases are `undefined`.

- [ ] **Step 2: Run the new test to verify the missing-peer case fails**

While `chrono-node` is still installed and the catch is not written, `between Monday and Wednesday` returns a range. Expected: FAIL on `toBeUndefined()`.

- [ ] **Step 3: Catch the missing module**

Inside `requireChronoSync` and `loadChrono`, catch the load error. Remember a module-level `chronoUnavailable = true`. On the first failure call:

```typescript
console.warn(
  'chrono-node is not installed; only built-in relative dates are parsed. ' +
  'Install the optional peer: npm install chrono-node'
);
```

Further calls skip the warning and skip the load. `parseWithChrono` returns `undefined` when the loader returns undefined. `since <date>` in `parseCustomPattern` returns `undefined` when `parseDate` is unavailable, instead of throwing.

Do not change the successful-load path. `parse` and `parseDate` arguments stay `{ forwardDate: false }` with the existing forward retry.

- [ ] **Step 4: Move the dependency**

```json
"peerDependencies": {
  "@huggingface/transformers": "^4.3.1",
  "chrono-node": "^2.9.1",
  "pg": ">=8.0.0",
  "yaml": ">=2.0.0"
},
"peerDependenciesMeta": {
  "chrono-node": { "optional": true }
}
```

Remove `chrono-node` from `dependencies`. The other peer meta entries stay. Run `bun install`. Optional peers are not lockfile keys today; `chrono-node` should disappear from `bun.lock` `packages`.

- [ ] **Step 5: Test both graphs**

With the peer absent:

```bash
bunx vitest run tests/unit/search/TemporalQueryParser.test.ts tests/unit/search/TemporalSearch.test.ts
```

Expected: PASS.

With the peer present (install it as a devDependency for this run only, then remove it before commit so it is not a hidden runtime dependency):

```bash
bun add -d chrono-node@2.9.1
bunx vitest run tests/unit/search/TemporalQueryParser.test.ts
bun remove chrono-node
```

Expected: the installed run still parses `between Monday and Wednesday` to a defined range. The committed `package.json` does not list `chrono-node` under `devDependencies` or `dependencies`.

- [ ] **Step 6: Changelog note**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Changed
- `chrono-node` is an optional peer. Built-in phrases (`last hour`, `past N days`, `this week`, `today`, `yesterday`, `N units ago`) parse as before. Other natural-language dates need `npm install chrono-node`.
```

- [ ] **Step 7: Commit**

```bash
git add src/search/TemporalQueryParser.ts tests/unit/search/TemporalQueryParser.test.ts package.json bun.lock CHANGELOG.md
git commit -m "feat: make chrono-node an optional peer"
```

### Task 10: Sprint 5 verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:ci
bun run build
node -e "const p=require('./package.json'); if(p.dependencies['chrono-node']) process.exit(1); if(!p.peerDependenciesMeta['chrono-node'].optional) process.exit(1)"
```

Expected: exit 0.

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

- Spec decisions REBUILD and MAKE OPTIONAL each have a sprint. VENDOR has no sprint. KEEP has a table and no tasks.
- Sprint 3's interface is `RunExclusiveMutex.runExclusive`, not `AsyncMutex.acquire`.
- Sprint 2's `ansi` keys match the call sites (`cyan`, `bold`, `green`, `red`, `yellow`, `gray`).
- Sprint 4's `PlainTable` options match `formatters.ts` (`head`, `colWidths`, `wordWrap`).
- Sprint 5 is gated and is the only task that edits `CHANGELOG.md`.
- No step says TBD. Verification commands are exact.
