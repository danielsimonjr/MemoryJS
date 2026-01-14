# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Agent Memory System

### Added

#### Sprint 1: Extended Type Definitions
- **AgentEntity Interface**: Extended Entity with 20+ fields for AI agent memory systems
  - Memory classification (working/episodic/semantic/procedural)
  - Session and task context (sessionId, conversationId, taskId)
  - Lifecycle management (expiresAt, promotedAt, markedForPromotion)
  - Access tracking (accessCount, lastAccessedAt, accessPattern)
  - Memory strength (confidence, confirmationCount, decayRate)
  - Multi-agent support (agentId, visibility, source)
- **AgentObservation Interface**: Extended observations with confidence, temporal validity, provenance
- **SessionEntity Interface**: Session tracking with status, goals, and session linking
- **MemorySource Interface**: Provenance tracking for memory origin
- **Type Guards**: isAgentEntity, isSessionEntity, isWorkingMemory, isEpisodicMemory, isSemanticMemory, isProceduralMemory
- **AccessContextBuilder**: Fluent builder for access context construction
- **Utility Types**: WorkingMemoryEntity, EpisodicMemoryEntity, SemanticMemoryEntity, ProceduralMemoryEntity

#### Sprint 2: Access Tracking Foundation
- **AccessTracker Class**: Tracks memory access patterns for decay and ranking
  - recordAccess() with context (session, task, query, retrieval method)
  - getAccessStats() with pattern classification (frequent/occasional/rare)
  - calculateRecencyScore() using exponential decay formula
  - getFrequentlyAccessed() and getRecentlyAccessed() with time filtering
  - Static utility calculateRecencyScoreFromTimestamp()
- **AccessStats Interface**: Statistics including access counts, patterns, intervals
- **AccessTrackerConfig**: Configurable buffer size, half-life, frequency thresholds

#### Sprint 3: Access Tracking Integration
- **SearchManager Integration**: Optional access tracking via SearchOptionsWithTracking
- **EntityManager Integration**: Optional access tracking via GetEntityOptions for getEntity()
- **GraphTraversal Integration**: Optional access tracking via TraversalOptionsWithTracking for findShortestPath() and findAllPaths()
- **ManagerContext Integration**: AccessTracker lazy-initialized and wired to all managers

#### Sprint 4: Decay Engine Foundation
- **DecayEngine Class**: Time-based memory importance decay with exponential decay formula
  - calculateDecayFactor() with configurable half-life and importance modulation
  - calculateEffectiveImportance() combining base importance, decay, and strength multiplier
  - getDecayedMemories() to find memories below threshold
  - getMemoriesAtRisk() to identify at-risk memories
  - reinforceMemory() to strengthen memories against decay
  - applyDecay() for batch decay analysis
  - Static calculateDecayFactorStatic() utility
- **DecayEngineConfig**: Configurable half-life, modulation settings, minimum floor
- **Strength Multiplier**: Confirmations (+10% each) and accesses (+1% per 100)

#### Sprint 5: Decay Engine Operations
- **forgetWeakMemories() Method**: Delete or archive memories below effective importance threshold
  - Support for age filtering (olderThanHours)
  - Tag exclusion protection (excludeTags)
  - Dry-run mode for preview
  - Removes related relations when forgetting
- **DecayScheduler Class**: Scheduled periodic decay and forget operations
  - Configurable decay interval (decayIntervalMs)
  - Optional auto-forget with forgetOptions
  - Callbacks for monitoring (onDecayComplete, onForgetComplete, onError)
  - Manual cycle execution via runNow()
- **ManagerContext Integration**: DecayEngine and DecayScheduler accessible via context
  - Environment variable configuration (MEMORY_DECAY_*, MEMORY_AUTO_DECAY, etc.)
  - Lazy initialization with proper dependency wiring

#### Sprint 6: Working Memory Manager Foundation
- **WorkingMemoryManager Class**: Session-scoped, TTL-based short-term memory management
  - createWorkingMemory() with auto-generated unique names
  - getSessionMemories() with filtering by entityType, taskId, importance
  - clearExpired() for automatic cleanup of TTL-expired memories
  - extendTTL() to extend memory lifetime
  - markForPromotion() and getPromotionCandidates() for promotion workflow
- **WorkingMemoryConfig**: Configurable defaults (TTL, max per session, auto-promote thresholds)
- **SessionMemoryFilter**: Filter options for session memory queries
- **Session Index**: In-memory index for O(1) session lookups

#### Sprint 7: Working Memory Promotion
- **Enhanced markForPromotion()**: Added PromotionMarkOptions for target type and priority
  - targetType option to specify 'episodic' or 'semantic' destination
  - Adds promote_to_{type} tag for promotion workflow tracking
- **Enhanced getPromotionCandidates()**: Added PromotionCriteria for flexible candidate selection
  - Priority-based sorting (marked candidates get +100 priority)
  - Customizable thresholds for confidence, confirmations, and access count
  - includeMarked option to filter marked-only candidates
- **promoteMemory() Method**: Convert working memory to long-term storage
  - Supports promotion to episodic or semantic memory types
  - Clears TTL-related fields (expiresAt, isWorkingMemory, markedForPromotion)
  - Sets promotion tracking metadata (promotedAt, promotedFrom)
  - Removes entity from session index after promotion
- **confirmMemory() Method**: Strengthen memories with confirmation tracking
  - Increments confirmationCount on each call
  - Optional confidence boost parameter
  - Auto-promotion trigger when thresholds met (if enabled)
- **New Interfaces**: PromotionMarkOptions, PromotionCriteria, PromotionResult, ConfirmationResult

#### Sprint 8: Session Management
- **SessionManager Class**: Full session lifecycle management for conversations and tasks
  - startSession() with auto-generated or custom session IDs
  - Support for goal description, task type, and user intent metadata
  - Session continuation via previousSessionId linking
  - endSession() with configurable cleanup and promotion
  - getActiveSession() and getActiveSessions() for current session queries
  - getSessionHistory() with filtering by status, taskType, agentId, date range
  - Pagination support for session history
- **Session Linking**: Bidirectional session relationship management
  - linkSessions() for relating multiple sessions
  - getSessionChain() for traversing session continuity chains
  - Automatic linking when continuing from previous session
- **End Session Options**: Configurable behavior on session end
  - promoteOnEnd: Promote high-confidence memories to long-term storage
  - cleanupOnEnd: Delete remaining working memories
  - EndSessionResult with promotion and cleanup statistics
- **New Interfaces**: SessionConfig, StartSessionOptions, SessionHistoryOptions, EndSessionResult

#### Sprint 9: Session-Scoped Queries
- **SessionQueryBuilder Class**: Fluent interface for building session-scoped queries
  - forSession() to restrict to single session
  - forSessions() to search across multiple sessions
  - withRelatedSessions() to include related session memories
  - fromCurrentSession() and fromLastNSessions() for common patterns
  - Chainable filter methods for task, importance, and memory types
- **Temporal Query Helpers**: Easy date-based filtering
  - createdToday() for today's memories only
  - createdInLastHours(n) and createdInLastDays(n) for relative time
  - inTimeRange(start, end) for explicit date ranges
- **Cross-Session Search**: Search across multiple sessions with ranking
  - searchWithRecencyRanking() applies recency boost to recent sessions
  - Deduplication across session boundaries
- **Entity With Context**: Retrieve entities with session metadata
  - getEntityWithContext() returns entity with session and related sessions
  - EntityWithContext interface for typed context access
- **New Interfaces**: SessionSearchOptions, EntityWithContext, SearchFunction

#### Sprint 10: Episodic Memory Structure
- **EpisodicMemoryManager Class**: Temporal and causal organization of event history
  - createEpisode() for creating episodic memories with session/task context
  - createEventSequence() for batch creation of linked events
  - linkSequence() for linking existing events in temporal order
- **Temporal Relations**: Bidirectional event sequencing
  - EpisodicRelations constants (PRECEDES, FOLLOWS, CAUSES, CAUSED_BY, PART_OF_SEQUENCE)
  - Automatic linking when previousEventId specified
  - getNextEvent() and getPreviousEvent() for navigation
- **Timeline Queries**: Chronological retrieval of episodic memories
  - getTimeline() with ascending/descending order and time range filtering
  - iterateForward() and iterateBackward() async generators
  - Pagination support with limit/offset
  - getAllEpisodes() for cross-session retrieval
- **Causal Relationship Tracking**: Cause-effect chains between events
  - addCausalLink() creates bidirectional causes/caused_by relations
  - getCausalChain() traverses causal chains with cycle detection
  - getDirectCauses() and getDirectEffects() for immediate relationships
- **Session Integration**: Automatic session summaries on end
  - SessionManager creates episodic summary when session ends
  - Summary includes goal, timestamps, status, and memory count
  - has_summary relation links session to summary
  - createSummaryOnEnd config option (default: true when EpisodicMemoryManager provided)
- **New Interfaces**: EpisodicMemoryConfig, CreateEpisodeOptions, TimelineOptions

#### Sprint 11: Consolidation Pipeline Foundation
- **ConsolidationPipeline Class**: Orchestrates memory transformation to long-term storage
  - consolidateSession() processes all working memories for a session
  - consolidateSessions() for batch processing multiple sessions
  - Filters candidates by confidence and confirmation thresholds
  - Configurable summarization and pattern extraction flags
- **Promotion System**: Convert working memory to long-term storage
  - promoteMemory() with target type (episodic/semantic)
  - Clears TTL fields and sets promotion metadata
  - Reinforces memory against decay after promotion
  - getPromotionCandidates() for candidate evaluation
  - isPromotionEligible() for eligibility checks
- **Pipeline Stages**: Pluggable processing architecture
  - PipelineStage interface for custom processors
  - registerStage() to add processors
  - Stages executed in registration order
  - StageResult aggregation across all stages
- **Consolidation Types**: New type definitions for consolidation
  - ConsolidateOptions for operation configuration
  - ConsolidationResult for statistics tracking
- **New Interfaces**: ConsolidationPipelineConfig, PipelineStage, StageResult

#### Sprint 12: Observation Summarization
- **SummarizationService Class**: Text summarization with LLM fallback
  - summarize() with optional LLM provider or algorithmic fallback
  - calculateSimilarity() using TF-IDF cosine similarity
  - groupSimilarObservations() for clustering related observations
  - summarizeGroups() for batch summarization
  - Pluggable ISummarizationProvider interface for LLM integration
- **ConsolidationPipeline Summarization**: Memory observation compression
  - summarizeObservations() groups and summarizes entity observations
  - applySummarizationToEntity() updates storage with compressed observations
  - Configurable similarityThreshold for grouping control
  - Compression ratio tracking in SummarizationResult
- **New Interfaces**: SummarizationConfig, GroupingResult, SummarizationResult, ISummarizationProvider

### Testing

- Added 67 unit tests for type guards and AccessContextBuilder
- Added 44 unit tests for AccessTracker
- Added 15 integration tests for access tracking across managers
- Added 36 unit tests for DecayEngine
- Added 14 unit tests for forgetWeakMemories
- Added 21 unit tests for DecayScheduler
- Added 4 integration tests for DecayEngine context access
- Added 58 unit tests for WorkingMemoryManager (32 Sprint 6 + 26 Sprint 7)
- Added 44 unit tests for SessionManager (39 Sprint 8 + 5 Sprint 10 integration)
- Added 20 unit tests for SessionQueryBuilder
- Added 30 unit tests for EpisodicMemoryManager
- Added 37 unit tests for ConsolidationPipeline (25 Sprint 11 + 12 Sprint 12 summarization)
- Added 41 unit tests for SummarizationService

## [1.1.0] - 2026-01-11

### Added

- **Dual Module Format**: Added tsup bundler for ESM and CommonJS output
  - `dist/index.js` - ES Module format
  - `dist/index.cjs` - CommonJS format
  - Proper `exports` field with `import` and `require` conditions
- **Test Reporter**: Added per-file-reporter for detailed test reports
  - JSON reports per test file in `tests/test-results/json/`
  - HTML reports per test file in `tests/test-results/html/`
  - Summary reports with coverage integration in `tests/test-results/summary/`
  - Configurable modes via `VITEST_REPORT_MODE` (all, summary, debug)
- **Build Scripts**:
  - `build` - tsup bundled build (ESM + CJS)
  - `build:watch` - tsup watch mode
  - `build:tsc` - original TypeScript compiler build
- **Worker Files**: Separate worker bundle for dynamic loading by workerpool
- **Tool Management Scripts**:
  - `tools:install` - install dependencies for all standalone tools
  - `tools:build` - build all standalone tool executables

### Changed

- Updated vitest.config.ts with `SKIP_BENCHMARKS` environment variable support
- Updated vitest.config.ts with `json-summary` coverage reporter for per-file-reporter integration
- Updated .gitignore to exclude tool build artifacts (`tools/*/node_modules/`, `tools/*/dist/`, `tools/*/*.exe`)

## [1.0.0] - 2026-01-10

### Added

Initial release - extracted core knowledge graph functionality from memory-mcp.

#### Core Features
- **Entity Management**: Full CRUD operations for entities with observations
- **Relation Management**: Create and manage typed relationships between entities
- **Hierarchical Organization**: Parent-child entity nesting with tree operations
- **Tag Management**: Tag aliasing, bulk operations, and filtering

#### Storage Backends
- **JSONL Storage**: Default file-based storage with in-memory caching
- **SQLite Storage**: Optional database backend with FTS5 full-text search
- **Storage Factory**: Automatic backend selection via configuration

#### Search Capabilities
- **Basic Search**: Name and observation content matching
- **Ranked Search**: TF-IDF relevance scoring
- **Boolean Search**: AND, OR, NOT operators
- **Fuzzy Search**: Levenshtein distance-based typo tolerance
- **BM25 Search**: Probabilistic ranking function
- **Semantic Search**: Vector similarity (requires embedding provider)
- **Hybrid Search**: Multi-signal fusion (semantic + lexical + symbolic)
- **Smart Search**: Reflection-based query refinement

#### Graph Algorithms
- **Shortest Path**: BFS-based pathfinding
- **All Paths**: DFS enumeration up to max depth
- **Centrality**: Degree, betweenness, and PageRank algorithms
- **Connected Components**: Graph connectivity analysis

#### Import/Export
- **Formats**: JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid
- **Compression**: Optional Brotli compression for large exports
- **Streaming**: Memory-efficient export for large graphs (>= 5000 entities)
- **Backup/Restore**: Full graph backup with compression support

#### Utilities
- **Zod Validation**: Schema validation for all inputs
- **Compression**: Brotli compression utilities with base64 support
- **Search Cache**: LRU caching with TTL for search results
- **Indexes**: Name, type, and relation indexes for O(1) lookups
- **Worker Pool**: Parallel processing for CPU-intensive operations

### Architecture

- **ManagerContext**: Central access point with lazy-initialized managers
- **Layered Design**: Protocol → Managers → Storage
- **Barrel Exports**: Clean module organization via index files

### Testing

- 2882 tests across 90 test files
- Unit, integration, and performance benchmarks
- Coverage for edge cases and error handling

---

## Implementation Notes

The original Phase 13 plan specified adapter interfaces (`IStorageAdapter`, `IWorkerAdapter`) for
pluggable storage and worker backends. The actual implementation used a direct code copy approach,
preserving the existing class structure (`GraphStorage`, `SQLiteStorage`, `StorageFactory`) without
introducing adapter abstractions. This simplified the extraction while maintaining full functionality.

Future versions may introduce adapter interfaces to enable Bun/Deno support.

---

## Extracted From

This library was extracted from [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) v10.1.0 as Phase 13 of the memory-mcp project evolution.

The extraction separates the core knowledge graph functionality from the MCP server implementation, enabling:
- Standalone use without MCP dependencies
- Cleaner dependency tree
- Independent versioning and releases
