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
import { registerExclusionCommands } from './exclusion.js';
import { registerDecisionCommands } from './decision.js';
import { registerProjectContextCommands } from './projectContext.js';
import { registerToolAffordanceCommands } from './toolAffordance.js';
import { registerSmokeCommand } from './smoke.js';
import { registerDiagCommand } from './diag.js';
import { registerInspectCommands } from './inspect.js';
import { registerHeuristicCommands } from './heuristic.js';
import { registerObservationDedupCommands } from './observationDedup.js';
import { registerSpellCommands } from './spell.js';
import { registerCheckCommand } from './check.js';
import { registerCacheCommands } from './cache.js';
import { registerReindexCommand } from './reindex.js';

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
  registerExclusionCommands(program);
  registerDecisionCommands(program);
  registerProjectContextCommands(program);
  registerToolAffordanceCommands(program);
  registerSmokeCommand(program);
  registerDiagCommand(program);
  registerInspectCommands(program);
  registerHeuristicCommands(program);
  registerObservationDedupCommands(program);
  registerSpellCommands(program);
  registerCheckCommand(program);
  registerCacheCommands(program);
  registerReindexCommand(program);
}
