// One-off generator for docs/architecture/duplicate-baseline.json — the
// check-duplicates gate's accepted-backlog snapshot. Run manually (not part
// of any npm script) whenever the baseline needs to be re-seeded after a
// deliberate, reviewed change to the accepted TRUE_DUPLICATE set. See
// tools/create-dependency-graph/check-duplicates.mjs for the consumer.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = process.cwd();
const dupPath = join(ROOT_DIR, 'docs', 'architecture', 'duplicate-symbols.json');
const outPath = join(ROOT_DIR, 'docs', 'architecture', 'duplicate-baseline.json');

const report = JSON.parse(readFileSync(dupPath, 'utf-8'));

const collect = (entries) => {
  const out = {};
  for (const e of entries) {
    if (e.tag !== 'TRUE_DUPLICATE') continue;
    out[e.name] = e.definers.map((d) => d.file).sort();
  }
  return out;
};

const baseline = {
  generated: new Date().toISOString().split('T')[0],
  note:
    'The in-progress dedup campaign backlog: TRUE_DUPLICATE names accepted as of `generated`. ' +
    '`node tools/create-dependency-graph/check-duplicates.mjs` fails only on NEW ' +
    'TRUE_DUPLICATE names beyond this set — as names are consolidated, re-run this generator ' +
    'to shrink the baseline. Not auto-run; a human re-seeds it deliberately after reviewing ' +
    'what changed.',
  runtime: collect(report.runtime),
  types: collect(report.types),
};

writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n');
console.log(
  `Written: docs/architecture/duplicate-baseline.json ` +
    `(${Object.keys(baseline.runtime).length} runtime, ${Object.keys(baseline.types).length} type TRUE_DUPLICATE names)`
);
