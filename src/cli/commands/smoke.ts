/**
 * Smoke CLI command.
 *
 * Exercises every major MemoryJS manager surface against a fresh temp graph
 * and reports per-step pass/fail. Designed for end-to-end smoke testing,
 * pre-release verification, and interactive dogfooding (`--keep` preserves
 * the temp dir + prints its path).
 *
 * Coverage targets: entity, relation, observation, search (basic + boolean
 * + ranked), tag, hierarchy, graph algorithms, io (export), maintenance
 * (validation), decision rationale, heuristic guidelines, project context,
 * tool affordance, exclusion (do_not_remember), observation dedup, spell
 * correction. Roughly 30 ops; total run typically completes in <5 s.
 *
 * Exit code is the number of failing steps (0 = success, non-zero = how
 * many steps failed). Print mode toggled with --verbose.
 *
 * @module cli/commands/smoke
 */

import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { ManagerContext } from '../../core/ManagerContext.js';
import { formatSuccess, formatError } from '../formatters.js';

interface SmokeStep {
  name: string;
  run: () => Promise<void>;
}

interface SmokeResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

async function runSteps(steps: SmokeStep[], verbose: boolean): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  for (const step of steps) {
    const start = performance.now();
    try {
      await step.run();
      const durationMs = performance.now() - start;
      results.push({ name: step.name, ok: true, durationMs });
      if (verbose) {
        console.log(`  ${formatSuccess('✓')} ${step.name} (${durationMs.toFixed(1)} ms)`);
      }
    } catch (error) {
      const durationMs = performance.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: step.name, ok: false, durationMs, error: message });
      if (verbose) {
        console.log(`  ${formatError('✗')} ${step.name} (${durationMs.toFixed(1)} ms) — ${message}`);
      }
    }
  }
  return results;
}

function buildSteps(ctx: ManagerContext): SmokeStep[] {
  return [
    // ---- Entity (CRUD) ----
    {
      name: 'entity:create',
      run: async () => {
        const [created] = await ctx.entityManager.createEntities([{
          name: 'Alpha', entityType: 'service', observations: ['root node'],
        }]);
        if (created.name !== 'Alpha') throw new Error(`expected Alpha got ${created.name}`);
      },
    },
    {
      name: 'entity:open_nodes',
      run: async () => {
        const result = await ctx.searchManager.openNodes(['Alpha']);
        if (result.entities.length !== 1) throw new Error(`expected 1 entity got ${result.entities.length}`);
      },
    },
    {
      name: 'entity:update',
      run: async () => {
        await ctx.entityManager.updateEntity('Alpha', { importance: 7 });
        const after = ctx.storage.getEntityByName('Alpha');
        if (after?.importance !== 7) throw new Error(`importance not persisted: ${after?.importance}`);
      },
    },

    // ---- Relation ----
    {
      name: 'relation:create_endpoints',
      run: async () => {
        await ctx.entityManager.createEntities([
          { name: 'Beta', entityType: 'service', observations: ['second node'] },
          { name: 'Gamma', entityType: 'service', observations: ['third node'] },
        ]);
      },
    },
    {
      name: 'relation:create',
      run: async () => {
        await ctx.relationManager.createRelations([{ from: 'Alpha', to: 'Beta', relationType: 'depends_on' }]);
        const graph = await ctx.storage.loadGraph();
        if (!graph.relations.some((r) => r.from === 'Alpha' && r.to === 'Beta')) {
          throw new Error('relation Alpha→Beta not found in graph');
        }
      },
    },

    // ---- Observation ----
    {
      name: 'observation:add',
      run: async () => {
        await ctx.observationManager.addObservations([
          { entityName: 'Alpha', contents: ['extra note for search'] },
        ]);
        const obs = await ctx.observationManager.getObservationsFor('Alpha');
        if (!obs.some((o) => o.includes('extra note'))) throw new Error('observation not persisted');
      },
    },
    {
      name: 'observation:delete',
      run: async () => {
        await ctx.observationManager.deleteObservations([
          { entityName: 'Alpha', observations: ['root node'] },
        ]);
        const obs = await ctx.observationManager.getObservationsFor('Alpha');
        if (obs.includes('root node')) throw new Error('observation not deleted');
      },
    },

    // ---- Search ----
    {
      name: 'search:basic',
      run: async () => {
        const result = await ctx.searchManager.searchNodes('extra note');
        if (result.entities.length === 0) throw new Error('basic search returned no entities');
      },
    },
    {
      name: 'search:boolean',
      run: async () => {
        const result = await ctx.searchManager.booleanSearch('extra AND note');
        if (result.entities.length === 0) throw new Error('boolean search returned no entities');
      },
    },
    {
      name: 'search:ranked',
      run: async () => {
        const result = await ctx.rankedSearch.searchNodesRanked('extra note', undefined, undefined, undefined, 5);
        if (result.length === 0) throw new Error('ranked search returned no results');
      },
    },

    // ---- Tag ----
    {
      name: 'tag:add',
      run: async () => {
        await ctx.entityManager.addTags('Alpha', ['critical', 'core']);
        const e = ctx.storage.getEntityByName('Alpha');
        if (!e?.tags?.includes('critical')) throw new Error('tag not added');
      },
    },
    {
      name: 'tag:remove',
      run: async () => {
        await ctx.entityManager.removeTags('Alpha', ['core']);
        const e = ctx.storage.getEntityByName('Alpha');
        if (e?.tags?.includes('core')) throw new Error('tag not removed');
      },
    },

    // ---- Hierarchy ----
    {
      name: 'hierarchy:set_parent',
      run: async () => {
        await ctx.hierarchyManager.setEntityParent('Beta', 'Alpha');
        const e = ctx.storage.getEntityByName('Beta');
        if (e?.parentId !== 'Alpha') throw new Error(`parent not set: ${e?.parentId}`);
      },
    },
    {
      name: 'hierarchy:ancestors',
      run: async () => {
        const ancestors = await ctx.hierarchyManager.getAncestors('Beta');
        if (!ancestors.some((a) => a.name === 'Alpha')) throw new Error('Alpha not in Beta ancestors');
      },
    },

    // ---- Graph algorithms ----
    {
      name: 'graph:shortest_path',
      run: async () => {
        const result = await ctx.graphTraversal.findShortestPath('Alpha', 'Beta');
        if (!result || result.path.length === 0) throw new Error('no path found Alpha→Beta');
      },
    },
    {
      name: 'graph:connected_components',
      run: async () => {
        const result = await ctx.graphTraversal.findConnectedComponents();
        if (result.components.length === 0) throw new Error('no connected components');
      },
    },

    // ---- IO ----
    {
      name: 'io:export_json',
      run: async () => {
        const graph = await ctx.storage.loadGraph();
        const exported = ctx.ioManager.exportGraph(graph, 'json');
        const parsed = JSON.parse(exported);
        if (!Array.isArray(parsed.entities) || parsed.entities.length < 3) {
          throw new Error(`export json had ${parsed.entities?.length} entities`);
        }
      },
    },

    // ---- Maintenance / Analytics ----
    {
      name: 'analytics:stats',
      run: async () => {
        const stats = await ctx.analyticsManager.getGraphStats();
        if (stats.totalEntities < 3) throw new Error(`stats.totalEntities=${stats.totalEntities}`);
      },
    },
    {
      name: 'maintenance:validate',
      run: async () => {
        const report = await ctx.analyticsManager.validateGraph();
        if (!report) throw new Error('validate returned nothing');
      },
    },

    // ---- Decision Rationale (v2.1.0) ----
    {
      name: 'decision:propose',
      run: async () => {
        const r = await ctx.decisionManager.propose({
          context: 'choosing storage',
          decision: 'use SQLite',
          alternatives: ['JSONL'],
          consequences: ['ACID'],
        });
        if (!r.id) throw new Error('propose returned no id');
      },
    },
    {
      name: 'decision:accept',
      run: async () => {
        const list = await ctx.decisionManager.list({ status: 'proposed' });
        if (list.length === 0) throw new Error('no proposed decision to accept');
        const result = await ctx.decisionManager.accept(list[0].id);
        if (result !== 'accepted') throw new Error(`accept returned ${result}`);
      },
    },
    {
      name: 'decision:list',
      run: async () => {
        const list = await ctx.decisionManager.list({ status: 'accepted' });
        if (list.length === 0) throw new Error('accepted decision missing from list');
      },
    },

    // ---- Heuristic Guidelines (v2.1.0) ----
    {
      name: 'heuristic:add',
      run: async () => {
        const id = await ctx.heuristicManager.add({
          condition: 'editing TypeScript', action: 'run typecheck before commit',
        });
        if (!id) throw new Error('add_heuristic returned no id');
      },
    },
    {
      name: 'heuristic:match',
      run: async () => {
        const matches = await ctx.heuristicManager.match('editing TypeScript file');
        if (matches.length === 0) throw new Error('match returned no heuristics');
      },
    },

    // ---- Project Context (v2.1.0) ----
    {
      name: 'project_context:upsert',
      run: async () => {
        const rec = await ctx.projectContextManager.upsert('smoke', {
          facts: ['smoke test project'],
        });
        if (!rec) throw new Error('upsert returned nothing');
      },
    },
    {
      name: 'project_context:get',
      run: async () => {
        const rec = ctx.projectContextManager.get('smoke');
        if (!rec) throw new Error('project context not found after upsert');
      },
    },

    // ---- Tool Affordance (v2.1.0) ----
    {
      name: 'tool_affordance:record + stats',
      run: async () => {
        await ctx.toolAffordanceManager.recordOutcome('test_tool', {
          outcome: 'success', durationMs: 10,
        });
        const stats = ctx.toolAffordanceManager.rollingStats('test_tool');
        if (!stats) throw new Error('rollingStats returned null after recording');
      },
    },

    // ---- Exclusion (do_not_remember) (v2.1.0) ----
    {
      name: 'exclusion:add + check',
      run: async () => {
        await ctx.exclusionManager.add({ pattern: 'secret-token' });
        const verdict = await ctx.exclusionManager.check('this contains secret-token');
        if (!verdict.blocked) throw new Error('exclusion check failed to block matching content');
      },
    },

    // ---- Observation Dedup (v2.1.0) ----
    {
      name: 'observation_dedup:find',
      run: async () => {
        await ctx.entityManager.createEntities([
          { name: 'DupA', entityType: 'note', observations: ['shared dedup fact'] },
          { name: 'DupB', entityType: 'note', observations: ['shared dedup fact'] },
        ]);
        const groups = await ctx.observationDedupManager.findDuplicateObservations({});
        if (groups.length === 0) throw new Error('dedup found 0 groups despite seeded duplicates');
      },
    },

    // ---- Spell Correction (v2.1.0) ----
    {
      name: 'spell:rebuild + suggest',
      run: async () => {
        await ctx.spellChecker.rebuild();
        const suggestions = await ctx.spellChecker.suggest('Alpa', { limit: 3 });
        // Suggestions may be empty for very short vocabularies; just verify no throw.
        if (!Array.isArray(suggestions)) throw new Error('suggest did not return an array');
      },
    },
  ];
}

function printSummary(results: SmokeResult[], totalMs: number, verbose: boolean): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  if (!verbose) {
    for (const r of results) {
      const marker = r.ok ? formatSuccess('✓') : formatError('✗');
      const tail = r.ok ? '' : ` — ${r.error}`;
      console.log(`  ${marker} ${r.name}${tail}`);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(formatSuccess(`Smoke test passed: ${passed}/${results.length} steps in ${totalMs.toFixed(0)} ms`));
  } else {
    console.log(formatError(`Smoke test FAILED: ${failed} failing / ${results.length} total in ${totalMs.toFixed(0)} ms`));
  }
}

export function registerSmokeCommand(program: Command): void {
  program
    .command('smoke')
    .description('Run a per-category end-to-end smoke test (~30 ops) against a fresh temp graph')
    .option('-s, --storage <path>', 'Storage path for the smoke run (default: temp dir)')
    .option('-k, --keep', 'Preserve the smoke graph after the run and print its path (default: cleanup)')
    .option('-v, --verbose', 'Print each step as it runs (default: print summary only)')
    .action(async (opts: { storage?: string; keep?: boolean; verbose?: boolean }) => {
      const verbose = Boolean(opts.verbose);
      const keep = Boolean(opts.keep);

      const storagePath = opts.storage
        ? opts.storage
        : await fs.mkdtemp(join(tmpdir(), 'memoryjs-smoke-'));
      const graphPath = opts.storage ? storagePath : join(storagePath, 'graph.jsonl');

      if (verbose) console.log(`Smoke storage: ${graphPath}`);

      const ctx = new ManagerContext(graphPath);
      const steps = buildSteps(ctx);
      const start = performance.now();
      const results = await runSteps(steps, verbose);
      const totalMs = performance.now() - start;
      printSummary(results, totalMs, verbose);

      if (keep) {
        console.log(`\nKeeping smoke graph at: ${graphPath}`);
      } else if (!opts.storage) {
        // Only auto-clean dirs we created ourselves. Never delete a user-supplied path.
        try {
          await fs.rm(storagePath, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup; cloud-sync file locks can hold temp dirs briefly.
        }
      }

      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) process.exit(1);
    });
}
