/**
 * Recursa knowledge layer (RS-5): `InstructionSetManager`, the
 * `KnowledgeRepository` snapshot / revision store, and their digest helpers.
 * Barrel for `src/agent/knowledge/`.
 */
export {
  InstructionSetManager,
  instructionItemsFor,
  renderInstructionItems,
  buildInstructionSetEntity,
  type InstructionPatchResult,
  type InstructionHistorySource,
  type InstructionSetManagerOptions,
  type InstructionItem,
} from './InstructionSetManager.js';
export {
  KnowledgeRepository,
  type SkillMatchLike,
  type SkillManagerLike,
  type FailureLookupLike,
  type KnowledgeRepositoryOptions,
  type ApplyResult,
  type RollbackResult,
  type LoadForContextOptions,
  type LoadedKnowledge,
} from './KnowledgeRepository.js';
export {
  compareIds,
  canonicalKnowledgeJson,
  clone,
  digestOf,
  slugify,
  shortId,
  fitInOrder,
  assertBudgetTokens,
  idDelta,
  diffSnapshots,
  type IdDelta,
  type KnowledgeDiff,
} from './knowledgeDigest.js';
export {
  workFrom,
  safeApplyOp,
  applyOp,
  planWrites,
  type PlannedWrite,
  type WorkState,
} from './knowledgeRevision.js';
