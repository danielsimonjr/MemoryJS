#!/usr/bin/env node
// Every file named in package.json `exports` must actually exist after a build.
//
// This exists because the declaration pipeline changed: tsup used to emit .d.ts and
// .d.cts itself, and now tsc emits .d.ts while scripts/emit-dts.mjs mirrors the
// .d.cts. A published package whose `types` condition points at a file that is not
// in the tarball still INSTALLS fine -- consumers just silently lose types, and the
// failure surfaces in someone else's editor rather than in our CI.
//
// So the exports map is checked against the built tree, not assumed to match it.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = createRequire(import.meta.url)("../package.json");

const missing = [];
let checked = 0;

/** Walk an exports value, which nests condition objects arbitrarily deep. */
function walk(value, path) {
  if (typeof value === "string") {
    checked++;
    if (!existsSync(join(ROOT, value))) missing.push(`${path} -> ${value}`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [condition, inner] of Object.entries(value)) {
      walk(inner, `${path}.${condition}`);
    }
  }
}

for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
  walk(value, subpath);
}
for (const field of ["main", "module", "types"]) {
  if (pkg[field]) {
    checked++;
    if (!existsSync(join(ROOT, pkg[field]))) missing.push(`${field} -> ${pkg[field]}`);
  }
}

if (checked === 0) {
  console.error("check-exports FAIL: nothing was checked — the exports map is empty?");
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`check-exports FAIL: ${missing.length} of ${checked} declared files are missing:`);
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

console.log(`check-exports OK: all ${checked} files named by exports/main/types exist`);
