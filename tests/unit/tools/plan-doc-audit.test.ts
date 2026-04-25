import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  extractSymbols,
  checkSymbol,
  auditFile,
  applyFlips,
  runAudit,
} from '../../../tools/plan-doc-audit/audit.js';

describe('plan-doc-audit / extractSymbols', () => {
  it('extracts backtick-quoted PascalCase symbols', () => {
    const syms = extractSymbols('Implement `MemoryEngine` and `ImportanceScorer`');
    expect(syms).toContain('MemoryEngine');
    expect(syms).toContain('ImportanceScorer');
  });

  it('extracts backtick method calls and strips parens', () => {
    // Only backtick-quoted spans count. PascalCase in prose is intentionally ignored.
    const syms = extractSymbols('Wire `addTurn(content, opts)` into ManagerContext');
    expect(syms).toContain('addTurn');
    expect(syms).not.toContain('ManagerContext'); // bare in prose, not in backticks
  });

  it('extracts backtick PascalCase even when surrounded by prose', () => {
    const syms = extractSymbols('Wire `MemoryEngine` into the `ManagerContext` lazy getter');
    expect(syms).toContain('MemoryEngine');
    expect(syms).toContain('ManagerContext');
  });

  it('skips PascalCase tokens that appear only in prose (no backticks)', () => {
    const syms = extractSymbols('Run Tests for the Phase TODO Update API code via MemoryEngine');
    expect(syms.length).toBe(0);
  });

  it('strips method-chain receiver from backtick spans', () => {
    const syms = extractSymbols('Call `engine.checkDuplicate()`');
    expect(syms).toContain('checkDuplicate');
  });

  it('returns empty for plain prose with PascalCase but no backticks', () => {
    // Stricter contract: anything not in backticks doesn't count as a symbol.
    const syms = extractSymbols('Run Tests for the Phase TODO Update API code');
    expect(syms.length).toBe(0);
  });

  it('skips generic short method names (add/set/get/run) even in backticks', () => {
    // These are too noisy — bare `add()` / `set()` / `run()` matches every
    // crud/builder method in src/ and produces meaningless candidates.
    const syms = extractSymbols('Call `add(x)` and `set(y)` and `run()`');
    expect(syms.length).toBe(0);
  });

  it('extracts distinctive method names from backticks', () => {
    const syms = extractSymbols('Call `addTurn(x)` and `getSessionTurns()`');
    expect(syms).toContain('addTurn');
    expect(syms).toContain('getSessionTurns');
  });

  it('returns empty when no backtick code spans present', () => {
    // Plain prose, no backticks → no symbols. PascalCase in prose is
    // intentionally ignored to avoid noise like "Memory Engine Core".
    const syms = extractSymbols('Run typecheck and Verify the test suite via MemoryEngine');
    expect(syms.length).toBe(0);
  });

  it('rejects non-identifier content inside backticks', () => {
    const syms = extractSymbols('Open `docs/superpowers/specs/file.md`');
    expect(syms.length).toBe(0);
  });

  it('rejects prose-inside-backticks like `string` or `true`', () => {
    const syms = extractSymbols('Returns `true` when content matches `string` predicate');
    expect(syms.length).toBe(0);
  });
});

describe('plan-doc-audit / checkSymbol against synthetic src/', () => {
  let tmpRoot: string;
  let srcDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'plan-doc-audit-test-'));
    srcDir = join(tmpRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    // Initialize a tiny git repo so `git grep` works
    execSync('git init -q', { cwd: tmpRoot });
    execSync('git config user.email t@t.local', { cwd: tmpRoot });
    execSync('git config user.name test', { cwd: tmpRoot });
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeAndCommit(rel: string, content: string): void {
    const full = join(tmpRoot, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    execSync(`git add .`, { cwd: tmpRoot });
    execSync(`git -c core.autocrlf=false commit -q -m t`, { cwd: tmpRoot });
  }

  it('classifies a real implementation as shipped', () => {
    writeAndCommit(
      'src/foo.ts',
      `
export class RealThing {
  doStuff(x: number): number {
    const y = x * 2;
    return y + 1;
  }
}
`,
    );
    const result = checkSymbol('RealThing', 'src', tmpRoot);
    expect(result.status).toBe('shipped');
  });

  it('classifies a stub that throws Not implemented as stub', () => {
    writeAndCommit(
      'src/bar.ts',
      `
export class StubThing {
  doStuff(_x: number): number {
    throw new Error('Not implemented — Task 99');
  }
}
`,
    );
    const result = checkSymbol('StubThing', 'src', tmpRoot);
    expect(result.status).toBe('stub');
  });

  it('classifies an absent symbol as absent', () => {
    writeAndCommit('src/baz.ts', `export const x = 1;\n`);
    const result = checkSymbol('NonexistentSymbol', 'src', tmpRoot);
    expect(result.status).toBe('absent');
  });

  it('classifies as shipped when at least one match is real (any-real-wins)', () => {
    writeAndCommit(
      'src/mixed.ts',
      `
class FirstStubThing {
  go(): void { throw new Error('Not implemented'); }
}
class SecondMixed {
  go(): void { console.log('real'); }
}
`,
    );
    const stubResult = checkSymbol('FirstStubThing', 'src', tmpRoot);
    expect(stubResult.status).toBe('stub');

    const shippedResult = checkSymbol('SecondMixed', 'src', tmpRoot);
    expect(shippedResult.status).toBe('shipped');
  });
});

describe('plan-doc-audit / auditFile + applyFlips', () => {
  let tmpRoot: string;
  let srcDir: string;
  let planFile: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'plan-doc-audit-flip-'));
    srcDir = join(tmpRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    execSync('git init -q', { cwd: tmpRoot });
    execSync('git config user.email t@t.local', { cwd: tmpRoot });
    execSync('git config user.name test', { cwd: tmpRoot });

    // Write src with one shipped class and one stub class
    writeFileSync(
      join(srcDir, 'lib.ts'),
      `
export class ShippedThing {
  greet(): string { return 'hello'; }
}
export class StubbedThing {
  greet(): string { throw new Error('Not implemented — Task 1'); }
}
`,
    );
    execSync('git add .', { cwd: tmpRoot, shell: true as unknown as string });
    execSync('git -c core.autocrlf=false commit -q -m t', { cwd: tmpRoot, shell: true as unknown as string });

    planFile = join(tmpRoot, 'plan.md');
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('recommends flip for tasks whose every symbol is shipped', () => {
    writeFileSync(
      planFile,
      `# Plan

- [ ] \`ShippedThing\` is referenced in this task
- [ ] \`StubbedThing\` body status
- [ ] Update CLAUDE.md documentation
`,
    );
    const findings = auditFile(join(tmpRoot, 'plan.md'), 'src', tmpRoot);
    expect(findings).toHaveLength(3);

    const shippedFinding = findings.find((f) => f.task.includes('ShippedThing'));
    expect(shippedFinding?.recommendation).toBe('flip');

    const stubFinding = findings.find((f) => f.task.includes('StubbedThing'));
    expect(stubFinding?.recommendation).toBe('leave');
    expect(stubFinding?.reason).toBe('has-stub');

    const noSymbolsFinding = findings.find((f) => f.task.includes('CLAUDE.md'));
    expect(noSymbolsFinding?.recommendation).toBe('leave');
  });

  it('does not flip tasks starting with future-work verbs even if symbols are shipped', () => {
    // The verb-filter exists because tasks like "Wire X into ContextWindowManager"
    // mention an existing symbol as the *target* of new work, not as evidence the
    // task is done. Defaults conservatively to leave when the verb signals
    // future work.
    writeFileSync(
      planFile,
      `# Plan

- [ ] Implement a wrapper around \`ShippedThing\`
- [ ] Wire \`ShippedThing\` into the new engine
- [ ] Add a hook on \`ShippedThing\`
- [ ] \`ShippedThing\` is referenced in this task
`,
    );
    const findings = auditFile(join(tmpRoot, 'plan.md'), 'src', tmpRoot);
    expect(findings).toHaveLength(4);

    // First three start with Implement / Wire / Add — leave despite shipped symbol.
    expect(findings[0].recommendation).toBe('leave');
    expect(findings[0].reason).toBe('task-describes-future-work');
    expect(findings[1].recommendation).toBe('leave');
    expect(findings[2].recommendation).toBe('leave');

    // Fourth has no future-work verb → flip.
    expect(findings[3].recommendation).toBe('flip');
  });

  it('applyFlips rewrites only the recommended lines', () => {
    writeFileSync(
      planFile,
      `# Plan

- [ ] \`ShippedThing\` is referenced in this task
- [ ] \`StubbedThing\` body status
`,
    );
    const findings = auditFile(join(tmpRoot, 'plan.md'), 'src', tmpRoot);
    const result = applyFlips(findings);
    expect(result.filesUpdated).toBe(1);
    expect(result.flipped).toBe(1);

    const after = readFileSync(join(tmpRoot, 'plan.md'), 'utf-8');
    expect(after).toContain('- [x] `ShippedThing` is referenced');
    expect(after).toContain('- [ ] `StubbedThing` body status');
  });
});

describe('plan-doc-audit / runAudit end-to-end (no symbols)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'plan-doc-audit-e2e-'));
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    mkdirSync(join(tmpRoot, 'docs/superpowers/plans'), { recursive: true });
    mkdirSync(join(tmpRoot, 'docs/roadmap'), { recursive: true });
    writeFileSync(join(tmpRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    execSync('git init -q', { cwd: tmpRoot });
    execSync('git config user.email t@t.local', { cwd: tmpRoot });
    execSync('git config user.name test', { cwd: tmpRoot });
    execSync('git add .', { cwd: tmpRoot, shell: true as unknown as string });
    execSync('git -c core.autocrlf=false commit -q -m t', { cwd: tmpRoot, shell: true as unknown as string });
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty findings when no plan files exist', () => {
    const result = runAudit({ cwd: tmpRoot });
    expect(result.findings).toEqual([]);
  });

  it('walks both plan and roadmap roots', () => {
    writeFileSync(
      join(tmpRoot, 'docs/superpowers/plans', 'p.md'),
      '- [ ] task without symbols\n',
    );
    writeFileSync(
      join(tmpRoot, 'docs/roadmap', 'r.md'),
      '- [ ] another task without symbols\n',
    );
    const result = runAudit({ cwd: tmpRoot });
    expect(result.findings).toHaveLength(2);
    // Both have no extractable symbols → leave with no-symbols-extracted
    expect(result.findings.every((f) => f.recommendation === 'leave')).toBe(true);
  });
});
