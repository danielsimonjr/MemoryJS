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

export {
  WorkingMemoryManager,
  type WorkingMemoryConfig,
  type SessionMemoryFilter,
  type PromotionMarkOptions,
  type PromotionCriteria,
  type PromotionResult,
  type ConfirmationResult,
} from './WorkingMemoryManager.js';

export {
  SessionManager,
  type SessionConfig,
  type StartSessionOptions,
  type SessionHistoryOptions,
  type EndSessionResult,
} from './SessionManager.js';

export {
  SessionQueryBuilder,
  type SessionSearchOptions,
  type EntityWithContext,
  type SearchFunction,
} from './SessionQueryBuilder.js';

export {
  EpisodicMemoryManager,
  EpisodicRelations,
  type EpisodicMemoryConfig,
  type CreateEpisodeOptions,
  type TimelineOptions,
} from './EpisodicMemoryManager.js';

export {
  ConsolidationPipeline,
  type ConsolidationPipelineConfig,
  type PipelineStage,
  type StageResult,
} from './ConsolidationPipeline.js';

export {
  SummarizationService,
  type ISummarizationProvider,
  type SummarizationConfig,
  type GroupingResult,
} from './SummarizationService.js';

export { PatternDetector } from './PatternDetector.js';

export { RuleEvaluator } from './RuleEvaluator.js';

export {
  SalienceEngine,
  type SalienceEngineConfig,
} from './SalienceEngine.js';

export {
  ContextWindowManager,
  type ContextWindowManagerConfig,
  type SpilloverResult,
  type WakeUpOptions,
  type WakeUpResult,
} from './ContextWindowManager.js';

export {
  MemoryFormatter,
  type MemoryFormatterConfig,
} from './MemoryFormatter.js';

export {
  MultiAgentMemoryManager,
  type MultiAgentConfig,
} from './MultiAgentMemoryManager.js';

export {
  ConflictResolver,
  type ConflictResolverConfig,
  type ResolutionResult,
} from './ConflictResolver.js';

export {
  SessionCheckpointManager,
  type SessionCheckpointData,
} from './SessionCheckpoint.js';

export {
  AgentMemoryManager,
  type CreateMemoryOptions,
  type RetrieveContextOptions,
} from './AgentMemoryManager.js';

export {
  CollaborativeSynthesis,
  type CollaborativeSynthesisConfig,
  type SynthesisResult,
} from './CollaborativeSynthesis.js';

export {
  type AgentMemoryConfig,
  loadConfigFromEnv,
  mergeConfig,
  validateConfig,
} from './AgentMemoryConfig.js';

// v1.7.0 Features
export {
  ArtifactManager,
} from './ArtifactManager.js';

export {
  type IDistillationPolicy,
  type DistilledMemory,
  type DistillationConfig,
  NoOpDistillationPolicy,
  DefaultDistillationPolicy,
  CompositeDistillationPolicy,
} from './DistillationPolicy.js';

export {
  DistillationPipeline,
  type DistillationStats,
  type DistillationResult,
} from './DistillationPipeline.js';

export {
  type AgentRole,
  type RoleProfile,
  getRoleProfile,
  listRoleProfiles,
  resolveRoleProfile,
  createCustomProfile,
} from './RoleProfiles.js';

export {
  EntropyFilterStage,
  computeEntropy,
  passesEntropyFilter,
  type EntropyFilterConfig,
  LowEntropyContentError,
} from './EntropyFilter.js';

export {
  FailureDistillation,
  type FailureDistillationResult,
  type FailureDistillationConfig,
} from './FailureDistillation.js';

export {
  CognitiveLoadAnalyzer,
  type CognitiveLoadConfig,
} from './CognitiveLoadAnalyzer.js';

export {
  VisibilityResolver,
} from './VisibilityResolver.js';

export {
  ConsolidationScheduler,
  type ConsolidationSchedulerConfig,
  type ConsolidationCycleResult,
} from './ConsolidationScheduler.js';

export {
  DreamEngine,
  type DreamEngineConfig,
  type DreamPhaseConfig,
  type DreamEngineCallbacks,
  type DreamPhaseResult,
  type DreamCycleResult,
} from './DreamEngine.js';

export {
  ProfileManager,
  type ProfileResponse,
  type ProfileManagerConfig,
  type ProfileOptions,
} from './ProfileManager.js';

export {
  ObserverPipeline,
  type ObservationScore,
  type ObserverPipelineOptions,
  type ObserverPipelineStats,
} from './ObserverPipeline.js';

export {
  WorkThreadManager,
  type WorkThread,
  type WorkThreadStatus,
  type WorkThreadFilter,
  type CreateWorkThreadOptions,
} from './WorkThreadManager.js';

export {
  ContextProfileManager,
  type ContextProfile,
  type ProfileConfig,
} from './ContextProfileManager.js';
