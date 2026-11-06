/**
 * 08 - Bitemporal versioning, temporal relations, causal reasoning, world-state diffs.
 *
 * Run: bun run examples/08-versioning-causal.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    await ctx.entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['Works at Acme'] },
      { name: 'Acme', entityType: 'organization', observations: ['Employer'] },
      { name: 'Globex', entityType: 'organization', observations: ['New employer'] },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'Alice', to: 'Acme', relationType: 'works_at' },
    ]);

    // Temporal relations: invalidateRelation() sets validUntil, so queryAsOf() stops
    // returning the edge after that date.
    const before = await ctx.relationManager.queryAsOf('Alice', '2100-01-01', { direction: 'outgoing' });
    await ctx.relationManager.invalidateRelation('Alice', 'works_at', 'Acme', '2025-01-01T00:00:00Z');
    await ctx.relationManager.createRelations([{ from: 'Alice', to: 'Globex', relationType: 'works_at' }]);
    const in2024 = await ctx.relationManager.queryAsOf('Alice', '2024-06-01', { direction: 'outgoing' });
    const in2026 = await ctx.relationManager.queryAsOf('Alice', '2026-06-01', { direction: 'outgoing' });
    const history = await ctx.relationManager.timeline('Alice', { direction: 'outgoing' });

    // Bitemporal entities: invalidate an entity, then time-travel to a point before it ended.
    await ctx.entityManager.invalidateEntity('Globex', '2030-01-01T00:00:00Z');
    const globexIn2026 = await ctx.entityManager.entityAsOf('Globex', '2026-01-01T00:00:00Z');

    // Causal reasoning over causes / enables / prevents / precedes / correlates relations.
    await ctx.entityManager.createEntities([
      { name: 'Rain', entityType: 'event', observations: ['Heavy rainfall'] },
      { name: 'Flooding', entityType: 'event', observations: ['Street flooding'] },
      { name: 'Erosion', entityType: 'event', observations: ['Soil erosion'] },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'Rain', to: 'Flooding', relationType: 'causes' },
      { from: 'Flooding', to: 'Erosion', relationType: 'causes' },
    ]);
    const effects = await ctx.causalReasoner.findEffects('Rain', ['Flooding', 'Erosion']);
    const causes = await ctx.causalReasoner.findCauses('Erosion', ['Rain', 'Flooding']);
    const withoutLink = await ctx.causalReasoner.counterfactual({
      seed: 'Rain',
      removeFrom: 'Flooding',
      removeTo: 'Erosion',
      predict: 'Erosion',
    });

    // World-state snapshot and diff.
    const snapshotBefore = await ctx.worldModelManager.getCurrentState();
    await ctx.entityManager.createEntities([{ name: 'Drought', entityType: 'event', observations: ['Dry spell'] }]);
    const snapshotAfter = await ctx.worldModelManager.getCurrentState();
    const change = ctx.worldModelManager.detectStateChange(snapshotBefore, snapshotAfter);

    return {
      outgoingBeforeClose: before.length,
      acmeIn2024: in2024.some((r) => r.to === 'Acme'),
      acmeIn2026: in2026.some((r) => r.to === 'Acme'),
      timelineLength: history.length,
      globexVisibleIn2026: globexIn2026 !== null,
      effectTargets: effects.map((c) => c.path[c.path.length - 1]),
      causeSources: causes.map((c) => c.path[0]),
      erosionWithoutFlooding: withoutLink.length,
      stateChangeAdded: change.added.map((e) => e.name),
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-08-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
