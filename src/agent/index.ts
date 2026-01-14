/**
 * Agent Module - Barrel Export
 *
 * Central export point for agent memory management components.
 *
 * @module agent
 */

export {
  AccessTracker,
  type AccessStats,
  type AccessTrackerConfig,
  type AccessContext,
} from './AccessTracker.js';

export {
  DecayEngine,
  type DecayEngineConfig,
  type DecayOperationOptions,
  type ReinforcementOptions,
  type DecayResult,
  type ForgetOptions,
  type ForgetResult,
} from './DecayEngine.js';

export {
  DecayScheduler,
  type DecaySchedulerConfig,
  type DecayCycleResult,
} from './DecayScheduler.js';
