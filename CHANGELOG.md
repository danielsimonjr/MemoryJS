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

#### Sprint 13: Pattern Extraction
- **PatternDetector Class**: Token-based pattern detection for observations
  - detectPatterns() identifies recurring templates with variable slots
  - extractTemplate() creates patterns with {X} variable markers
  - matchesPattern() checks if observation matches a template
  - calculatePatternSpecificity() measures pattern specificity
  - mergeConsecutiveVariables() for pattern normalization
- **ConsolidationPipeline Pattern Methods**: Pattern-based semantic memory creation
  - extractPatterns() analyzes entity observations by type
  - createSemanticFromPattern() converts patterns to semantic memories
  - extractAndCreateSemanticPatterns() end-to-end pattern processing
  - Creates derived_from relations to source entities
  - getPatternDetector() accessor for advanced operations
- **New Types**: PatternResult interface with pattern template, variables, occurrences, confidence, sourceEntities

#### Sprint 14: Memory Merging
- **ConsolidationPipeline Merge Methods**: Duplicate detection and memory consolidation
  - mergeMemories() with three strategies: newest, strongest, merge_observations
  - findDuplicates() for similarity-based duplicate detection using TF-IDF
  - autoMergeDuplicates() for automatic merging above similarity threshold
  - getMergeHistory() retrieves audit trail for entity merge operations
  - Automatic relation retargeting when entities are merged
  - Audit trail creation via merge_audit entities
- **New Types**: MemoryMergeStrategy type, MergeResult interface, DuplicatePair interface

#### Sprint 15: Auto-Consolidation Rules
- **RuleEvaluator Class**: Condition evaluation with caching and AND/OR logic
  - evaluate() checks conditions against entity properties
  - calculateAgeHours() for age-based condition evaluation
  - Caching with cache key based on entity name, lastModified, and conditions
  - clearCache() and getCacheSize() for cache management
- **ConsolidationPipeline Rule Management**: Rule-based automatic consolidation
  - addRule() to register consolidation rules
  - removeRule() to delete rules by name
  - getRules() returns readonly list of registered rules
  - clearRules() removes all rules
  - getRuleEvaluator() accessor for advanced operations
- **Auto-Consolidation Methods**: Trigger-based rule execution
  - runAutoConsolidation() processes rules matching trigger type
  - executeRule() evaluates entities against rule conditions and executes actions
  - triggerManualConsolidation() convenience method for manual trigger
  - Priority-based rule processing (higher priority first)
- **New Types**: ConsolidationTrigger, ConsolidationAction, RuleConditions, ConsolidationRule, RuleEvaluationResult

#### Sprint 16: Salience Engine Foundation
- **SalienceEngine Class**: Context-aware memory relevance scoring
  - calculateSalience() computes multi-factor score with component breakdown
  - rankEntitiesBySalience() for sorting entities by relevance
  - getTopSalient() retrieves highest-salience entities from storage
  - Configurable weights for importance, recency, frequency, context, and novelty
- **Salience Components**: Five-factor scoring model
  - baseImportance: DecayEngine effective importance normalized to 0-1
  - recencyBoost: Exponential decay from last access time with temporal focus
  - frequencyBoost: Log-normalized access count from AccessTracker
  - contextRelevance: Task/session/query/intent matching
  - noveltyBoost: Inverse recency to surface less recently accessed items
- **Temporal Focus Support**: Adjustable behavior for recent vs historical focus
  - recent: Boosts recently accessed, reduces novelty
  - historical: Boosts novelty, reduces recency
  - balanced: Default equal weighting
- **New Types**: SalienceContext, SalienceWeights, SalienceComponents, ScoredEntity, TemporalFocus

#### Sprint 17: Context Relevance Scoring
- **Enhanced Task Relevance**: TF-IDF similarity for semantic task matching
  - calculateTaskRelevance() uses SummarizationService for cosine similarity
  - Falls back to keyword matching when semantic similarity disabled
  - Returns 1.0 for exact task ID match
- **Query Text Matching**: Semantic query matching via TF-IDF
  - calculateQueryRelevance() for query text similarity scoring
  - Uses buildEntityText() to combine name, type, and observations
- **Session Context Scoring**: Configurable session boost factor
  - calculateSessionRelevance() with configurable boost factor
  - recentEntityBoostFactor for recent entity context boost
- **Intent Relevance**: User intent matching via semantic similarity
  - calculateIntentRelevance() for user intent scoring
- **Enhanced Novelty Calculation**: Multi-factor novelty scoring
  - Time-based novelty (50%): Inverse of recency
  - Access frequency novelty (30%): Rare access = more novel
  - Observation uniqueness (20%): Diverse observations = more novel
  - calculateObservationUniqueness() measures observation diversity
- **Configuration Options**: New configurable parameters
  - sessionBoostFactor: Boost for session match (default: 1.0)
  - recentEntityBoostFactor: Boost for recent entities (default: 0.7)
  - useSemanticSimilarity: Enable TF-IDF matching (default: true)
  - uniquenessThreshold: Threshold for observation uniqueness (default: 0.5)

#### Sprint 18: Context Window Manager Foundation
- **ContextWindowManager Class**: Token-budgeted memory retrieval
  - estimateTokens() using word count heuristic (words * 1.3 multiplier)
  - estimateTotalTokens() for batch estimation
  - prioritize() greedy algorithm maximizing salience/token efficiency
  - retrieveForContext() main retrieval method with options
- **Token Budget Management**: Stay within LLM context limits
  - Configurable maxTokens with reserve buffer
  - Greedy selection by salience/token ratio
  - Must-include entities bypass budget constraints
- **Memory Type Filtering**: Selective retrieval options
  - includeWorkingMemory, includeEpisodicRecent, includeSemanticRelevant
  - minSalience threshold filtering
- **Result Package**: Detailed retrieval results
  - Token breakdown by memory type (working, episodic, semantic, procedural)
  - Excluded entities with reasons (budget_exceeded, low_salience, filtered)
  - Suggestions for high-salience excluded entities
- **New Types**: ContextRetrievalOptions, TokenBreakdown, ContextPackage, ExcludedEntity

#### Sprint 19: Context-Optimized Retrieval
- **Budget Allocation Configuration**: Configurable budget percentages per memory type
  - workingBudgetPct: Working memory allocation (default: 30%)
  - episodicBudgetPct: Episodic memory allocation (default: 30%)
  - semanticBudgetPct: Semantic memory allocation (default: 40%)
  - recentSessionCount: Number of recent sessions for episodic (default: 3)
- **Type-Specific Retrieval Methods**: Specialized retrieval per memory type
  - retrieveWorkingMemory() with session filtering and budget constraints
  - retrieveEpisodicRecent() sorted by recency with session limiting
  - retrieveSemanticRelevant() prioritized by context salience
  - retrieveMustInclude() with warning generation for missing/exceeding budget
- **Budget Allocation Retrieval**: Coordinated multi-type retrieval
  - retrieveWithBudgetAllocation() allocates budget across memory types
  - Must-include entities subtracted from total budget first
  - Deduplication across memory type sources
  - Minimum salience filtering with must-include protection

#### Sprint 20: Spillover and Diversity
- **Spillover Handling**: Track and paginate content that exceeds budget
  - handleSpillover() tracks excluded entities with suggestions
  - retrieveSpilloverPage() pagination for follow-up retrieval
  - Cursor-based pagination with salience priority preservation
  - Generates suggestions for high-salience excluded content
- **Diversity Enforcement**: Prevent redundant context
  - enforceDiversity() detects and replaces similar entities
  - calculateDiversityScore() measures content variety
  - Configurable diversityThreshold (default: 0.8)
  - findDiverseReplacement() finds unique alternatives
- **Heap-Based Selection**: Efficient top-N retrieval
  - getMostSalient() uses min-heap for O(n log k) selection
  - calculateEntitySimilarity() for diversity checking
- **MemoryFormatter Class**: Format memories for LLM consumption
  - formatForPrompt() human-readable text output
  - formatAsJSON() structured data for tool use
  - formatCompact() minimal token format
  - formatByType() grouped by memory type
  - formatSummary() context package summary
  - Customizable templates and token limits
- **ManagerContext Integration**: Unified access to agent memory components
  - salienceEngine property with env var configuration
  - contextWindowManager property with env var configuration
  - memoryFormatter property with env var configuration
- **New Types**: SpilloverResult, MemoryFormatterConfig

#### Sprint 21: Agent Identity
- **AgentMetadata Type**: Agent identity and capability tracking
  - AgentType enum: llm, tool, human, system, default
  - trustLevel: Normalized 0-1 trust score
  - capabilities: String array for access control
  - createdAt/lastActiveAt: Activity timestamps
  - Optional custom metadata extension
- **MultiAgentMemoryManager Class**: Multi-agent memory coordination
  - registerAgent() with ID validation and metadata defaults
  - unregisterAgent() with default agent protection
  - getAgent() and hasAgent() for agent lookup
  - listAgents() with filtering by type, trust level, capability
  - getAgentCount() for registered agent count
- **Agent Memory Operations**: Ownership tracking
  - createAgentMemory() with automatic ownership assignment
  - getAgentMemories() for agent-owned memory retrieval
  - getVisibleMemories() respecting visibility rules
  - transferMemory() for ownership transfer
  - setMemoryVisibility() to change visibility level
- **Visibility Controls**: Cross-agent access control
  - private: Only visible to owning agent
  - shared: Visible to all registered agents
  - public: Visible to all including unregistered
  - allowCrossAgent config option for isolation
  - requireRegistration config option for strict mode
- **Event System**: Agent and memory lifecycle events
  - agent:registered, agent:unregistered events
  - memory:created, memory:transferred, memory:visibility_changed events
- **New Types**: MultiAgentConfig, AgentMetadata, AgentType

#### Sprint 22: Memory Visibility
- **Visibility Convenience Methods**: Simplified visibility changes
  - shareMemory() sets visibility to 'shared' for all registered agents
  - makePublic() sets visibility to 'public' for all including unregistered
  - makePrivate() sets visibility to 'private' for owner only
- **Visibility Filtering**: Filter entities by agent permissions
  - filterByVisibility() filters entity array by agent visibility rules
  - isMemoryVisible() checks if specific memory is visible to agent
  - getVisibleMemoriesByType() retrieves visible memories of specific type
- **Visibility-Aware Search**: Search with automatic visibility filtering
  - searchVisibleMemories() searches across visible memories only
  - Case-insensitive matching on name and observations
  - Respects private/shared/public visibility rules

#### Sprint 23: Cross-Agent Operations
- **Shared Memory Queries**: Find memories accessible to multiple agents
  - getSharedMemories() returns memories visible to all specified agents
  - Optional filtering by entity type and date range
  - Respects private/shared/public visibility rules
- **Cross-Agent Search**: Search across multiple agents with trust weighting
  - searchCrossAgent() searches visible memories from multiple agents
  - Optional trust-weighted scoring (useTrustWeighting, trustWeight)
  - Filter by specific agent IDs and entity type
  - Ranked results by combined relevance and trust score
- **Memory Copying**: Copy shared memories to private store
  - copyMemory() creates owned copy with source tracking
  - Tracks original entity ID and acquisition method
  - Optional custom name and annotation
  - Configurable visibility for the copy
- **Collaboration Events**: Audit trail for cross-agent operations
  - memory:cross_agent_search event for search operations
  - memory:copied event for memory copy operations
  - memory:cross_agent_access event for access tracking
  - recordCrossAgentAccess() for manual access recording
- **Collaboration Statistics**: Track sharing and access patterns
  - getCollaborationStats() returns sharing metrics
  - Counts shared, public, and accessible memories

#### Sprint 24: Conflict Resolution
- **ConflictResolver Class**: Detect and resolve memory conflicts
  - detectConflicts() finds contradictions using similarity and negation
  - Configurable similarityThreshold (default: 0.7)
  - Negation pattern detection for contradictory observations
- **Resolution Strategies**: Five strategies for conflict resolution
  - most_recent: Select by lastModified timestamp
  - highest_confidence: Select by confidence score
  - most_confirmations: Select by confirmation count
  - trusted_agent: Select by agent trustLevel
  - merge_all: Combine observations from all sources
- **resolveConflict() Method**: Apply strategy to conflicting memories
  - Returns resolution result with audit trail
  - Emits memory:conflict_resolved event
- **mergeCrossAgent() Method**: Merge memories from multiple agents
  - Trust-weighted confidence calculation
  - Preserves provenance from all sources
  - Optional conflict resolution with configurable strategy
- **Conflict Events**: Audit trail for conflict operations
  - memory:conflict event on detection
  - memory:conflict_resolved event on resolution
  - memory:merged event on cross-agent merge
- **New Types**: ConflictStrategy, ConflictInfo, ConflictResolverConfig, ResolutionResult

#### Sprint 25: Integration and Facade
- **AgentMemoryManager Class**: Unified facade for all agent memory operations
  - Session lifecycle: startSession(), endSession(), getActiveSession()
  - Working memory: addWorkingMemory(), getSessionMemories(), confirmMemory(), promoteMemory()
  - Episodic memory: createEpisode(), getTimeline()
  - Context retrieval: retrieveForContext(), formatForPrompt()
  - Decay management: getDecayedMemories(), forgetWeakMemories(), reinforceMemory()
  - Multi-agent: registerAgent(), getSharedMemories(), searchCrossAgent(), detectConflicts()
- **AgentMemoryConfig Interface**: Unified configuration for all components
  - Environment variable loading via loadConfigFromEnv()
  - Programmatic configuration with mergeConfig()
  - Configuration validation with validateConfig()
- **ManagerContext Integration**: agentMemory() accessor for facade
  - Optional configuration override parameter
  - Lazy initialization with proper dependency wiring
- **Component Lazy Loading**: All sub-managers initialized on demand
  - workingMemory, sessionManager, episodicMemory, consolidationPipeline
  - salienceEngine, contextWindowManager, memoryFormatter
  - multiAgentManager, conflictResolver
- **Event System**: Unified events for memory operations
  - session:started, session:ended, memory:created, memory:expired
  - consolidation:complete, memory:forgotten, agent:registered, manager:stopped

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
- Added 78 unit tests for ConsolidationPipeline (25 Sprint 11 + 12 Sprint 12 + 9 Sprint 13 + 18 Sprint 14 + 14 Sprint 15)
- Added 15 unit tests for RuleEvaluator
- Added 39 unit tests for SalienceEngine (24 Sprint 16 + 10 Sprint 17 + 5 Sprint 20)
- Added 44 unit tests for ContextWindowManager (18 Sprint 18 + 16 Sprint 19 + 10 Sprint 20)
- Added 19 unit tests for MemoryFormatter
- Added 41 unit tests for SummarizationService
- Added 25 unit tests for PatternDetector
- Added 13 unit tests for ConflictResolver
- Added 76 unit tests for MultiAgentMemoryManager (31 Sprint 21 + 19 Sprint 22 + 18 Sprint 23 + 8 Sprint 24)
- Added 23 unit tests for AgentMemoryManager facade

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
