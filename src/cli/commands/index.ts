/**
 * CLI Command Registry
 *
 * Registers all command categories with the main program.
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import { registerEntityCommands } from './entity.js';
import { registerRelationCommands } from './relation.js';
import { registerSearchCommands } from './search.js';
import { registerObservationCommands } from './observation.js';
import { registerTagCommands } from './tag.js';
import { registerHierarchyCommands } from './hierarchy.js';
import { registerGraphCommands } from './graph.js';
import { registerIOCommands } from './io.js';
import { registerMaintenanceCommands } from './maintenance.js';

export function registerCommands(program: Command): void {
  registerEntityCommands(program);
  registerRelationCommands(program);
  registerSearchCommands(program);
  registerObservationCommands(program);
  registerTagCommands(program);
  registerHierarchyCommands(program);
  registerGraphCommands(program);
  registerIOCommands(program);
  registerMaintenanceCommands(program);
}
