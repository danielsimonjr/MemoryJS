/**
 * 04 - Import / export, backups, and skill publishing.
 *
 * Run: bun run examples/04-import-export.ts
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
      { name: 'Alice', entityType: 'person', observations: ['Engineer'], tags: ['core'] },
      { name: 'Acme', entityType: 'organization', observations: ['Customer'] },
    ]);
    await ctx.relationManager.createRelations([{ from: 'Alice', to: 'Acme', relationType: 'works_at' }]);

    // Export the live graph as JSON text (other formats: csv, graphml, gexf, dot,
    // markdown, mermaid, turtle, rdf-xml, json-ld).
    const graph = await ctx.storage.loadGraph();
    const json = ctx.ioManager.exportGraph(graph, 'json');

    // Dry-run an import into a fresh store, then import for real.
    const targetPath = join(join(storagePath, '..'), 'target.jsonl');
    const target = new ManagerContext(targetPath);
    let added = 0;
    let skipped = 0;
    let dryRunAdded = 0;
    try {
      // importGraph(format, data, mergeStrategy, dryRun?, options?)
      const dry = await target.ioManager.importGraph('json', json, 'skip', true);
      dryRunAdded = dry.entitiesAdded;
      const real = await target.ioManager.importGraph('json', json, 'skip');
      added = real.entitiesAdded;
      skipped = real.entitiesSkipped;
    } finally {
      target.close();
    }

    // Backups: createBackup() → BackupResult.path, restoreFromBackup(path).
    const backup = await ctx.ioManager.createBackup();
    await ctx.entityManager.deleteEntities(['Acme']);
    const restore = await ctx.ioManager.restoreFromBackup(backup.path);
    const backups = await ctx.ioManager.listBackups();
    const afterRestore = await ctx.entityManager.listEntities();

    // Batch: queue mutations on a builder; they are validated and applied in one pass.
    // If the callback throws, nothing is applied.
    const batch = await ctx.batch((b) => {
      b.createEntity({ name: 'Initech', entityType: 'organization', observations: ['Vendor'] });
      b.createRelation({ from: 'Alice', to: 'Initech', relationType: 'consults_for' });
    });

    // Skills: publish every live skill as a SKILL.md tree below the storage directory.
    await ctx.skillManager.add({
      name: 'Triage bug reports',
      description: 'Use when a bug report arrives without reproduction steps',
      kind: 'procedure',
      scope: { domains: ['support'] },
      uncertainty: 0.2,
      body: '1. Ask for steps.\n2. Attach logs.',
    });
    const published = await ctx.ioManager.exportSkills('skills');
    const report = await ctx.ioManager.importSkills('skills');

    return {
      exportedBytesPositive: json.length > 0,
      dryRunAdded,
      added,
      skipped,
      backupEntityCount: backup.entityCount,
      restoredEntityCount: restore.entityCount,
      backupCount: backups.length,
      entityNamesAfterRestore: afterRestore.map((e) => e.name).sort(),
      batchCreated: batch.entitiesCreated,
      publishedSkillCount: published.skillCount,
      importedUnchanged: report.unchanged.length,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-04-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
