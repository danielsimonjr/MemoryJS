# Phase 1: Agent Memory System Implementation Plan

This document provides a detailed, sprint-based implementation plan for transforming MemoryJS into a comprehensive memory system for AI agents. The plan covers all five architectural phases outlined in `docs/architecture/AGENT_MEMORY.md`.

---

## Executive Summary

**Goal**: Transform MemoryJS from a general-purpose knowledge graph into a specialized memory system for AI agents with cognitive-inspired memory patterns.

**Core Capabilities to Implement**:
- Working memory with TTL-based expiration
- Episodic memory for session/conversation history
- Semantic memory for long-term facts and concepts
- Memory decay, reinforcement, and consolidation
- Context-aware retrieval with salience scoring
- Multi-agent memory sharing and isolation

**Estimated Sprints**: 25 sprints (4-5 tasks each)
**Dependencies**: Builds on existing MemoryJS infrastructure (storage backends, search, graph traversal)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        New Agent Memory Layer                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Sprint 1-5:   Memory Lifecycle Foundation (Types, Access, Decay)       │
│  Sprint 6-10:  Session & Working Memory (TTL, Sessions, Promotion)      │
│  Sprint 11-15: Consolidation Pipeline (Summarization, Patterns)         │
│  Sprint 16-20: Salience & Context Retrieval (Scoring, Token Budget)     │
│  Sprint 21-25: Multi-Agent Support (Identity, Visibility, Conflicts)    │
├─────────────────────────────────────────────────────────────────────────┤
│                    Existing MemoryJS Foundation                         │
│  EntityManager | RelationManager | SearchManager | GraphStorage         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Sprint Breakdown

### Phase 1: Memory Lifecycle Foundation (Sprints 1-5)

This phase establishes the foundational type system and core services for memory lifecycle management.

---

#### Sprint 1: Extended Type Definitions

**Objective**: Define TypeScript interfaces for agent memory entities, observations, and sessions.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **1.1** Create `AgentEntity` interface | Extend the base `Entity` interface with agent-specific fields: `memoryType` (working/episodic/semantic/procedural), `sessionId`, `conversationId`, `taskId`, `expiresAt`, `isWorkingMemory`, `promotedAt`, `promotedFrom`, `accessCount`, `lastAccessedAt`, `accessPattern`, `confidence`, `confirmationCount`, `decayRate`, `agentId`, `visibility`, and `source` tracking. | `src/types/agent-memory.ts` | Interface compiles without errors; all fields documented with JSDoc |
| **1.2** Create `AgentObservation` interface | Define extended observation type with `confidence`, `confirmationCount`, `contradictedBy`, `observedAt`, `validFrom`, `validUntil`, `source` (ObservationSource), `consolidatedFrom`, and `abstractionLevel` fields. | `src/types/agent-memory.ts` | Interface compiles; supports temporal scoping and provenance |
| **1.3** Create `SessionEntity` interface | Extend `AgentEntity` for session tracking with `entityType: 'session'`, `startedAt`, `endedAt`, `status` (active/completed/abandoned), `goalDescription`, `taskType`, `userIntent`, `memoryCount`, `consolidatedCount`, `previousSessionId`, and `relatedSessionIds`. | `src/types/agent-memory.ts` | Session entities can represent full conversation context |
| **1.4** Create `MemorySource` and `ObservationSource` types | Define provenance tracking with `agentId`, `timestamp`, `method` (observed/inferred/told/consolidated), `reliability`, `originalEntityId`, and observation-specific `type` (user_input/agent_inference/external_api/consolidation). | `src/types/agent-memory.ts` | Full audit trail capability for memory origins |
| **1.5** Export types and update barrel | Add exports to `src/types/index.ts`, create type guards (`isAgentEntity`, `isSessionEntity`), and add utility types for memory type narrowing. | `src/types/index.ts`, `src/types/agent-memory.ts` | Types importable from main package; type guards functional |

**Testing Requirements**:
- Unit tests for all type guards
- Compile-time tests ensuring type compatibility with existing Entity

---

#### Sprint 2: Access Tracking Foundation

**Objective**: Implement the `AccessTracker` service to record and analyze memory access patterns.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **2.1** Create `AccessTracker` class skeleton | Implement class with dependency injection for storage, define internal data structures for tracking: `Map<string, AccessRecord>` for per-entity tracking, methods stubs for all interface methods. | `src/agent/AccessTracker.ts` | Class instantiates with storage dependency |
| **2.2** Implement `recordAccess()` method | Record entity access with context (sessionId, taskId, queryContext, retrievalMethod). Update `accessCount`, `lastAccessedAt`, and maintain access history buffer (configurable size, default 100). Persist changes to storage. | `src/agent/AccessTracker.ts` | Access records persisted; history maintained correctly |
| **2.3** Implement `getAccessStats()` method | Return `AccessStats` object with `totalAccesses`, `lastAccessedAt`, `accessPattern` classification (frequent: >10/day, occasional: 1-10/day, rare: <1/day), `averageAccessInterval`, and `accessesBySession` breakdown. | `src/agent/AccessTracker.ts` | Stats accurate for various access patterns |
| **2.4** Implement `calculateRecencyScore()` method | Calculate recency score (0.0-1.0) using exponential decay formula: `e^(-ln(2) * hours_since_access / half_life_hours)`. Default half-life: 24 hours. Score of 1.0 for just-accessed, approaching 0 for old accesses. | `src/agent/AccessTracker.ts` | Scores mathematically correct; configurable half-life |
| **2.5** Implement `getFrequentlyAccessed()` and `getRecentlyAccessed()` | Return top N entities by access frequency (within time window) and recency. Use efficient sorting with heap for large datasets. Support optional time window filtering. | `src/agent/AccessTracker.ts` | Returns correct entities; performance O(n log k) |

**Testing Requirements**:
- Unit tests for each method with mock storage
- Integration test with real storage backend
- Performance test with 10k+ entities

---

#### Sprint 3: Access Tracking Integration

**Objective**: Integrate `AccessTracker` with existing search and retrieval operations.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **3.1** Create `AccessContext` interface | Define context passed to `recordAccess`: `sessionId?`, `taskId?`, `queryContext?` (the search query), `retrievalMethod` (search/direct/traversal). Add builder pattern for easy context construction. | `src/types/agent-memory.ts` | Context captures all relevant access metadata |
| **3.2** Integrate with `SearchManager` | Modify search methods to optionally record access for returned entities. Add `trackAccess?: boolean` option to search methods. When enabled, record access with query context. | `src/search/SearchManager.ts`, `src/agent/AccessTracker.ts` | Search results optionally tracked |
| **3.3** Integrate with `EntityManager.getEntity()` | Add optional access tracking to direct entity retrieval. Record with `retrievalMethod: 'direct'`. Maintain backward compatibility (tracking off by default). | `src/core/EntityManager.ts` | Direct retrieval optionally tracked |
| **3.4** Integrate with `GraphTraversal` | Track access for entities visited during traversal operations. Record with `retrievalMethod: 'traversal'`. Batch record for efficiency on large traversals. | `src/core/GraphTraversal.ts` | Traversal accesses tracked efficiently |
| **3.5** Add `AccessTracker` to `ManagerContext` | Lazy-initialize `AccessTracker` in `ManagerContext`. Expose via `ctx.accessTracker` getter. Wire up event emission for access recording. | `src/core/ManagerContext.ts` | Accessible via context; properly initialized |

**Testing Requirements**:
- Integration tests verifying tracking across operations
- Verify backward compatibility (no breaking changes)
- Test batch recording performance

---

#### Sprint 4: Decay Engine Foundation

**Objective**: Implement the `DecayEngine` for time-based memory importance decay.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **4.1** Create `DecayEngine` class skeleton | Implement class with configurable parameters: `halfLifeHours` (default 168 = 1 week), `importanceModulation` (boolean), `accessModulation` (boolean), `minImportance` (floor, default 0.1). | `src/agent/DecayEngine.ts` | Class instantiates with configuration |
| **4.2** Implement `calculateDecayFactor()` method | Calculate decay using formula: `e^(-ln(2) * age_hours / half_life_hours)`. Age calculated from `lastAccessedAt` or `createdAt`. Apply importance boost: `half_life *= (1 + importance/10)` when `importanceModulation` enabled. | `src/agent/DecayEngine.ts` | Decay mathematically correct; importance modulation works |
| **4.3** Implement `calculateEffectiveImportance()` method | Calculate effective importance: `base_importance * decay_factor * strength_multiplier`. Strength multiplier: `1 + (confirmationCount * 0.1) + (accessCount * 0.01)`. Clamp to `minImportance` floor. | `src/agent/DecayEngine.ts` | Effective importance accounts for all factors |
| **4.4** Implement `getDecayedMemories()` method | Query all `AgentEntity` records and return those with effective importance below threshold. Use efficient filtering with indexed queries where possible. | `src/agent/DecayEngine.ts` | Returns correct set of decayed memories |
| **4.5** Implement `reinforceMemory()` method | Strengthen a memory by: resetting decay (updating `lastAccessedAt` to now), incrementing `confirmationCount`, optionally boosting `confidence`. Emit event for tracking. | `src/agent/DecayEngine.ts` | Memory strength correctly updated; event emitted |

**Testing Requirements**:
- Unit tests for decay calculations with various time deltas
- Test importance modulation effects
- Test strength multiplier calculations

---

#### Sprint 5: Decay Engine Operations

**Objective**: Complete `DecayEngine` with batch operations and forgetting mechanisms.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **5.1** Implement `applyDecay()` batch method | Process all memories, updating their effective importance. Return `DecayResult` with `entitiesProcessed`, `averageDecay`, `memoriesAtRisk` (below threshold but not forgotten). Support dry-run mode. | `src/agent/DecayEngine.ts` | Batch processing efficient; accurate statistics |
| **5.2** Implement `forgetWeakMemories()` method | Delete or archive memories below `effectiveImportanceThreshold`. Support filters: `olderThanHours`, `excludeTags` (protected tags), `dryRun`. Return `ForgetResult` with counts and affected entity names. | `src/agent/DecayEngine.ts` | Correct memories forgotten; exclusions respected |
| **5.3** Create `DecayOptions` and `ForgetOptions` types | Define configuration interfaces with all tunable parameters. Add validation for ranges (e.g., `halfLifeHours` > 0, threshold 0-1). | `src/types/agent-memory.ts` | Options fully typed with validation |
| **5.4** Add scheduled decay job support | Create `DecayScheduler` utility that can run `applyDecay()` and `forgetWeakMemories()` on configurable intervals. Support cron-like scheduling. Integrate with existing task scheduler if present. | `src/agent/DecayScheduler.ts` | Scheduled decay runs correctly; configurable intervals |
| **5.5** Add `DecayEngine` to `ManagerContext` | Lazy-initialize `DecayEngine` with `AccessTracker` dependency. Expose via `ctx.decayEngine`. Add configuration via environment variables (`MEMORY_DECAY_HALF_LIFE_HOURS`, etc.). | `src/core/ManagerContext.ts` | Accessible via context; configurable via env |

**Testing Requirements**:
- Integration tests for full decay cycle
- Test scheduled job execution
- Performance test with large entity sets

---

### Phase 2: Session & Episodic Memory (Sprints 6-10)

This phase implements session management and working memory with TTL-based expiration.

---

#### Sprint 6: Working Memory Manager Foundation

**Objective**: Create the `WorkingMemoryManager` for session-scoped, TTL-based memory.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **6.1** Create `WorkingMemoryManager` class skeleton | Implement class with storage dependency, default TTL (24 hours), max memories per session limit (100). Define internal session-to-memories index. | `src/agent/WorkingMemoryManager.ts` | Class instantiates; configuration accepted |
| **6.2** Implement `createWorkingMemory()` method | Create new `AgentEntity` with `memoryType: 'working'`, `isWorkingMemory: true`, `sessionId`, calculated `expiresAt` based on TTL. Auto-generate unique name if not provided. Validate session exists. | `src/agent/WorkingMemoryManager.ts` | Working memories created with correct metadata |
| **6.3** Implement `getSessionMemories()` method | Return all working memories for a session. Use indexed lookup for O(1) session access. Support optional filters: `entityType`, `taskId`, `importance` range. | `src/agent/WorkingMemoryManager.ts` | Correct memories returned; filtering works |
| **6.4** Implement `clearExpired()` method | Query all working memories where `expiresAt < now`. Delete or archive based on configuration. Return count of cleared memories. Support batch deletion for efficiency. | `src/agent/WorkingMemoryManager.ts` | Expired memories cleared; count accurate |
| **6.5** Implement `extendTTL()` method | Extend expiration for specified entities by adding hours to `expiresAt`. Validate entities exist and are working memories. Return success status per entity. | `src/agent/WorkingMemoryManager.ts` | TTL extended correctly; validation enforced |

**Testing Requirements**:
- Unit tests for TTL calculations
- Test session isolation
- Test expiration edge cases

---

#### Sprint 7: Working Memory Promotion

**Objective**: Implement promotion pipeline from working to long-term memory.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **7.1** Implement `markForPromotion()` method | Set flag on working memory indicating promotion candidacy. Add `markedForPromotion: true` field. Optionally specify target memory type (episodic/semantic). | `src/agent/WorkingMemoryManager.ts` | Memories correctly marked; metadata preserved |
| **7.2** Implement `getPromotionCandidates()` method | Return working memories meeting promotion criteria: `markedForPromotion` OR (`confidence >= threshold` AND `confirmationCount >= N`). Sort by promotion priority (confidence * confirmations). | `src/agent/WorkingMemoryManager.ts` | Correct candidates returned; priority ordering |
| **7.3** Implement basic `promoteMemory()` method | Convert working memory to target type: update `memoryType`, clear `expiresAt`, set `promotedAt` and `promotedFrom`, remove `isWorkingMemory` flag. Keep entity in place (no move/delete). | `src/agent/WorkingMemoryManager.ts` | Memory type converted; metadata correct |
| **7.4** Create `WorkingMemoryOptions` type | Define options interface: `ttlHours`, `autoPromote` (auto-promote on confirmation threshold), `taskId`, `importance`, `autoPromoteThreshold` (confidence threshold). | `src/types/agent-memory.ts` | Options typed; validation rules defined |
| **7.5** Add auto-promotion trigger | When `autoPromote` enabled and entity reaches confirmation threshold, automatically promote. Emit `memory:promoted` event. Support opt-out for specific memories. | `src/agent/WorkingMemoryManager.ts` | Auto-promotion triggers correctly; events emitted |

**Testing Requirements**:
- Test promotion criteria evaluation
- Test auto-promotion triggers
- Verify promotion preserves data integrity

---

#### Sprint 8: Session Management

**Objective**: Implement full session lifecycle management.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **8.1** Create `SessionManager` class | Manage session lifecycle: creation, updates, ending. Maintain active sessions index. Inject `WorkingMemoryManager` dependency for memory operations. | `src/agent/SessionManager.ts` | Class instantiates; sessions trackable |
| **8.2** Implement `startSession()` method | Create new `SessionEntity` with `status: 'active'`, `startedAt: now`, goal/task metadata. Generate unique session ID. Register session for tracking. Return session entity. | `src/agent/SessionManager.ts` | Sessions created correctly; IDs unique |
| **8.3** Implement `endSession()` method | Update session: set `endedAt`, `status` (completed/abandoned), calculate `memoryCount`. Trigger consolidation if configured. Clean up working memories (delete or promote). | `src/agent/SessionManager.ts` | Sessions ended correctly; cleanup executed |
| **8.4** Implement `getActiveSession()` and `getSessionHistory()` | Return current active session(s) for agent. Return paginated session history with optional filters: date range, status, task type. | `src/agent/SessionManager.ts` | Active sessions retrievable; history queryable |
| **8.5** Implement session linking | Support `previousSessionId` for continuation sessions. Add `linkSessions()` method to create `relatedSessionIds` connections. Track session chains for context continuity. | `src/agent/SessionManager.ts` | Sessions linkable; chains traversable |

**Testing Requirements**:
- Test full session lifecycle
- Test session linking
- Test cleanup on session end

---

#### Sprint 9: Session-Scoped Queries

**Objective**: Add session-aware query capabilities to search and retrieval.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **9.1** Add session filtering to search | Extend search options with `sessionId` filter. When specified, only return memories from that session. Support `includeRelatedSessions` option. | `src/search/SearchManager.ts` | Session filtering works correctly |
| **9.2** Create `SessionQueryBuilder` | Fluent interface for building session-scoped queries: `forSession(id).withTaskId(task).inTimeRange(start, end).search(query)`. Returns filtered results. | `src/agent/SessionQueryBuilder.ts` | Builder pattern works; queries execute correctly |
| **9.3** Add temporal queries | Support queries like "memories from last N sessions", "memories created today", "memories during task X". Create helper methods for common temporal patterns. | `src/agent/SessionQueryBuilder.ts` | Temporal queries return correct results |
| **9.4** Implement cross-session search | Search across multiple sessions with relevance ranking. Weight recent sessions higher. Support session type filtering (completed only, etc.). | `src/search/SearchManager.ts`, `src/agent/SessionQueryBuilder.ts` | Cross-session search ranks correctly |
| **9.5** Add session context to retrieval | When retrieving entities, optionally include session context (which session created it, related sessions). Add `includeSessionContext` option. | `src/core/EntityManager.ts` | Session context returned correctly |

**Testing Requirements**:
- Test session filtering accuracy
- Test cross-session ranking
- Performance test with many sessions

---

#### Sprint 10: Episodic Memory Structure

**Objective**: Implement episodic memory organization for conversation/event history.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **10.1** Create `EpisodicMemoryManager` class | Manage episodic memories with temporal ordering. Support event sequences and causal relationships. Use relations for event chains. | `src/agent/EpisodicMemoryManager.ts` | Class manages episodic memories correctly |
| **10.2** Implement event sequencing | Create memories as ordered events with `previousEvent` and `nextEvent` relations. Support `createEventSequence()` for batch event creation. | `src/agent/EpisodicMemoryManager.ts` | Event sequences maintain order |
| **10.3** Implement timeline queries | Query episodic memories by time range. Return in chronological order. Support forward and reverse iteration. | `src/agent/EpisodicMemoryManager.ts` | Timeline queries return ordered results |
| **10.4** Add causal relationship tracking | Track `causes` and `causedBy` relations between episodic memories. Support querying causal chains. | `src/agent/EpisodicMemoryManager.ts` | Causal chains queryable |
| **10.5** Integrate with session lifecycle | When session ends, convert session's event log to episodic memories. Link episodic memories to source session. | `src/agent/SessionManager.ts`, `src/agent/EpisodicMemoryManager.ts` | Session events become episodic memories |

**Testing Requirements**:
- Test event sequence integrity
- Test timeline query accuracy
- Test causal chain traversal

---

### Phase 3: Decay & Consolidation (Sprints 11-15)

This phase implements the consolidation pipeline for memory promotion and abstraction.

---

#### Sprint 11: Consolidation Pipeline Foundation

**Objective**: Create the `ConsolidationPipeline` for memory transformation and promotion.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **11.1** Create `ConsolidationPipeline` class skeleton | Implement class with dependencies: storage, `WorkingMemoryManager`, `DecayEngine`. Define pipeline stages as pluggable processors. | `src/agent/ConsolidationPipeline.ts` | Class instantiates; pipeline structure defined |
| **11.2** Implement `consolidateSession()` method | Process all memories from a session: evaluate promotion criteria, apply summarization if enabled, create semantic memories from patterns. Return `ConsolidationResult`. | `src/agent/ConsolidationPipeline.ts` | Session memories processed correctly |
| **11.3** Create `ConsolidateOptions` type | Define options: `summarize`, `extractPatterns`, `minConfidence`, `minConfirmations`, `preserveOriginals` (keep working memories after promotion). | `src/types/agent-memory.ts` | Options fully typed; sensible defaults |
| **11.4** Implement `promoteMemory()` with target type | Extend basic promotion to specify target (`episodic` or `semantic`). Apply different rules per target: episodic keeps temporal context, semantic abstracts away. | `src/agent/ConsolidationPipeline.ts` | Promotion respects target type rules |
| **11.5** Create `ConsolidationResult` type | Define result structure: `memoriesProcessed`, `memoriesPromoted`, `memoriesMerged`, `patternsExtracted`, `summariesCreated`, `errors`. | `src/types/agent-memory.ts` | Result captures all pipeline outcomes |

**Testing Requirements**:
- Test session consolidation
- Test promotion rules per type
- Test error handling

---

#### Sprint 12: Observation Summarization

**Objective**: Implement observation summarization for memory compression.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **12.1** Implement `summarizeObservations()` method | Group similar observations on an entity using similarity threshold. Create summary observation from groups. Track `consolidatedFrom` provenance. | `src/agent/ConsolidationPipeline.ts` | Similar observations grouped and summarized |
| **12.2** Add similarity detection for observations | Use existing search infrastructure (embeddings if available, TF-IDF fallback) to compute observation similarity. Configurable threshold (default 0.8). | `src/agent/ConsolidationPipeline.ts` | Similarity detection accurate |
| **12.3** Implement LLM-based summarization (optional) | If `MEMORY_SUMMARIZATION_PROVIDER` configured, use LLM to generate natural language summary. Create `SummarizationService` interface for provider abstraction. | `src/agent/SummarizationService.ts` | LLM summarization works; fallback for no provider |
| **12.4** Create abstraction levels | Increment `abstractionLevel` when summarizing: 0=raw, 1=summarized, 2=generalized. Track lineage through consolidation chain. | `src/agent/ConsolidationPipeline.ts` | Abstraction levels tracked correctly |
| **12.5** Implement `SummarizationResult` type | Define result: `originalCount`, `summaryCount`, `compressionRatio`, `summaries` (the new observations), `sourceObservations`. | `src/types/agent-memory.ts` | Result captures summarization details |

**Testing Requirements**:
- Test similarity grouping
- Test abstraction level tracking
- Test LLM summarization integration

---

#### Sprint 13: Pattern Extraction

**Objective**: Extract patterns and generalizations from repeated observations.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **13.1** Implement `extractPatterns()` method | Analyze entities of specified type for recurring observation patterns. Require minimum occurrences. Return identified patterns. | `src/agent/ConsolidationPipeline.ts` | Patterns extracted from repeated observations |
| **13.2** Create pattern detection algorithm | Use token-based pattern matching: identify common templates with variable slots. Example: "User prefers {X}" pattern from "User prefers blue", "User prefers red". | `src/agent/PatternDetector.ts` | Patterns identified with variable slots |
| **13.3** Create semantic memory from patterns | When pattern meets threshold, create new semantic memory entity representing the generalization. Link to source entities. | `src/agent/ConsolidationPipeline.ts` | Semantic memories created from patterns |
| **13.4** Implement `PatternResult` type | Define result: `pattern` (template string), `variables` (extracted values), `occurrences`, `confidence`, `sourceEntities`. | `src/types/agent-memory.ts` | Pattern results fully described |
| **13.5** Add pattern-based retrieval | Enable queries like "find all entities matching pattern X". Support pattern variables in search. | `src/search/SearchManager.ts` | Pattern-based search works |

**Testing Requirements**:
- Test pattern detection accuracy
- Test semantic memory creation
- Test pattern-based retrieval

---

#### Sprint 14: Memory Merging

**Objective**: Implement duplicate detection and memory merging.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **14.1** Implement `mergeMemories()` method | Merge multiple entities into one using specified strategy: `newest` (keep most recent), `strongest` (highest confidence), `merge_observations` (combine all). | `src/agent/ConsolidationPipeline.ts` | Memories merged correctly per strategy |
| **14.2** Implement duplicate detection | Leverage existing `CompressionManager` duplicate detection. Extend for agent memory fields (consider `sessionId`, `agentId` in similarity). | `src/agent/ConsolidationPipeline.ts` | Duplicates detected accurately |
| **14.3** Implement observation merging | When merging entities, combine observations: remove exact duplicates, merge similar with summarization, preserve provenance chain. | `src/agent/ConsolidationPipeline.ts` | Observations merged without loss |
| **14.4** Update relations on merge | Retarget relations from merged entities to surviving entity. Handle potential duplicate relations. Emit merge event. | `src/agent/ConsolidationPipeline.ts` | Relations correctly retargeted |
| **14.5** Create merge audit trail | Store merge history: which entities merged, when, by what rule, resulting entity. Enable "unmerge" for reversibility (soft delete). | `src/agent/ConsolidationPipeline.ts` | Merge history trackable; reversible |

**Testing Requirements**:
- Test all merge strategies
- Test relation retargeting
- Test merge reversibility

---

#### Sprint 15: Auto-Consolidation Rules

**Objective**: Implement rule-based automatic consolidation triggers.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **15.1** Create `ConsolidationRule` type | Define rule structure: `trigger` (session_end/time_elapsed/confirmation_threshold/manual), `conditions` (minConfidence, minConfirmations, minAccessCount, memoryType), `action` (promote/summarize/merge/archive). | `src/types/agent-memory.ts` | Rules fully typed |
| **15.2** Implement `runAutoConsolidation()` method | Process rules against all memories. Execute actions for memories meeting conditions. Return aggregate result. | `src/agent/ConsolidationPipeline.ts` | Auto-consolidation executes correctly |
| **15.3** Add rule evaluation engine | Evaluate rule conditions against entity. Support complex conditions (AND/OR logic). Cache evaluation results for performance. | `src/agent/RuleEvaluator.ts` | Rules evaluated correctly; caching works |
| **15.4** Implement trigger hooks | Fire consolidation on triggers: session end (hook into `SessionManager`), time elapsed (scheduled job), confirmation threshold (entity update hook). | `src/agent/ConsolidationPipeline.ts` | Triggers fire consolidation correctly |
| **15.5** Add `ConsolidationPipeline` to `ManagerContext` | Lazy-initialize pipeline with all dependencies. Expose via `ctx.consolidationPipeline`. Add env vars for auto-consolidation config. | `src/core/ManagerContext.ts` | Pipeline accessible; configured via env |

**Testing Requirements**:
- Test rule evaluation
- Test trigger mechanisms
- Test auto-consolidation end-to-end

---

### Phase 4: Context-Aware Retrieval (Sprints 16-20)

This phase implements salience-based retrieval optimized for LLM context windows.

---

#### Sprint 16: Salience Engine Foundation

**Objective**: Create the `SalienceEngine` for context-aware memory relevance scoring.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **16.1** Create `SalienceEngine` class skeleton | Implement class with configurable weights: recency (0.2), frequency (0.1), context relevance (0.5), novelty (0.2). Inject `AccessTracker`, `DecayEngine` dependencies. | `src/agent/SalienceEngine.ts` | Class instantiates; weights configurable |
| **16.2** Create `SalienceContext` type | Define context interface: `currentTask?`, `currentSession?`, `recentEntities?`, `queryText?`, `userIntent?`, `temporalFocus` (recent/historical/any). | `src/types/agent-memory.ts` | Context captures all relevance factors |
| **16.3** Implement `calculateSalience()` method | Calculate salience score combining: `base_importance * decay_factor + recency_boost + frequency_boost + context_relevance + novelty_bonus`. Each component weighted. Return 0-1 score. | `src/agent/SalienceEngine.ts` | Salience calculated correctly |
| **16.4** Implement recency and frequency boosts | Calculate `recency_boost` from `AccessTracker.calculateRecencyScore()`. Calculate `frequency_boost` from normalized access count. Both scaled by weights. | `src/agent/SalienceEngine.ts` | Boosts calculated and weighted correctly |
| **16.5** Create `ScoredEntity` type | Define result: `entity`, `salienceScore`, `components` breakdown (baseImportance, recencyBoost, frequencyBoost, contextRelevance, noveltyBoost). | `src/types/agent-memory.ts` | Scores include component breakdown |

**Testing Requirements**:
- Test salience calculation
- Test component weighting
- Test score normalization

---

#### Sprint 17: Context Relevance Scoring

**Objective**: Implement task and query relevance scoring for salience.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **17.1** Implement `calculateTaskRelevance()` method | Use semantic similarity (if embeddings available) or keyword matching to score entity relevance to `taskDescription`. Return 0-1 score. | `src/agent/SalienceEngine.ts` | Task relevance scored correctly |
| **17.2** Implement query text matching | Score entity relevance to `queryText` using existing search infrastructure. Normalize search scores to 0-1 range. | `src/agent/SalienceEngine.ts` | Query relevance scored correctly |
| **17.3** Implement session context scoring | Boost entities from `currentSession`. Slightly boost entities from `recentEntities` (recently accessed). Configurable session boost factor. | `src/agent/SalienceEngine.ts` | Session context boosts applied |
| **17.4** Implement `calculateNovelty()` method | Score novelty based on: inverse access frequency (rarely accessed = novel), time since last access, unique observations ratio. Higher novelty = more surprising/interesting. | `src/agent/SalienceEngine.ts` | Novelty scored correctly |
| **17.5** Implement temporal focus filtering | When `temporalFocus` is 'recent', heavily boost recent memories. When 'historical', boost older memories. When 'any', no temporal bias. | `src/agent/SalienceEngine.ts` | Temporal focus affects scoring correctly |

**Testing Requirements**:
- Test task relevance scoring
- Test novelty calculation
- Test temporal focus effects

---

#### Sprint 18: Context Window Manager Foundation

**Objective**: Create the `ContextWindowManager` for token-budgeted retrieval.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **18.1** Create `ContextWindowManager` class skeleton | Implement class with configurable `maxTokens` default (4000), token estimation method. Inject `SalienceEngine` dependency. | `src/agent/ContextWindowManager.ts` | Class instantiates; configurable |
| **18.2** Implement `estimateTokens()` method | Estimate token count for an entity. Use simple heuristic (words * 1.3) or tiktoken if available. Include entity name, type, and observations in estimate. | `src/agent/ContextWindowManager.ts` | Token estimates reasonably accurate |
| **18.3** Create `ContextRetrievalOptions` type | Define options: `maxTokens`, `context` (SalienceContext), `includeWorkingMemory`, `includeEpisodicRecent`, `includeSemanticRelevant`, `mustInclude` (entity names). | `src/types/agent-memory.ts` | Options fully typed |
| **18.4** Implement `prioritize()` method | Given list of entities and token budget, select subset that maximizes total salience while fitting budget. Use greedy algorithm with salience/tokens ratio. | `src/agent/ContextWindowManager.ts` | Prioritization maximizes salience within budget |
| **18.5** Create `ContextPackage` type | Define result: `memories`, `totalTokens`, `breakdown` (by memory type), `excluded` (what didn't fit), `suggestions` (what to retrieve if more space). | `src/types/agent-memory.ts` | Package captures complete retrieval result |

**Testing Requirements**:
- Test token estimation accuracy
- Test prioritization algorithm
- Test budget constraints respected

---

#### Sprint 19: Context-Optimized Retrieval

**Objective**: Implement the main retrieval algorithm for LLM context.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **19.1** Implement `retrieveForContext()` method | Main retrieval method combining all sources per options. Score candidates with `SalienceEngine`. Prioritize within budget. Return `ContextPackage`. | `src/agent/ContextWindowManager.ts` | Complete retrieval pipeline works |
| **19.2** Implement working memory retrieval | When `includeWorkingMemory`, get session's working memories. Reserve portion of budget (configurable, default 30%). | `src/agent/ContextWindowManager.ts` | Working memory included correctly |
| **19.3** Implement episodic retrieval | When `includeEpisodicRecent`, get recent episodic memories (last N sessions). Reserve portion of budget (default 30%). | `src/agent/ContextWindowManager.ts` | Recent episodic included correctly |
| **19.4** Implement semantic retrieval | When `includeSemanticRelevant`, run semantic search with context. Reserve portion of budget (default 40%). Use hybrid search if available. | `src/agent/ContextWindowManager.ts` | Semantic relevance included correctly |
| **19.5** Implement `mustInclude` handling | Ensure specified entities always included. Subtract their tokens from budget first. Warn if `mustInclude` exceeds budget. | `src/agent/ContextWindowManager.ts` | Must-include entities always present |

**Testing Requirements**:
- Test full retrieval pipeline
- Test budget allocation across types
- Test must-include behavior

---

#### Sprint 20: Spillover and Diversity

**Objective**: Handle context overflow and ensure retrieval diversity.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **20.1** Implement `handleSpillover()` method | When content exceeds budget, track what was excluded. Generate suggestions for follow-up retrieval. Enable pagination patterns. | `src/agent/ContextWindowManager.ts` | Spillover tracked; suggestions generated |
| **20.2** Implement diversity enforcement | Avoid redundant memories in context. Detect similarity between included memories. Replace duplicates with diverse alternatives. | `src/agent/ContextWindowManager.ts` | Context has minimal redundancy |
| **20.3** Add `getMostSalient()` to `SalienceEngine` | Convenience method returning top N most salient entities for context. Efficient implementation with heap-based selection. | `src/agent/SalienceEngine.ts` | Top salient entities returned efficiently |
| **20.4** Create memory formatting utilities | Format memories for LLM consumption: `formatForPrompt()` creating structured text, `formatAsJSON()` for structured output. Respect token limits per memory. | `src/agent/MemoryFormatter.ts` | Memories formatted correctly for LLMs |
| **20.5** Add `ContextWindowManager` and `SalienceEngine` to `ManagerContext` | Lazy-initialize both managers. Expose via `ctx.contextWindow` and `ctx.salienceEngine`. Add env vars for token budget config. | `src/core/ManagerContext.ts` | Managers accessible; configurable |

**Testing Requirements**:
- Test spillover handling
- Test diversity enforcement
- Test memory formatting

---

### Phase 5: Multi-Agent Support (Sprints 21-25)

This phase implements agent identity, memory visibility, and cross-agent operations.

---

#### Sprint 21: Agent Identity

**Objective**: Implement agent registration and identity management.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **21.1** Create `MultiAgentMemoryManager` class skeleton | Implement class managing multiple agents. Store agent metadata. Handle default agent for single-agent scenarios. | `src/agent/MultiAgentMemoryManager.ts` | Class instantiates; manages agents |
| **21.2** Implement `registerAgent()` method | Register agent with ID and metadata (name, type, trustLevel, capabilities). Validate unique ID. Create agent entity for tracking. | `src/agent/MultiAgentMemoryManager.ts` | Agents registered correctly |
| **21.3** Create `AgentMetadata` type | Define metadata: `name`, `type`, `trustLevel` (0-1), `capabilities[]`, `createdAt`, `lastActiveAt`. | `src/types/agent-memory.ts` | Metadata fully typed |
| **21.4** Implement `getAgent()` and `listAgents()` | Retrieve agent metadata by ID. List all registered agents with optional filters. | `src/agent/MultiAgentMemoryManager.ts` | Agent queries work correctly |
| **21.5** Add agent context to operations | Add `agentId` parameter to memory creation. Track owning agent on all new memories. Support agent context inheritance. | `src/agent/MultiAgentMemoryManager.ts` | Agent ownership tracked correctly |

**Testing Requirements**:
- Test agent registration
- Test agent queries
- Test ownership tracking

---

#### Sprint 22: Memory Visibility

**Objective**: Implement visibility controls for agent memories.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **22.1** Implement visibility field handling | Enforce `visibility` field on `AgentEntity`: 'private' (only owner), 'shared' (specified agents), 'public' (all agents). Default from config. | `src/agent/MultiAgentMemoryManager.ts` | Visibility enforced correctly |
| **22.2** Implement `createAgentMemory()` method | Create memory with agent ownership and visibility. Validate agent exists. Set default visibility from agent config or env. | `src/agent/MultiAgentMemoryManager.ts` | Memories created with correct visibility |
| **22.3** Implement `getVisibleMemories()` method | Return memories visible to specified agent: own private + shared with agent + public. Efficient indexed query by visibility. | `src/agent/MultiAgentMemoryManager.ts` | Visibility filtering correct |
| **22.4** Implement `shareMemory()` method | Change memory visibility. Support sharing with specific agents (add to shared list) or 'all' (set public). Validate owner permission. | `src/agent/MultiAgentMemoryManager.ts` | Sharing works correctly |
| **22.5** Add visibility filtering to search | Extend search to automatically filter by visibility for requesting agent. Add `agentId` to search context. | `src/search/SearchManager.ts` | Search respects visibility |

**Testing Requirements**:
- Test visibility enforcement
- Test sharing operations
- Test search filtering

---

#### Sprint 23: Cross-Agent Operations

**Objective**: Enable memory operations across agents.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **23.1** Implement `getSharedMemories()` method | Get all memories shared between two or more agents. Support filtering by memory type, time range. | `src/agent/MultiAgentMemoryManager.ts` | Shared memories retrieved correctly |
| **23.2** Implement cross-agent search | Search across all visible memories from multiple agents. Rank by relevance, optionally by agent trust level. | `src/agent/MultiAgentMemoryManager.ts` | Cross-agent search works |
| **23.3** Add trust-weighted scoring | When combining memories from multiple agents, weight by agent's `trustLevel`. Higher trust = higher score contribution. | `src/agent/MultiAgentMemoryManager.ts` | Trust weighting applied correctly |
| **23.4** Implement memory copying | Allow agent to copy shared memory to own private store. Track original source. Enable annotation with agent's perspective. | `src/agent/MultiAgentMemoryManager.ts` | Memory copying works; provenance tracked |
| **23.5** Add collaboration events | Emit events when agents share, access each other's memories. Create audit trail for multi-agent interactions. | `src/agent/MultiAgentMemoryManager.ts` | Collaboration events emitted |

**Testing Requirements**:
- Test cross-agent queries
- Test trust weighting
- Test collaboration tracking

---

#### Sprint 24: Conflict Resolution

**Objective**: Handle conflicting memories from multiple agents.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **24.1** Implement conflict detection | Detect when memories from different agents contradict. Use observation similarity + negation detection. Track in `contradictedBy` field. | `src/agent/ConflictResolver.ts` | Conflicts detected correctly |
| **24.2** Create `ConflictStrategy` type | Define strategies: 'most_recent', 'highest_confidence', 'most_confirmations', 'trusted_agent', 'merge_all'. Each with clear resolution rules. | `src/types/agent-memory.ts` | Strategies fully defined |
| **24.3** Implement `resolveConflict()` method | Apply strategy to conflicting memories. Return resolved memory. Track resolution in audit trail. Support manual override. | `src/agent/MultiAgentMemoryManager.ts`, `src/agent/ConflictResolver.ts` | Conflicts resolved per strategy |
| **24.4** Implement `mergeCrossAgent()` method | Merge memories from multiple agents into unified view. Weight by trust. Preserve provenance from all sources. Handle observation conflicts. | `src/agent/MultiAgentMemoryManager.ts` | Cross-agent merge works |
| **24.5** Add conflict notifications | Emit `memory:conflict` event when detected. Include conflicting entities, suggested resolution. Enable subscription for manual review. | `src/agent/ConflictResolver.ts` | Conflict events emitted |

**Testing Requirements**:
- Test conflict detection
- Test all resolution strategies
- Test cross-agent merge

---

#### Sprint 25: Integration and Facade

**Objective**: Create unified API and integrate all agent memory components.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **25.1** Create `AgentMemoryManager` facade | Unified API wrapping all agent memory operations. Methods: `startSession()`, `addWorkingMemory()`, `retrieveForContext()`, `consolidateSession()`, etc. | `src/agent/AgentMemoryManager.ts` | Facade provides unified API |
| **25.2** Implement configuration loading | Create `AgentMemoryConfig` interface. Load from env vars and/or programmatic config. Apply defaults. Validate configuration. | `src/agent/AgentMemoryConfig.ts` | Configuration loads correctly |
| **25.3** Add `AgentMemoryManager` to `ManagerContext` | Expose complete agent memory system via `ctx.agentMemory`. Wire up all dependencies. Lazy initialization. | `src/core/ManagerContext.ts` | Agent memory accessible via context |
| **25.4** Create integration tests | End-to-end tests covering: session lifecycle, memory consolidation, context retrieval, multi-agent scenarios. Verify all components work together. | `tests/integration/agent-memory/` | Integration tests pass |
| **25.5** Create documentation and examples | Write usage documentation with examples. Cover single-agent and multi-agent scenarios. Add to docs/. Update CLAUDE.md. | `docs/agent-memory/`, `CLAUDE.md` | Documentation complete and accurate |

**Testing Requirements**:
- Comprehensive integration tests
- Performance benchmarks
- Documentation review

---

## Environment Variables Summary

Add these to the environment configuration:

```bash
# Memory Lifecycle
MEMORY_WORKING_TTL_HOURS=24
MEMORY_DECAY_HALF_LIFE_HOURS=168
MEMORY_DECAY_MIN_IMPORTANCE=0.1
MEMORY_FORGET_THRESHOLD=0.05

# Consolidation
MEMORY_AUTO_CONSOLIDATE=true
MEMORY_CONSOLIDATE_MIN_CONFIDENCE=0.7
MEMORY_CONSOLIDATE_MIN_CONFIRMATIONS=2
MEMORY_SUMMARIZATION_PROVIDER=none  # 'openai' or 'none'

# Context Window
MEMORY_DEFAULT_TOKEN_BUDGET=4000
MEMORY_TOKEN_ESTIMATOR=simple  # 'simple' or 'tiktoken'

# Multi-Agent
MEMORY_MULTI_AGENT_ENABLED=false
MEMORY_DEFAULT_VISIBILITY=private
MEMORY_CONFLICT_STRATEGY=highest_confidence
```

---

## File Structure

New files to be created:

```
src/
├── agent/
│   ├── index.ts                    # Barrel export
│   ├── AccessTracker.ts            # Sprint 2-3
│   ├── DecayEngine.ts              # Sprint 4-5
│   ├── DecayScheduler.ts           # Sprint 5
│   ├── WorkingMemoryManager.ts     # Sprint 6-7
│   ├── SessionManager.ts           # Sprint 8
│   ├── SessionQueryBuilder.ts      # Sprint 9
│   ├── EpisodicMemoryManager.ts    # Sprint 10
│   ├── ConsolidationPipeline.ts    # Sprint 11-15
│   ├── SummarizationService.ts     # Sprint 12
│   ├── PatternDetector.ts          # Sprint 13
│   ├── RuleEvaluator.ts            # Sprint 15
│   ├── SalienceEngine.ts           # Sprint 16-17, 20
│   ├── ContextWindowManager.ts     # Sprint 18-20
│   ├── MemoryFormatter.ts          # Sprint 20
│   ├── MultiAgentMemoryManager.ts  # Sprint 21-24
│   ├── ConflictResolver.ts         # Sprint 24
│   ├── AgentMemoryManager.ts       # Sprint 25
│   └── AgentMemoryConfig.ts        # Sprint 25
├── types/
│   └── agent-memory.ts             # Sprint 1 (new file)
tests/
├── unit/agent/                     # Unit tests per class
└── integration/agent-memory/       # Integration tests
docs/
└── agent-memory/                   # Usage documentation
```

---

## Dependencies

External dependencies to evaluate/add:

| Package | Purpose | Sprint |
|---------|---------|--------|
| `tiktoken` | Accurate token counting (optional) | Sprint 18 |
| `cron` | Scheduled job support (optional) | Sprint 5 |

All other functionality builds on existing MemoryJS infrastructure.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Performance degradation with access tracking | Batch writes, configurable tracking, opt-in per operation |
| Token estimation inaccuracy | Support multiple estimators, calibration tests |
| Memory bloat from history tracking | Configurable history limits, automatic cleanup |
| Multi-agent complexity | Feature-flagged, disabled by default |
| LLM summarization cost | Optional, fallback to algorithmic summarization |

---

## Success Metrics

- **Unit test coverage**: >80% for all new code
- **Integration test coverage**: All major workflows tested
- **Performance**:
  - Access tracking: <1ms overhead per operation
  - Decay processing: <100ms for 10k entities
  - Context retrieval: <50ms for typical workload
- **Memory overhead**: <10% increase in base memory usage
- **API usability**: Clean, consistent API matching design doc

---

## Conclusion

This implementation plan transforms MemoryJS into a cognitive-inspired memory system for AI agents across 25 sprints. Each sprint delivers testable, incremental value while building toward the complete vision outlined in the Agent Memory System design.

The phased approach ensures:
1. **Foundation first**: Types and core services established before complex features
2. **Incremental delivery**: Each sprint produces working, tested code
3. **Backward compatibility**: Existing MemoryJS usage unaffected
4. **Extensibility**: Plugin points for future enhancements (procedural memory, distributed memory)

Begin with Sprint 1 to establish the type foundation, then proceed sequentially through each sprint.
