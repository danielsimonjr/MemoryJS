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
import chalk from 'chalk';

interface InteractiveContext {
  ctx: ManagerContext;
  options: GlobalOptions;
  history: string[];
}

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
    prompt: chalk.cyan('memory> '),
    completer: (line: string) => {
      const completions = [
        'entities', 'relations', 'search', 'get', 'stats',
        'help', 'exit', 'clear', 'history',
        ...entityNames,
      ];
      const hits = completions.filter(c => c.toLowerCase().startsWith(line.toLowerCase()));
      return [hits.length ? hits : completions, line];
    },
  });

  console.log(chalk.green('MemoryJS Interactive Mode'));
  console.log(chalk.gray('Type "help" for commands, "exit" to quit.\n'));

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
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.gray('\nGoodbye!'));
    process.exit(0);
  });
}

async function processCommand(
  input: string,
  ctx: InteractiveContext,
  rl: readline.Interface
): Promise<void> {
  const [command, ...args] = input.split(/\s+/);

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
      const graph = await ctx.ctx.storage.loadGraph();
      const entities = graph.entities;
      console.log(`\nEntities (${entities.length}):`);
      for (const e of entities.slice(0, 20)) {
        console.log(`  ${chalk.cyan(e.name)} [${e.entityType}]`);
      }
      if (entities.length > 20) {
        console.log(`  ... and ${entities.length - 20} more`);
      }
      break;
    }

    case 'get': {
      const name = args.join(' ');
      if (!name) {
        console.log(chalk.yellow('Usage: get <entity-name>'));
        break;
      }
      const entity = await ctx.ctx.entityManager.getEntity(name);
      if (entity) {
        console.log(JSON.stringify(entity, null, 2));
      } else {
        console.log(chalk.yellow(`Entity not found: ${name}`));
      }
      break;
    }

    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.log(chalk.yellow('Usage: search <query>'));
        break;
      }
      const result = await ctx.ctx.searchManager.searchNodes(query);
      console.log(`\nSearch results for "${query}":`);
      for (const entity of result.entities.slice(0, 10)) {
        console.log(`  ${chalk.cyan(entity.name)} [${entity.entityType}]`);
        if (entity.observations && entity.observations.length > 0) {
          const preview = entity.observations[0].substring(0, 60);
          console.log(`    ${chalk.gray(preview)}${entity.observations[0].length > 60 ? '...' : ''}`);
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
        console.log(chalk.yellow('Usage: relations <entity-name>'));
        break;
      }
      const relations = await ctx.ctx.relationManager.getRelations(name);
      if (relations.length === 0) {
        console.log(chalk.yellow(`No relations found for: ${name}`));
        break;
      }
      console.log(`\nRelations for "${name}":`);
      for (const rel of relations) {
        if (rel.from === name) {
          console.log(`  ${chalk.cyan(name)} --[${rel.relationType}]--> ${rel.to}`);
        } else {
          console.log(`  ${rel.from} --[${rel.relationType}]--> ${chalk.cyan(name)}`);
        }
      }
      break;
    }

    case 'stats': {
      const stats = await ctx.ctx.analyticsManager.getGraphStats();
      console.log(`\nKnowledge Graph Statistics:`);
      console.log(`  Entities: ${stats.totalEntities}`);
      console.log(`  Relations: ${stats.totalRelations}`);
      console.log(`  Entity Types: ${Object.keys(stats.entityTypesCounts).length}`);
      console.log(`  Relation Types: ${Object.keys(stats.relationTypesCounts).length}`);
      break;
    }

    case 'history':
      console.log('\nCommand history:');
      ctx.history.slice(-20).forEach((cmd, i) => {
        console.log(`  ${i + 1}. ${cmd}`);
      });
      break;

    default:
      console.log(chalk.yellow(`Unknown command: ${command}. Type "help" for available commands.`));
  }
}

function showHelp(): void {
  console.log(`
${chalk.green('Available Commands:')}

  ${chalk.cyan('entities')} / ${chalk.cyan('ls')}    List all entities
  ${chalk.cyan('get <name>')}         Get entity details
  ${chalk.cyan('search <query>')}     Search entities
  ${chalk.cyan('relations <name>')}   Show relations for entity
  ${chalk.cyan('stats')}              Show graph statistics
  ${chalk.cyan('history')}            Show command history
  ${chalk.cyan('clear')}              Clear screen
  ${chalk.cyan('help')}               Show this help
  ${chalk.cyan('exit')}               Exit interactive mode

${chalk.gray('Tab completion available for entity names.')}
`);
}
