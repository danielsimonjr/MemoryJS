/**
 * CMP-4: barrel exports for types returned by public ManagerContext getters.
 *
 * Each symbol added to src/core/index.ts, src/search/index.ts and
 * src/utils/index.ts must be importable from its barrel (runtime values) and
 * reachable from the package root. Type-only names are imported with
 * `import type` so a missing type breaks `bun run typecheck` on src.
 */

import { describe, it, expect } from 'vitest';
import * as core from '../../src/core/index.js';
import * as search from '../../src/search/index.js';
import * as utils from '../../src/utils/index.js';
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
import {
  ObservationStore,
  EntityStateMachine,
  IllegalStatusTransitionError,
  DEFAULT_ENTITY_STATUS,
  canTransition,
  effectiveStatus,
} from '../../src/core/index.js';
import {
  MaterializedViewsManager,
  BloomFilter,
  BloomPreScreener,
  PartialIndexAdvisor,
  formatQueryPlanAscii,
  TieredIndex,
  buildTieredIndex,
  LRUHotTier,
  DiskWarmTier,
  BrotliColdTier,
} from '../../src/search/index.js';
import {
  CachePressureCoordinator,
  IndexHealthMonitor,
  CompressedMap,
  ZlibCompressionAdapter,
} from '../../src/utils/index.js';
import type { ObservationStoreStats, ProceduralGraphConfig } from '../../src/core/index.js';
import type { ProceduralGraphConfig as RootProceduralGraphConfig } from '../../src/index.js';
import type {
  ViewDefinition,
  ViewSnapshot,
  BloomPreScreenerOptions,
  FilterObservation,
  IndexRecommendation,
  PartialIndexAdvisorOptions,
  ExplainPlanResult,
  TieredIndexOptions,
  TieredIndexBuildOptions,
  ITieredIndex,
  IIndexTier,
  TierAccessStats,
  LRUHotTierOptions,
  DiskWarmTierOptions,
  BrotliColdTierOptions,
} from '../../src/search/index.js';
import type {
  PressureAwareCache,
  CachePressureSnapshot,
  DiagnosticsReport,
  TieredIndexStatsSnapshot,
  IndexHealthReport,
  IndexHealthSources,
  IndexHealthSnapshot,
  IIndexHealth,
  CompressedMapOptions,
  ICompressionAdapter,
} from '../../src/utils/index.js';

// Compile-time proof that the type-only names resolve from their barrels.
type ExportedTypeProbes = [
  ObservationStoreStats,
  ProceduralGraphConfig,
  RootProceduralGraphConfig,
  ViewDefinition,
  ViewSnapshot,
  BloomPreScreenerOptions,
  FilterObservation,
  IndexRecommendation,
  PartialIndexAdvisorOptions,
  ExplainPlanResult,
  TieredIndexOptions<unknown>,
  TieredIndexBuildOptions<unknown>,
  ITieredIndex<string, unknown>,
  IIndexTier<string, unknown>,
  TierAccessStats,
  LRUHotTierOptions<string, unknown>,
  DiskWarmTierOptions<unknown>,
  BrotliColdTierOptions,
  PressureAwareCache,
  CachePressureSnapshot,
  DiagnosticsReport,
  TieredIndexStatsSnapshot,
  IndexHealthReport,
  IndexHealthSources,
  IndexHealthSnapshot,
  IIndexHealth,
  CompressedMapOptions<unknown>,
  ICompressionAdapter,
];
const typeProbes: ExportedTypeProbes | undefined = undefined;

describe('CMP-4 barrel exports', () => {
  it('core barrel exports ObservationStore and EntityStateMachine family', () => {
    expect(typeof ObservationStore).toBe('function');
    expect(typeof EntityStateMachine).toBe('function');
    expect(typeof IllegalStatusTransitionError).toBe('function');
    expect(DEFAULT_ENTITY_STATUS).toBe('published');
    expect(typeof canTransition).toBe('function');
    expect(typeof effectiveStatus).toBe('function');
    expect(core.ObservationStore).toBe(ObservationStore);
    expect(core.EntityStateMachine).toBe(EntityStateMachine);
  });

  it('search barrel exports the public getter return types', () => {
    expect(typeof MaterializedViewsManager).toBe('function');
    expect(typeof BloomFilter).toBe('function');
    expect(typeof BloomPreScreener).toBe('function');
    expect(typeof PartialIndexAdvisor).toBe('function');
    expect(typeof formatQueryPlanAscii).toBe('function');
    expect(typeof TieredIndex).toBe('function');
    expect(typeof buildTieredIndex).toBe('function');
    expect(typeof LRUHotTier).toBe('function');
    expect(typeof DiskWarmTier).toBe('function');
    expect(typeof BrotliColdTier).toBe('function');
    expect(search.TieredIndex).toBe(TieredIndex);
    expect(search.PartialIndexAdvisor).toBe(PartialIndexAdvisor);
  });

  it('utils barrel exports the monitor, pressure, compressed-map and adapter types', () => {
    expect(typeof CachePressureCoordinator).toBe('function');
    expect(typeof IndexHealthMonitor).toBe('function');
    expect(typeof CompressedMap).toBe('function');
    expect(typeof ZlibCompressionAdapter).toBe('function');
    expect(utils.IndexHealthMonitor).toBe(IndexHealthMonitor);
    expect(utils.CompressedMap).toBe(CompressedMap);
  });

  it('every newly exported runtime symbol is reachable from the package root', () => {
    const names = [
      'ObservationStore',
      'EntityStateMachine',
      'IllegalStatusTransitionError',
      'DEFAULT_ENTITY_STATUS',
      'canTransition',
      'effectiveStatus',
      'MaterializedViewsManager',
      'BloomFilter',
      'BloomPreScreener',
      'PartialIndexAdvisor',
      'formatQueryPlanAscii',
      'TieredIndex',
      'buildTieredIndex',
      'LRUHotTier',
      'DiskWarmTier',
      'BrotliColdTier',
      'CachePressureCoordinator',
      'IndexHealthMonitor',
      'CompressedMap',
      'ZlibCompressionAdapter',
    ] as const;
    for (const name of names) {
      expect(root as Record<string, unknown>, name).toHaveProperty(name);
    }
  });

  it('does not remove previously exported symbols', () => {
    expect(core).toHaveProperty('GraphStorage');
    expect(core).toHaveProperty('ManagerContext');
    expect(search).toHaveProperty('SearchManager');
    expect(utils).toHaveProperty('logger');
    expect(typeProbes).toBeUndefined();
  });
});

describe('DES-1 storage capability barrel exports', () => {
  it('core barrel and package root export hasDeltaPrimitives and withStorageWriteLock', () => {
    expect(typeof core.hasDeltaPrimitives).toBe('function');
    expect(typeof core.withStorageWriteLock).toBe('function');
    expect(root.hasDeltaPrimitives).toBe(core.hasDeltaPrimitives);
    expect(root.withStorageWriteLock).toBe(core.withStorageWriteLock);
  });
});

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
