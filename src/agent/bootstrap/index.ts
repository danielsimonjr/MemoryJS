/**
 * Recursa Phase 5 bootstrapping public surface (spec section 3.7, batch 5C): the corpus mapper,
 * boundary recorder, exploration notes, practice-task generator and the `Bootstrapper` that composes
 * them. Shared helpers in `bootstrapShared` are internal and not re-exported.
 *
 * @module agent/bootstrap
 * @experimental Recursa Phase 5 (bootstrapping).
 */

export { Bootstrapper } from './Bootstrapper.js';
export type { BootstrapLearner, BootstrapperDeps, BootstrapResult, BootstrapRunInput } from './Bootstrapper.js';
export { CorpusMapper, LOCATED_AT_RELATION, DEFAULT_SHARD_SIZE, DEFAULT_MAP_CONCURRENCY, defaultPartitioner, navigationLeafName, sourceEntityName, MAX_REF_CHARS } from './CorpusMapper.js';
export type { CorpusMapOptions, CorpusMapperDeps, CorpusSource, NavigationMap, Partitioner } from './CorpusMapper.js';
export { BoundaryRecorder, DEFAULT_COVERAGE_BUDGET_TOKENS, coverageEntityName, summarizeCoverage } from './BoundaryRecorder.js';
export type { BoundaryRecorderDeps, ExpectedRegion, RecordCoverageInput } from './BoundaryRecorder.js';
export { ExplorationNotes, skillNameFor } from './ExplorationNotes.js';
export type { ExplorationNotesDeps, ExplorationSkillOps, NotesBullet, WriteNotesInput } from './ExplorationNotes.js';
export { PracticeTaskGenerator, DEFAULT_TASK_COUNT } from './PracticeTaskGenerator.js';
export type { GeneratedTasks, GenerateTasksInput, PracticeTaskGeneratorDeps, TaskSourceLike } from './PracticeTaskGenerator.js';
