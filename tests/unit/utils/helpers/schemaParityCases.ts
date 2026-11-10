/**
 * Input corpus shared by the Zod parity recorder and the replayed parity test.
 *
 * Every schema MemoryJS uses at runtime appears here with a valid input, one
 * input per constraint it declares, and the edge inputs that change the answer
 * (wrong types, `null`, `undefined`, extra keys, reserved record keys,
 * boundary values). The recorder runs these through Zod 4.6.7 and freezes the
 * results; `schema.parity.test.ts` replays them through `src/utils/schema.ts`.
 *
 * Inputs live in TypeScript rather than the fixture because several of them are
 * not JSON values (`undefined`, `NaN`, `Infinity`, a `Map`, a function).
 */

/** Schema names, matching the maps in the recorder and the parity test. */
export type SchemaName =
  | 'EntitySchema'
  | 'CreateEntitySchema'
  | 'UpdateEntitySchema'
  | 'RelationSchema'
  | 'CreateRelationSchema'
  | 'SearchQuerySchema'
  | 'DateRangeSchema'
  | 'TagAliasSchema'
  | 'ExportFormatSchema'
  | 'BatchCreateEntitiesSchema'
  | 'BatchCreateRelationsSchema'
  | 'EntityNamesSchema'
  | 'DeleteRelationsSchema'
  | 'AddObservationInputSchema'
  | 'AddObservationsInputSchema'
  | 'DeleteObservationInputSchema'
  | 'DeleteObservationsInputSchema'
  | 'ArchiveCriteriaSchema'
  | 'SavedSearchInputSchema'
  | 'SavedSearchUpdateSchema'
  | 'ImportFormatSchema'
  | 'ExtendedExportFormatSchema'
  | 'MergeStrategySchema'
  | 'ExportFilterSchema'
  | 'OptionalTagsSchema'
  | 'OptionalEntityNamesSchema'
  | 'knowledgeLoadSchema'
  | 'skillsPublishSchema'
  | 'skillsImportSchema'
  | 'learnStartSchema'
  | 'traceIdSchema'
  | 'learnSubmitSchema'
  | 'submitChildSchema'
  | 'logAppendSchema'
  | 'logSelectSchema'
  | 'evalRunSchema'
  | 'PGNodeSchema'
  | 'PGEdgeSchema'
  | 'PGSnapshotSchema'
  | 'PGEditSetSchema';

/** One `safeParse` input for one schema. */
export interface ParityCase {
  /** Unique, human-readable case id. */
  label: string;
  /** Schema under test. */
  schema: SchemaName;
  /** Value passed to `safeParse`. */
  input: unknown;
}

/** A helper call that consumes a `ZodError` and surfaces its issues. */
export interface ParityOpCase {
  /** Unique, human-readable case id. */
  label: string;
  /** Helper exercised. */
  op: 'formatZodErrors' | 'issuesOf';
  /** Schema whose failure produces the error. */
  schema: SchemaName;
  /** Failing input. */
  input: unknown;
}

const VALID_ENTITY = {
  name: 'Alice',
  entityType: 'person',
  observations: ['likes tea'],
};

const VALID_RELATION = { from: 'Alice', to: 'Bob', relationType: 'knows' };

const VALID_TASK = {
  id: 't1',
  input: 'What is the total?',
  rubric: [{ id: 'c1', text: 'Mentions 42', kind: 'fact' }],
};

const VALID_SNAPSHOT = {
  schemaVersion: 1,
  graphId: 'g1',
  revisionId: 'r1',
  entryNodeId: 'n1',
  relationVocabulary: ['LEADS_TO'],
  cyclePolicy: 'allow',
  toolCatalogHash: 'h1',
  nodes: [{ id: 'n1', type: 'ACTION', description: 'start' }],
  edges: [
    { source: 'n1', relation: 'LEADS_TO', target: 'n1', condition: null, guidance: null, pitfalls: null },
  ],
};

/** Every case, in a stable order so the fixture diff stays readable. */
export const CASES: ParityCase[] = [
  // ==================== utils/schemas ====================
  { label: 'entity/valid', schema: 'EntitySchema', input: VALID_ENTITY },
  {
    label: 'entity/valid-full',
    schema: 'EntitySchema',
    input: {
      ...VALID_ENTITY,
      id: 'e1',
      createdAt: '2026-01-15T12:00:00.000Z',
      lastModified: '2026-01-15T12:00:00.000Z',
      tags: ['  Team-A '],
      importance: 7,
      parentId: 'Root',
      contentHash: 'a'.repeat(64),
    },
  },
  { label: 'entity/empty-name', schema: 'EntitySchema', input: { ...VALID_ENTITY, name: '' } },
  { label: 'entity/long-name', schema: 'EntitySchema', input: { ...VALID_ENTITY, name: 'a'.repeat(501) } },
  { label: 'entity/trimmed-name', schema: 'EntitySchema', input: { ...VALID_ENTITY, name: '  Alice  ' } },
  { label: 'entity/empty-type', schema: 'EntitySchema', input: { ...VALID_ENTITY, entityType: '' } },
  { label: 'entity/missing-observations', schema: 'EntitySchema', input: { name: 'A', entityType: 'b' } },
  { label: 'entity/empty-observation', schema: 'EntitySchema', input: { ...VALID_ENTITY, observations: [''] } },
  {
    label: 'entity/toxic-observation',
    schema: 'EntitySchema',
    input: { ...VALID_ENTITY, observations: ['x'.repeat(5001)] },
  },
  { label: 'entity/extra-key', schema: 'EntitySchema', input: { ...VALID_ENTITY, isAdmin: true } },
  { label: 'entity/bad-importance', schema: 'EntitySchema', input: { ...VALID_ENTITY, importance: 11 } },
  { label: 'entity/fractional-importance', schema: 'EntitySchema', input: { ...VALID_ENTITY, importance: 1.5 } },
  { label: 'entity/bad-timestamp', schema: 'EntitySchema', input: { ...VALID_ENTITY, createdAt: 'yesterday' } },
  { label: 'entity/bad-hash-length', schema: 'EntitySchema', input: { ...VALID_ENTITY, contentHash: 'abc' } },
  { label: 'entity/not-an-object', schema: 'EntitySchema', input: 'nope' },
  { label: 'entity/array', schema: 'EntitySchema', input: [] },
  { label: 'entity/null', schema: 'EntitySchema', input: null },

  { label: 'create-entity/valid', schema: 'CreateEntitySchema', input: VALID_ENTITY },
  {
    label: 'create-entity/valid-full',
    schema: 'CreateEntitySchema',
    input: {
      ...VALID_ENTITY,
      ttl: 3600,
      confidence: 0.5,
      version: 2,
      isLatest: true,
      lifecycleStatus: 'published',
      observationMeta: [{ content: 'c', sourceRef: 'ingest-1-chunk-1' }],
      source: { kind: 'cli' },
    },
  },
  {
    label: 'create-entity/extra-key',
    schema: 'CreateEntitySchema',
    input: { ...VALID_ENTITY, unknownField: 1 },
  },
  {
    label: 'create-entity/zero-version',
    schema: 'CreateEntitySchema',
    input: { ...VALID_ENTITY, version: 0 },
  },
  {
    label: 'create-entity/bad-confidence',
    schema: 'CreateEntitySchema',
    input: { ...VALID_ENTITY, confidence: 1.5 },
  },
  {
    label: 'create-entity/bad-lifecycle',
    schema: 'CreateEntitySchema',
    input: { ...VALID_ENTITY, lifecycleStatus: 'gone' },
  },
  {
    label: 'create-entity/bad-observationMeta',
    schema: 'CreateEntitySchema',
    input: { ...VALID_ENTITY, observationMeta: [{ validFrom: 'x' }] },
  },
  { label: 'create-entity/missing-name', schema: 'CreateEntitySchema', input: { entityType: 'b', observations: [] } },

  { label: 'update-entity/valid', schema: 'UpdateEntitySchema', input: { importance: 5 } },
  {
    label: 'update-entity/strips-junk',
    schema: 'UpdateEntitySchema',
    input: { importance: 5, isAdmin: true, __role: 'root', internalFlag: 'x' },
  },
  { label: 'update-entity/empty', schema: 'UpdateEntitySchema', input: {} },
  { label: 'update-entity/bad-importance', schema: 'UpdateEntitySchema', input: { importance: -1 } },
  { label: 'update-entity/bad-version', schema: 'UpdateEntitySchema', input: { version: 0 } },
  { label: 'update-entity/not-an-object', schema: 'UpdateEntitySchema', input: 5 },
  {
    label: 'update-entity/loose-timestamps',
    schema: 'UpdateEntitySchema',
    input: { createdAt: 'whenever', lastModified: 'whenever' },
  },
  { label: 'update-entity/tags-and-observations', schema: 'UpdateEntitySchema', input: { tags: [' A '], observations: ['o'] } },

  { label: 'relation/valid', schema: 'RelationSchema', input: VALID_RELATION },
  {
    label: 'relation/valid-full',
    schema: 'RelationSchema',
    input: {
      ...VALID_RELATION,
      weight: 0.5,
      confidence: 0.8,
      properties: { bidirectional: true, provenance: 'pg' },
      metadata: { proceduralGraph: { schemaVersion: 1 } },
    },
  },
  { label: 'relation/extra-key', schema: 'RelationSchema', input: { ...VALID_RELATION, unknownKey: true } },
  { label: 'relation/bad-weight', schema: 'RelationSchema', input: { ...VALID_RELATION, weight: 2 } },
  { label: 'relation/missing-type', schema: 'RelationSchema', input: { from: 'A', to: 'B' } },
  { label: 'relation/bad-properties', schema: 'RelationSchema', input: { ...VALID_RELATION, properties: { bidirectional: 'yes' } } },
  { label: 'relation/metadata-array', schema: 'RelationSchema', input: { ...VALID_RELATION, metadata: [] } },

  { label: 'create-relation/valid', schema: 'CreateRelationSchema', input: VALID_RELATION },
  { label: 'create-relation/extra-key', schema: 'CreateRelationSchema', input: { ...VALID_RELATION, unknownKey: true } },
  { label: 'create-relation/empty-endpoint', schema: 'CreateRelationSchema', input: { ...VALID_RELATION, to: '' } },

  { label: 'search-query/valid', schema: 'SearchQuerySchema', input: '  hello world  ' },
  { label: 'search-query/empty', schema: 'SearchQuerySchema', input: '' },
  { label: 'search-query/whitespace', schema: 'SearchQuerySchema', input: '   ' },
  { label: 'search-query/too-long', schema: 'SearchQuerySchema', input: 'a'.repeat(1001) },
  { label: 'search-query/number', schema: 'SearchQuerySchema', input: 5 },

  { label: 'date-range/valid', schema: 'DateRangeSchema', input: { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' } },
  { label: 'date-range/reversed', schema: 'DateRangeSchema', input: { start: '2026-02-01T00:00:00Z', end: '2026-01-01T00:00:00Z' } },
  { label: 'date-range/bad-start', schema: 'DateRangeSchema', input: { start: 'soon', end: '2026-01-01T00:00:00Z' } },
  { label: 'date-range/empty', schema: 'DateRangeSchema', input: {} },

  { label: 'tag-alias/valid', schema: 'TagAliasSchema', input: { canonical: '  AI ', aliases: ['ML'] } },
  { label: 'tag-alias/no-aliases', schema: 'TagAliasSchema', input: { canonical: 'ai', aliases: [] } },
  { label: 'tag-alias/bad-alias', schema: 'TagAliasSchema', input: { canonical: 'ai', aliases: [''] } },
  { label: 'tag-alias/extra-key', schema: 'TagAliasSchema', input: { canonical: 'ai', aliases: ['ml'], extra: 1 } },

  { label: 'export-format/valid', schema: 'ExportFormatSchema', input: 'graphml' },
  { label: 'export-format/bad', schema: 'ExportFormatSchema', input: 'yaml' },
  { label: 'export-format/number', schema: 'ExportFormatSchema', input: 1 },

  { label: 'batch-create-entities/valid', schema: 'BatchCreateEntitiesSchema', input: [VALID_ENTITY] },
  { label: 'batch-create-entities/empty', schema: 'BatchCreateEntitiesSchema', input: [] },
  { label: 'batch-create-entities/toxic', schema: 'BatchCreateEntitiesSchema', input: [] },
  { label: 'batch-create-entities/item-fail', schema: 'BatchCreateEntitiesSchema', input: [VALID_ENTITY, { name: '' }] },
  { label: 'batch-create-entities/not-array', schema: 'BatchCreateEntitiesSchema', input: {} },

  { label: 'batch-create-relations/valid', schema: 'BatchCreateRelationsSchema', input: [VALID_RELATION] },
  { label: 'batch-create-relations/empty', schema: 'BatchCreateRelationsSchema', input: [] },

  { label: 'entity-names/valid', schema: 'EntityNamesSchema', input: ['Alice', 'Bob'] },
  { label: 'entity-names/empty', schema: 'EntityNamesSchema', input: [] },
  { label: 'entity-names/bad', schema: 'EntityNamesSchema', input: ['Alice', ''] },

  { label: 'delete-relations/valid', schema: 'DeleteRelationsSchema', input: [VALID_RELATION] },
  { label: 'delete-relations/empty', schema: 'DeleteRelationsSchema', input: [] },

  { label: 'add-observation/valid', schema: 'AddObservationInputSchema', input: { entityName: 'Alice', contents: ['x'] } },
  { label: 'add-observation/empty-contents', schema: 'AddObservationInputSchema', input: { entityName: 'Alice', contents: [] } },
  { label: 'add-observation/extra-key', schema: 'AddObservationInputSchema', input: { entityName: 'Alice', contents: [], extra: 1 } },

  { label: 'add-observations/valid', schema: 'AddObservationsInputSchema', input: [{ entityName: 'Alice', contents: ['x'] }] },
  { label: 'add-observations/empty', schema: 'AddObservationsInputSchema', input: [] },

  { label: 'delete-observation/valid', schema: 'DeleteObservationInputSchema', input: { entityName: 'Alice', observations: ['x'] } },
  { label: 'delete-observation/bad', schema: 'DeleteObservationInputSchema', input: { entityName: '', observations: [''] } },

  { label: 'delete-observations/valid', schema: 'DeleteObservationsInputSchema', input: [{ entityName: 'Alice', observations: ['x'] }] },
  { label: 'delete-observations/empty', schema: 'DeleteObservationsInputSchema', input: [] },

  { label: 'archive-criteria/valid', schema: 'ArchiveCriteriaSchema', input: { importanceLessThan: 3, tags: ['old'] } },
  { label: 'archive-criteria/empty', schema: 'ArchiveCriteriaSchema', input: {} },
  { label: 'archive-criteria/bad-date', schema: 'ArchiveCriteriaSchema', input: { olderThan: 'long ago' } },
  { label: 'archive-criteria/extra-key', schema: 'ArchiveCriteriaSchema', input: { keep: true } },

  { label: 'saved-search/valid', schema: 'SavedSearchInputSchema', input: { name: ' My search ', query: 'abc', minImportance: 2 } },
  { label: 'saved-search/empty-name', schema: 'SavedSearchInputSchema', input: { name: '', query: 'abc' } },
  { label: 'saved-search/missing-query', schema: 'SavedSearchInputSchema', input: { name: 'x' } },
  { label: 'saved-search/extra-key', schema: 'SavedSearchInputSchema', input: { name: 'x', query: 'y', extra: 1 } },

  { label: 'saved-search-update/valid', schema: 'SavedSearchUpdateSchema', input: { query: 'abc' } },
  { label: 'saved-search-update/empty', schema: 'SavedSearchUpdateSchema', input: {} },
  { label: 'saved-search-update/bad-importance', schema: 'SavedSearchUpdateSchema', input: { minImportance: 99 } },

  { label: 'import-format/valid', schema: 'ImportFormatSchema', input: 'csv' },
  { label: 'import-format/bad', schema: 'ImportFormatSchema', input: 'dots' },

  { label: 'extended-export-format/valid', schema: 'ExtendedExportFormatSchema', input: 'json-ld' },
  { label: 'extended-export-format/bad', schema: 'ExtendedExportFormatSchema', input: 'xml' },

  { label: 'merge-strategy/valid', schema: 'MergeStrategySchema', input: 'merge' },
  { label: 'merge-strategy/bad', schema: 'MergeStrategySchema', input: 'append' },

  { label: 'export-filter/valid', schema: 'ExportFilterSchema', input: { entityType: 'person', tags: ['a'] } },
  { label: 'export-filter/bad-date', schema: 'ExportFilterSchema', input: { startDate: 'now' } },
  { label: 'export-filter/extra-key', schema: 'ExportFilterSchema', input: { nope: 1 } },

  { label: 'optional-tags/valid', schema: 'OptionalTagsSchema', input: [' A ', 'b'] },
  { label: 'optional-tags/absent', schema: 'OptionalTagsSchema', input: undefined },
  { label: 'optional-tags/bad', schema: 'OptionalTagsSchema', input: [''] },

  { label: 'optional-entity-names/valid', schema: 'OptionalEntityNamesSchema', input: ['Alice'] },
  { label: 'optional-entity-names/absent', schema: 'OptionalEntityNamesSchema', input: undefined },

  // ==================== adapters/recursaToolSchemas ====================
  { label: 'knowledge-load/valid', schema: 'knowledgeLoadSchema', input: { role: 'solver', taskHint: 'ledger' } },
  {
    label: 'knowledge-load/full',
    schema: 'knowledgeLoadSchema',
    input: {
      role: 'shared',
      taskHint: 'x',
      budgetTokens: 100,
      sections: ['instructions', 'skills'],
      includeSkillIds: ['s1'],
      maxSkills: 5,
    },
  },
  { label: 'knowledge-load/bad-role', schema: 'knowledgeLoadSchema', input: { role: 'judge', taskHint: 'x' } },
  { label: 'knowledge-load/extra-key', schema: 'knowledgeLoadSchema', input: { role: 'solver', taskHint: 'x', zzz: 1 } },
  { label: 'knowledge-load/missing-hint', schema: 'knowledgeLoadSchema', input: { role: 'solver' } },
  { label: 'knowledge-load/too-many-sections', schema: 'knowledgeLoadSchema', input: { role: 'solver', taskHint: 'x', sections: ['instructions', 'skills', 'failures', 'instructions'] } },
  { label: 'knowledge-load/zero-maxskills', schema: 'knowledgeLoadSchema', input: { role: 'solver', taskHint: 'x', maxSkills: 0 } },

  { label: 'skills-publish/valid', schema: 'skillsPublishSchema', input: { dir: 'sub', snapshotId: 's1' } },
  { label: 'skills-publish/empty', schema: 'skillsPublishSchema', input: {} },
  { label: 'skills-publish/extra-key', schema: 'skillsPublishSchema', input: { other: 1 } },

  { label: 'skills-import/valid', schema: 'skillsImportSchema', input: { dir: 'sub' } },
  { label: 'skills-import/empty-dir', schema: 'skillsImportSchema', input: { dir: '' } },

  {
    label: 'learn-start/valid',
    schema: 'learnStartSchema',
    input: { tasks: [VALID_TASK], budget: { maxRounds: 2 } },
  },
  {
    label: 'learn-start/full',
    schema: 'learnStartSchema',
    input: {
      tasks: [VALID_TASK],
      taskIds: ['t1'],
      budget: { maxRounds: 1, maxTokens: 10, maxWallClockMs: 20, maxChildren: 2 },
      split: 'auto',
      validationSampleSize: 1,
      validationRepeats: 2,
      concurrency: 4,
      leafThreshold: 5,
      maxDepth: 1,
      sessionId: 's',
      subsetLabel: 'a',
    },
  },
  {
    label: 'learn-start/empty-tasks',
    schema: 'learnStartSchema',
    input: { tasks: [], budget: { maxRounds: 1 } },
  },
  {
    label: 'learn-start/duplicate-task-ids',
    schema: 'learnStartSchema',
    input: { tasks: [VALID_TASK, VALID_TASK], budget: { maxRounds: 1 } },
  },
  {
    label: 'learn-start/reserved-task-id',
    schema: 'learnStartSchema',
    input: { tasks: [{ ...VALID_TASK, id: '__proto__' }], budget: { maxRounds: 1 } },
  },
  {
    label: 'learn-start/reserved-source-key',
    schema: 'learnStartSchema',
    input: {
      tasks: [{ ...VALID_TASK, sources: JSON.parse('{"__proto__":1}') }],
      budget: { maxRounds: 1 },
    },
  },
  {
    label: 'learn-start/bad-task-item',
    schema: 'learnStartSchema',
    input: { tasks: [{ id: 't', input: '' }], budget: { maxRounds: 1 } },
  },
  {
    label: 'learn-start/extra-task-key',
    schema: 'learnStartSchema',
    input: { tasks: [{ ...VALID_TASK, extra: 1 }], budget: { maxRounds: 1 } },
  },
  {
    label: 'learn-start/missing-budget',
    schema: 'learnStartSchema',
    input: { tasks: [VALID_TASK] },
  },
  {
    label: 'learn-start/bad-split',
    schema: 'learnStartSchema',
    input: { tasks: [VALID_TASK], budget: { maxRounds: 1 }, split: 'random' },
  },
  {
    label: 'learn-start/bad-rubric',
    schema: 'learnStartSchema',
    input: { tasks: [{ id: 't', input: 'i', rubric: [{ id: 'c', text: 'x', kind: 'nope' }] }], budget: { maxRounds: 1 } },
  },
  {
    label: 'learn-start/infinite-tolerance',
    schema: 'learnStartSchema',
    input: {
      tasks: [{ id: 't', input: 'i', rubric: [{ id: 'c', text: 'x', kind: 'number', tolerance: Infinity }] }],
      budget: { maxRounds: 1 },
    },
  },
  { label: 'learn-start/not-an-object', schema: 'learnStartSchema', input: 'nope' },

  { label: 'trace-id/valid', schema: 'traceIdSchema', input: { traceId: 't1' } },
  { label: 'trace-id/extra-key', schema: 'traceIdSchema', input: { traceId: 't1', extra: 1 } },
  { label: 'trace-id/empty', schema: 'traceIdSchema', input: { traceId: '' } },
  { label: 'trace-id/missing', schema: 'traceIdSchema', input: {} },

  {
    label: 'learn-submit/solve',
    schema: 'learnSubmitSchema',
    input: {
      traceId: 't1',
      kind: 'solve',
      payload: { a: { answer: 'x', traceAddrs: ['e1'] } },
    },
  },
  {
    label: 'learn-submit/judge',
    schema: 'learnSubmitSchema',
    input: { traceId: 't1', kind: 'judge', payload: { a: [{ criterionId: 'c1', pass: true }] } },
  },
  {
    label: 'learn-submit/null-payload-entry',
    schema: 'learnSubmitSchema',
    input: { traceId: 't1', kind: 'solve', payload: { a: null } },
  },
  {
    label: 'learn-submit/bad-kind',
    schema: 'learnSubmitSchema',
    input: { traceId: 't1', kind: 'other', payload: {} },
  },
  { label: 'learn-submit/missing-kind', schema: 'learnSubmitSchema', input: { traceId: 't1', payload: {} } },
  { label: 'learn-submit/not-an-object', schema: 'learnSubmitSchema', input: [] },
  {
    label: 'learn-submit/bad-solve-body',
    schema: 'learnSubmitSchema',
    input: { traceId: 't1', kind: 'solve', payload: { a: { answer: 'x' } } },
  },
  {
    label: 'learn-submit/reserved-payload-key',
    schema: 'learnSubmitSchema',
    input: { traceId: 't1', kind: 'solve', payload: { unsafe: { answer: 'x', traceAddrs: [] } } },
  },
  {
    label: 'learn-submit/extra-key',
    schema: 'learnSubmitSchema',
    input: { traceId: 't1', kind: 'solve', payload: {}, extra: 1 },
  },

  { label: 'submit-child/valid', schema: 'submitChildSchema', input: { traceId: 't1', childTraceId: 't2' } },
  { label: 'submit-child/with-failure', schema: 'submitChildSchema', input: { traceId: 't1', childTraceId: 't2', failure: 'boom' } },
  { label: 'submit-child/missing-child', schema: 'submitChildSchema', input: { traceId: 't1' } },
  { label: 'submit-child/extra-key', schema: 'submitChildSchema', input: { traceId: 't1', childTraceId: 't2', nope: 1 } },

  {
    label: 'log-append/valid',
    schema: 'logAppendSchema',
    input: { sessionId: 's', kind: 'note', content: 'x' },
  },
  {
    label: 'log-append/full',
    schema: 'logAppendSchema',
    input: {
      sessionId: 's',
      kind: 'tool_call',
      tag: 't',
      content: 'x',
      ts: '2026-01-15T12:00:00.123Z',
      tokens: { input: 1, output: 2 },
    },
  },
  { label: 'log-append/bad-kind', schema: 'logAppendSchema', input: { sessionId: 's', kind: 'blah', content: 'x' } },
  { label: 'log-append/bad-ts', schema: 'logAppendSchema', input: { sessionId: 's', kind: 'note', content: 'x', ts: '2026-01-15' } },
  { label: 'log-append/offset-ts', schema: 'logAppendSchema', input: { sessionId: 's', kind: 'note', content: 'x', ts: '2026-01-15T12:00:00+01:00' } },
  { label: 'log-append/negative-tokens', schema: 'logAppendSchema', input: { sessionId: 's', kind: 'note', content: 'x', tokens: { input: -1, output: 0 } } },
  { label: 'log-append/extra-key', schema: 'logAppendSchema', input: { sessionId: 's', kind: 'note', content: 'x', extra: 1 } },

  { label: 'log-select/valid', schema: 'logSelectSchema', input: { addr: 'e12' } },
  { label: 'log-select/full', schema: 'logSelectSchema', input: { addr: 'e1', regex: 'a+', lines: [1, 2], fields: ['content'] } },
  { label: 'log-select/bad-addr', schema: 'logSelectSchema', input: { addr: 'x' } },
  { label: 'log-select/e0-addr', schema: 'logSelectSchema', input: { addr: 'e0' } },
  { label: 'log-select/short-lines', schema: 'logSelectSchema', input: { addr: 'e1', lines: [1] } },
  { label: 'log-select/long-lines', schema: 'logSelectSchema', input: { addr: 'e1', lines: [1, 2, 3] } },
  { label: 'log-select/bad-line-bound', schema: 'logSelectSchema', input: { addr: 'e1', lines: [0, 1] } },
  { label: 'log-select/empty-regex', schema: 'logSelectSchema', input: { addr: 'e1', regex: '' } },
  { label: 'log-select/extra-key', schema: 'logSelectSchema', input: { addr: 'e1', extra: 1 } },

  {
    label: 'eval-run/valid',
    schema: 'evalRunSchema',
    input: { tasks: [VALID_TASK], answers: { t1: '42' } },
  },
  {
    label: 'eval-run/full',
    schema: 'evalRunSchema',
    input: { tasks: [VALID_TASK], answers: { t1: '42' }, knowledge: 'k', concurrency: 2 },
  },
  { label: 'eval-run/missing-answers', schema: 'evalRunSchema', input: { tasks: [VALID_TASK] } },
  { label: 'eval-run/reserved-answer-key', schema: 'evalRunSchema', input: { tasks: [VALID_TASK], answers: { __proto__x: '1' } } },
  { label: 'eval-run/bad-concurrency', schema: 'evalRunSchema', input: { tasks: [VALID_TASK], answers: {}, concurrency: 1000 } },
  { label: 'eval-run/not-an-object', schema: 'evalRunSchema', input: 'nope' },
  { label: 'eval-run/extra-key', schema: 'evalRunSchema', input: { tasks: [VALID_TASK], answers: {}, extra: 1 } },

  // ==================== procedural graph ====================
  { label: 'pg-node/valid', schema: 'PGNodeSchema', input: { id: 'n1', type: 'ACTION', description: 'd' } },
  { label: 'pg-node/with-action', schema: 'PGNodeSchema', input: { id: 'n1', type: 'SKILL', description: 'd', actionName: 'a' } },
  { label: 'pg-node/bad-type', schema: 'PGNodeSchema', input: { id: 'n1', type: 'NOPE', description: 'd' } },
  { label: 'pg-node/empty-id', schema: 'PGNodeSchema', input: { id: '', type: 'ACTION', description: 'd' } },
  { label: 'pg-node/extra-key', schema: 'PGNodeSchema', input: { id: 'n1', type: 'ACTION', description: 'd', x: 1 } },

  {
    label: 'pg-edge/valid',
    schema: 'PGEdgeSchema',
    input: { source: 'a', relation: 'r', target: 'b', condition: null, guidance: 'g', pitfalls: 'p' },
  },
  {
    label: 'pg-edge/bad-condition',
    schema: 'PGEdgeSchema',
    input: { source: 'a', relation: 'r', target: 'b', condition: 3, guidance: 'g', pitfalls: 'p' },
  },
  {
    label: 'pg-edge/missing-guidance',
    schema: 'PGEdgeSchema',
    input: { source: 'a', relation: 'r', target: 'b', condition: null, pitfalls: 'p' },
  },

  { label: 'pg-snapshot/valid', schema: 'PGSnapshotSchema', input: VALID_SNAPSHOT },
  {
    label: 'pg-snapshot/with-parent',
    schema: 'PGSnapshotSchema',
    input: { ...VALID_SNAPSHOT, parentRevisionId: 'r0' },
  },
  { label: 'pg-snapshot/bad-version', schema: 'PGSnapshotSchema', input: { ...VALID_SNAPSHOT, schemaVersion: 2 } },
  { label: 'pg-snapshot/bad-policy', schema: 'PGSnapshotSchema', input: { ...VALID_SNAPSHOT, cyclePolicy: 'ignore' } },
  {
    label: 'pg-snapshot/bad-node',
    schema: 'PGSnapshotSchema',
    input: { ...VALID_SNAPSHOT, nodes: [{ id: 'n1', type: 'WAT', description: 'd' }] },
  },
  { label: 'pg-snapshot/extra-key', schema: 'PGSnapshotSchema', input: { ...VALID_SNAPSHOT, extra: 1 } },

  {
    label: 'pg-edit-set/valid',
    schema: 'PGEditSetSchema',
    input: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [] },
  },
  {
    label: 'pg-edit-set/with-items',
    schema: 'PGEditSetSchema',
    input: {
      add_nodes: [{ id: 'n1', type: 'STATE', description: 'd' }],
      delete_nodes: ['n2'],
      add_edges: [
        {
          source: 'n1',
          relation: 'r',
          target: 'n2',
          condition: null,
          guidance: 'g',
          pitfalls: 'p',
        },
      ],
      delete_edges: [{ source: 'n1', target: 'n2' }],
    },
  },
  {
    label: 'pg-edit-set/bad-delete-node',
    schema: 'PGEditSetSchema',
    input: { add_nodes: [], delete_nodes: [''], add_edges: [], delete_edges: [] },
  },
  {
    label: 'pg-edit-set/extra-key',
    schema: 'PGEditSetSchema',
    input: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [], extra: 1 },
  },
];

/** Schemas whose `toJSONSchema(..., { io: 'input', unrepresentable: 'any' })` output is frozen. */
export const JSON_SCHEMA_CASES: SchemaName[] = [
  'knowledgeLoadSchema',
  'skillsPublishSchema',
  'skillsImportSchema',
  'learnStartSchema',
  'traceIdSchema',
  'learnSubmitSchema',
  'submitChildSchema',
  'logAppendSchema',
  'logSelectSchema',
  'evalRunSchema',
  'EntitySchema',
  'CreateEntitySchema',
  'UpdateEntitySchema',
  'RelationSchema',
  'DateRangeSchema',
  'BatchCreateEntitiesSchema',
  'PGSnapshotSchema',
  'PGEditSetSchema',
];

/**
 * Failing inputs whose complete `ZodError` shape is frozen: constructor name,
 * `issues` order, `path` segments, `code` and `message`.
 */
export const ERROR_SHAPE_CASES: Array<{ label: string; schema: SchemaName; input: unknown }> = [
  { label: 'error/entity-multi', schema: 'EntitySchema', input: { name: '', entityType: '', observations: [''] } },
  { label: 'error/trace-id', schema: 'traceIdSchema', input: { traceId: 'x', extra: 1 } },
  { label: 'error/discriminated', schema: 'learnSubmitSchema', input: { traceId: 't', kind: 'nope' } },
  { label: 'error/tuple', schema: 'logSelectSchema', input: { addr: 'e1', lines: [0] } },
  {
    label: 'error/reserved-record-key',
    schema: 'learnSubmitSchema',
    input: { traceId: 't', kind: 'solve', payload: JSON.parse('{"constructor":{"answer":"x","traceAddrs":[]}}') },
  },
];

/** Helper calls recorded from the same failing inputs. */
export const OPS: ParityOpCase[] = [
  { label: 'format/entity-multi', op: 'formatZodErrors', schema: 'EntitySchema', input: { name: '', entityType: '', observations: 'x' } },
  { label: 'format/entity-extra-key', op: 'formatZodErrors', schema: 'EntitySchema', input: { ...VALID_ENTITY, isAdmin: 1 } },
  { label: 'format/search-query', op: 'formatZodErrors', schema: 'SearchQuerySchema', input: '' },
  { label: 'format/update-entity', op: 'formatZodErrors', schema: 'UpdateEntitySchema', input: { importance: 99 } },
  { label: 'issues/trace-id', op: 'issuesOf', schema: 'traceIdSchema', input: { traceId: '', extra: 1 } },
  { label: 'issues/eval-run', op: 'issuesOf', schema: 'evalRunSchema', input: { tasks: [], answers: 1 } },
  { label: 'issues/log-select', op: 'issuesOf', schema: 'logSelectSchema', input: { addr: 'x' } },
  { label: 'issues/learn-submit', op: 'issuesOf', schema: 'learnSubmitSchema', input: { traceId: 't', kind: 'solve', payload: 1 } },
];
