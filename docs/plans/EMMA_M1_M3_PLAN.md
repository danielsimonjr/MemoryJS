# EMMA M1–M3 implementation plan

Planning only. This file does not change `src/`. Implement in order **M1, then M2, then M3**. Each item is its own pull request. M2's base is M1's head branch. M3's base is M2's head branch. Do not squash the three into one PR.

Phase 2 (clone cleanup) is a fourth pull request branched from `master`, not stacked on M3. M1–M3 do not refactor unrelated clones.

Out of scope for every PR: a new store, a new status enum, a workflow synthesizer, a benchmark harness, controller-routing memory, inheriting specialists, a per-step skill pool, and any change to `FailureManager.markResolved` (the caller closes the failure after the edit exists). Do not bump the package version, tag, or release.

Measured against `master` `60102494873a4edb3aa4b1007dd26dca55a60951`. The EMMA section is `docs/roadmap/ROADMAP.md` ("Research track — EMMA").

## Stack

| PR | Base | Delivers |
|---|---|---|
| M1 | `master` | One `blamedComponent` on `FailureRecord`, resolved at `record`, retrieved by `lookupByComponent`. |
| M2 | M1 head | `applyGuardedEdit`: one bounded change, a new version, `causedByFailureId`, previous version kept. |
| M3 | M2 head | That version starts `draft`. `noteHelped` publishes it. `retire` archives it. Default search still returns the published ancestor while the head is a draft. |
| Phase 2 | `master` | `repo-tools clones` cleanup and `docs/analysis/CLONES_REMAINING.md`. |

Each PR that edits `src/`:

- `bunx vitest run` on the test files named in that PR.
- `bun run typecheck` and `bun run lint` exit 0.
- `repo-tools docs check src` exits 0. Every new exported symbol has a JSDoc block. The first sentence says what it does.
- `repo-tools check . --docs=docs/architecture` exits 0. Update only Value cells the check reports as drift. Do not rewrite architecture prose. Tool pin: `@danielsimonjr/repo-tools@2.3.0` (the version in `.github/workflows/typescript.yml`).
- One bullet under `CHANGELOG.md` `## [Unreleased]`. No version heading.

`CreateEntitySchema` is `.strict()` and `UpdateEntitySchema` is `.strip()`. A new entity field that is missing from either schema is rejected or dropped. `GraphStorage` persists optional fields only from `OPTIONAL_PERSISTED_ENTITY_FIELDS`. `SQLiteStorage` persists them only from `EXTENSION_FIELDS`. Add a field to all four, or it will not round-trip. PostgreSQL copies any non-first-class key into the `extra` JSONB column, so it needs no column.

---

## M1. One blamed component on the failure record

### Types

In `src/types/agent-memory.ts`, next to `FailureRecord`:

```typescript
export const BLAMED_COMPONENT_KINDS = [
  'entity',
  'heuristic',
  'procedure',
  'plan-node',
  'pg-node',
] as const;

export type BlamedComponentKind = (typeof BLAMED_COMPONENT_KINDS)[number];

/** One component a failure blames. The object holds one id. */
export interface BlamedComponent {
  kind: BlamedComponentKind;
  id: string;
}
```

Add to `FailureRecord`:

```typescript
/**
 * The one component this failure blames. Absent on records written
 * before this field existed. `record` stores `{ kind, id }` only.
 */
blamedComponent?: BlamedComponent;
```

`FailureInput` is `Omit<FailureRecord, 'id' | 'timestamp' | 'lifecycle'>`, so the field is already optional on `record` input. Do not add a second component field, and do not accept an array.

`failureRecord` is already on `OPTIONAL_PERSISTED_ENTITY_FIELDS` in `src/core/GraphStorage.ts`, so the nested object persists on JSONL without a new column. Do not add a SQLite migration for `failureRecord` in this PR. SQLite's `EXTENSION_FIELDS` still omits `failureRecord`; that drop is pre-existing and out of scope.

### `PlanManager.findNodeOwners`

`PlanManager.findNode` (`src/agent/PlanManager.ts`) is `(planId, nodeId) => GoalNode | null`. A blamed component has one id, the goal-node id, and no plan id.

Add:

```typescript
/**
 * Plan ids whose goal tree contains `nodeId`. Empty when none do.
 * Two plans can both contain one id; the caller decides what that means.
 */
async findNodeOwners(nodeId: string): Promise<string[]>
```

Implementation: `listPlans()` then `findNode(plan.id, nodeId)` for each plan. Return the plan ids that hit. Do not throw on zero or two hits. Do not export `findNodeInTree`.

### `FailureManager` config and `record`

`src/agent/FailureManager.ts`. Keep the constructor `(storage, entityManager, config?)`. Extend the config:

```typescript
export interface FailureManagerConfig {
  defaultLookupLimit?: number;
  /**
   * Required only when a record blames a `plan-node`.
   * Return every plan id whose tree contains the node id.
   */
  findPlanNodeOwners?: (nodeId: string) => Promise<readonly string[]>;
}
```

Extend `FailureEntityOptions`:

```typescript
/**
 * Required when `blamedComponent.kind` is `pg-node`.
 * `record` checks `snapshot.nodes` and does not store the snapshot.
 */
pgSnapshot?: PGSnapshot;
```

Import `PGSnapshot` as a type from `src/types/proceduralGraph.ts`.

`record` changes, after the five existing `validateNonEmpty` calls and before `appendEntity`:

1. If `input.blamedComponent` is `undefined`, store the record as today. Do not invent a component.
2. If it is an array, or not a plain object, throw `Error` whose message contains `blamedComponent`. Do not call `appendEntity`.
3. If `kind` is not one of `BLAMED_COMPONENT_KINDS`, throw the same way.
4. `validateNonEmpty(blamedComponent.id, 'blamedComponent.id', 'FailureManager')`. Whitespace-only fails. Do not call `appendEntity`.
5. Resolve the id. On failure throw `Error` whose message contains the id and the kind. Do not call `appendEntity`.
   - `entity`: `storage.getEntityByName(id)` is not `undefined`. Any entity type is enough.
   - `heuristic`: the same lookup, and `isHeuristicMemory` is true. A person entity blamed as a heuristic is rejected. `noteHelped` later calls `HeuristicManager.reinforce` on this id.
   - `procedure`: the same lookup, and `entityType` is `procedure` or `procedure-step` (`PROCEDURE_ENTITY_TYPE` / `PROCEDURE_STEP_ENTITY_TYPE` in `src/agent/procedural/ProcedureStore.ts`).
   - `plan-node`: call `config.findPlanNodeOwners`. Missing resolver throws `Error` whose message says a plan-node blame needs `findPlanNodeOwners`. Zero owners throws (unknown id). Two or more owners throws (the id is not one component).
   - `pg-node`: `options.pgSnapshot` is required. The id must be `snapshot.nodes[].id` for exactly one node. A missing snapshot throws. A missing node throws.
6. Store exactly `{ kind, id }`. Drop any extra key the caller put on the object.

Wire it in `ManagerContext.failureManager` (`src/core/ManagerContext.ts`):

```typescript
findPlanNodeOwners: (nodeId) => this.plan.findNodeOwners(nodeId),
```

The closure touches `this.plan` only when a plan-node is recorded, so constructing `failureManager` does not construct `PlanManager`.

### `lookupByComponent`

```typescript
/**
 * Failures whose `blamedComponent.id` equals `id`.
 * Records that omit the field are absent.
 * `options.status` matches `lookupForTask` (default `'open'`, or `'resolved'`, or `'all'`).
 * `options.limit` caps the result. Omit it and the method returns every match.
 * It does not use `defaultLookupLimit`.
 * Match is on the id string only. Kind is ignored.
 * Order is the order `loadAllFailureRecords` already returns.
 */
async lookupByComponent(id: string, options?: LookupOptions): Promise<FailureRecord[]>
```

An empty or non-string `id` returns `[]`. It does not throw. `lookupForTask` and `scoreMatch` do not read `blamedComponent`. A record with the field still scores from `applicability_hint`, `context`, and `attempted` only.

### M1 edge cases

| Case | Result |
|---|---|
| Field omitted | `record` succeeds. `lookupForTask` is unchanged. `lookupByComponent` does not return the record. |
| `id` `''` or `'   '` | Throw. `appendEntity` not called. |
| Unknown entity / heuristic / procedure name | Throw. `appendEntity` not called. |
| `kind: 'heuristic'` and the entity is not `isHeuristicMemory` | Throw. |
| `kind: 'procedure'` and `entityType` is anything else | Throw. |
| `kind: 'plan-node'`, no resolver | Throw. |
| `kind: 'plan-node'`, resolver returns `[]` or two ids | Throw. |
| `kind: 'pg-node'`, no snapshot, or id not in `nodes` | Throw. |
| Extra keys on the object, or a second id | Stored value is `{ kind, id }` only. |
| `lookupByComponent` with more than five matches and no `limit` | All of them. The lookup-for-task cap of 5 does not apply. |
| `status` omitted | Only `lifecycle.status === 'open'`. |
| Same id string on two kinds | Both match. The method filters on id only. |

### M1 tests

`tests/unit/agent/FailureManager.test.ts` uses the existing `createMockStorage` / `createFakeEntityManager`. Add a `describe('blamedComponent')` with these `it` names:

- `round-trips one blamedComponent through lookupByComponent and getAll`
- `stores kind and id and drops any other key`
- `rejects an empty blamedComponent id before append`
- `rejects an unknown entity id before append`
- `rejects a heuristic kind when the entity is not a heuristic`
- `rejects a procedure kind when the entity is not a procedure or a procedure-step`
- `rejects an unknown plan-node id`
- `rejects a plan-node id that two plans own`
- `rejects a plan-node blame when no resolver is configured`
- `rejects a pg-node id that is not in the snapshot`
- `rejects a pg-node blame when no snapshot is supplied`
- `lookupByComponent applies the status filter and skips records that omit the field`
- `lookupByComponent returns every match when limit is omitted`
- `lookupForTask stays green when blamedComponent is absent`

The last test records a failure with no component, calls `lookupForTask` with a token from `applicability_hint`, and expects that record. It also records a second failure that blames a real entity and expects `lookupForTask` to still rank by the existing weights (hint 3, context 2, attempted 1), not by the component id.

`tests/unit/agent/PlanManager.test.ts`, `describe('findNodeOwners')`:

- `returns the plan id when the node is the root`
- `returns an empty list for an unknown node id`
- `returns both plan ids when two stored plans contain the same node id`

The third test creates one plan, copies that stored entity onto a second name with the same `rootGoal.id`, and expects both ids. `record` is what rejects the ambiguity. `findNodeOwners` reports it.

### M1 acceptance

- A record written with one resolved id is returned by `lookupByComponent(id)` and by `getAll()`, and the stored object is `{ kind, id }`.
- A second component cannot be stored: the type has one object, and `record` copies two keys.
- An unknown id throws inside `record` and `appendEntity` is not called.
- A record with no `blamedComponent` keeps today's `lookupForTask` result and is absent from `lookupByComponent`.
- Existing `FailureManager` tests stay green. The constructor is still callable with two arguments.

---

## M2. One guarded edit, new version, linked to that failure

Depends on M1. New module `src/agent/GuardedComponentEdit.ts`. Export the functions and the error class from `src/agent/index.ts`.

`applyGuardedEdit` does not call `markResolved`, `deleteEntities`, `forgetByContent`, `forgetWeakMemories`, `HeuristicManager.remove`, or `ArchiveManager.archiveEntities`.

### Error

```typescript
export type GuardedEditErrorCode =
  | 'failure-not-found'
  | 'no-blamed-component'
  | 'component-not-found'
  | 'unbounded'
  | 'delete-shaped'
  | 'wrong-target'
  | 'empty-change'
  | 'name-collision'
  | 'task-not-found'
  | 'version-not-found'
  | 'illegal-transition'
  | 'conflict';

export class GuardedEditError extends Error {
  readonly code: GuardedEditErrorCode;
  constructor(code: GuardedEditErrorCode, message: string);
}
```

`name` is `GuardedEditError`. Every throw below is this class, before any storage write, except `conflict` which is the procedural-graph head check inside `commitRetainedRevision` (that path returns before it inserts).

### Change object

One change. `targetId` must equal `failure.blamedComponent.id`.

```typescript
export type GuardedScalarField = 'importance' | 'confidence' | 'ttl';

export interface GuardedChange {
  targetId: string;
  /** Append one observation. Mutually exclusive with the other change keys. */
  observation?: string;
  /** Entity scalar. Requires `value`. Not a version-chain field and not `lifecycleStatus`. */
  field?: GuardedScalarField;
  value?: number;
  /** `plan-node` only. One field on that goal node. */
  planNodeField?: 'description' | 'acceptanceCriteria';
  planNodeValue?: string;
  /** `pg-node` only. Replaces `PGNode.description` for `targetId`. */
  pgNodeDescription?: string;
  /** `pg-node` only. One text field on one edge that touches `targetId`. */
  pgEdgeText?: {
    source: string;
    target: string;
    field: 'condition' | 'guidance' | 'pitfalls';
    value: string | null;
  };
  /**
   * Presence of any of these keys, even as `undefined`, is delete-shaped
   * or an unbounded `PGEditSet`. Detect them on the raw object before
   * narrowing. `applyGuardedEdit` has no delete kind.
   */
  delete_nodes?: unknown;
  delete_edges?: unknown;
  add_nodes?: unknown;
  add_edges?: unknown;
  deleteEntity?: unknown;
}
```

Count the set change keys: `observation`, `field`, `planNodeField`, `pgNodeDescription`, `pgEdgeText`. Zero throws `empty-change`. Two or more throws `unbounded`. `field` without a finite `value`, or `value` without `field`, throws `empty-change`. `observation` that is empty or whitespace throws `empty-change`. `importance` must be an integer 0 through 10. `confidence` must be a number from 0 to 1. `ttl` must be a finite number. Reject before write.

If the raw object has `delete_nodes`, `delete_edges`, `add_nodes`, `add_edges`, or `deleteEntity`, throw `delete-shaped` before the one-change check and before any write.

If `targetId !== blamedComponent.id`, throw `wrong-target`.

### Context

```typescript
export interface GuardedEditContext {
  storage: IGraphStorage;
  entityManager: EntityManager;
  relationManager: RelationManager;
  contradictionDetector: ContradictionDetector;
  auditLog: AuditLog;
  heuristicManager: HeuristicManager;
  findPlanNodeOwners: (nodeId: string) => Promise<readonly string[]>;
  /** Required when the blamed kind is `pg-node`. */
  pg?: {
    backing: IProceduralGraphBacking;
    graphId: string;
  };
}

export async function applyGuardedEdit(
  failureId: string,
  change: GuardedChange,
  deps: GuardedEditContext,
): Promise<GuardedEditResult>

export type GuardedEditResult =
  | { kind: 'entity'; entity: Entity; previousName: string }
  | { kind: 'pg-revision'; revision: PGSnapshot; parentRevisionId: string };
```

### `ContradictionDetector.supersede`

`src/features/ContradictionDetector.ts`. Today's signature stays valid. Add an optional fourth argument. Default `undefined` keeps today's body: `detect` runs, contradicted observations are dropped, and the new entity copies only the fields it copies today.

```typescript
export interface SupersedeOptions {
  causedByFailureId?: string;
  lifecycleStatus?: EntityStatus;
  /**
   * Guarded edits set this. Skip `detect`. Keep every existing observation.
   * Copy subtype fields that are present on the old entity:
   * `memoryType`, `heuristicRecord` (structuredClone), `agentId`,
   * `visibility`, `confidence`, `confirmationCount`, `source`.
   * Do not copy `id`, `name`, `contentHash`, `supersededBy`, or the
   * version-chain fields. Those are set by this method, as today.
   */
  preserveBody?: boolean;
  patch?: Partial<Pick<Entity, 'importance' | 'confidence' | 'ttl'>>;
}

async supersede(
  oldEntity: Entity,
  newObservations: string[],
  entityManager: EntityManager,
  options?: SupersedeOptions,
): Promise<Entity>
```

When `preserveBody` is true, `newObservations` are appended after the old observations. No observation is removed.

Set `causedByFailureId` and `lifecycleStatus` on the new entity only when the option is present. Do not set them on the old entity.

Before `createEntities`, if `storage` is not available here, the caller checks the name. `supersede` itself does not see storage. `applyGuardedEdit` computes `newName` the same way (`${rootName}-v${nextVersion}`, `rootName = old.rootEntityName ?? old.name`, `nextVersion = (old.version ?? 1) + 1`) and throws `name-collision` when `storage.getEntityByName(newName)` is defined. Then it calls `supersede`.

`causedByFailureId` must be added to:

- `Entity` in `src/types/types.ts` (optional `string`, next to the version-chain fields).
- `CreateEntitySchema` and `UpdateEntitySchema` in `src/utils/schemas.ts`.
- `OPTIONAL_PERSISTED_ENTITY_FIELDS` in `src/core/GraphStorage.ts`.
- `SQLiteStorage.EXTENSION_FIELDS` in `src/core/SQLiteStorage.ts`.

`lifecycleStatus` is already on both schemas and both allow-lists.

`CreateEntitySchema` is `.strict()`. `createEntities` rejects the batch when the object carries a key the schema does not name. `preserveBody` copies `memoryType`, `heuristicRecord`, `agentId`, `visibility`, `confirmationCount`, `source`, and (for a plan) `planRecord`. Add those keys to `CreateEntitySchema` as optional, using the same loose types `UpdateEntitySchema` already uses (`heuristicRecord` and `planRecord` and `source` are `z.unknown().optional()`). `confidence` is already on the create schema. `UpdateEntitySchema` already admits the subtype keys except `causedByFailureId`.

`GraphStorage`'s allow-list already contains `memoryType`, `heuristicRecord`, `planRecord`, `agentId`, `visibility`, `confirmationCount`, and `source`. `SQLiteStorage.EXTENSION_FIELDS` contains `memoryType`, `agentId`, `visibility`, `confirmationCount`, and `source`, and does not contain `heuristicRecord` or `planRecord`. Add those two, or a heuristic version and a plan version lose their record on SQLite. PostgreSQL's `extra` column stores them with no change.

### Entity path (`entity`, `heuristic`, `procedure`)

1. Load the failure with `storage.getEntityByName(failureId)` and `isFailureMemory`. Missing or not a failure: `failure-not-found`.
2. No `blamedComponent`: `no-blamed-component`.
3. Run the change checks above.
4. Load the component entity. Missing, or the kind check from M1 fails: `component-not-found`.
5. For `procedure`, the observation must not start with `[success-rate]: `, `[execution-count]: `, `[order]: `, `[action]: `, `[timeout]: `, `[param]: `, `[procedure-steps]: `, or `[procedure-meta]: `. Those prefixes are parsed as procedure fields by `ProcedureStore`. Throw `unbounded` so one sentence cannot rewrite a scalar the caller did not name.
6. Name-collision check, then:

```typescript
await contradictionDetector.supersede(oldEntity, observation ? [observation] : [], entityManager, {
  causedByFailureId: failure.id,
  lifecycleStatus: 'draft',
  preserveBody: true,
  patch: field ? { [field]: value } : undefined,
});
```

M2 writes `lifecycleStatus: 'draft'` now. M3's acceptance is that the version M2 writes is a draft. Do not leave it unset. Unset means published, and a later `updateEntity` cannot move `published` back to `draft` (`published → draft` is illegal).

7. The new entity's `causedByFailureId` is `failure.id`. `version`, `parentEntityName`, `rootEntityName`, and `isLatest: true` are the fields `supersede` already writes. The old entity is `isLatest: false` and `supersededBy` the new name. It still loads by its old name.
8. For a heuristic, `heuristicRecord` on the new entity is a clone. Do not rewrite `heuristicRecord.id`. `reinforce` keys by entity name.
9. Append one audit entry (below). Return `{ kind: 'entity', entity, previousName: oldEntity.name }`.

### Plan-node path

The id is a goal-node id. The versioned entity is the plan entity.

1. `findPlanNodeOwners(id)` must return one plan id. Zero: `component-not-found`. Two: `wrong-target`.
2. The only legal change keys are `planNodeField` and `planNodeValue` (`planNodeValue` non-empty). Any other change key is `unbounded` for this kind.
3. Load the plan entity (`isPlanMemory`). Clone `planRecord`. Walk the tree with the same parent/child shape `findNode` uses. Set that one field on the matching node. Leave every other node as it was.
4. Extend `SupersedeOptions` with `planRecord?: PlanRecord`. `supersede` copies it onto the new entity when `preserveBody` is true, in the same `createEntities` call as the version fields. Call `supersede` with `preserveBody: true`, `causedByFailureId`, `lifecycleStatus: 'draft'`, `newObservations: []`, and the cloned `planRecord`. Do not write the tree in a second `updateEntity`. A crash between two writes would leave a plan version without its tree.
5. Audit, then return the entity result. `previousName` is the plan entity name, not the node id.

### Procedural-graph path

`PGSnapshot` does not grow a `causedByFailureId` field. The round record does.

Add to `PGRoundRecord` in `src/types/proceduralGraph.ts`:

```typescript
/** FailureRecord.id when this round was written by `applyGuardedEdit`. */
causedByFailureId?: string;
```

Rounds are stored as JSON (`record_json` / the in-memory record object), so the field persists without a table change.

1. Kind `pg-node` and missing `deps.pg`: throw `component-not-found` before write.
2. The only legal change is `pgNodeDescription` (non-empty string) or `pgEdgeText`.
3. `loadHead(graphId)`. Missing: `component-not-found`.
4. `loadRevision(graphId, head.revisionId)`. Missing node id: `component-not-found`.
5. Node text: copy the snapshot. New `revisionId` is `rev-` plus `randomUUID()`. `parentRevisionId` is the head revision id. Replace `description` on the one node whose `id` is `targetId`. Every other node field, every edge, `entryNodeId`, `relationVocabulary`, `cyclePolicy`, `toolCatalogHash`, `schemaVersion`, and `graphId` stay as they were.
6. Edge text: find the one edge with that `source` and `target`. It must have `source === targetId` or `target === targetId`. Otherwise `wrong-target`. Set that one field. Leave the other two text fields as they were. `null` is a value, not an edge delete.
7. Build a `PGEvaluationReport` with `fingerprint: 'guarded-edit'`, `graphDigest` from `graphDigest(child)` (`src/agent/procedural/graph/canonical.ts`), `taskCount: 0`, `completed: 0`, `meanScore: 0`, `scores: []`, `incomplete: false`, `evaluatedAt` an ISO timestamp.
8. Build a `PGRoundRecord`: `runId` `guarded-edit`, `round: 1`, `retainedRevisionId` the parent revision, `candidateRevisionId` the child, `outcome: 'accepted'`, `baselineMean: null`, `candidateMean: null`, `diagnostics: []`, `repairs: []`, both timestamps ISO, `causedByFailureId: failure.id`.
9. `commitRetainedRevision({ expectedHeadVersion: head.headVersion, revision: child, validation, round })`. This is the backing's existing head update. It is not a new promotion rule. `status: 'conflict'` throws `conflict` and writes no audit entry. Do not call `setHead` as a second step.
10. M3 does not move `PGHead`. `noteHelped` and `retire` are entity operations. A revision id passed to them is `version-not-found`.
11. Audit with `entityName` set to the new `revisionId` and `metadata: { failureId: failure.id, graphId }`. Return `{ kind: 'pg-revision', revision: child, parentRevisionId }`.

### Audit entry

`AuditEntry` (`src/features/AuditLog.ts`) has no metadata field today. Add an optional field:

```typescript
/** Extra attributes. `applyGuardedEdit` sets `{ failureId }`. */
metadata?: Record<string, unknown>;
```

`append` already spreads the entry into the JSON line, so the field is stored. Old lines without it still load.

```typescript
await auditLog.append({
  operation: 'create',
  entityName: newVersionName, // entity name, or the new revision id
  status: 'committed',
  after: kind === 'entity' ? newEntity : { revisionId, parentRevisionId, graphId },
  metadata: { failureId: failure.id },
});
```

One entry. The target is the new version. The metadata names the failure id.

### M2 edge cases

| Case | Result |
|---|---|
| Failure id missing | `failure-not-found`. No write. |
| Failure has no `blamedComponent` | `no-blamed-component`. No write. |
| `targetId` is some other id | `wrong-target`. Old entity still `isLatest !== false`. Entity count unchanged. |
| Two change keys, or a `PGEditSet` key, or `deleteEntity` | `unbounded` or `delete-shaped`. No write. |
| `${root}-vN` already exists | `name-collision`. No write. |
| Observation on a procedure that uses a procedure prefix | `unbounded`. No write. |
| Heuristic edit | New entity is still `isHeuristicMemory`. `support` is unchanged by the edit. |
| `preserveBody` omitted | `supersede` still drops contradicted observations. Existing supersede tests stay green. |
| PG head version mismatch | `conflict`. No audit line. |
| `listRevisions(..., { offset: 0, limit: 0 })` | Returns `items: []` and a `total`. Tests must pass `limit >= 2`. |

### M2 tests

New `tests/unit/agent/GuardedComponentEdit.test.ts`. Temp directory and `ManagerContext` on a JSONL file, the pattern in `tests/integration/features/contradiction-detector-supersede.test.ts`. `ContradictionDetector` gets a semantic-search fake whose `calculateSimilarity` returns `0`. `AuditLog` points at a file in that directory. Clean the directory in `afterEach`.

`it` names:

- `chain length grows by one and the old entity reloads`
- `causedByFailureId matches the failure id`
- `the new version is a draft`
- `rejects a second target before any write`
- `rejects a delete-shaped payload with no storage change`
- `rejects two field changes before any write`
- `rejects a failure that has no blamedComponent`
- `appends one audit entry whose metadata names the failure id`
- `does not call deleteEntities`
- `procedural graph child snapshot parentRevisionId is the previous revision and listRevisions returns both`

The chain test: create entity `widget` with one observation, record a failure that blames `{ kind: 'entity', id: 'widget' }`, call `applyGuardedEdit` with one new observation. `getVersionChain('widget')` has length 2. `getEntity('widget')` still returns the old entity, `isLatest === false`, `supersededBy` the new name. The new entity's observations contain the old text and the new text.

The delete-shaped test spies on `entityManager.deleteEntities` and asserts the spy was not called, and asserts `getEntity('widget')` is unchanged.

The audit test uses `auditLog.query({ entityName: newName })` (or `query({})` and find the line) and expects `metadata.failureId` to equal the failure id.

The graph test uses `InMemoryProceduralGraphBacking` and `createGraph` with one node. `listRevisions(graphId, { offset: 0, limit: 10 })` has `total === 2` and both revision ids. `loadRevision` of the parent still returns the old description.

Extend `tests/integration/features/contradiction-detector-supersede.test.ts`:

- `preserveBody keeps every observation and stores causedByFailureId and lifecycleStatus`

Existing three `supersede` tests stay green (they omit the fourth argument).

### M2 acceptance

- One call yields one new version of the blamed id.
- `getVersionChain` still returns the previous entity. `loadRevision` still returns the previous snapshot.
- The new entity's `causedByFailureId` equals the failure id. The pg round's `causedByFailureId` equals it, and the audit metadata names it.
- A payload that names another id, two fields, or a delete throws before a write.
- The new entity's `lifecycleStatus` is `'draft'`.
- `markResolved` is not called.

---

## M3. Draft, then publish or archive

Depends on M2. Same module. No new status enum. `EntityStatus` and `ENTITY_STATUS_TRANSITIONS` stay as they are. `published → draft` stays illegal. `applyGuardedEdit` already passes `lifecycleStatus: 'draft'` on the create path (initial draft is accepted by `createEntities`; the transition guard runs on update only).

### `getLatestPublished`

`src/core/EntityManager.ts`, next to `getLatestVersion`:

```typescript
/**
 * Newest entity in the version chain whose effective status is `published`.
 * Undefined `lifecycleStatus` counts as published.
 * Returns null when the name is unknown or every version is draft or archived.
 * The head is returned when the head is published.
 */
async getLatestPublished(entityName: string): Promise<Entity | null>
```

Walk `getVersionChain` from the end (highest `version ?? 1` first). Return the first whose `(lifecycleStatus ?? 'published') === 'published'`. This is the trusted-memory read. It does not apply search filters.

`getLatestVersion` stays as it is. A draft head is `isLatest !== false`, so `getLatestVersion` returns the draft.

### Search: published ancestor while the head is a draft

`SearchFilterChain.entityPassesFilters` sees one entity. `BasicSearch`, `BooleanSearch`, and `FuzzySearch` call `applyFilters` on a text-matched subset. If the draft is not in that subset, a check that only looks at the subset treats the parent as an ordinary superseded entity and hides it. Default search would then return nothing for the parent's own text.

Add:

```typescript
/**
 * Names of the nearest published ancestor of a head whose effective
 * status is `draft`. Undefined `lifecycleStatus` counts as published.
 * An archived or draft ancestor is skipped. The walk follows
 * `parentEntityName`. A head that is not a draft adds nothing.
 */
static publishedAncestorsOfDraftHeads(entities: readonly Entity[]): ReadonlySet<string>
```

Walk: group is unnecessary if each head is found by `isLatest !== false`. For each such head with effective status `draft`, start at `parentEntityName` and walk while the parent exists in the array and the walk has not repeated a name. Return the first ancestor whose effective status is `published`. Do not add an older published ancestor behind that one.

`applyFilters(entities, filters, versionContext?)`:

```typescript
versionContext?: { visibleSupersededNames?: ReadonlySet<string> }
```

When `visibleSupersededNames` is omitted, build it from `entities` (correct for `RankedSearch` and `MaterializedViews`, which pass `graph.entities`, and for the filter unit test). When the caller already removed entities, it passes a set built from the full `graph.entities`.

`entityPassesFilters` gains an optional fourth argument, that set. The versioning branch becomes:

- `includeSuperseded` true: do not reject for `isLatest === false`.
- else if `isLatest === false` and the name is not in the set: reject.
- else if `isLatest === false` and the name is in the set: do not reject here.
- The lifecycle branch is unchanged. A draft fails the default `['published']` filter. A published ancestor passes it.

Call sites that pass a subset, and must pass a set built from `graph.entities`:

- `BasicSearch.search` (`src/search/BasicSearch.ts`, the `textMatched` call)
- `BasicSearch.searchByDateRange`
- `BooleanSearch` (the `booleanMatched` call)
- `FuzzySearch` (the `fuzzyMatched` call)

`RankedSearch.searchNodesRanked` and `MaterializedViews` pass the full entity list. Omitting the argument is correct there.

`openNodes` does not use the filter. Asking for the draft by name still returns it.

While the head is `archived` or `published`, the set does not include the parent. After `retire`, default search omits the archived head (lifecycle) and omits the superseded parent (`isLatest === false`). `getLatestPublished` still returns the parent. Do not extend the search exception to archived heads. The roadmap names the draft case only. Hiding the parent after a failed trial is the specified search behavior. Callers that want the last trusted version use `getLatestPublished`.

### `noteHelped` and `retire`

```typescript
export async function noteHelped(
  versionName: string,
  taskId: string,
  deps: GuardedEditContext,
): Promise<Entity>

export async function retire(
  versionName: string,
  taskId: string,
  reason: string,
  deps: GuardedEditContext,
): Promise<Entity>
```

Both throw `version-not-found` or `task-not-found` before any write when `getEntityByName` misses. `taskId` must already be an entity. `createRelations` rejects a dangling endpoint, and a status write must not happen first.

`noteHelped`:

1. Effective status is `(lifecycleStatus ?? 'published')`.
2. `draft` or `archived`: `updateEntity(versionName, { lifecycleStatus: 'published' })`. `archived → published` is legal. Do not pass `expectedVersion` (that would bump `version` and scramble the chain number).
3. `published`: do not call `updateEntity` for status. Do not send `lifecycleStatus: 'draft'`. The state machine treats `published → published` as a no-op. This function does not write it.
4. If `entity.source` is a `MemorySource` (it has `agentId`, `timestamp`, `method`, and `reliability`), `updateEntity` with `source: { ...source, trustLevel: 'verified' }`. If `source` is absent, do not invent one. Combine this with the status patch when both apply, so it is one `updateEntity`.
5. If `isHeuristicMemory(entity)` after the reload, `heuristicManager.reinforce(versionName)`. `reinforce` adds 1 to `heuristicRecord.support` and also moves `confidence`. The acceptance check is `support`. A result other than `'updated'` throws `conflict` (`'not-found'` throws `component-not-found`).
6. `relationManager.createRelations([{ from: versionName, to: taskId, relationType: 'helped_task' }])`. A second call with the same pair is a no-op: `createRelations` drops a triple that already exists. A different `taskId` adds another row.

`retire`:

1. `validateNonEmpty(reason, 'reason', 'retire')`. Store `reason` unchanged. Do not trim a reason that contains non-whitespace.
2. `draft` or `published`: `updateEntity(versionName, { lifecycleStatus: 'archived' })`.
3. `archived`: do not write status (`archived → archived` is a no-op).
4. Do not call a delete, forget, remove, or `ArchiveManager.archiveEntities`.
5. `createRelations([{ from: versionName, to: taskId, relationType: 'retired_after', metadata: { reason } }])`.
6. The entity still loads by `versionName`. `getVersionChain` still contains it.

An entity that never went through `applyGuardedEdit` is not passed to these methods by the acceptance test. Its `lifecycleStatus` stays unset, and `applyFilters` still returns it.

### M3 edge cases

| Case | Result |
|---|---|
| Head is draft, parent is published | `applyFilters` on the full chain returns the parent and not the draft. `getLatestVersion` returns the draft. `getLatestPublished` returns the parent. |
| Head is draft, parent is draft, grandparent is published | The set contains the grandparent only. |
| Head is draft and no published ancestor exists | Default search returns nothing from the chain. |
| Head is published | Superseded parents stay hidden. The head is returned. |
| Head is archived (`retire`) | Default search omits the head and the parent. `getLatestPublished` returns the parent. `getEntity(versionName)` returns the archived entity. |
| Unrelated `isLatest === false` entity with no draft head | Still hidden. The existing versioning tests stay green. |
| `includeSuperseded: true` | Version check does not hide anyone. Lifecycle still hides drafts unless the caller passes `lifecycleStatus`. |
| Text search matches only the parent | Parent is returned, draft is not. The set was built from the full graph. |
| `noteHelped` on a published version | No status write. `helped_task` is still created. A heuristic `support` still increases by one. |
| `noteHelped` with `lifecycleStatus: 'draft'` | This API never does that. |
| `taskId` is not an entity | `task-not-found` before the status write. |
| `retire` reason `''` or whitespace | Throw before a write. |
| Procedure-graph revision id passed to `noteHelped` | `version-not-found`. No `setHead`. |

### M3 tests

Extend `tests/unit/agent/GuardedComponentEdit.test.ts`:

- `noteHelped publishes the draft, writes helped_task, and bumps heuristic support by one`
- `retire archives the version, keeps it loadable, and stores retired_after reason`
- `noteHelped on an already published version does not send it back to draft`
- `retire does not call deleteEntities`
- `noteHelped throws task-not-found before a status write when the task is missing`

The heuristic test: `HeuristicManager.add`, blame that id with `kind: 'heuristic'`, `applyGuardedEdit` with one observation, assert `support` is still 0, create a task entity, `noteHelped`, assert `lifecycleStatus === 'published'`, `support === 1`, and one relation `from` the new version `to` the task with `relationType === 'helped_task'`.

The retire test: `getEntity(versionName)` is defined, `lifecycleStatus === 'archived'`, `getVersionChain` includes that name, the relation `metadata.reason` equals the reason argument, and `deleteEntities` was not called.

Extend `tests/unit/search/search-filter-chain-versioning.test.ts`:

- `when the latest version is draft, default filters return the published parent and omit the draft`
- `when the latest version is archived, default filters omit the head and the superseded parent`
- `a superseded entity with no draft head stays excluded`

The first test builds two entities that share `rootEntityName`, parent `isLatest: false` and `lifecycleStatus: 'published'` (or unset), child `isLatest: true`, `lifecycleStatus: 'draft'`, `parentEntityName` the parent. `applyFilters(chain, {})` returns only the parent.

Extend `tests/unit/core/entity-manager-version-chain.test.ts`:

- `getLatestVersion returns the draft head`
- `getLatestPublished returns the published parent while the head is draft`
- `getLatestPublished returns the published parent after the head is archived`
- `getLatestPublished returns the head when the head is published`

Add one search test, in `tests/unit/search/BasicSearch.test.ts` if that file already constructs a temp graph, otherwise next to the filter test as a `BasicSearch` case:

- `a text query that matches only the published parent returns that parent while the head is draft`

Create parent observation `keeps coffee`, draft observation `trial tea`, search `coffee`. The result entities include the parent and do not include the draft.

### M3 acceptance

- The version M2 writes has `lifecycleStatus: 'draft'`.
- Default search returns the previous published ancestor and omits the draft, including when the query text is only on the ancestor.
- `getLatestVersion` returns the draft.
- After `noteHelped`, the draft is `published`, default search returns it, a `helped_task` relation points at `taskId`, and a heuristic's `support` has increased by one.
- After `retire`, default search omits the archived version, `getVersionChain` still contains it, `getEntity` still loads it, and a `retired_after` relation stores `reason`.
- An entity that never went through `applyGuardedEdit` keeps its current status and its current search behavior.
- `noteHelped` on an already published version does not write `draft`.

---

## Phase 2. `repo-tools clones` cleanup

Branched from `master`. Do not mix it with M1–M3. Those PRs add a module and must not move unrelated functions.

### Command

From the repository root. The pin is `@danielsimonjr/repo-tools@2.3.0`.

```bash
npm install --global --ignore-scripts --no-audit --no-fund @danielsimonjr/repo-tools@2.3.0
repo-tools clones . --src=src --out=../tmp/memoryjs-clones-baseline
```

`--out` rejects an absolute path (exit 2, message `holds an absolute path`). A relative path that starts with `..` is accepted. `resolve(root, out)` then writes outside the checkout. `../tmp/memoryjs-clones-baseline` from this repo is `/tmp/memoryjs-clones-baseline`.

Do not pass `--out=reports/clones` or any path inside the repo. Do not commit `inventory.jsonl` or `clones.json`.

After the run, `git status --short` must not list those files. Exit 0 means the run finished. Exit 1 means no source file. Exit 2 is usage.

The command prints five summary lines and, with `--out`, writes:

- `inventory.jsonl`: one unit per line (`id`, `file`, `name`, `container`, `kind`, `startLine`, `endLine`, `nodes`, `exactHash`, `textHash`, and the other fields in section 17.7 of repo-tools `docs/design.md`).
- `clones.json`: `params`, `exactGroups`, `textGroups`, `near`. A group is a list of unit ids. A near pair is `{ a, b, jStruct, contain, jNames }`.

Defaults, and the values this baseline used: `minNodes` 50, `shingle` 6, `near` 0.6, `containment` 0.9, `containment-min` 20, `rare` 60, `min-shared` 3. `--src=src` is the `src` area. Do not change the thresholds in the cleanup PR. A pair that only appears after lowering `--near` is out of scope.

Resolve an id by parsing `inventory.jsonl` and matching `id`. Do not hard-code line numbers from this plan. They move.

There is no `repo-tools.config.json` in this repo. A future `clones` section would override the defaults. Do not add one.

### Baseline (this plan, before any cleanup)

Command above, on `master` `60102494873a4edb3aa4b1007dd26dca55a60951`, `@danielsimonjr/repo-tools` 2.3.0. Stdout:

```text
files=304 parseErrors=0 units(minNodes=50)=1365
nodes p50=104 p90=292 p99=756 max=1915
exact groups=4 (units in them=8) text-identical groups=1
near pairs=54 by jStruct: 0.9 or more: 5, 0.8 to 0.9: 11, 0.7 to 0.8: 12, 0.6 to 0.7: 15, below 0.6 (containment): 11
units by folder: src/adapters=28 src/agent=547 src/cli=74 src/core=220 src/features=92 src/search=256 src/security=11 src/types=9 src/utils=126 src/workers=2
```

Counts to carry forward:

| Count | Value |
|---|---|
| Units (`minNodes=50`) | 1365 |
| Exact groups | 4 |
| Units in exact groups | 8 |
| Text-identical groups | 1 |
| Near pairs | 54 |
| Parse errors | 0 |
| Files | 304 |

`jStruct` bands inside the 54: `>= 0.9` is 5, `0.8–0.9` is 11, `0.7–0.8` is 12, `0.6–0.7` is 15, below `0.6` (containment rule) is 11.

The four exact groups, resolved from that run's inventory (re-resolve before editing):

| Units | Note |
|---|---|
| `EpisodicMemoryManager.getNextEvent`, `EpisodicMemoryManager.getPreviousEvent` | Same body. One comparison uses `EpisodicRelations.PRECEDES`, the other `FOLLOWS`. |
| `FailureDistillation.buildFailureDescription`, `FailureDistillation.buildLesson` | Same shape. The sentence templates differ. `docs/analysis/DUPLICATE_FUNCTION_AUDIT.md` section 6 kept this pair. |
| `ProceduralGraphState.nextTimestamp`, `SqliteProceduralGraphBacking.nextTimestamp` | The text-identical group. The bodies match, including whitespace-insensitive text. |
| `JsonlColumnStore.put`, `BrotliColdTier.put` | Same rollback-on-failed-flush shape. Parameter names differ (`name`/`T` and `key`/`V`). |

One near pair has `jStruct` 1 and is not an exact group: `FailureManager.getAll` and `PlanManager.listPlans` (57 and 73 labels). Equal shingle sets are not equal label sequences. Section 6 of the audit kept this pair (different record types).

Re-run the same command at the start of the cleanup PR. The five summary lines must match this baseline before the first edit. If they do not, stop. Do not edit against a different count.

### Same-algorithm or look-alike

A score is a reason to read. It is not a verdict. Read both bodies before changing either. The normaliser replaces every identifier with `ID` and every literal with `LIT`, and it drops types and comments. Two functions that call different functions are an exact group when the shape matches.

**Same-algorithm.** Merge it in this PR. The bodies do the same work. Every difference is a name, a literal, a type, a comment, or one parameter that keeps both current behaviors. The `PRECEDES` / `FOLLOWS` pair is this case: one private method takes the relation type. A text-identical pair is this case unless a boundary below applies. `nextTimestamp` is a pure bump of `this.lastTimestamp`. A shared function that takes the previous timestamp and returns the next one is the merge, if the sqlite backing can import that helper without a cycle. Each class keeps a one-line method.

A containment pair (`jStruct` below 0.6, `contain` at least 0.9) is same-algorithm only when the smaller body is a pure piece the larger body should call, and a test pins both old results. If the shared piece is a few lines and a shared helper is longer than the copy, it is a look-alike. The audit's IDF and heap rows are that situation. Do not re-merge them.

**Look-alike.** Do not edit the bodies. The shape matches and the job, the error contract, or the side effects do not. `buildFailureDescription` / `buildLesson` is the expected look-alike: three templates differ, and the shared part is the fallback expression. `getAll` / `listPlans` is the expected look-alike. Constructors that only fill defaults are look-alikes. A sync method and an async method of the same name are look-alikes. Two methods that walk the same loop, one setting bits and one testing them, are look-alikes when the shared part is a handful of lines.

**Boundary.** Do not merge. Record it as a look-alike would be recorded, with verdict `boundary`. The worker bundle (`src/workers/`) must not import the library. Two backings may share a pure helper and must not share a store client. A pair the audit already measured as slower after a merge stays split.

Do not merge a unit with a unit that contains it. The tool does not emit those pairs.

### What the cleanup PR changes

- One family per commit. A family is one exact group, or one near pair, or a set of pairs that are the same helper.
- Behavior stays the same. Add or extend a test that pins the shared result before the commit that deletes the copy.
- A same-algorithm pair is not a ledger row. It is gone from the next `clones` run, or it remains only as the one shared function plus thin callers that fall under `minNodes`.
- A bad merge that creates a new near pair is fixed in this PR. Do not ledger it to skip the work.
- Do not edit `docs/analysis/DUPLICATE_FUNCTION_AUDIT.md` except to add one line at the top pointing at `CLONES_REMAINING.md` as the list of pairs this cleanup left in place. Do not rewrite that audit.
- Run the architecture check and the docs check, as in the stack section. Line counts will drift.

### `docs/analysis/CLONES_REMAINING.md`

Write this file in the cleanup PR. It is the ledger of pairs the cleanup left in the tree. Same-algorithm pairs that were merged are not rows. They are listed once, under Removed, so every baseline group and pair is accounted for.

```markdown
# Clones remaining

**Tool**: `@danielsimonjr/repo-tools` 2.3.0
**Command**: `repo-tools clones . --src=src --out=../tmp/memoryjs-clones-baseline`
**Baseline commit**: 60102494873a4edb3aa4b1007dd26dca55a60951
**Baseline**: 4 exact groups, 8 units in them, 1 text-identical group, 54 near pairs, 1365 units
**After cleanup**: <exact groups>, <units in them>, <text-identical groups>, <near pairs>, <units>
**Cleanup commit**: <sha>

A row is a pair or an exact group this cleanup did not merge. A same-algorithm pair is not a row.

## Removed

| id | was | units | merge |
|---|---|---|---|
| R001 | exact | `src/agent/EpisodicMemoryManager.ts getNextEvent` ; `src/agent/EpisodicMemoryManager.ts getPreviousEvent` | one method, relation type parameter |

`units` names `file`, `container`, and `name` from `inventory.jsonl`. Do not use line numbers. `merge` names the helper and the parameter. One row per baseline exact group or near pair that the follow-up run no longer reports.

## Remaining

| id | result | units | scores | verdict | why it stays |
|---|---|---|---|---|---|
| K001 | exact | `src/agent/FailureDistillation.ts FailureDistillation.buildFailureDescription` ; `src/agent/FailureDistillation.ts FailureDistillation.buildLesson` | exactHash=<hash> jStruct=1 contain=1 | look-alike | The three sentence templates differ. The shared part is the empty-chain fallback. |
| K002 | near | `src/agent/FailureManager.ts FailureManager.getAll` ; `src/agent/PlanManager.ts PlanManager.listPlans` | jStruct=1 contain=1 jNames=0.462 | look-alike | Same guard shape. Different record types and filtered fields. Not an exact group. |

Columns:

| Column | Values |
|---|---|
| `id` | `R001` upward in Removed. `K001` upward in Remaining. Stable inside the file. Do not renumber in a later edit. Append. |
| `result` | `exact`, `text`, or `near`. `text` is a text-identical group. An exact group that is also a near pair at `jStruct` 1 is one row, `result` `exact`. |
| `units` | Two or more units, separated by ` ; `. Each unit is `file container.name` or `file name` when `container` is empty. |
| `scores` | For `exact` and `text`: `exactHash` and, when the pair is also in `near`, `jStruct`, `contain`, `jNames`. For `near`: those three numbers from `clones.json`. |
| `verdict` | `look-alike` or `boundary`. Remaining has no `same-algorithm` verdict. |
| `why it stays` | One or two sentences. Name the contract that differs, or the boundary. "The score is high" is not a reason. |

Header rule: the count of baseline exact groups plus the count of baseline near pairs equals the number of Removed rows plus the number of Remaining rows, except that a near pair which is also an exact group is one item, not two. This baseline has 4 exact groups and 54 near pairs, and each exact group is also a near pair at `jStruct` 1, so the accounted items are 54 (the near list), not 58. The fifth `jStruct === 1` near pair (`getAll` / `listPlans`) is not an exact group and is its own item. After the follow-up run, every current exact group and every current near pair is a Remaining row or was just created by a merge that this PR still has to fix.

Do not paste `clones.json` into the ledger.

### Phase 2 acceptance

- The follow-up `repo-tools clones` run uses the same command and the same thresholds.
- Every baseline near pair is either a Removed row or a Remaining row.
- No Remaining row has verdict `same-algorithm`.
- `git status` does not show `inventory.jsonl` or `clones.json`.
- Tests that pin each merged family pass. `bun run typecheck` and `bun run lint` exit 0. The two repo-tools checks exit 0.

---

## Ambiguities resolved

1. **`findNode` takes a plan id and a node id. The blamed component has one id.** `findNodeOwners` scans every plan. `record` requires exactly one owner. Two owners is a rejected record, not a stored list.
2. **A `pg-node` has no entity and no snapshot on the manager.** `record` takes `pgSnapshot` on the options and does not store it. `applyGuardedEdit` loads `deps.pg.backing` head for `deps.pg.graphId`.
3. **`lookupByComponent` and the limit of 5.** No default limit. `lookupForTask` keeps 5. Status default stays `'open'`.
4. **`entity`, `heuristic`, and `procedure` share `getEntityByName` in the roadmap.** Existence uses that lookup. `heuristic` also requires `isHeuristicMemory`. `procedure` also requires `entityType` `procedure` or `procedure-step`. Otherwise M3's `reinforce` would no-op on a person entity.
5. **`supersede` drops contradicted observations.** That is a second change and a deletion. Guarded edits pass `preserveBody: true`, which skips `detect` and copies subtype fields. The default path is unchanged.
6. **`AuditEntry` has no metadata.** Optional `metadata` was added. The entry's `entityName` is the new version. `metadata.failureId` is the failure id.
7. **A draft head hides its published parent, including when search has already dropped the draft from the candidate list.** The visible-name set is computed from the full entity list. Callers that filter first pass that set in. The exception applies only while the head is `draft`. After `retire` the head is `archived`, default search omits the parent too, and `getLatestPublished` is how a caller still reads it.
8. **`noteHelped` on an already published version.** No status write. The `helped_task` relation is still created. Heuristic `support` still increases. The API never sends `draft`. `archived → published` is allowed because the state machine already allows un-archive.
9. **`source.trustLevel = 'verified'` is optional in the roadmap.** Set it only when `source` is already a `MemorySource`. Do not invent the required source fields.
10. **Procedural-graph head.** `commitRetainedRevision` is the existing head update and is what M2 calls. M3 does not call `setHead`. Draft, `noteHelped`, and `retire` are entity operations. `causedByFailureId` on a graph lives on `PGRoundRecord` and on the audit entry, not on `PGSnapshot`.
11. **`listRevisions` with `limit: 0` returns no items.** Tests pass `limit >= 2`.
12. **`jStruct` 1 is not an exact group.** Equal shingle sets can come from different label sequences (`getAll` / `listPlans`). Read the bodies.
13. **SQLite drops `failureRecord` today.** Not fixed here. M1 tests use the in-memory mock. `causedByFailureId` is added to the SQLite extension list because the new version entity must round-trip.
