# ClawVault Ideas: Review & Implementation Plan

Review of `CLAWVAULT_IDEAS.md` against the existing MemoryJS codebase, with corrections, adjusted priorities, and a concrete implementation plan.

---

## Review & Corrections

### Idea 1: Observer Pipeline — Needs Architectural Rethinking

**Correction:** The proposal describes file-offset cursor-based reading, which is a ClawVault-specific pattern (it watches markdown files on disk). MemoryJS is a library, not a file-watching daemon. The pipeline should be event-driven, hooking into `ObservationManager.addObservations()` and `SessionManager.endSession()` rather than polling files.

**What's already there:**
- `ConsolidationPipeline` already orchestrates working → long-term promotion with pluggable stages
- `SummarizationService` groups and summarizes observations
- `PatternDetector` extracts recurring templates
- `RuleEvaluator` triggers actions on conditions (session_end, confirmation_threshold, etc.)

**What's genuinely new:** A *streaming* observation processor that scores/routes individual observations as they arrive, not just batch-consolidates at session end. The routing concept (decisions → decisions/, tasks → backlog) maps well to MemoryJS's `entityType` and `tags` system.

**Revised scope:** An `ObserverPipeline` that hooks into `ObservationManager` via events, scores incoming observations, auto-tags/routes them by type, and drops low-importance ones. No file watchers.

---

### Idea 2: Context Profiles — Smaller Delta Than Described

**Correction:** The document says "MemoryJS's `ContextWindowManager` does token budgeting but doesn't adjust *what* it retrieves based on task type." This understates existing capabilities. `SalienceEngine` already supports:
- Context-aware scoring with `currentTask`, `currentSession`, `queryText`, `userIntent`, `recentEntities`
- `temporalFocus: 'recent' | 'historical' | 'balanced'` that reshapes recency curves
- Configurable weight distributions per call via `SalienceContext`

**What's genuinely new:** Named profile *presets* that bundle these knobs into reusable configurations, plus auto-detection from query content. The "handoff" profile concept (pull last session state + unfinished tasks) is particularly valuable and has no existing equivalent.

**Revised scope:** A thin `ContextProfileManager` that maps profile names to `SalienceContext` + `ContextRetrievalOptions` configurations, with regex-based auto-detection. Much of this is wiring, not new algorithms.

---

### Idea 3: Fact Extraction — Overlaps with Core Data Model

**Correction:** The proposed `Fact { entity, relation, value }` triple is structurally identical to MemoryJS's existing `Entity` + `Relation` model. Creating a parallel `facts.jsonl` store would fragment the graph. The real value is *auto-extraction* of entities and relations from observation text at write time — enriching the existing graph, not creating a shadow graph.

**Revised scope:** A `FactExtractor` that parses observation text into candidate `Entity` and `Relation` objects, then feeds them into the existing `EntityManager` and `RelationManager`. Deterministic IDs for dedup are useful but should use existing entity names (normalized), not a separate hash scheme.

---

### Idea 4: Transition Ledger — Good Fit, Minor Concern

**Correction:** Mostly accurate. One concern: an append-only JSONL ledger per entity could grow unbounded. Need a retention policy (e.g., compact after N entries, archive old transitions).

**What's already there:** `ConsolidationPipeline.mergeMemories()` records merge audit trails. `AccessTracker` logs access patterns. But there's no general-purpose change log.

**Revised scope:** As described, plus configurable retention and optional integration with `ArchiveManager` for old transitions.

---

### Idea 5: Workgraph Threads — Effort Underestimated

**Correction:** "Medium effort" is optimistic. This is a full coordination subsystem with:
- A state machine (5 states, valid transitions to enforce)
- Exclusive ownership with claim/release (needs deadlock/starvation handling)
- Dependency tracking (needs cycle detection)
- Thread decomposition (tree structure with aggregation of child status)
- Integration with `MultiAgentMemoryManager`, `TransitionLedger`, and `SessionManager`

This is closer to **Medium-High** effort and should be built on top of the Transition Ledger (Idea 4), not independently.

**Revised scope:** Implement after Transition Ledger. Use ledger for state machine transitions rather than mutable fields. Scope down v1 to: create, claim, release, complete, block/unblock. Defer decomposition and advanced coordination to v2.

---

### Idea 6: Session Checkpointing — Accurate Assessment

**Correction:** Mostly accurate. `SessionManager` currently stores session metadata as entities but doesn't serialize working memory state, pipeline progress, or decay snapshots. The "context death detection" concept maps to detecting sessions with status='active' that haven't been updated recently.

**What to add:** A `checkpoint()` method that serializes the full `AgentMemoryManager` state tree (working memories, active session context, decay state) as a compressed blob observation on the session entity. `restore()` rehydrates from it.

---

### Idea 7: Observation Dedup — Gap Overstated

**Correction:** `ObservationManager.addObservations()` already filters exact duplicate observations within an entity (line-level dedup in the `addObservations` method). The gap is *fuzzy* dedup — catching "User prefers dark mode" vs "The user likes dark mode" as duplicates.

**What's already there:**
- `CompressionManager.calculateEntitySimilarity()` computes observation Jaccard similarity
- `SummarizationService.calculateSimilarity()` does word-overlap between observation texts
- `ConsolidationPipeline.findDuplicates()` and `autoMergeDuplicates()` work at entity level

**What's genuinely new:** *Observation-level* similarity dedup at write time, with a merge strategy (keep longest, max importance). This is a hook in `ObservationManager`, not a new subsystem.

**Revised scope:** Add a `deduplicateObservations` option to `addObservations()` with configurable Jaccard threshold (default 0.8). Reuse `SummarizationService.calculateSimilarity()`.

---

### Idea 8: Auto-Linking — Risk of Noise

**Correction:** The concept is sound but needs guardrails. Naively matching entity names in observation text will create false positives (e.g., entity "Project" matching "This project is..."). Need minimum name length, entity type filtering, and a confidence threshold.

**Revised scope:** An `AutoLinker` that scans observation text for entity name mentions, creates `mentions` relations, but only for entities with names ≥ 4 characters or names matching specific types (people, projects, tools). Include a `mentions` relation type with source tracking.

---

## Revised Priority Ranking

| # | Idea | Impact | Effort | Priority | Rationale |
|---|------|--------|--------|----------|-----------|
| 7 | Observation Dedup | High | **Very Low** | **P0** | Hook into existing method, reuse existing similarity code |
| 2 | Context Profiles | High | Low | **P0** | Thin wrapper over existing SalienceEngine/ContextWindowManager |
| 6 | Session Checkpointing | Medium-High | Low-Med | **P1** | Natural SessionManager extension, enables crash recovery |
| 4 | Transition Ledger | Medium-High | Low-Med | **P1** | Foundation for Workgraph (Idea 5), broadly useful |
| 8 | Auto-Linking | Medium | Low | **P1** | Low effort with guardrails, enriches graph passively |
| 1 | Observer Pipeline | High | **Medium-High** | **P2** | Needs careful architecture; depends on Transition Ledger |
| 3 | Fact Extraction | Medium | Medium | **P2** | Useful but rule-based mode is limited; LLM mode needs provider abstraction |
| 5 | Workgraph Threads | High | **Medium-High** | **P3** | Depends on Transition Ledger; complex state machine |

Key changes from original ranking:
- **Idea 7 moved up:** Even lower effort than described since similarity code exists
- **Idea 8 moved up:** Low effort with high passive value
- **Idea 5 moved down:** Effort was underestimated; depends on Idea 4
- **Idea 1 moved down:** Architecture needs rethinking away from file-watching

---

## Implementation Plan

### Phase 1: Quick Wins (P0)

#### 1A. Observation Dedup at Write Time
**Files:** `src/core/ObservationManager.ts`, `src/agent/SummarizationService.ts`

**Steps:**
1. Add `DeduplicationOptions` interface to `src/types/types.ts`:
   ```typescript
   interface DeduplicationOptions {
     enabled: boolean;
     similarityThreshold: number;  // default 0.8
     mergeStrategy: 'keep_longest' | 'keep_newest' | 'keep_both';
   }
   ```
2. Extract `calculateSimilarity()` from `SummarizationService` into a standalone `src/utils/textSimilarity.ts` utility along with its private helpers (`tokenize()`, `buildTFVector()`, `cosineSimilarity()`) — these are all pure functions with no instance dependencies
3. Add optional `dedup?: DeduplicationOptions` parameter to `ObservationManager.addObservations()`
4. Before inserting each observation, compare against existing observations on that entity using TF-IDF cosine similarity (via the extracted utility)
5. If similarity > threshold, apply merge strategy instead of inserting
6. Add `MEMORY_OBSERVATION_DEDUP` env var (default: `false`) for global opt-in
7. Wire into `ManagerContext`

**Tests:** `tests/unit/core/ObservationManager.dedup.test.ts`
- Exact duplicates still filtered (existing behavior)
- Near-duplicates merged when dedup enabled (uses TF-IDF cosine similarity, not Jaccard)
- Threshold respected (below threshold passes, above threshold merges)
- Merge strategies work correctly
- Performance: dedup on 100 observations < 50ms

---

#### 1B. Context Profiles
**Files:** New `src/agent/ContextProfileManager.ts`, modify `src/agent/ContextWindowManager.ts`

**Steps:**
1. Create `ContextProfile` type and `ProfileConfig` interface:
   ```typescript
   type ContextProfile = 'default' | 'planning' | 'incident' | 'handoff' | 'review' | 'auto';

   interface ProfileConfig {
     salienceWeights: {
       importanceWeight: number;
       recencyWeight: number;
       frequencyWeight: number;
       contextWeight: number;
       noveltyWeight: number;
     };
     temporalFocus: 'recent' | 'balanced' | 'historical';
     budgetAllocation: { working: number; episodic: number; semantic: number };
     preferredEntityTypes?: string[];
     maxTokens?: number;          // override default
   }
   ```
2. Define preset profiles:
   - `default`: Balanced weights (current defaults)
   - `planning`: High importance (0.35) + context (0.30), low recency (0.10), prefer 'concept', 'project', 'architecture' types
   - `incident`: High recency (0.40) + importance (0.30), low novelty (0.05), budgets heavily to working memory (50/30/20)
   - `handoff`: High recency (0.35), prefer session entities, auto-include last session's working memories
   - `review`: Balanced with high context (0.30), prefer episodic memories
3. Implement `inferProfile(query: string): ContextProfile` with regex patterns:
   - `incident`: `/outage|sev[0-4]|broken|down|emergency|incident|alert|page/i`
   - `planning`: `/plan|architect|design|roadmap|strategy|proposal/i`
   - `handoff`: `/resume|continue|where.*left|pick.*up|hand.*off|catch.*up/i`
   - `review`: `/review|retrospect|recap|summary|what.*happened/i`
4. Add `profile?: ContextProfile` option to `ContextWindowManager.retrieveForContext()`
5. When profile is `'auto'`, run `inferProfile()` on the query text
6. Apply profile config to salience context and budget allocation before retrieval
7. Expose via `AgentMemoryManager.retrieveForContext(options)` with profile support
8. Wire into `ManagerContext` lazy initialization

**Tests:** `tests/unit/agent/ContextProfileManager.test.ts`
- Each profile produces expected weight distributions
- Auto-detection correctly classifies sample queries
- Profile configs merge properly with explicit overrides
- Handoff profile retrieves last session state

---

### Phase 2: Foundations (P1)

#### 2A. Session Checkpointing
**Files:** Extend `src/agent/SessionManager.ts`, new `src/agent/SessionCheckpoint.ts`

**Steps:**
1. Define `SessionCheckpoint` interface:
   ```typescript
   interface SessionCheckpoint {
     id: string;                    // checkpoint_{sessionId}_{timestamp}
     sessionId: string;
     name?: string;                 // user-provided label
     timestamp: string;
     state: {
       workingMemories: string[];   // entity names
       decaySnapshot: Record<string, number>;  // entity → effective importance
       activeProfile?: ContextProfile;
       metadata: Record<string, unknown>;
     };
   }
   ```
2. Store checkpoints as observations on the session entity (JSON-serialized, prefixed with `[CHECKPOINT]`)
3. Implement `SessionManager.checkpoint(name?)`:
   - Collect working memory entity names for the session
   - Snapshot decay values for all session entities
   - Serialize and store as checkpoint observation
4. Implement `SessionManager.restore(checkpointId)`:
   - Parse checkpoint observation
   - Re-create expired working memories if needed
   - Restore decay values via `DecayEngine.reinforceMemory()`
5. Implement `SessionManager.detectAbnormalEndings()`:
   - Find session entities with status='active' and lastModified > 1 hour ago
   - Return as candidates for recovery
6. Implement `sleep(sessionId)` / `wake(sessionId)`:
   - `sleep`: checkpoint + set status to 'suspended'
   - `wake`: restore checkpoint + set status to 'active'

**Tests:** `tests/unit/agent/SessionCheckpoint.test.ts`

---

#### 2B. Transition Ledger
**Files:** New `src/core/TransitionLedger.ts`

**Steps:**
1. Define `TransitionEvent` interface (as in proposal, plus `id` field)
2. Implement `TransitionLedger` class:
   - Constructor takes storage path (separate from main graph storage)
   - `append(event)`: JSONL append with fsync
   - `query(filter)`: Filter by entityId, agentId, field, time range
   - `detectRegressions(entityId)`: Find reversed state transitions
   - `getHistory(entityId, limit?)`: Recent transitions for an entity
   - `compact(olderThan: Date)`: Archive old entries via `ArchiveManager`
3. Integration points (via `GraphEventEmitter`):
   - `EntityManager`: log importance changes, type changes, deletion
   - `ObservationManager`: log observation additions/removals
   - `RelationManager`: log relation creation/deletion
   - `SessionManager`: log session state transitions
4. Add `MEMORY_TRANSITION_LEDGER` env var (default: `false`)
5. Wire into `ManagerContext` as optional lazy-initialized manager

**Tests:** `tests/unit/core/TransitionLedger.test.ts`

---

#### 2C. Auto-Linking
**Files:** New `src/features/AutoLinker.ts`, modify `src/core/ObservationManager.ts`

**Steps:**
1. Implement `AutoLinker` class:
   - Constructor takes `EntityManager` and `RelationManager`
   - `detectMentions(text, knownEntities)`: Returns entity names found in text
   - Guardrails: skip entity names < 4 characters, skip common words, case-insensitive matching
   - Use word boundary matching (`\b` regex) to avoid partial matches
2. Add `autoLink?: boolean` option to `ObservationManager.addObservations()`
3. When enabled, after adding observations:
   - Get all entity names from storage
   - For each new observation, detect mentions of other entities
   - Create `mentions` relation from the observation's entity to the mentioned entity
   - Skip self-references
4. Add `MEMORY_AUTO_LINK` env var (default: `false`)

**Tests:** `tests/unit/features/AutoLinker.test.ts`

---

### Phase 3: Advanced Features (P2)

#### 3A. Observer Pipeline
**Files:** New `src/agent/ObserverPipeline.ts`

**Steps:**
1. Implement as an event-driven pipeline, not file-based:
   - Subscribe to `GraphEventEmitter` for observation additions
   - Score incoming observations using `SalienceEngine`
   - Route to entity types/tags based on content patterns
   - Drop observations below configurable importance threshold
2. Support both sync (rule-based) and async (LLM) processing modes
3. Integrate with `ContextProfileManager` for profile-aware routing
4. Use `TransitionLedger` to record routing decisions

**Depends on:** Phase 2B (Transition Ledger), Phase 1B (Context Profiles)

---

#### 3B. Fact Extraction
**Files:** New `src/features/FactExtractor.ts`

**Steps:**
1. Rule-based extraction patterns:
   - `X works at Y`, `X is a Y`, `X uses Y`, `X prefers Y`
   - Date patterns, monetary amounts, proper nouns
2. Extract into existing `Entity` + `Relation` model (not parallel `Fact` store)
3. Entity normalization: lowercase, strip titles (Dr., Mr., etc.)
4. Deterministic naming: normalized entity name as identifier
5. Confidence field stored as entity importance (0-10 scaled from 0-1)
6. Optional LLM mode via `ISummarizationProvider` interface (already exists)

**Depends on:** Phase 2C (Auto-Linking, for mention detection reuse)

---

### Phase 4: Coordination (P3)

#### 4A. Workgraph Threads
**Files:** New `src/agent/WorkThreadManager.ts`

**Steps:**
1. Build on `TransitionLedger` for state tracking
2. v1 scope: create, claim, release, complete, block/unblock
3. v2 scope: decomposition, dependency DAG, aggregated status
4. Integrate with `MultiAgentMemoryManager` for ownership

**Depends on:** Phase 2B (Transition Ledger), Phase 2A (Session Checkpointing for crash recovery)

---

## Implementation Order (Summary)

```
Phase 1 (P0) — can be done in parallel:
  ├── 1A: Observation Dedup
  └── 1B: Context Profiles

Phase 2 (P1) — sequential dependencies:
  ├── 2A: Session Checkpointing
  ├── 2B: Transition Ledger
  └── 2C: Auto-Linking (after 2B for ledger integration)

Phase 3 (P2) — depends on Phase 2:
  ├── 3A: Observer Pipeline (after 2B + 1B)
  └── 3B: Fact Extraction (after 2C)

Phase 4 (P3) — depends on Phase 2:
  └── 4A: Workgraph Threads (after 2A + 2B)
```

---

## Open Questions

1. **LLM Provider Abstraction:** Ideas 1 and 3 need LLM access for their "smart" modes. Should this reuse the existing `ISummarizationProvider` interface or create a more general `LLMProvider`?
2. **Storage for Transition Ledger:** Separate JSONL file or stored as entities/observations in the main graph? Separate file is cleaner but adds another storage backend to manage.
3. **Auto-Linking Performance:** Scanning all entity names against every new observation is O(E×O). For large graphs (>10K entities), should we use a trie or inverted index for name matching?
4. **Checkpointing Granularity:** Full state snapshots could be large. Should checkpoints be incremental (delta from last checkpoint)?
