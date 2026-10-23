/**
 * Hierarchy CLI Commands
 *
 * @module cli/commands/hierarchy
 */

import { Command } from 'commander';
import { runAction } from './helpers.js';
import { formatEntities, formatSuccess } from '../formatters.js';

/**
 * Register the `hierarchy` command group: `set-parent`, `children`, `ancestors`, `descendants` and `roots`.
 *
 * @param program - The root Commander program that receives the commands.
 */
export function registerHierarchyCommands(program: Command): void {
  const hierarchy = program
    .command('hierarchy')
    .description('Manage entity hierarchy (parent/child relationships)');

  hierarchy
    .command('set-parent <entity> <parent>')
    .description('Set parent of an entity (use "none" to remove)')
    .action(runAction(program, async (ctx, _options, logger, entity: string, parent: string) => {
      const parentVal = parent.toLowerCase() === 'none' ? null : parent;
      await ctx.hierarchyManager.setEntityParent(entity, parentVal);
      if (parentVal) {
        logger.info(formatSuccess(`Set parent of ${entity} to ${parentVal}`));
      } else {
        logger.info(formatSuccess(`Removed parent from ${entity}`));
      }
    }));

  hierarchy
    .command('children <entity>')
    .description('List children of an entity')
    .action(runAction(program, async (ctx, options, logger, entity: string) => {
      const children = await ctx.hierarchyManager.getChildren(entity);
      logger.log(formatEntities(children, options.format));
    }));

  hierarchy
    .command('ancestors <entity>')
    .description('List ancestors of an entity (parent to root)')
    .action(runAction(program, async (ctx, options, logger, entity: string) => {
      const ancestors = await ctx.hierarchyManager.getAncestors(entity);
      logger.log(formatEntities(ancestors, options.format));
    }));

  hierarchy
    .command('descendants <entity>')
    .description('List all descendants of an entity')
    .action(runAction(program, async (ctx, options, logger, entity: string) => {
      const descendants = await ctx.hierarchyManager.getDescendants(entity);
      logger.log(formatEntities(descendants, options.format));
    }));

  hierarchy
    .command('roots')
    .description('List root entities (no parent)')
    .action(runAction(program, async (ctx, options, logger) => {
      const roots = await ctx.hierarchyManager.getRootEntities();
      logger.log(formatEntities(roots, options.format));
    }));
}
