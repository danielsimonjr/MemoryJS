/**
 * Query Plan Formatter
 *
 * Renders a `QueryPlan` (from `QueryPlanner`) as a human-readable ASCII
 * tree. Used by `searchManager.explainPlan` and for ad-hoc CLI debugging.
 *
 * @module search/QueryPlanFormatter
 * @experimental Output shape (`{ ascii, json }`) may evolve.
 */

import type { QueryPlan, SubQuery } from '../types/index.js';

/**
 * Render a QueryPlan as an ASCII tree.
 *
 * @param plan - The plan to render.
 * @returns A multi-line string suitable for `console.log` / CLI output.
 */
export function formatQueryPlanAscii(plan: QueryPlan): string {
  const lines: string[] = [];
  // Normalise whitespace so embedded newlines/tabs don't break tree alignment.
  const normalised = plan.originalQuery.replace(/\s+/g, ' ').trim();
  lines.push(`QueryPlan: ${truncate(normalised, 80)}`);
  lines.push(`├─ Strategy:             ${plan.executionStrategy}`);
  lines.push(`├─ Merge:                ${plan.mergeStrategy}`);
  lines.push(`├─ Estimated complexity: ${plan.estimatedComplexity.toFixed(2)}`);

  const sub = plan.subQueries;
  if (sub.length === 0) {
    lines.push('└─ SubQueries: (none)');
    return lines.join('\n');
  }

  lines.push(`└─ SubQueries (${sub.length}):`);
  sub.forEach((sq, i) => {
    const isLast = i === sub.length - 1;
    const branch = isLast ? '   └─' : '   ├─';
    const lead = isLast ? '      ' : '   │  ';
    lines.push(`${branch} [${sq.id}] ${padRight(sq.targetLayer, 8)} | priority ${sq.priority}`);
    lines.push(`${lead}query: ${truncate(sq.query, 70)}`);
    if (sq.dependsOn && sq.dependsOn.length > 0) {
      lines.push(`${lead}depends-on: ${sq.dependsOn.join(', ')}`);
    }
    if (sq.filters) {
      const filterKeys = Object.keys(sq.filters as Record<string, unknown>);
      if (filterKeys.length > 0) {
        lines.push(`${lead}filters: ${filterKeys.join(', ')}`);
      }
    }
  });

  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * The shape returned by `SearchManager.explainPlan`.
 *
 * `ascii` is a printable tree; `json` is the underlying `QueryPlan` so callers
 * can post-process, diff plans, or feed them into another tool.
 */
export interface ExplainPlanResult {
  ascii: string;
  json: QueryPlan;
}

/** Type re-export for downstream callers that only want the plan shape. */
export type { SubQuery };
