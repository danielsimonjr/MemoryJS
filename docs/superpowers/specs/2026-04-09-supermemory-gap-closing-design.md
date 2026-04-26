# Design: Supermemory Gap-Closing (Sprint 1 MUST Features)

**Date:** 2026-04-09
**Status:** ✅ **Shipped as v1.8.0** — auto-maintained user profile, two-tier semantic forget, memory versioning + contradiction resolution, project/container scoping. See CHANGELOG v1.8.0.
**Branch:** `feature/must-have-8` → merged to master.
**Related:** `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`

## Goal

Close the Sprint 1 MUST gap with supermemory by adding four features to memoryjs, preserving memoryjs's local-first architecture and 94-tool MCP surface. Features are implemented in dependency order so each is independently shippable.

1. **Project Scoping** — `projectId` on Entity, filter propagation through `SearchFilterChain`
2. **Memory Versioning** — version chain fields on Entity, `ContradictionDetector` with semantic similarity
3. **Semantic Forget** — two-tier deletion (exact → 0.85 semantic) with audit logging
4. **User Profile** — `ProfileManager` backed by Entity type `"profile"` with static/dynamic facts

## Non-Goals

- Project CRUD (projects are implicit — they exist when entities reference them)
- Cross-project search (scoping means isolation by design)
- Project-level permissions (memoryjs is local-first)
- Cloud sync, OAuth, or external connectors (out of Sprint 1 scope)
- Migration of existing data (new fields are optional; existing entities work unchanged)

## Entity Model Changes (shared by all features)

```typescript
export interface Entity {
  // ... existing fields ...

  // === Project Scoping (Feature 1) ===
  /** Project/container scope identifier. Undefined = global/unscoped. */
  projectId?: string;

  // === Memory Versioning (Feature 2) ===
  /** Version number, starting at 1. Incremented on contradiction. */
  version?: number;
  /** Name of the entity this supersedes (previous version). */
  parentEntityName?: string;
  /** Name of the original entity in the version chain. */
  rootEntityName?: string;
  /** Whether this is the latest version in its chain. Default: true. */
  isLatest?: boolean;
  /** Name of the entity that superseded this one. */
  supersededBy?: string;
}
```

**Design choices:**
- `projectId` is a simple string, not a foreign key. Matches supermemory's `containerTag`.
- Version fields use entity names (not IDs) since names are already unique in memoryjs.
- `isLatest` defaults to `true` — existing entities need no migration.
- No `isForgotten` field — use actual deletion with `AuditLog` instead.

**SQLite schema additions:**
```sql
ALTER TABLE entities ADD COLUMN projectId TEXT;
ALTER TABLE entities ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE entities ADD COLUMN isLatest INTEGER DEFAULT 1;
CREATE INDEX idx_entities_projectId ON entities(projectId);
CREATE INDEX idx_entities_isLatest ON entities(isLatest);
```
Migration is additive — `ALTER TABLE` + `ADD COLUMN` for existing DBs via `SQLiteStorage` migration block pattern (same as `migrateRelationsTable`).

**JSONL serialization:**
Fields are added to the explicit serialization blocks in `GraphStorage.appendEntity()`, `saveGraphInternal()`, and `updateEntity()`, alongside the existing `parentId` handling.

---

## Feature 1: Project Scoping

### Files touched

| File | Change |
|------|--------|
| `src/types/types.ts` | Add `projectId` to Entity |
| `src/search/SearchFilterChain.ts` | Add `projectId` to `SearchFilters`, add check in `entityPassesFilters()`, add to `hasActiveFilters()` |
| `src/core/GraphStorage.ts` | Serialize `projectId` in `appendEntity`, `saveGraphInternal`, `updateEntity` |
| `src/core/SQLiteStorage.ts` | Column + index + migration + all INSERT/UPDATE bindings |
| `src/core/ManagerContext.ts` | Accept `defaultProjectId` option; expose `.defaultProjectId` |
| `src/core/EntityManager.ts` | Auto-stamp `projectId` on new entities from context default |
| `src/search/SearchManager.ts` | Pass `projectId` through all search method signatures as filter option |

### New MCP tools (memory-mcp)
- `list_projects` — scan all entities, return distinct `projectId` values
- `set_project_scope(projectId)` — set `defaultProjectId` on the active context

### Error handling
- Invalid `projectId` (empty string): throw `ValidationError`
- Searching with `projectId` that has no entities: return empty results (not an error)
- `projectId` on operations with `GovernanceManager`: no change — governance unaware of scoping

### Testing
- Unit: `SearchFilterChain.entityPassesFilters` with `projectId` filter matrix (global, scoped, mixed)
- Integration: create entities in 2 projects, verify cross-project isolation in all 4 search methods
- Storage round-trip: save + load entities with `projectId` on both backends
- Migration: open a pre-v1.8.0 SQLite DB, verify `ALTER TABLE` runs and existing entities get `projectId = NULL`

---

## Feature 2: Memory Versioning / Contradiction Resolution

### New file: `src/features/ContradictionDetector.ts`

```typescript
export interface Contradiction {
  existingObservation: string;
  newObservation: string;
  similarity: number;
}

export class ContradictionDetector {
  constructor(
    private semanticSearch: SemanticSearch,
    private storage: GraphStorage,
    private threshold: number = 0.85
  ) {}

  /** Check if new observations contradict existing ones on the entity. */
  async detect(
    entity: Entity,
    newObservations: string[]
  ): Promise<Contradiction[]>;

  /** Create a new entity version superseding the old one. */
  async supersede(
    oldEntity: Entity,
    newObservations: string[],
    entityManager: EntityManager
  ): Promise<Entity>;
}
```

### Integration hook: `ObservationManager.addObservations()`

Insert before `entity.observations.push(...)` (around line 67):
```typescript
if (this.contradictionDetector) {
  const contradictions = await this.contradictionDetector.detect(entity, newObservations);
  if (contradictions.length > 0) {
    return this.contradictionDetector.supersede(entity, newObservations, this.entityManager);
  }
}
```

### Supersede algorithm

1. Clone `oldEntity` with new name: `${oldEntity.name}-v${oldEntity.version + 1}`
2. Set `parentEntityName = oldEntity.name`, `rootEntityName = oldEntity.rootEntityName ?? oldEntity.name`
3. Set `version = (oldEntity.version ?? 1) + 1`, `isLatest = true`
4. Replace contradicted observations in new entity, append non-contradicted
5. Update `oldEntity`: `isLatest = false`, `supersededBy = newEntity.name`
6. Both writes happen in a single transaction via `TransactionManager`
7. `CompressionManager.mergeEntities` gains a guard to refuse merging across version chains

### Search behavior
- `SearchFilterChain` filters `isLatest !== false` by default
- New `includeSuperseded?: boolean` option in `SearchFilters` to see version history
- All existing searches auto-filter superseded versions (back-compat: entities without `isLatest` are treated as `isLatest: true`)

### New MCP tools (memory-mcp)
- `get_entity_versions(name)` — return all versions in the chain for an entity
- `get_version_chain(rootName)` — return full chain rooted at a given entity

### Configuration
- Disabled by default — activate via `MEMORY_CONTRADICTION_DETECTION=true` env var or `ManagerContext` option
- Requires embedding provider configured (`MEMORY_EMBEDDING_PROVIDER`)
- Threshold configurable via `MEMORY_CONTRADICTION_THRESHOLD` (default 0.85)

### Error handling
- No embedding provider + detection enabled: log warning, skip detection (don't fail)
- Transaction failure during supersede: rollback both writes, throw `VersioningError`
- Circular version chain detection: `rootEntityName` cannot equal `supersededBy`

### Testing
- Unit: `ContradictionDetector.detect()` with known contradictory pairs
- Unit: `supersede()` creates correct chain, transitions flags correctly
- Integration: full flow via `addObservations`, verify chain navigation
- Regression: existing entities without version fields still work in all search methods
- `CompressionManager` does not merge across version chains

---

## Feature 3: Semantic Forget

### New file: `src/features/SemanticForget.ts`

```typescript
export interface ForgetResult {
  method: 'exact' | 'semantic' | 'not_found';
  deletedObservations: { entityName: string; observation: string }[];
  deletedEntities: string[];
  similarity?: number;
}

export interface ForgetOptions {
  threshold?: number;   // default 0.85
  projectId?: string;
  dryRun?: boolean;
  agentId?: string;     // for audit log
}

export class SemanticForget {
  constructor(
    private storage: GraphStorage,
    private observationManager: ObservationManager,
    private entityManager: EntityManager,
    private semanticSearch?: SemanticSearch,
    private auditLog?: AuditLog
  ) {}

  async forgetByContent(
    content: string,
    options?: ForgetOptions
  ): Promise<ForgetResult>;
}
```

### Algorithm

1. **Exact pass:** Scan entities (filtered by `projectId`). Find observations where `observation === content`. If any match:
   - If `dryRun`, return `{ method: 'exact', deletedObservations: [...], deletedEntities: [] }`
   - Else: call `observationManager.deleteObservations()`, manually append to `auditLog`, check if any entity now has zero observations and delete it too
2. **Semantic fallback** (only if exact found nothing AND `semanticSearch` is available):
   - Call `semanticSearch.search(graph, content, 5, threshold)` — entity-level semantic match
   - For each matching entity, pick the observation with the highest `SemanticSearch.calculateSimilarity(content, observation)` score (re-embed per observation, compare cosine)
   - Delete only the single best-matching observation per entity (not all observations)
   - If an entity's best observation similarity < `threshold`, skip that entity
3. **Not found:** Return `{ method: 'not_found', deletedObservations: [], deletedEntities: [] }`
4. **Audit log entry:**
   ```typescript
   await auditLog.append({
     operation: 'delete',
     entityName,
     agentId: options?.agentId,
     before: entitySnapshot,
     after: undefined,
     status: 'committed'
   });
   ```

### Integration

Wired into `ManagerContext` as a lazy getter alongside other features:
```typescript
get semanticForget(): SemanticForget {
  return (this._semanticForget ??= new SemanticForget(
    this.storage, this.observationManager, this.entityManager,
    this.semanticSearch, this.governanceManager?.auditLog
  ));
}
```

### New MCP tool (memory-mcp)
- `forget_memory(content, threshold?, dryRun?, projectId?)` — returns `ForgetResult`

### Error handling
- No semantic search configured + no exact match: return `method: 'not_found'` (graceful)
- `GovernanceManager.canDelete` returns false: throw `POLICY_VIOLATION` (via manual check since `deleteObservations` bypasses governance)
- Storage error mid-deletion: let it propagate (transaction semantics handled by storage layer)

### Testing
- Unit: exact match path (case-sensitive, one entity, multi-entity)
- Unit: semantic fallback path (mock `SemanticSearch` with known similarity scores)
- Unit: `dryRun` never mutates storage
- Unit: entity with all observations deleted is itself deleted
- Integration: audit log entry format and content
- Integration: `projectId` scoping isolates forgets to the correct project

---

## Feature 4: User Profile (Entity-Backed)

### New file: `src/agent/ProfileManager.ts`

```typescript
export interface ProfileResponse {
  static: string[];
  dynamic: string[];
  entityName: string;
}

export interface ProfileManagerConfig {
  staticThreshold?: number;    // default 0.6 (baseImportance threshold)
  dynamicRecencyThreshold?: number;  // default 0.5 (recencyBoost threshold)
  maxDynamicFacts?: number;    // default 20
  namePattern?: string;        // default "profile-{projectId}" (uses "profile-global" if no projectId)
}

export class ProfileManager {
  constructor(
    private storage: GraphStorage,
    private entityManager: EntityManager,
    private sessionManager: SessionManager,
    private salienceEngine: SalienceEngine,
    private config: ProfileManagerConfig = {}
  ) {}

  async getProfile(options?: {
    projectId?: string;
    agentId?: string
  }): Promise<ProfileResponse>;

  async extractFromSession(sessionId: string): Promise<string[]>;

  async addFact(
    content: string,
    type: 'static' | 'dynamic',
    options?: { projectId?: string }
  ): Promise<void>;

  async promoteFact(
    content: string,
    options?: { projectId?: string }
  ): Promise<void>;
}
```

### Data model

Profile is stored as an Entity with:
- `entityType: "profile"`
- `name: "profile-" + sanitize(projectId)` where `sanitize` is `projectId ?? "global"`, lowercased, with non-alphanumeric chars replaced by `-` (e.g. `"My Project!"` → `"profile-my-project-"`)
- `observations: string[]` where each is prefixed `[static] <fact>` or `[dynamic] <fact>`
- `importance: 10` (always top priority)
- `projectId: <scope>` (if scoped)
- Profile entity names are reserved — user attempts to create an entity with a `profile-*` name throw `ValidationError`

**Why tagged observations instead of separate fields:**
- Leverages existing storage, search, tags, hierarchy, governance, import/export for free
- No new storage schema needed
- Search can find profile facts via existing search methods
- The `[static]`/`[dynamic]` prefix is parseable and human-readable

### getProfile algorithm

1. Resolve entity name: `profile-${projectId ?? 'global'}`
2. Try `entityManager.getEntity(name)`. If not found, return empty `ProfileResponse`
3. Parse observations: split by prefix into `static` and `dynamic` arrays (strip prefix)
4. Return `{ static, dynamic, entityName }`

### extractFromSession algorithm

1. Load session via `sessionManager.getSession(sessionId)`
2. For each observation in the session's `SessionEntity.observations`:
   - Compute salience via `salienceEngine.calculateSalience(observation, { temporalFocus: 'recent' })`
   - Skip if below threshold
   - Classify: if `baseImportance > staticThreshold` and `recencyBoost < 0.2` → `static`, else → `dynamic`
3. Deduplicate against existing profile observations (exact match)
4. Append new facts to profile entity via `observationManager.addObservations()`
5. Trim dynamic facts to `maxDynamicFacts` (FIFO, oldest dynamic first)
6. Return list of newly added facts

### promoteFact algorithm

1. Get profile entity
2. Find observation matching `[dynamic] ${content}`
3. Replace with `[static] ${content}` via `observationManager.deleteObservations` + `addObservations`

### Auto-extraction hook

In `AgentMemoryManager`, on the existing `session:ended` event:
```typescript
this.on('session:ended', async (session) => {
  if (this.config.profile?.autoExtract !== false) {
    await this.profileManager.extractFromSession(session.id);
  }
});
```

### AgentMemoryManager integration

Following the lazy-init pattern (line 145 for field, line ~278 for getter):
```typescript
private _profileManager?: ProfileManager;

get profileManager(): ProfileManager {
  return (this._profileManager ??= new ProfileManager(
    this.storage,
    this.entityManager,
    this.sessionManager,
    this.salienceEngine,
    this.config.profile ?? {}
  ));
}
```

`AgentMemoryConfig` gains a `profile?: ProfileManagerConfig` slice.

### Type additions (`src/types/agent-memory.ts`)

```typescript
export interface ProfileEntity extends AgentEntity {
  entityType: 'profile';
}

export function isProfileEntity(entity: Entity): entity is ProfileEntity {
  return entity.entityType === 'profile';
}
```

### New MCP tools (memory-mcp)
- `get_profile(projectId?)` — returns `ProfileResponse`
- `update_profile(content, type, projectId?)` — adds a static or dynamic fact
- `promote_profile_fact(content, projectId?)` — moves dynamic → static

### Error handling
- Profile entity does not exist: `getProfile` returns empty response (not an error)
- Session not found in `extractFromSession`: throw `SessionNotFoundError`
- `SalienceEngine` not available: skip auto-classification, default all facts to `dynamic`
- Observation with malformed prefix: log warning, treat as dynamic

### Testing
- Unit: prefix parsing (`[static]` vs `[dynamic]` vs no prefix)
- Unit: `getProfile` for existing + missing profile
- Unit: classification thresholds with mocked salience scores
- Unit: FIFO trimming of dynamic facts at `maxDynamicFacts`
- Unit: `promoteFact` transitions dynamic → static
- Integration: full auto-extract flow via `session:ended` event
- Integration: project-scoped profiles are isolated

---

## Implementation Order (Dependency Chain)

1. **Entity model + storage** (foundation — all features depend)
2. **Feature 1: Project Scoping** (uses Entity model only)
3. **Feature 2: Memory Versioning** (uses Entity model + SearchFilterChain)
4. **Feature 3: Semantic Forget** (uses Feature 1 for scoping, independent otherwise)
5. **Feature 4: User Profile** (uses Features 1, 2, 3 — builds on full stack)

Each step ends with a committed, passing test suite and can be released independently as a minor version bump.

## Versioning Strategy

- Current: v1.5.0 (package.json); project memory references v1.7.0 feature work in progress on `feature/must-have-8`
- This spec targets **v1.8.0** — the next minor release after must-have-8 merges
- Each feature is independently shippable (v1.8.0-alpha.1 through v1.8.0-alpha.4 if desired)

## Open Questions

1. **Contradiction detection opt-in/opt-out?** Current design: opt-in via env var. Alternative: opt-in per-entity via a `detectContradictions?: boolean` field.
2. **Profile entity name collisions** — resolved: `profile-*` namespace is reserved; user creation attempts throw `ValidationError`.
3. **Cross-project profile inheritance?** Should a project's profile inherit from the global profile? Not in Sprint 1 scope; defer.

## Success Criteria

- All 4 features land without breaking any of the 4,674 existing tests
- `npm run typecheck` passes after each feature
- New features add ~150-250 new tests total (unit + integration)
- No performance regression in existing search benchmarks (>5%)
- MCP tool count grows from 94 → ~104 (10 new tools across 4 features)
- Every new MCP tool has a test exercising it through the memory-mcp server
- Documentation updated: `CHANGELOG.md`, `README.md` feature list, `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md` status column
