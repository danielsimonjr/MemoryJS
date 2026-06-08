/**
 * Project Context CLI Commands — `memory project-context` (Phase 3 Type 2).
 *
 * Thin wrapper around `ctx.projectContextManager` for hand-typed
 * project knowledge ("the test command is X", "we use Y convention").
 *
 * @module cli/commands/projectContext
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError } from '../formatters.js';

export function registerProjectContextCommands(program: Command): void {
  const pc = program
    .command('project-context')
    .description('Manage structured per-project knowledge (facts/conventions/commands/glossary)');

  pc
    .command('show <projectId>')
    .description('Show the project-context record as rendered prose')
    .action(async (projectId: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const prose = await ctx.projectContextManager.forContext(projectId);
        if (prose === '') {
          logger.info(`(no project-context record for '${projectId}')`);
          return;
        }
        logger.info(prose);
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  pc
    .command('append-fact <projectId> <fact>')
    .description('Append a fact to the project context (dedups)')
    .action(async (projectId: string, fact: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        await ctx.projectContextManager.appendFact(projectId, fact);
        logger.info(formatSuccess(`${projectId}: appended fact`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  pc
    .command('append-convention <projectId> <convention>')
    .description('Append a convention to the project context (dedups)')
    .action(async (projectId: string, convention: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        await ctx.projectContextManager.appendConvention(projectId, convention);
        logger.info(formatSuccess(`${projectId}: appended convention`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  pc
    .command('append-command <projectId>')
    .description('Append a documented project command')
    .requiredOption('--name <name>', 'Command short name (e.g. "test")')
    .requiredOption('--command <command>', 'Command line (e.g. "npm test")')
    .requiredOption('--purpose <purpose>', 'What the command does')
    .action(async (projectId: string, opts: { name: string; command: string; purpose: string }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        await ctx.projectContextManager.appendCommand(projectId, {
          name: opts.name,
          command: opts.command,
          purpose: opts.purpose,
        });
        logger.info(formatSuccess(`${projectId}: appended command '${opts.name}'`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  pc
    .command('append-glossary <projectId>')
    .description('Append a glossary term to the project context')
    .requiredOption('--term <term>', 'Domain term')
    .requiredOption('--definition <definition>', 'Term definition')
    .action(async (projectId: string, opts: { term: string; definition: string }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        await ctx.projectContextManager.appendGlossaryTerm(projectId, {
          term: opts.term,
          definition: opts.definition,
        });
        logger.info(formatSuccess(`${projectId}: appended glossary term '${opts.term}'`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  pc
    .command('clear <projectId>')
    .description('Wipe all four arrays (facts/conventions/commands/glossary) — keeps the entity')
    .action(async (projectId: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const cleared = await ctx.projectContextManager.clear(projectId);
        if (cleared) {
          logger.info(formatSuccess(`${projectId}: cleared`));
        } else {
          logger.error(formatError(`No project-context record for '${projectId}'`));
          process.exit(1);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
