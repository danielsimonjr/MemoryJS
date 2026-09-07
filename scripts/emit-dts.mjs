#!/usr/bin/env node
// Emit declaration files for the published package.
//
// WHY THIS EXISTS: tsup generated .d.ts and .d.cts itself via rollup-plugin-dts.
// That plugin reaches into TypeScript's programmatic Compiler API, which TypeScript
// 7.0 does not ship (it is expected in 7.1), so `dts: true` crashes with
// "Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')".
//
// tsup's BUNDLING is unaffected -- that is esbuild, which has no such dependency.
// So the split is: tsup emits JavaScript, tsc emits the declarations. tsc runs fine
// on TypeScript 7; it is the one tool guaranteed to.
//
// THE .d.cts HALF, AND THE MISTAKE WORTH RECORDING: package.json maps every
// subpath's `require` condition to a .d.cts, and tsc emits .d.ts only. A plain COPY
// looks sufficient and is not. The emitted declarations reference siblings as
// `from './core/index.js'` -- an ESM specifier. Inside a .d.cts, TypeScript treats
// that as requiring an ES module and rejects it with TS1479. The copied files
// existed, passed a file-existence check, and still gave a CommonJS consumer zero
// types. Relative specifiers are therefore rewritten .js -> .cjs, which resolves to
// the sibling .d.cts.
//
// The rewrite is VERIFIED HERE rather than assumed: after writing, every .d.cts is
// re-read and the script fails if any still carries a relative .js specifier.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Resolve through the package MANIFEST, not the subpath. TypeScript 7 does not
// expose "typescript/bin/tsc" in its exports map, so require.resolve on that subpath
// throws ERR_PACKAGE_PATH_NOT_EXPORTED. The manifest is always exported and names
// the bin, so this keeps working across TypeScript majors. Running it under
// process.execPath also avoids spawning the .cmd shim, which Node refuses on
// Windows without a shell ("spawnSync npx.cmd EINVAL").
const tsPkgPath = require.resolve("typescript/package.json");
const tsc = join(dirname(tsPkgPath), require("typescript/package.json").bin.tsc);

console.log("emit-dts: running tsc --emitDeclarationOnly");
execFileSync(process.execPath, [tsc, "--emitDeclarationOnly"], {
  cwd: ROOT,
  stdio: "inherit",
});

// Only RELATIVE specifiers are rewritten. A bare specifier ("node:fs", a dependency
// name) is resolved by Node and must be left alone.
// NOTE: built fresh per call. A /g regex carries lastIndex between .test() calls,
// which makes a shared instance return alternating answers on identical input --
// precisely the kind of intermittent, self-inflicted wrongness this script exists
// to avoid.
// Three syntaxes carry a specifier: `from "x"`, `import("x")`, and the bare
// side-effect form `import "x";`. The third has neither `from` nor parentheses and
// was missed on the first pass -- `import './sqlite-register.js';` survived the
// rewrite and produced TS1479 in exactly one file.
const relativeJs = () =>
  /((?:from|import)\s*["']|import\s*\(\s*["'])(\.[^"']*?)\.js(["'])/g;

// The self-check must NOT reuse the rewrite pattern. A verifier built from the same
// regex as the thing it verifies shares its blind spots and reports success for
// exactly the cases the rewriter cannot see -- which is what happened here. This one
// is syntax-agnostic: ANY relative specifier still ending in .js is a failure.
const anyRelativeJs = () => /["'](\.[^"']*?)\.js["']/g;

/** Every .d.ts under dir gets a sibling .d.cts with CJS-resolvable specifiers. */
function mirror(dir) {
  const written = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      written.push(...mirror(full));
      continue;
    }
    if (!entry.endsWith(".d.ts")) continue;

    const source = readFileSync(full, "utf8");
    const converted = source.replace(
      relativeJs(),
      (_m, lead, spec, quote) => `${lead}${spec}.cjs${quote}`,
    );
    const target = `${full.slice(0, -".d.ts".length)}.d.cts`;
    writeFileSync(target, converted);
    written.push(target);
  }
  return written;
}

const written = mirror(join(ROOT, "dist"));

// Self-check. The failure this catches is silent: a .d.cts that exists, resolves as
// a file, and hands a CommonJS consumer nothing but TS1479 errors.
const leftovers = written.filter((f) => anyRelativeJs().test(readFileSync(f, "utf8")));
if (leftovers.length > 0) {
  console.error(
    `emit-dts FAIL: ${leftovers.length} .d.cts files still contain a relative .js specifier:`,
  );
  for (const f of leftovers.slice(0, 5)) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`emit-dts: wrote ${written.length} .d.cts, all specifiers CJS-resolvable`);
