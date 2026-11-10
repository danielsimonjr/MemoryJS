/**
 * Interactive CLI Mode (REPL)
 *
 * Provides an interactive shell for exploring the knowledge graph.
 *
 * @module cli/interactive
 */

import * as readline from 'readline';
import { ManagerContext } from '../core/ManagerContext.js';
import type { GlobalOptions } from './options.js';
import { ansi } from './ansi.js';

interface InteractiveContext {
  ctx: ManagerContext;
  options: GlobalOptions;
  history: string[];
}

/**
 * Start the interactive REPL for the knowledge graph.
 *
 * The REPL loads the graph once to seed entity-name completion.
 * The promise stays pending until the user closes the shell.
 *
 * @param options - The global CLI options. `storage` selects the graph file.
 */
export async function startInteractiveMode(options: GlobalOptions): Promise<void> {
  const ctx = new ManagerContext(options.storage);

  const interactiveCtx: InteractiveContext = {
    ctx,
    options,
    history: [],
  };

  // Get entity names for completion
  const graph = await ctx.storage.loadGraph();
  const entityNames = graph.entities.map(e => e.name);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ansi.cyan('memory> '),
    completer: (line: string) => {
      const completions = [
        'entities', 'relations', 'search', 'get', 'stats',
        'tags', 'path', 'observe', 'delete', 'export',
        'help', 'exit', 'clear', 'history',
        ...entityNames,
      ];
      const hits = completions.filter(c => c.toLowerCase().startsWith(line.toLowerCase()));
      return [hits.length ? hits : completions, line];
    },
  });

  console.log(ansi.green('MemoryJS Interactive Mode'));
  console.log(ansi.gray('Type "help" for commands, "exit" to quit.\n'));

  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    interactiveCtx.history.push(trimmed);

    try {
      await processCommand(trimmed, interactiveCtx, rl);
    } catch (error) {
      console.error(ansi.red(`Error: ${(error as Error).message}`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(ansi.gray('\nGoodbye!'));
    process.exit(0);
  });
}

async function processCommand(
  input: string,
  ictx: InteractiveContext,
  rl: readline.Interface
): Promise<void> {
  const [command, ...args] = input.split(/\s+/);
  const ctx = ictx.ctx;

  switch (command.toLowerCase()) {
    case 'help':
    case '.help':
      showHelp();
      break;

    case 'exit':
    case '.exit':
    case 'quit':
      rl.close();
      break;

    case 'clear':
    case '.clear':
      console.clear();
      break;

    case 'entities':
    case 'ls': {
      const graph = await ctx.storage.loadGraph();
      const entities = graph.entities;
      console.log(`\nEntities (${entities.length}):`);
      for (const e of entities.slice(0, 20)) {
        console.log(`  ${ansi.cyan(e.name)} [${e.entityType}]`);
      }
      if (entities.length > 20) {
        console.log(`  ... and ${entities.length - 20} more`);
      }
      break;
    }

    case 'get': {
      const name = args.join(' ');
      if (!name) {
        console.log(ansi.yellow('Usage: get <entity-name>'));
        break;
      }
      const entity = await ctx.entityManager.getEntity(name);
      if (entity) {
        console.log(JSON.stringify(entity, null, 2));
      } else {
        console.log(ansi.yellow(`Entity not found: ${name}`));
      }
      break;
    }

    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.log(ansi.yellow('Usage: search <query>'));
        break;
      }
      const result = await ctx.searchManager.searchNodes(query);
      console.log(`\nSearch results for "${query}":`);
      for (const entity of result.entities.slice(0, 10)) {
        console.log(`  ${ansi.cyan(entity.name)} [${entity.entityType}]`);
        if (entity.observations && entity.observations.length > 0) {
          const preview = entity.observations[0].substring(0, 60);
          console.log(`    ${ansi.gray(preview)}${entity.observations[0].length > 60 ? '...' : ''}`);
        }
      }
      if (result.entities.length > 10) {
        console.log(`  ... and ${result.entities.length - 10} more`);
      }
      break;
    }

    case 'relations': {
      const name = args.join(' ');
      if (!name) {
        console.log(ansi.yellow('Usage: relations <entity-name>'));
        break;
      }
      const relations = await ctx.relationManager.getRelations(name);
      if (relations.length === 0) {
        console.log(ansi.yellow(`No relations found for: ${name}`));
        break;
      }
      console.log(`\nRelations for "${name}":`);
      for (const rel of relations) {
        if (rel.from === name) {
          console.log(`  ${ansi.cyan(name)} --[${rel.relationType}]--> ${rel.to}`);
        } else {
          console.log(`  ${rel.from} --[${rel.relationType}]--> ${ansi.cyan(name)}`);
        }
      }
      break;
    }

    case 'stats': {
      const stats = await ctx.analyticsManager.getGraphStats();
      console.log(`\nKnowledge Graph Statistics:`);
      console.log(`  Entities: ${stats.totalEntities}`);
      console.log(`  Relations: ${stats.totalRelations}`);
      console.log(`  Entity Types: ${Object.keys(stats.entityTypesCounts).length}`);
      console.log(`  Relation Types: ${Object.keys(stats.relationTypesCounts).length}`);
      break;
    }

    case 'tags': {
      const tagName = args.join(' ');
      if (!tagName) {
        console.log(ansi.yellow('Usage: tags <entity-name>'));
        break;
      }
      const tagEntity = await ctx.entityManager.getEntity(tagName);
      if (tagEntity) {
        const tags = tagEntity.tags || [];
        console.log(`\nTags for "${tagName}": ${tags.length > 0 ? tags.join(', ') : 'None'}`);
      } else {
        console.log(ansi.yellow(`Entity not found: ${tagName}`));
      }
      break;
    }

    case 'path': {
      if (args.length < 2) {
        console.log(ansi.yellow('Usage: path <from> <to>'));
        break;
      }
      const [pathFrom, pathTo] = args;
      const pathResult = await ctx.graphTraversal.findShortestPath(pathFrom, pathTo);
      if (pathResult) {
        console.log(`\nPath (${pathResult.length} hops): ${pathResult.path.join(' -> ')}`);
        for (const rel of pathResult.relations) {
          console.log(`  ${rel.from} --[${rel.relationType}]--> ${rel.to}`);
        }
      } else {
        console.log(ansi.yellow(`No path found between "${pathFrom}" and "${pathTo}"`));
      }
      break;
    }

    case 'observe': {
      const obsEntity = args[0];
      const obsText = args.slice(1).join(' ');
      if (!obsEntity || !obsText) {
        console.log(ansi.yellow('Usage: observe <entity> <observation text>'));
        break;
      }
      await ctx.observationManager.addObservations([{
        entityName: obsEntity,
        contents: [obsText],
      }]);
      console.log(ansi.green(`Added observation to ${obsEntity}`));
      break;
    }

    case 'delete': {
      const delName = args.join(' ');
      if (!delName) {
        console.log(ansi.yellow('Usage: delete <entity-name>'));
        break;
      }
      await ctx.entityManager.deleteEntities([delName]);
      console.log(ansi.green(`Deleted entity: ${delName}`));
      break;
    }

    case 'export': {
      const validFormats = ['json', 'csv', 'graphml', 'gexf', 'dot', 'markdown', 'mermaid', 'turtle', 'rdf-xml', 'json-ld'];
      const fmt = args[0] || 'json';
      if (!validFormats.includes(fmt)) {
        console.log(ansi.yellow(`Invalid format: ${fmt}. Use: ${validFormats.join(', ')}`));
        break;
      }
      const exportGraph = await ctx.storage.loadGraph();
      const output = ctx.ioManager.exportGraph(exportGraph, fmt as 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid' | 'turtle' | 'rdf-xml' | 'json-ld');
      console.log(output);
      break;
    }

    case 'history':
      console.log('\nCommand history:');
      ictx.history.slice(-20).forEach((cmd, i) => {
        console.log(`  ${i + 1}. ${cmd}`);
      });
      break;

    case 'show': {
      const name = args.join(' ');
      if (!name) {
        console.log(ansi.yellow('Usage: show <entity-name>'));
        break;
      }
      const { snapshotEntity } = await import('./commands/inspect.js');
      try {
        const snap = await snapshotEntity(ctx, name);
        console.log(JSON.stringify(snap, null, 2));
      } catch (e) {
        console.log(ansi.yellow((e as Error).message));
      }
      break;
    }

    case 'tree': {
      const root = args[0];
      const { buildTree, renderTreeAscii } = await import('./commands/inspect.js');
      try {
        if (root) {
          const t = await buildTree(ctx, root);
          process.stdout.write(renderTreeAscii(t));
        } else {
          const roots = await ctx.hierarchyManager.getRootEntities();
          for (const r of roots) {
            const t = await buildTree(ctx, r.name);
            process.stdout.write(renderTreeAscii(t));
          }
        }
      } catch (e) {
        console.log(ansi.yellow((e as Error).message));
      }
      break;
    }

    case 'neighbors': {
      const name = args.join(' ');
      if (!name) {
        console.log(ansi.yellow('Usage: neighbors <entity-name>'));
        break;
      }
      const { neighbors } = await import('./commands/inspect.js');
      try {
        const report = await neighbors(ctx, name);
        console.log(JSON.stringify(report, null, 2));
      } catch (e) {
        console.log(ansi.yellow((e as Error).message));
      }
      break;
    }

    case 'diag':
    case 'health': {
      // Defer to the same code path the subcommand uses; print summary inline.
      const graph = await ctx.storage.loadGraph();
      const names = new Set(graph.entities.map((e) => e.name));
      const orphans = graph.relations.filter((r) => !names.has(r.from) || !names.has(r.to)).length;
      const dupNames = graph.entities.length - names.size;
      console.log(JSON.stringify({
        entities: graph.entities.length,
        relations: graph.relations.length,
        orphan_relations: orphans,
        duplicate_names: dupNames,
        storage: ictx.options.storage,
      }, null, 2));
      break;
    }

    case 'size': {
      const { buildSizeReport } = await import('./commands/inspect.js');
      const report = await buildSizeReport(ctx, ictx.options.storage);
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    case 'check': {
      const apply = args[0] === '--apply';
      const { detectIssues, applyFixes } = await import('./commands/check.js');
      const { orphans, missing, cycles } = await detectIssues(ctx);
      const ok = orphans.length === 0 && missing.length === 0 && cycles.length === 0;
      const result: Record<string, unknown> = {
        ok, applied: apply, orphanRelations: orphans, missingParents: missing, hierarchyCycles: cycles,
      };
      if (apply && (orphans.length > 0 || missing.length > 0)) {
        result.actions = await applyFixes(ctx, orphans, missing);
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'heuristics': {
      const heuristics = await ctx.heuristicManager.list();
      console.log(JSON.stringify({ heuristics, count: heuristics.length }, null, 2));
      break;
    }

    case 'spell': {
      const query = args.join(' ');
      if (!query) {
        console.log(ansi.yellow('Usage: spell <query>'));
        break;
      }
      const suggestions = await ctx.spellChecker.suggest(query);
      console.log(JSON.stringify({ query, suggestions, count: suggestions.length }, null, 2));
      break;
    }

    case 'cache': {
      const sub = args[0];
      const { getAllCacheStats, clearAllSearchCaches } = await import('../utils/searchCache.js');
      if (sub === 'clear') {
        clearAllSearchCaches();
        console.log(JSON.stringify({ cleared: true }, null, 2));
      } else {
        console.log(JSON.stringify({ stats: getAllCacheStats() }, null, 2));
      }
      break;
    }

    case 'reindex': {
      const t = Date.now();
      await ctx.rankedSearch.buildIndex();
      await ctx.spellChecker.rebuild();
      console.log(JSON.stringify({ ok: true, ranked: 'rebuilt', spell: 'rebuilt', durationMs: Date.now() - t }, null, 2));
      break;
    }

    default:
      console.log(ansi.yellow(`Unknown command: ${command}. Type "help" for available commands.`));
  }
}

function showHelp(): void {
  console.log(`
${ansi.green('Available Commands:')}

  ${ansi.cyan('entities')} / ${ansi.cyan('ls')}    List all entities
  ${ansi.cyan('get <name>')}         Get entity details
  ${ansi.cyan('search <query>')}     Search entities
  ${ansi.cyan('relations <name>')}   Show relations for entity
  ${ansi.cyan('tags <name>')}        Show tags for entity
  ${ansi.cyan('path <from> <to>')}   Find shortest path
  ${ansi.cyan('observe <e> <text>')} Add observation to entity
  ${ansi.cyan('delete <name>')}      Delete entity
  ${ansi.cyan('export [format]')}    Export graph to stdout
  ${ansi.cyan('stats')}              Show graph statistics
  ${ansi.cyan('show <name>')}        Verbose entity snapshot (obs + relations + hierarchy)
  ${ansi.cyan('tree [root]')}        ASCII hierarchy tree (all roots if omitted)
  ${ansi.cyan('neighbors <name>')}   Incoming + outgoing relations + degree counts
  ${ansi.cyan('diag')} / ${ansi.cyan('health')}     Quick integrity summary
  ${ansi.cyan('size')}               Graph + storage footprint
  ${ansi.cyan('check [--apply]')}    Orphan + missing-parent + cycle detect/repair
  ${ansi.cyan('heuristics')}         List all heuristics
  ${ansi.cyan('spell <query>')}      Spell suggestions for a query
  ${ansi.cyan('cache [clear]')}      Search-cache stats; "cache clear" to bust
  ${ansi.cyan('reindex')}            Rebuild ranked-search + spell vocabulary
  ${ansi.cyan('history')}            Show command history
  ${ansi.cyan('clear')}              Clear screen
  ${ansi.cyan('help')}               Show this help
  ${ansi.cyan('exit')}               Exit interactive mode

${ansi.gray('Tab completion available for entity names.')}
`);
}
