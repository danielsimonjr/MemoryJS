/**
 * Performance Baseline Helper
 *
 * Reads `tests/performance/baselines.json` and returns the row for the
 * current `${process.platform}-${cpuModelSlug}` key, if present.
 * Absent rows yield `null`, signaling the test should log timings but
 * not assert latency — lets the suite stay green on new platforms
 * while a baseline gets captured manually.
 *
 * Future enhancement: when `MEMORY_PERF_RECORD=1`, append captured
 * timings back into baselines.json. Not implemented yet — set it up
 * when the first concrete need arises (otherwise it's spec-on-spec).
 *
 * @module tests/performance/baselineHelper
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export interface BaselineRow {
  p50_ms: number;
  p95_ms: number;
  noise_floor_pct: number;
  captured_at: string;
  captured_node: string;
}

interface BaselinesFile {
  _meta?: unknown;
  platforms: Record<string, Record<string, BaselineRow>>;
}

/** Stable key for the current platform. Truncated CPU model keeps the
 * key readable + matches across patch-level CPU revisions of the same
 * family. */
export function platformKey(): string {
  const cpus = os.cpus();
  const model = cpus[0]?.model ?? 'unknown';
  // Slug: keep first 24 chars, strip trademark/copyright noise, lowercase.
  const slug = model
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `${process.platform}-${slug}`;
}

/** Returns the baseline row for `testName` on the active platform, or
 * `null` if no baseline has been captured yet. */
export function getBaseline(testName: string): BaselineRow | null {
  const path = join(__dirname, 'baselines.json');
  let parsed: BaselinesFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as BaselinesFile;
  } catch {
    return null;
  }
  const key = platformKey();
  return parsed.platforms?.[key]?.[testName] ?? null;
}

/** Convenience: assert P95 against a baseline ± noise floor when one
 * exists; otherwise log the captured P95 for manual baseline seeding. */
export function assertOrLogP95(testName: string, p95Ms: number): void {
  const baseline = getBaseline(testName);
  if (!baseline) {
    // eslint-disable-next-line no-console
    console.log(
      `[perf:${platformKey()}] ${testName} p95=${p95Ms.toFixed(1)}ms (no baseline yet)`,
    );
    return;
  }
  const tolerance = baseline.p95_ms * (1 + baseline.noise_floor_pct / 100);
  // Caller wraps in expect() — this helper just builds the threshold.
  if (p95Ms > tolerance) {
    throw new Error(
      `[perf:${platformKey()}] ${testName} p95=${p95Ms.toFixed(1)}ms > ` +
        `baseline ${baseline.p95_ms}ms ± ${baseline.noise_floor_pct}% (tolerance ${tolerance.toFixed(1)}ms)`,
    );
  }
}
