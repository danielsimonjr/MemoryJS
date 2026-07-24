#!/usr/bin/env node
// check-duplicates — prevention gate for the duplicate-symbols campaign.
//
// By default, regenerates the duplicate-symbol analysis (via
// create-dependency-graph.ts, run with plain `node` — Node >= 22.18 type
// stripping, no tsx required) and fails if any TRUE_DUPLICATE name exists
// beyond docs/architecture/duplicate-baseline.json — the campaign's accepted,
// shrinking backlog. New unauthorized duplicates can't accumulate;
// consolidating an existing one and re-running
// `node tools/create-dependency-graph/gen-duplicate-baseline.mjs` shrinks the
// baseline.
//
// Pass `--no-regen` to skip the (slow) regeneration and gate against the
// already-generated docs/architecture/duplicate-symbols.json — useful in a
// pre-commit hook whose earlier step already refreshed the report.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = process.cwd();
const SKIP_REGEN = process.argv.includes('--no-regen');

function regenerateDuplicateSymbols() {
  // Plain `node` + argv array (no shell): Node >= 22.18 strips types natively.
  execFileSync(
    process.execPath,
    ['tools/create-dependency-graph/create-dependency-graph.ts', '--root=.'],
    { cwd: ROOT_DIR, stdio: 'pipe' }
  );
}

function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT_DIR, relPath), 'utf-8'));
}

/** New TRUE_DUPLICATE names in `current` (kind => name => files) not present
 *  in `baseline` (kind => name => files). Returns a flat list of findings. */
function diffNewDuplicates(current, baseline) {
  const findings = [];
  for (const kind of ['runtime', 'types']) {
    const currentNames = current[kind] ?? {};
    const baselineNames = baseline[kind] ?? {};
    for (const [name, files] of Object.entries(currentNames)) {
      if (!(name in baselineNames)) {
        findings.push({ kind, name, files });
      }
    }
  }
  return findings;
}

function main() {
  if (SKIP_REGEN) {
    console.log('check-duplicates --no-regen — reading existing duplicate-symbol analysis...');
  } else {
    console.log('check-duplicates — regenerating duplicate-symbol analysis...');
    try {
      regenerateDuplicateSymbols();
    } catch (err) {
      console.error('Failed to regenerate docs/architecture/duplicate-symbols.json:');
      console.error(err.message);
      process.exit(1);
    }
  }

  const report = readJson('docs/architecture/duplicate-symbols.json');
  const baseline = readJson('docs/architecture/duplicate-baseline.json');

  const current = {
    runtime: Object.fromEntries(
      report.runtime
        .filter((e) => e.tag === 'TRUE_DUPLICATE')
        .map((e) => [e.name, e.definers.map((d) => d.file).sort()])
    ),
    types: Object.fromEntries(
      report.types
        .filter((e) => e.tag === 'TRUE_DUPLICATE')
        .map((e) => [e.name, e.definers.map((d) => d.file).sort()])
    ),
  };

  const newDuplicates = diffNewDuplicates(current, baseline);

  const currentTotal = Object.keys(current.runtime).length + Object.keys(current.types).length;
  const baselineTotal =
    Object.keys(baseline.runtime ?? {}).length + Object.keys(baseline.types ?? {}).length;

  if (newDuplicates.length > 0) {
    console.error('');
    console.error(
      `FAIL: ${newDuplicates.length} new TRUE_DUPLICATE name(s) not in docs/architecture/duplicate-baseline.json:`
    );
    for (const f of newDuplicates) {
      console.error('');
      console.error(`  [${f.kind}] ${f.name}`);
      for (const file of f.files) console.error(`    - ${file}`);
      console.error(
        `    A new own-definition of \`${f.name}\` was added in >=2 files. Reuse the existing ` +
          `canonical definition (see the file list above; prefer the one already exported ` +
          `from src/index.ts) instead of adding a new independent body. If this is ` +
          `legitimately independent (e.g. the standalone worker bundle), add it to ` +
          `tools/create-dependency-graph/duplicate-allowlist.json instead. If it's an ` +
          `accepted new item in the consolidation backlog, re-run ` +
          `\`node tools/create-dependency-graph/gen-duplicate-baseline.mjs\` after review.`
      );
    }
    console.error('');
    console.error(
      `check-duplicates: FAILED (${currentTotal} current TRUE_DUPLICATE vs ${baselineTotal} baselined)`
    );
    process.exit(1);
  }

  console.log(
    `check-duplicates: PASSED (${currentTotal} current TRUE_DUPLICATE, ` +
      `${baselineTotal} baselined, 0 new)`
  );
}

main();
