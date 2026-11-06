/**
 * 06 - Multi-agent memory: visibility, collaborative synthesis, conflict resolution.
 *
 * Run: bun run examples/06-multi-agent.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollaborativeSynthesis, ManagerContext, MultiAgentMemoryManager, type Entity } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    const multi = new MultiAgentMemoryManager(ctx.storage);
    await multi.registerAgent('planner', { name: 'Planner', type: 'llm' });
    await multi.registerAgent('researcher', { name: 'Researcher', type: 'llm' });

    // Visibility: private by default; shareMemory() widens it to 'shared'.
    await multi.createAgentMemory('planner', {
      name: 'planner-private-note',
      entityType: 'note',
      memoryType: 'semantic',
      observations: ['Budget is tight this quarter'],
    });
    const shared = await multi.createAgentMemory('researcher', {
      name: 'research-finding',
      entityType: 'finding',
      memoryType: 'semantic',
      observations: ['Latency dropped 30% after caching'],
    });
    await multi.shareMemory(shared.name, 'researcher');
    const plannerView = (await multi.getVisibleMemories('planner')).map((e) => e.name).sort();

    // Two agents describe the same logical fact (same rootEntityName) → a conflict.
    // createAgentMemory() does not take rootEntityName, so the pair is written with
    // entityManager.createEntities(), which keeps the agent fields.
    await ctx.entityManager.createEntities([
      { name: 'Launch plan', entityType: 'project', observations: ['Targets Q3'] },
    ]);
    const claims: Array<Entity & { agentId: string; memoryType: 'semantic'; visibility: 'shared' }> = [
      { name: 'launch-date-planner', entityType: 'fact', observations: ['Launch is planned for September'],
        rootEntityName: 'Launch date', confidence: 0.6, agentId: 'planner', memoryType: 'semantic', visibility: 'shared' },
      { name: 'launch-date-researcher', entityType: 'fact', observations: ['Launch is planned for August'],
        rootEntityName: 'Launch date', confidence: 0.9, agentId: 'researcher', memoryType: 'semantic', visibility: 'shared' },
    ];
    await ctx.entityManager.createEntities(claims);
    await ctx.relationManager.createRelations(
      claims.map((c) => ({ from: 'Launch plan', to: c.name, relationType: 'has_fact' })),
    );

    // Collaborative synthesis: BFS from a seed, salience-ranked neighbours, and conflicts.
    const agent = ctx.agentMemory();
    const synthesis = await agent.collaborativeSynthesis.synthesize('Launch plan');
    const winners = agent.collaborativeSynthesis.resolveConflicts(synthesis, { strategy: 'highest_confidence' });
    const winnerAgents = [...winners.values()].map((e) => e.agentId);

    // The same class can be built directly from its four dependencies.
    const direct = new CollaborativeSynthesis(
      ctx.storage,
      ctx.graphTraversal,
      agent.createRoleAwareSalienceEngine('reviewer'),
    );
    const directResult = await direct.synthesize('Launch plan');

    return {
      plannerViewIncludesShared: plannerView.includes('research-finding'),
      plannerViewIncludesPrivate: plannerView.includes('planner-private-note'),
      conflictCount: synthesis.conflicts.length,
      conflictRecommended: synthesis.conflicts[0]?.recommendedWinner ?? null,
      winnerAgents,
      directSeed: directResult.seedEntity,
      synthesizedObservationCount: synthesis.synthesizedObservations.length,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-06-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
