/**
 * Inventory guard for the in-repo schema module.
 *
 * The module implements only the slice of Zod 4.6.7 that `src/` actually uses.
 * This test scans `src/` and fails when a new `z.<member>` or chained builder
 * method appears that `src/utils/schema.ts` does not implement, so the subset
 * cannot silently drift from the code that depends on it.
 *
 * It also pins the inverse: nothing under `src/` or `tests/` imports `zod`.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

/** Files under `src/` (all TypeScript). */
function srcFiles(dir = join(ROOT, 'src')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...srcFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** `z.<member>` names the module exposes. */
const INVENTORY_MEMBERS = new Set([
  'array',
  'boolean',
  'discriminatedUnion',
  'enum',
  'infer',
  'input',
  'iso',
  'literal',
  'null',
  'number',
  'object',
  'output',
  'record',
  'string',
  'toJSONSchema',
  'tuple',
  'union',
  'unknown',
  'ZodError',
  'ZodType',
  'ZodSchema',
]);

/** Factories that also appear as `.name()` when chained off `z`. */
const INVENTORY_FACTORIES = new Set([
  'array',
  'boolean',
  'discriminatedUnion',
  'enum',
  'literal',
  'null',
  'number',
  'object',
  'record',
  'string',
  'tuple',
  'union',
  'unknown',
]);

/** Chained builder methods the module exposes. */
const INVENTORY_METHODS = new Set([
  'datetime',
  'default',
  'finite',
  'int',
  'length',
  'max',
  'min',
  'nullable',
  'optional',
  'parse',
  'passthrough',
  'positive',
  'refine',
  'regex',
  'safeParse',
  'strict',
  'strip',
  'toLowerCase',
  'trim',
]);

/**
 * Method names in every fluent chain that starts at a `z.` factary.
 *
 * The scan walks characters after each `z.` occurrence, tracking parenthesis
 * depth, and records `.name(` at depth zero. It stops on a statement separator
 * or a closing parenthesis that belongs to an enclosing expression, so an
 * unrelated `set.has()` elsewhere on the line is never read as a schema method.
 *
 * @param source - File contents.
 * @returns One array of method names per chain, the factory first.
 */
function schemaChains(source: string): string[][] {
  const chains: string[][] = [];
  const startPattern = /\bz\./g;
  let start: RegExpExecArray | null;
  while ((start = startPattern.exec(source)) !== null) {
    const factory = /^z\.([A-Za-z_][A-Za-z_0-9]*)/.exec(source.slice(start.index));
    if (!factory) continue;
    const names: string[] = [factory[1]!];
    let index = start.index + factory[0].length;
    let depth = 0;
    while (index < source.length) {
      const char = source[index]!;
      if (char === '(') {
        depth++;
        index++;
        continue;
      }
      if (char === ')') {
        if (depth === 0) break;
        depth--;
        index++;
        continue;
      }
      if (depth === 0 && char === '.') {
        const match = /^\.([A-Za-z_][A-Za-z_0-9]*)/.exec(source.slice(index));
        if (!match) break;
        names.push(match[1]!);
        index += match[0].length;
        continue;
      }
      if (depth === 0 && (char === ';' || char === ',' || char === '=' || char === '\n')) {
        if (char === '\n') {
          // A chain may continue on the next line only with a leading dot.
          const rest = /^\s*\.([A-Za-z_][A-Za-z_0-9]*)/.exec(source.slice(index));
          if (rest) {
            names.push(rest[1]!);
            index += rest[0].length;
            continue;
          }
        }
        break;
      }
      index++;
    }
    if (names.length > 0) chains.push(names);
  }
  return chains;
}

describe('schema inventory', () => {
  const files = srcFiles();
  const sources = files
    .filter((file) => !file.endsWith(join('utils', 'schema.ts')))
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }));

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('reads fluent chains, so the guard cannot pass vacuously', () => {
    const chains = schemaChains(
      [
        "const a = z.string().min(1).max(2);",
        "const b = z.object({ k: z.number().int() }).strict();",
        "const c = z.array(z.string()).max(3);",
        "const d = z.record(z.string(), z.unknown()).optional();",
        "if (set.has(key)) return;",
      ].join('\n'),
    );
    expect(chains).toContainEqual(['string', 'min', 'max']);
    expect(chains).toContainEqual(['object', 'strict']);
    expect(chains).toContainEqual(['array', 'max']);
    expect(chains).toContainEqual(['record', 'optional']);
    expect(chains).toContainEqual(['number', 'int']);
    expect(chains.flat()).not.toContain('has');
  });

  it('uses only inventoried `z.<member>` names', () => {
    const offenders: string[] = [];
    for (const { file, source } of sources) {
      for (const match of source.matchAll(/\bz\.([A-Za-z_][A-Za-z_0-9]*)/g)) {
        const member = match[1]!;
        if (!INVENTORY_MEMBERS.has(member)) offenders.push(`${file}: z.${member}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses only inventoried builder methods', () => {
    const offenders: string[] = [];
    for (const { file, source } of sources) {
      for (const chain of schemaChains(source)) {
        for (const method of chain.slice(1)) {
          if (!INVENTORY_METHODS.has(method) && !INVENTORY_FACTORIES.has(method)) {
            offenders.push(`${file}: .${method}()`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no `zod` import anywhere in src/ or tests/', () => {
    const importers: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) scan(full);
        else if (entry.endsWith('.ts')) {
          const source = readFileSync(full, 'utf8');
          // Strip comments and string literals so a fixture that *mentions*
          // `zod` in source text is not mistaken for an import.
          const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
            .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
          if (/from\s+['"]zod['"]/.test(code)) importers.push(full);
        }
      }
    };
    scan(join(ROOT, 'src'));
    scan(join(ROOT, 'tests'));
    expect(importers).toEqual([]);
  });
});
