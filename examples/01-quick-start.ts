/**
 * 01 - Quick start: entities, relations, observations, search and lookups.
 *
 * Run: bun run examples/01-quick-start.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntityNotFoundError, ManagerContext } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(
  storagePath: string,
  options: { storageType?: 'jsonl' | 'sqlite' } = {},
): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext({ storagePath, storageType: options.storageType });
  try {
    await ctx.entityManager.createEntities([
      {
        name: 'TypeScript',
        entityType: 'language',
        observations: ['A typed superset of JavaScript'],
        tags: ['programming', 'frontend'],
        importance: 8,
      },
      {
        name: 'Node.js',
        entityType: 'runtime',
        observations: ['JavaScript runtime built on V8'],
        tags: ['backend', 'server'],
      },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'TypeScript', to: 'Node.js', relationType: 'runs_on' },
    ]);
    await ctx.observationManager.addObservations([
      { entityName: 'Node.js', contents: ['Ships an event loop'] },
    ]);

    const matches = await ctx.searchManager.searchNodes('runtime');
    const entity = await ctx.entityManager.getEntity('TypeScript');
    const languages = await ctx.entityManager.listEntities({ entityType: 'language' });
    const relations = await ctx.relationManager.getRelations('TypeScript');
    const observations = await ctx.observationManager.getObservationsFor('Node.js');

    // Typed errors: a missing entity raises EntityNotFoundError.
    let missingEntityError = false;
    try {
      await ctx.entityManager.setImportance('Missing', 5);
    } catch (err) {
      missingEntityError = err instanceof EntityNotFoundError;
    }

    return {
      searchHits: matches.entities.map((e) => e.name),
      entityImportance: entity?.importance,
      languageNames: languages.map((e) => e.name),
      relationTypes: relations.map((r) => `${r.from} ${r.relationType} ${r.to}`),
      nodeObservations: observations,
      missingEntityError,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-01-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
