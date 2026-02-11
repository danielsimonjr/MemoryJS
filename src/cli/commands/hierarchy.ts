/**
 * Hierarchy CLI Commands
 *
 * @module cli/commands/hierarchy
 */

import { Command } from 'commander';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatEntities, formatSuccess, formatError } from '../formatters.js';

export function registerHierarchyCommands(program: Command): void {
  const hierarchy = program
    .command('hierarchy')
    .description('Manage entity hierarchy (parent/child relationships)');

  hierarchy
    .command('set-parent <entity> <parent>')
    .description('Set parent of an entity (use "none" to remove)')
    .action(async (entity: string, parent: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const parentVal = parent.toLowerCase() === 'none' ? null : parent;
        await ctx.hierarchyManager.setEntityParent(entity, parentVal);
        if (parentVal) {
          logger.info(formatSuccess(`Set parent of ${entity} to ${parentVal}`));
        } else {
          logger.info(formatSuccess(`Removed parent from ${entity}`));
        }
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  hierarchy
    .command('children <entity>')
    .description('List children of an entity')
    .action(async (entity: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const children = await ctx.hierarchyManager.getChildren(entity);
        console.log(formatEntities(children, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  hierarchy
    .command('ancestors <entity>')
    .description('List ancestors of an entity (parent to root)')
    .action(async (entity: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const ancestors = await ctx.hierarchyManager.getAncestors(entity);
        console.log(formatEntities(ancestors, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  hierarchy
    .command('descendants <entity>')
    .description('List all descendants of an entity')
    .action(async (entity: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const descendants = await ctx.hierarchyManager.getDescendants(entity);
        console.log(formatEntities(descendants, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });

  hierarchy
    .command('roots')
    .description('List root entities (no parent)')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);

      try {
        const roots = await ctx.hierarchyManager.getRootEntities();
        console.log(formatEntities(roots, options.format));
      } catch (error) {
        logger.error(formatError((error as Error).message));
        process.exit(1);
      }
    });
}
