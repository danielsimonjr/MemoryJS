/**
 * Exclusion CLI Commands — `memory exclude` (Phase 3 do_not_remember).
 *
 * Surfaces `ExclusionManager` add/list/remove for the hand-typed-rule
 * use case ("forget anything that mentions X"). The runtime API
 * (`ctx.exclusionManager`) is the canonical surface; this CLI is the
 * thin convenience wrapper.
 *
 * @module cli/commands/exclusion
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatSuccess, formatError } from '../formatters.js';

export function registerExclusionCommands(program: Command): void {
  const exclude = program
    .command('exclude')
    .description('Manage do_not_remember exclusion rules');

  exclude
    .command('add <pattern>')
    .description('Add an exclusion rule (substring match)')
    .option('--scope <scope>', "Rule scope: 'future-only' | 'past-only' | 'both'", 'both')
    .option('--entity-type <type>', 'Restrict to a single entity type')
    .option('--reason <reason>', 'Free-text justification')
    .action(async (
      pattern: string,
      opts: { scope?: string; entityType?: string; reason?: string },
    ) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      const scope = opts.scope ?? 'both';
      if (scope !== 'future-only' && scope !== 'past-only' && scope !== 'both') {
        logger.error(formatError(
          `exclude add: --scope must be one of future-only | past-only | both; received '${scope}'`,
        ));
        process.exit(1);
      }

      try {
        const rule = await ctx.exclusionManager.add({
          pattern,
          scope,
          entityType: opts.entityType,
          reason: opts.reason,
        });
        logger.info(
          formatSuccess(
            `Added rule ${rule.id}: pattern="${rule.pattern}", scope=${rule.scope}` +
              (rule.deletedCount ? `, deleted ${rule.deletedCount} existing match(es)` : ''),
          ),
        );
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  exclude
    .command('list')
    .description('List all exclusion rules')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const rules = await ctx.exclusionManager.list();
        if (rules.length === 0) {
          logger.info('(no exclusion rules)');
          return;
        }
        for (const r of rules) {
          const parts = [
            r.id,
            `pattern="${r.pattern}"`,
            `scope=${r.scope}`,
            r.entityType ? `entityType=${r.entityType}` : null,
            r.deletedCount ? `deleted=${r.deletedCount}` : null,
            `blocked=${r.blockedCount}`,
            r.reason ? `— ${r.reason}` : null,
          ].filter(Boolean);
          logger.info(parts.join(' | '));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  exclude
    .command('remove <id>')
    .description('Remove an exclusion rule (does NOT restore deleted memories)')
    .action(async (id: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const removed = await ctx.exclusionManager.remove(id);
        if (removed) {
          logger.info(formatSuccess(`Removed rule ${id}`));
        } else {
          logger.error(formatError(`No exclusion rule with id '${id}'`));
          process.exit(1);
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
