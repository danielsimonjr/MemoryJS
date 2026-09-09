#!/usr/bin/env node
// Two project rules that oxlint 1.82 cannot host, implemented against a real AST.
//
// WHY THIS EXISTS: the ESLint config carried a `no-restricted-syntax` selector and a
// project-local plugin rule. oxlint does not implement no-restricted-syntax and its
// config parser rejects JS plugin paths, so a straight lint swap would have SILENTLY
// DELETED both. Both guard documented failure classes -- the leaf-layer rule prevented
// 37+ type-only cycles, and the updateEntity rule catches a silent-failure pattern
// found by review across four sprints -- so they get a real implementation instead.
//
// WHY A PARSER LIBRARY, given the standing rule to prefer what TypeScript or Bun
// already provide: neither can do this. Measured, not assumed --
//   Bun.Transpiler.scanImports('import { a } from "../core/x.js"; a();')
//     -> [{ kind: 'import-statement', path: '../core/x.js' }]   (scanner works)
//   ... on `import type { X } from "../core/x.js"`               -> []
//   ... on `type A = import("../agent/y.js").Y`                  -> []
// Bun erases both TYPE forms before it looks, and they are precisely what rule 1
// exists to catch. Bun also exposes no AST (scan / scanImports / transform only), so
// rule 2 -- "is this call's return value used?" -- is unanswerable there. TypeScript
// 7 does not ship its programmatic Compiler API either.
//
// So: oxc-parser, which is the SAME engine oxlint already runs here, not a new
// ecosystem. A regex would be the obvious shortcut and the wrong one: rule 2 turns on
// whether a call's RESULT IS USED, a question about the syntax tree rather than about
// the text of a line.
import { findLeafLayerViolations, findUnusedUpdateEntityReturns } from "./lint-rules.mjs";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const problems = [];
let filesScanned = 0;

/** Every .ts file under dir, recursively. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

for (const file of await walk(SRC)) {
  const source = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).split(String.fromCharCode(92)).join("/");
  filesScanned++;

  if (rel.startsWith("src/types/")) {
    for (const m of findLeafLayerViolations(file, source)) problems.push(`${rel}: ${m}`);
  }
  for (const v of findUnusedUpdateEntityReturns(file, source)) {
    problems.push(`${rel}:${v.line}: ${v.message}`);
  }
}

// A check that scanned nothing must FAIL, not pass. An empty result and a broken walk
// are indistinguishable from the exit code alone.
if (filesScanned === 0) {
  console.error("check-lint-rules FAIL: scanned 0 files — the walk is broken.");
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`check-lint-rules: ${problems.length} problem(s) in ${filesScanned} files:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`check-lint-rules OK: ${filesScanned} files, both project rules clean`);
