/**
 * Focused CPU benchmarks. Run: node --import tsx benchmarks/review-bench.ts [repo-root]
 * The optional root permits comparison against a checkout of an earlier revision.
 * Each case reports the median of seven warmed samples; no wall-clock CI gates.
 */
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ABACRule } from '../src/security/ABACPolicy.js';

const root = resolve(process.argv[2] ?? '.');
const { ABACPolicy } = await import(pathToFileURL(resolve(root, 'src/security/ABACPolicy.ts')).href);
const { levenshteinDistance } = await import(pathToFileURL(resolve(root, 'src/utils/searchAlgorithms.ts')).href);
let checksum = 0;

function measure(name: string, iterations: number, fn: () => number): void {
  for (let i = 0; i < Math.min(iterations, 100); i++) checksum += fn();
  const samples: number[] = [];
  for (let round = 0; round < 7; round++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) checksum += fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, iterations, medianMs: Number(samples[3].toFixed(3)) }));
}

const rules: ABACRule[] = Array.from({ length: 100 }, (_, i) => ({
  id: `rule-${i}`, action: 'read', effect: i === 99 ? 'deny' : 'permit',
  conditions: Array.from({ length: 4 }, (_, j) => ({
    attribute: `subject.attr${j}`, op: 'eq', value: j,
  })),
}));
const policy = new ABACPolicy(rules);
const context = {
  subject: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`attr${i}`, i])),
  resource: { classification: 'internal' }, action: 'read',
};
measure('ABAC: 100 rules, 4 conditions, 100 attributes', 200, () =>
  policy.evaluate(context) === 'deny' ? 1 : 0);

// The acceptance decision is identical even when the baseline ignores the optional cutoff.
const a = 'ab'.repeat(256);
const near = 'ac' + a.slice(2);
const far = 'cd'.repeat(256);
measure('Fuzzy: near match, 512 characters, cutoff 5', 300, () =>
  levenshteinDistance(a, near, 5) <= 5 ? 1 : 0);
measure('Fuzzy: non-match, 512 characters, cutoff 5', 300, () =>
  levenshteinDistance(a, far, 5) <= 5 ? 1 : 0);
console.log(JSON.stringify({ node: process.version, checksum }));
