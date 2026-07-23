/**
 * Procedural Memory Module — Barrel Export (3B.4)
 *
 * @module agent/procedural
 */

export {
  ProcedureManager,
  type ProcedureManagerConfig,
  type InvocationResult,
} from './ProcedureManager.js';
export {
  ProcedureStore,
  decodeProcedure,
  migrateLegacyProcedures,
  stepEntityName,
  fallbackEntityName,
  PROCEDURE_ENTITY_TYPE,
  PROCEDURE_STEP_ENTITY_TYPE,
  HAS_STEP_RELATION,
  PRECEDES_RELATION,
  HAS_FALLBACK_RELATION,
} from './ProcedureStore.js';
export { StepSequencer } from './StepSequencer.js';
