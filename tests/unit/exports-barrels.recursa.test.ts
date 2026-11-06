/**
 * Recursa and legacy-migration barrel exports (split from exports-barrels.test.ts).
 *
 * Runtime names must be reachable from src/agent/index.ts and the package root;
 * type-only names are imported with `import type` so a missing one breaks
 * `bun run typecheck`.
 */

import { describe, it, expect } from 'vitest';
import * as root from '../../src/index.js';
import * as agent from '../../src/agent/index.js';
import type {
  SkillContextOptions,
  ImportReport,
  ImportConflict,
  PublishResult,
  PublishOptions,
  AddSkillInput,
  SkillMatch,
  SkillPatch,
  SkillOutcome,
  ParsedSkillDocument,
  SkillParseResult,
  SkillPublishMarker,
  ConfinedRead,
  KnowledgeDiff,
  IdDelta,
  ApplyResult,
  RollbackResult,
  LoadForContextOptions,
  LoadedKnowledge,
  KnowledgeRepositoryOptions,
  InstructionSetManagerOptions,
  InstructionItem,
  InstructionPatchResult,
  PlannedWrite,
  WorkState,
} from '../../src/agent/index.js';

// Compile-time proof that the Recursa Phase 1 type-only names resolve from the agent barrel.
type RecursaTypeProbes = [
  SkillContextOptions,
  ImportReport,
  ImportConflict,
  PublishResult,
  PublishOptions,
  AddSkillInput,
  SkillMatch,
  SkillPatch,
  SkillOutcome,
  ParsedSkillDocument,
  SkillParseResult,
  SkillPublishMarker,
  ConfinedRead,
  KnowledgeDiff,
  IdDelta,
  ApplyResult,
  RollbackResult,
  LoadForContextOptions,
  LoadedKnowledge,
  KnowledgeRepositoryOptions,
  InstructionSetManagerOptions,
  InstructionItem,
  InstructionPatchResult,
  PlannedWrite,
  WorkState,
];
const recursaTypeProbes: RecursaTypeProbes | undefined = undefined;

describe('Recursa Phase 1D agent and root barrel exports', () => {
  const runtimeNames = [
    'SkillManager',
    'SkillPublisher',
    'SKILL_MARKER_FILE',
    'SKILL_FRONT_MATTER_KEYS',
    'SKILL_KIND_VALUES',
    'loadOptionalYaml',
    'serializeSkillMarkdown',
    'parseSkillMarkdown',
    'skillContentHash',
    'renderSkillSection',
    'fitSkillSectionToBudget',
    'skillDedupHash',
    'mintSkillId',
    'skillObservations',
    'recoverPublishedTree',
    'removeBestEffort',
    'pathExists',
    'readConfinedSkillFile',
    'InstructionSetManager',
    'instructionItemsFor',
    'renderInstructionItems',
    'buildInstructionSetEntity',
    'KnowledgeRepository',
    'compareIds',
    'canonicalKnowledgeJson',
    'clone',
    'digestOf',
    'slugify',
    'shortId',
    'fitInOrder',
    'assertBudgetTokens',
    'idDelta',
    'diffSnapshots',
    'workFrom',
    'safeApplyOp',
    'applyOp',
    'planWrites',
  ] as const;

  it('every Recursa Phase 1 symbol is reachable from src/agent/index.ts and the package root', () => {
    for (const name of runtimeNames) {
      expect(agent as Record<string, unknown>, `agent barrel: ${name}`).toHaveProperty(name);
      expect(root as Record<string, unknown>, `root barrel: ${name}`).toHaveProperty(name);
    }
    expect(root.SkillManager).toBe(agent.SkillManager);
    expect(root.KnowledgeRepository).toBe(agent.KnowledgeRepository);
    expect(recursaTypeProbes).toBeUndefined();
  });
});

// Recursa Phase 4 (leaf learner) barrel: src/agent/learning/index.ts, re-exported from src/agent/index.ts.
import type {
  DiagnoserLike,
  KnowledgeEditorLike,
  LeafCallContext,
  LeafLearnerOptions,
  LeafStartOptions,
  LearningDeps,
  LearningLoadedKnowledge,
  LearningReport,
  LearningSolver,
  LearningTrace as LearningTraceType,
  StepRequest,
  TraceTree,
  ValidationPlan,
  ValidationVerdictResult,
  LeafLearnerDeps,
} from '../../src/agent/index.js';

type LearningTypeProbes = [
  DiagnoserLike,
  KnowledgeEditorLike,
  LeafCallContext,
  LeafLearnerOptions,
  LeafStartOptions,
  LearningDeps,
  LearningLoadedKnowledge,
  LearningReport,
  LearningSolver,
  LearningTraceType,
  StepRequest,
  TraceTree,
  ValidationPlan,
  ValidationVerdictResult,
  LeafLearnerDeps,
];
const learningTypeProbes: LearningTypeProbes | undefined = undefined;

describe('Recursa Phase 4 learning barrel exports', () => {
  const runtimeNames = [
    'LeafLearner',
    'Diagnoser',
    'KnowledgeEditor',
    'RevisionValidator',
    'planValidation',
    'decideValidation',
    'LearningTrace',
    'LearningAccountant',
    'createLeafLearnerDeps',
  ] as const;

  it('exports the leaf-learner public surface from src/agent/index.ts and the package root', () => {
    for (const name of runtimeNames) {
      expect(agent as Record<string, unknown>, `agent barrel: ${name}`).toHaveProperty(name);
      expect(root as Record<string, unknown>, `root barrel: ${name}`).toHaveProperty(name);
    }
    expect(root.LeafLearner).toBe(agent.LeafLearner);
    expect(learningTypeProbes).toBeUndefined();
  });

  it('keeps internal leaf-learner plumbing out of the barrel', () => {
    for (const name of ['submitRoundSolve', 'serializeRun', 'capAnswer', 'ANSWER_CAP_BYTES', 'loadRun', 'beginRound']) {
      expect(agent as Record<string, unknown>, `agent barrel must not export ${name}`).not.toHaveProperty(name);
    }
  });
});

describe('Recursa Phase 5 learner and bootstrap barrel exports', () => {
  const runtimeNames = [
    'split',
    'isPartition',
    'RevisionMerger',
    'RecursiveLearner',
    'LearningReflector',
    'MAX_KEY_INSIGHTS',
    'createInProcessLearnHandler',
    'DEFAULT_CHILD_CONCURRENCY',
    'Bootstrapper',
    'CorpusMapper',
    'BoundaryRecorder',
    'ExplorationNotes',
    'PracticeTaskGenerator',
    'DEFAULT_TASK_COUNT',
    'defaultPartitioner',
    'skillNameFor',
  ] as const;

  it('exports the Phase 5 public surface from src/agent/index.ts and the package root', () => {
    for (const name of runtimeNames) {
      expect(agent as Record<string, unknown>, `agent barrel: ${name}`).toHaveProperty(name);
      expect(root as Record<string, unknown>, `root barrel: ${name}`).toHaveProperty(name);
    }
    expect(root.RecursiveLearner).toBe(agent.RecursiveLearner);
    expect(root.Bootstrapper).toBe(agent.Bootstrapper);
  });

  it('keeps Phase 5 internal helpers out of the barrel', () => {
    for (const name of ['bootstrapShared', 'buildMemoryEntity', 'assertPartition', 'KeyedMutex', 'validateAndApplyMerge', 'loadRecursive', 'ChildKnowledgeOverlay', 'shortHash']) {
      expect(agent as Record<string, unknown>, `agent barrel must not export ${name}`).not.toHaveProperty(name);
    }
  });
});

describe('Legacy migration barrel exports', () => {
  it('exports migrateLegacyProcedures from src/agent/index.ts and the package root', () => {
    expect(agent as Record<string, unknown>).toHaveProperty('migrateLegacyProcedures');
    expect(root as Record<string, unknown>).toHaveProperty('migrateLegacyProcedures');
    expect(root.migrateLegacyProcedures).toBe(agent.migrateLegacyProcedures);
    expect(typeof agent.migrateLegacyProcedures).toBe('function');
  });
});
