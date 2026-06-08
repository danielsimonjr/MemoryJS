/**
 * Decision CLI Commands — `memory decision` (Phase 3 Decision Rationale).
 *
 * Thin wrapper around `ctx.decisionManager` for the hand-typed ADR use
 * case ("did we decide to use X?"). The runtime API stays canonical.
 *
 * @module cli/commands/decision
 */

import { readFileSync, writeFileSync } from 'fs';
import { Command } from 'commander';
import { DecisionManager } from '../../agent/DecisionManager.js';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError } from '../formatters.js';

export function registerDecisionCommands(program: Command): void {
  const decision = program
    .command('decision')
    .description('Manage decision-rationale records (ADR-equivalent)');

  decision
    .command('propose')
    .description('Propose a new decision')
    .requiredOption('--context <text>', 'Problem-space description')
    .requiredOption('--decision <text>', 'The chosen path')
    .option('--alternative <text...>', 'Alternative options considered', [])
    .option('--consequence <text...>', 'Anticipated consequences', [])
    .option('--supersedes <id>', 'Backward link to a prior decision')
    .action(async (opts: {
      context: string;
      decision: string;
      alternative?: string[];
      consequence?: string[];
      supersedes?: string;
    }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const rec = await ctx.decisionManager.propose({
          context: opts.context,
          decision: opts.decision,
          alternatives: opts.alternative ?? [],
          consequences: opts.consequence ?? [],
          supersedes: opts.supersedes as ReturnType<() => never> | undefined,
        });
        logger.info(formatSuccess(`Proposed ${rec.id}: ${rec.decision}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('accept <id>')
    .description('Accept a proposed decision')
    .action(async (id: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.decisionManager.accept(id);
        if (result === 'accepted' || result === 'already-accepted') {
          logger.info(formatSuccess(`${id}: ${result}`));
        } else {
          logger.error(formatError(`${id}: ${result}`));
          process.exit(1);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('reject <id>')
    .description('Reject a proposed decision')
    .requiredOption('--reason <text>', 'Why the decision is being rejected')
    .action(async (id: string, opts: { reason: string }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.decisionManager.reject(id, opts.reason);
        if (result === 'rejected' || result === 'already-rejected') {
          logger.info(formatSuccess(`${id}: ${result}`));
        } else {
          logger.error(formatError(`${id}: ${result}`));
          process.exit(1);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('supersede <id> <by>')
    .description('Mark an accepted decision as superseded by another')
    .action(async (id: string, by: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const result = await ctx.decisionManager.supersede(
          id,
          by as ReturnType<() => never>,
        );
        if (result === 'superseded') {
          logger.info(formatSuccess(`${id}: superseded by ${by}`));
        } else {
          logger.error(formatError(`${id}: ${result}`));
          process.exit(1);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('list')
    .description('List decisions, optionally filtered by status')
    .option('--status <status>', "Filter: 'proposed' | 'accepted' | 'rejected' | 'superseded'")
    .action(async (opts: { status?: string }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const recs = await ctx.decisionManager.list(
          opts.status ? { status: opts.status as 'proposed' } : {},
        );
        if (recs.length === 0) {
          logger.info('(no decisions)');
          return;
        }
        for (const r of recs) {
          logger.info(`${r.id} | ${r.status} | ${r.decision}`);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('find <query>')
    .description('Find decisions whose context/decision/consequences match a substring')
    .action(async (query: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const matches = await ctx.decisionManager.findByContext(query);
        if (matches.length === 0) {
          logger.info(`(no decisions matching "${query}")`);
          return;
        }
        for (const r of matches) {
          logger.info(`${r.id} | ${r.status} | ${r.decision}`);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('export <id>')
    .description('Render a decision as ADR-format markdown')
    .option('--out <path>', 'Write to a file instead of stdout')
    .action(async (id: string, opts: { out?: string }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const md = ctx.decisionManager.exportAsAdrMarkdown(id);
        if (opts.out) {
          writeFileSync(opts.out, md, 'utf8');
          logger.info(formatSuccess(`Wrote ${opts.out}`));
        } else {
          logger.info(md);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  decision
    .command('import <path>')
    .description('Parse an ADR markdown file and propose it as a decision')
    .action(async (path: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const text = readFileSync(path, 'utf8');
        const input = DecisionManager.parseAdrMarkdown(text);
        if (!input) {
          logger.error(formatError(
            `${path}: required ## Context or ## Decision sections missing`,
          ));
          process.exit(1);
        }
        const rec = await ctx.decisionManager.propose(input);
        logger.info(formatSuccess(`Imported ${path} → ${rec.id}`));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
