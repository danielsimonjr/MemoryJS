#!/usr/bin/env node
/**
 * rebuild-native.mjs - the install-time guard that this package ships no native addons.
 *
 * WHY THIS FILE STILL EXISTS
 *   MemoryJS used to have exactly one native runtime dependency, `better-sqlite3`, which got
 *   its binary from an `install` script (`prebuild-install || node-gyp rebuild`) rather than
 *   from a prebuilt platform package. Any installer that did not run install scripts therefore
 *   produced a `better-sqlite3` directory with no `better_sqlite3.node` in it, and every call
 *   failed with "Could not locate the bindings file". That is what made the deployed memory-mcp
 *   plugin unusable, and it is why this postinstall hook existed: it loaded each addon, rebuilt
 *   it when the load failed, and printed what broke instead of swallowing the reason.
 *
 *   Sprint 9 replaced that addon with Node's built-in `node:sqlite`, so the package now ships no
 *   native code and there is nothing to rebuild. The file stays because `package.json` lists it
 *   in `files` and runs it from `postinstall`, and because a published tarball must not fail its
 *   install. It is now a check rather than a repair: it reads the package's own `package.json`
 *   and fails loudly if a dependency that needs a native build comes back without this script
 *   being taught about it. It always exits 0, so a consumer's `npm install` cannot break here.
 *
 * .mjs rather than .js on purpose: this is ES module syntax, and most packages using it do not
 * set "type": "module". The extension makes it unambiguous instead of relying on Node's fallback
 * reparse, which emits MODULE_TYPELESS_PACKAGE_JSON on every install.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packages known to need a native build, with the check that proves they load.
 *
 * Empty since Sprint 9. Adding an entry here means the package has an `install` script that
 * compiles C/C++, and the load check must open a real database or the equivalent, because a
 * native addon binds lazily in its constructor.
 */
const NATIVE = [];

const here = dirname(fileURLToPath(import.meta.url));

/** Packages the package.json declares that are known to require a compiled addon. */
const KNOWN_NATIVE = new Set(['better-sqlite3', 'node-gyp', 'sharp', 'canvas']);

function declaredDependencies() {
  try {
    const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
  } catch {
    // A published tarball places this file next to package.json, but a copied or
    // relocated script may not. Not knowing is not a failure of the install.
    return [];
  }
}

const unexpected = declaredDependencies().filter(
  (name) => KNOWN_NATIVE.has(name) && !NATIVE.some((entry) => entry.package === name),
);

if (unexpected.length > 0) {
  console.warn(
    `[rebuild-native] these dependencies need a native build, but this script does not check them: ${unexpected.join(', ')}\n` +
      `[rebuild-native]   Add an entry to NATIVE in scripts/rebuild-native.mjs (package + probe),\n` +
      `[rebuild-native]   or the addon can be missing or ABI-mismatched at runtime.`,
  );
} else if (NATIVE.length === 0) {
  console.log(
    "[rebuild-native] no native addons: the SQLite backend is Node's built-in node:sqlite",
  );
}

// Always 0. A missing toolchain must not break `npm install`; the warning above is the signal.
process.exit(0);
