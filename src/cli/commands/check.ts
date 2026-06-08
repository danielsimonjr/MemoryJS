/**
 * Graph repair CLI command — `memory check`.
 *
 * Detects two classes of integrity bugs that the `health` subcommand
 * reports but does not fix:
 *
 *   1. Orphan relations — relations whose `from` or `to` endpoint
 *      references an entity that no longer exists.
 *   2. Missing parents — entities whose `parentId` references an entity
 *      that no longer exists.
 *
 * Dry-run is the default: print every finding as structured JSON and
 * exit 0 without mutating. Pass `--apply` to actually delete orphan
 * relations and clear missing parentIds. Hierarchy cycles are NOT
 * auto-repaired here (no safe default for which edge to break) — they
 * are reported but always left for human review.
 *
 * @module cli/commands/check
 */

import { Command } from 'commander';
import { ManagerContext } from '../../core/ManagerContext.js';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

interface OrphanRelation {
  from: string;
  to: string;
  relationType: string;
  reason: 'from-missing' | 'to-missing' | 'both-missing';
}

interface MissingParent {
  entity: string;
  parentId: string;
}

interface HierarchyCycle {
  entityInCycle: string;
  cycleThrough: string;
}

interface CheckReport {
  ok: boolean;
  applied: boolean;
  orphanRelations: OrphanRelation[];
  missingParents: MissingParent[];
  hierarchyCycles: HierarchyCycle[];
  actions?: {
    orphanRelationsDeleted: number;
    missingParentsCleared: number;
  };
}

async function detectIssues(ctx: ManagerContext): Promise<{
  orphans: OrphanRelation[];
  missing: MissingParent[];
  cycles: HierarchyCycle[];
}> {
  const graph = await ctx.storage.loadGraph();
  const names = new Set(graph.entities.map((e) => e.name));

  const orphans: OrphanRelation[] = [];
  for (const r of graph.relations) {
    const fromMissing = !names.has(r.from);
    const toMissing = !names.has(r.to);
    if (fromMissing || toMissing) {
      orphans.push({
        from: r.from,
        to: r.to,
        relationType: r.relationType,
        reason: fromMissing && toMissing ? 'both-missing' : fromMissing ? 'from-missing' : 'to-missing',
      });
    }
  }

  const missing: MissingParent[] = [];
  const cycles: HierarchyCycle[] = [];
  const byName = new Map<string, { name: string; parentId?: string }>();
  for (const e of graph.entities) byName.set(e.name, { name: e.name, parentId: e.parentId });

  for (const e of graph.entities) {
    if (!e.parentId) continue;
    if (!byName.has(e.parentId)) {
      missing.push({ entity: e.name, parentId: e.parentId });
      continue;
    }
    // Walk upward; record a cycle if we revisit a node.
    const visited = new Set<string>([e.name]);
    let cur = byName.get(e.parentId);
    while (cur && cur.parentId) {
      if (visited.has(cur.name)) {
        cycles.push({ entityInCycle: e.name, cycleThrough: cur.name });
        break;
      }
      visited.add(cur.name);
      cur = byName.get(cur.parentId);
    }
  }

  return { orphans, missing, cycles };
}

async function applyFixes(
  ctx: ManagerContext,
  orphans: OrphanRelation[],
  missing: MissingParent[],
): Promise<{ orphanRelationsDeleted: number; missingParentsCleared: number }> {
  let deleted = 0;
  let cleared = 0;

  if (orphans.length > 0) {
    await ctx.relationManager.deleteRelations(
      orphans.map((o) => ({ from: o.from, to: o.to, relationType: o.relationType })),
    );
    deleted = orphans.length;
  }

  for (const m of missing) {
    // setEntityParent(name, null) clears the parentId. Wrapped in try/catch so
    // one ill-formed record doesn't abort the rest of the repair sweep.
    try {
      await ctx.hierarchyManager.setEntityParent(m.entity, null);
      cleared += 1;
    } catch {
      // Skip; entity may have vanished mid-repair on a busy graph.
    }
  }

  return { orphanRelationsDeleted: deleted, missingParentsCleared: cleared };
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Detect orphan relations + missing parents + hierarchy cycles. Dry-run by default.')
    .option('--apply', 'Actually delete orphan relations + clear missing parentIds (cycles always left for human review)')
    .action(async (opts: { apply?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const { orphans, missing, cycles } = await detectIssues(ctx);
        const ok = orphans.length === 0 && missing.length === 0 && cycles.length === 0;
        const report: CheckReport = {
          ok,
          applied: Boolean(opts.apply),
          orphanRelations: orphans,
          missingParents: missing,
          hierarchyCycles: cycles,
        };

        if (opts.apply && (orphans.length > 0 || missing.length > 0)) {
          report.actions = await applyFixes(ctx, orphans, missing);
        }

        console.log(JSON.stringify(report, null, 2));
        // Exit non-zero only when issues are present AND --apply was NOT used.
        // After successful --apply, downstream pipelines should treat the run as a fix completed.
        if (!ok && !opts.apply) process.exit(1);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}

// Re-export internals for the REPL bridge + tests.
export { detectIssues, applyFixes };
export type { CheckReport, OrphanRelation, MissingParent, HierarchyCycle };
