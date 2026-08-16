#!/usr/bin/env node
/**
 * rebuild-native.mjs - make sure this package's native addons actually LOAD on this host.
 *
 * WHY THIS FILE EXISTS
 *   postinstall used to be:
 *
 *       npm rebuild better-sqlite3 2>/dev/null || true
 *
 *   which is POSIX shell. npm runs scripts through cmd.exe on Windows, where `/dev/null` is not a
 *   path and `true` is not a command. Tested on Windows 11, that line produces:
 *
 *       The system cannot find the path specified.
 *       'true' is not recognized as an internal or external command
 *       exit code 1
 *
 *   cmd fails on the redirect BEFORE npm runs, so the rebuild never happened - and the `|| true`
 *   meant to make it non-fatal is itself what errors. episodic-memory 1.5.0 therefore installed
 *   into the plugin cache with no better_sqlite3.node, and every CLI command that opens the index
 *   died with "Could not locate the bindings file".
 *
 * WHY IT TESTS THE LOAD RATHER THAN LOOKING FOR FILES
 *   The first version of this script searched <pkg>/node_modules/<name> for a .node file. That is
 *   filesystem archaeology standing in for a capability, and it was wrong twice over in one sweep:
 *
 *     - memoryjs/tools/migrate-from-jsonl-to-sqlite HAS a local node_modules/better-sqlite3
 *       directory with no binding in it, but `require.resolve` finds the PARENT copy in
 *       memoryjs/node_modules, which is built. The module loads perfectly. The path check reported
 *       a problem that did not exist, then ran a pointless rebuild that returned exit 0 having
 *       built nothing.
 *     - Hoisting, workspaces and peer installs all place the real copy somewhere other than the
 *       obvious directory. Any path-shaped check has to re-implement Node's resolution to be right.
 *
 *   Node already knows how to answer this. Asking it is both simpler and correct: try to load the
 *   module the same way the application will. That is the only claim anyone actually cares about.
 *
 * TWO RULES
 *   1. NON-FATAL, NEVER SILENT. A missing C++ toolchain must not break `npm install` - a developer
 *      should still get a working checkout - so this always exits 0. But the old form swallowed the
 *      reason along with the failure, which is why a broken release shipped unnoticed. Failures
 *      print what broke, what it breaks, and the command that fixes it.
 *   2. VERIFY AFTER, NOT BEFORE. `npm rebuild` reports success without necessarily producing a
 *      loadable addon, so the load is retried afterwards. "The command succeeded" and "the module
 *      loads" are different claims.
 *
 * .mjs rather than .js on purpose: this is ES module syntax, and most packages using it do not set
 * "type": "module". The extension makes it unambiguous instead of relying on Node's fallback
 * reparse, which emits MODULE_TYPELESS_PACKAGE_JSON on every install.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

// Resolves exactly as the package's own code will: from inside the package, walking up.
const require = createRequire(import.meta.url);

/** Native modules that must be compiled against the host's Node ABI. */
const NATIVE = ['better-sqlite3'];

/** npm is a shell script on POSIX and a .cmd shim on Windows; spawn needs to know. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** The only question that matters: can this package load the module? */
function loads(pkg) {
  try {
    require(pkg);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err).split('\n')[0] };
  }
}

for (const pkg of NATIVE) {
  const first = loads(pkg);
  if (first.ok) {
    let from = '';
    try { from = ` (${require.resolve(pkg)})`; } catch { /* resolution detail is a nicety */ }
    console.log(`[rebuild-native] ${pkg}: loads${from}`);
    continue;
  }

  console.log(`[rebuild-native] ${pkg}: does not load - ${first.reason}`);
  console.log(`[rebuild-native] ${pkg}: building for node ${process.version} on ${process.platform}...`);

  // shell:true is REQUIRED on Windows, not a convenience. npm is a .cmd shim there, and since the
  // CVE-2024-27980 mitigation Node refuses to spawn .cmd/.bat without a shell - spawnSync returns
  // status null having launched nothing. The arguments are fixed literals, so there is nothing for
  // a shell to mis-parse.
  const res = spawnSync(NPM, ['rebuild', pkg], { cwd: repoRoot, stdio: 'inherit', shell: true });
  if (res.error) console.warn(`[rebuild-native] ${pkg}: spawn failed - ${res.error.message}`);

  const after = loads(pkg);
  if (after.ok) {
    console.log(`[rebuild-native] ${pkg}: OK - loads after rebuild`);
  } else {
    console.warn(
      `[rebuild-native] ${pkg}: STILL DOES NOT LOAD (npm rebuild exit ${res.status ?? 'n/a'}) - ${after.reason}\n` +
      `[rebuild-native]   Anything using ${pkg} will fail at runtime.\n` +
      `[rebuild-native]   Fix on this host with:  npm rebuild ${pkg}\n` +
      `[rebuild-native]   That usually needs a C++ toolchain (Windows: Visual Studio Build Tools).`
    );
  }
}

// Always 0. A missing toolchain must not break `npm install`; the warning above is the signal, and
// it is deliberately impossible to miss in a way `2>/dev/null || true` never was.
process.exit(0);
