# MemoryJS - Component Reference

**Version**: 1.2.0
**Last Updated**: 2026-01-14

---

## Table of Contents

1. [Overview](#overview)
2. [Agent Components](#agent-components)
3. [Core Components](#core-components)
4. [Search Components](#search-components)
5. [Feature Components](#feature-components)
6. [Utility Components](#utility-components)
7. [Type Definitions](#type-definitions)
8. [Component Dependencies](#component-dependencies)

---

## Overview

MemoryJS follows a layered architecture with specialized components:

```
┌─────────────────────────────────────────────────────────────┐
│  agent/            │  Agent memory system (19 files)        │
├─────────────────────────────────────────────────────────────┤
│  core/             │  Central managers and storage (12 files)│
├─────────────────────────────────────────────────────────────┤
│  search/           │  Search implementations (29 files)     │
├─────────────────────────────────────────────────────────────┤
│  features/         │  Advanced capabilities (9 files)       │
├─────────────────────────────────────────────────────────────┤
│  utils/            │  Shared utilities (18 files)           │
├─────────────────────────────────────────────────────────────┤
│  types/            │  TypeScript definitions (3 files)      │
├─────────────────────────────────────────────────────────────┤
│  workers/          │  Web workers (2 files)                 │
└─────────────────────────────────────────────────────────────┘
```

**Total:** 93 TypeScript files | 657 exports | ~41,000 lines of code

---

## Agent Components

### AgentMemoryManager (`agent/AgentMemoryManager.ts`)

**Purpose**: Unified facade for AI agent memory operations

```typescript
export class AgentMemoryManager {
  constructor(context: ManagerContext, config?: AgentMemoryConfig)

  // Session Management
  async startSession(options?: SessionOptions): Promise<SessionEntity>
  async endSession(sessionId: string): Promise<void>
  async getActiveSession(): Promise<SessionEntity | null>

  // Working Memory
  async addWorkingMemory(sessionId: string, content: string, options?): Promise<AgentEntity>
  async getWorkingMemories(sessionId: string): Promise<AgentEntity[]>
  async clearExpiredMemories(): Promise<number>

  // Memory Lifecycle
  async reinforceMemory(entityName: string): Promise<void>
  async promoteToLongTerm(entityName: string): Promise<void>
  async consolidateSession(sessionId: string, options?): Promise<ConsolidationResult>

  // Retrieval
  async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>
  async getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>

  // Lifecycle
  start(): void   // Start decay scheduler
  stop(): void    // Stop decay scheduler
}
```

---

### SessionManager (`agent/SessionManager.ts`)

**Purpose**: Session lifecycle management

```typescript
export class SessionManager {
  constructor(storage: IGraphStorage)

  async createSession(options?: SessionOptions): Promise<SessionEntity>
  async getSession(sessionId: string): Promise<SessionEntity | null>
  async getActiveSession(): Promise<SessionEntity | null>
  async endSession(sessionId: string): Promise<void>
  async listSessions(filter?: SessionFilter): Promise<SessionEntity[]>
}
```

---

### WorkingMemoryManager (`agent/WorkingMemoryManager.ts`)

**Purpose**: Short-term memory with TTL and promotion

```typescript
export class WorkingMemoryManager {
  constructor(storage: IGraphStorage, config?: WorkingMemoryConfig)

  async createWorkingMemory(sessionId: string, content: string, options?): Promise<AgentEntity>
  async getSessionMemories(sessionId: string): Promise<AgentEntity[]>
  async clearExpired(): Promise<number>
  async extendTTL(entityNames: string[], additionalHours: number): Promise<void>
  async markForPromotion(entityName: string): Promise<void>
  async getPromotionCandidates(sessionId: string): Promise<AgentEntity[]>
}
```

---

### DecayEngine (`agent/DecayEngine.ts`)

**Purpose**: Time-based importance decay calculations

```typescript
export class DecayEngine {
  constructor(config?: DecayConfig)

  calculateEffectiveImportance(entity: AgentEntity): number
  calculateDecayFactor(lastAccessedAt: string, halfLifeHours: number): number
  async getDecayedMemories(threshold: number): Promise<AgentEntity[]>
  async reinforceMemory(entityName: string, amount?: number): Promise<void>
}
```

**Decay Formula**:
```
effective_importance = base_importance × decay_factor × strength_multiplier
decay_factor = e^(-ln(2) × age_hours / half_life_hours)
```

---

### DecayScheduler (`agent/DecayScheduler.ts`)

**Purpose**: Scheduled decay cycle execution

```typescript
export class DecayScheduler {
  constructor(decayEngine: DecayEngine, config?: SchedulerConfig)

  start(): void
  stop(): void
  runDecayCycle(): Promise<DecayResult>
  setInterval(intervalMs: number): void
}
```

---

### SalienceEngine (`agent/SalienceEngine.ts`)

**Purpose**: Context-aware memory scoring

```typescript
export class SalienceEngine {
  constructor(storage: IGraphStorage, accessTracker: AccessTracker)

  calculateSalience(entity: AgentEntity, context: SalienceContext): number
  async getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>
  calculateNovelty(entity: AgentEntity): number
  calculateTaskRelevance(entity: AgentEntity, taskDescription: string): Promise<number>
}
```

**Salience Components**:
- Base importance
- Recency boost
- Frequency boost
- Context relevance
- Novelty bonus

---

### ContextWindowManager (`agent/ContextWindowManager.ts`)

**Purpose**: LLM context window optimization

```typescript
export class ContextWindowManager {
  constructor(config?: ContextWindowConfig)

  async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>
  estimateTokens(entity: AgentEntity): number
  prioritize(entities: AgentEntity[], maxTokens: number): AgentEntity[]
}
```

---

### MemoryFormatter (`agent/MemoryFormatter.ts`)

**Purpose**: Memory-to-prompt formatting

```typescript
export class MemoryFormatter {
  formatForPrompt(memories: AgentEntity[], options?: FormatOptions): string
  formatEntity(entity: AgentEntity): string
  formatObservations(observations: string[], limit?: number): string
}
```

---

### MultiAgentMemoryManager (`agent/MultiAgentMemoryManager.ts`)

**Purpose**: Multi-agent shared memory and conflict resolution

```typescript
export class MultiAgentMemoryManager {
  constructor(storage: IGraphStorage, config?: MultiAgentConfig)

  async registerAgent(agentId: string, metadata?: AgentMetadata): Promise<void>
  async createAgentMemory(agentId: string, entity: Partial<AgentEntity>): Promise<AgentEntity>
  async getVisibleMemories(agentId: string, filter?: MemoryFilter): Promise<AgentEntity[]>
  async shareMemory(entityName: string, targetAgents: string[] | 'all'): Promise<void>
  async resolveConflict(conflictingEntities: string[], strategy: ConflictStrategy): Promise<AgentEntity>
}
```

---

### ConflictResolver (`agent/ConflictResolver.ts`)

**Purpose**: Conflict resolution strategies

```typescript
export class ConflictResolver {
  resolve(entities: AgentEntity[], strategy: ConflictStrategy): AgentEntity
}

type ConflictStrategy = 'most_recent' | 'highest_confidence' | 'most_confirmations' | 'merge_all';
```

---

### ConsolidationPipeline (`agent/ConsolidationPipeline.ts`)

**Purpose**: Memory consolidation from working to long-term

```typescript
export class ConsolidationPipeline {
  constructor(storage: IGraphStorage, config?: ConsolidationConfig)

  async consolidateSession(sessionId: string, options?: ConsolidateOptions): Promise<ConsolidationResult>
  async promoteMemory(entityName: string, targetType: MemoryType): Promise<void>
  async runAutoConsolidation(rules: ConsolidationRule[]): Promise<ConsolidationResult>
}
```

---

### AccessTracker (`agent/AccessTracker.ts`)

**Purpose**: Memory access pattern tracking

```typescript
export class AccessTracker {
  async recordAccess(entityName: string, context?: AccessContext): Promise<void>
  async getAccessStats(entityName: string): Promise<AccessStats>
  calculateRecencyScore(entityName: string, halfLifeHours?: number): number
  async getFrequentlyAccessed(limit: number): Promise<Entity[]>
  async getRecentlyAccessed(limit: number): Promise<Entity[]>
}
```

---

### EpisodicMemoryManager (`agent/EpisodicMemoryManager.ts`)

**Purpose**: Timeline-based episodic memory

```typescript
export class EpisodicMemoryManager {
  constructor(storage: IGraphStorage)

  async addEpisode(sessionId: string, content: string, metadata?: EpisodeMetadata): Promise<AgentEntity>
  async getSessionEpisodes(sessionId: string): Promise<AgentEntity[]>
  async getRecentEpisodes(limit: number): Promise<AgentEntity[]>
  async searchEpisodes(query: string, options?: SearchOptions): Promise<AgentEntity[]>
}
```

---

### SummarizationService (`agent/SummarizationService.ts`)

**Purpose**: Memory summarization for consolidation

```typescript
export class SummarizationService {
  constructor(config?: SummarizationConfig)

  async summarizeObservations(observations: string[]): Promise<string>
  async summarizeEntities(entities: AgentEntity[]): Promise<string>
}
```

---

### PatternDetector (`agent/PatternDetector.ts`)

**Purpose**: Pattern detection in memories

```typescript
export class PatternDetector {
  async detectPatterns(entities: AgentEntity[], minOccurrences: number): Promise<Pattern[]>
  async extractRules(patterns: Pattern[]): Promise<Rule[]>
}
```

---

### RuleEvaluator (`agent/RuleEvaluator.ts`)

**Purpose**: Rule-based memory evaluation

```typescript
export class RuleEvaluator {
  async evaluateRules(entity: AgentEntity, rules: ConsolidationRule[]): Promise<RuleResult[]>
  shouldPromote(entity: AgentEntity, rules: ConsolidationRule[]): boolean
}
```

---

## Core Components

### ManagerContext (`core/ManagerContext.ts`)

**Purpose**: Central context holding all managers with lazy initialization

**Pattern**: Context Pattern with Lazy Initialization

```typescript
export class ManagerContext {
  constructor(config: ManagerContextConfig)

  // Manager accessors (lazy-initialized via getters)
  get entityManager(): EntityManager
  get relationManager(): RelationManager
  get observationManager(): ObservationManager
  get hierarchyManager(): HierarchyManager
  get searchManager(): SearchManager
  get ioManager(): IOManager
  get tagManager(): TagManager
  get graphTraversal(): GraphTraversal

  // Agent Memory System
  agentMemory(config?: AgentMemoryConfig): AgentMemoryManager

  // Direct storage access
  get storage(): IGraphStorage
}
```

**Lazy Initialization**:
```typescript
private _entityManager?: EntityManager;
get entityManager(): EntityManager {
  return (this._entityManager ??= new EntityManager(this.storage, this.eventEmitter));
}

// Agent Memory accessor
private _agentMemoryManager?: AgentMemoryManager;
agentMemory(config?: AgentMemoryConfig): AgentMemoryManager {
  return (this._agentMemoryManager ??= new AgentMemoryManager(this, config));
}
```

---

### EntityManager (`core/EntityManager.ts`)

**Purpose**: Entity CRUD operations with validation

```typescript
export class EntityManager {
  constructor(storage: IGraphStorage, eventEmitter?: GraphEventEmitter)

  // Core CRUD
  async createEntities(entities: Entity[]): Promise<Entity[]>
  async getEntityByName(name: string): Promise<Entity | null>
  async getAllEntities(): Promise<Entity[]>
  async deleteEntities(entityNames: string[]): Promise<void>

  // Tag operations
  async addTags(entityName: string, tags: string[]): Promise<Entity>
  async removeTags(entityName: string, tags: string[]): Promise<Entity>
  async setImportance(entityName: string, importance: number): Promise<Entity>
  async addTagsToMultipleEntities(entityNames: string[], tags: string[]): Promise<Entity[]>
  async replaceTag(oldTag: string, newTag: string): Promise<number>
  async mergeTags(tag1: string, tag2: string, targetTag: string): Promise<number>
}
```

**Key Features**:
- Automatic timestamp management (createdAt, lastModified)
- Tag normalization (lowercase)
- Importance validation (0-10 range)
- Batch operations (single I/O)
- Zod schema validation
- Event emission for TF-IDF sync

---

### RelationManager (`core/RelationManager.ts`)

**Purpose**: Relation CRUD operations

```typescript
export class RelationManager {
  constructor(storage: IGraphStorage)

  async createRelations(relations: Relation[]): Promise<Relation[]>
  async getRelationsForEntity(entityName: string): Promise<{
    incoming: Relation[];
    outgoing: Relation[];
  }>
  async deleteRelations(relations: Relation[]): Promise<void>
  async getAllRelations(): Promise<Relation[]>
}
```

**Key Features**:
- Automatic timestamp management
- Duplicate relation prevention
- Deferred integrity (relations to non-existent entities allowed)

---

### ObservationManager (`core/ObservationManager.ts`)

**Purpose**: Observation add/delete operations

```typescript
export class ObservationManager {
  constructor(storage: IGraphStorage, eventEmitter?: GraphEventEmitter)

  async addObservations(additions: ObservationAddition[]): Promise<ObservationResult[]>
  async deleteObservations(deletions: ObservationDeletion[]): Promise<ObservationResult[]>
}

interface ObservationAddition {
  entityName: string;
  contents: string[];
}
```

---

### HierarchyManager (`core/HierarchyManager.ts`)

**Purpose**: Parent-child entity relationships

```typescript
export class HierarchyManager {
  constructor(storage: IGraphStorage)

  async setEntityParent(entityName: string, parentName: string | null): Promise<Entity>
  async getChildren(entityName: string): Promise<Entity[]>
  async getParent(entityName: string): Promise<Entity | null>
  async getAncestors(entityName: string): Promise<Entity[]>
  async getDescendants(entityName: string): Promise<Entity[]>
  async getSubtree(entityName: string): Promise<KnowledgeGraph>
  async getRootEntities(): Promise<Entity[]>
  async getEntityDepth(entityName: string): Promise<number>
  async moveEntity(entityName: string, newParentName: string | null): Promise<Entity>
}
```

**Key Features**:
- Cycle detection (prevents infinite loops)
- Recursive traversal for ancestors/descendants
- Subtree extraction with relations

---

### GraphStorage (`core/GraphStorage.ts`)

**Purpose**: JSONL file I/O with in-memory caching

```typescript
export class GraphStorage implements IGraphStorage {
  constructor(memoryFilePath: string)

  async loadGraph(): Promise<KnowledgeGraph>
  async saveGraph(graph: KnowledgeGraph): Promise<void>
  invalidateCache(): void
}
```

**Key Features**:
- JSONL format (line-delimited JSON)
- In-memory cache with write-through invalidation
- Deep copy on cache reads (prevents mutation)
- Backward compatibility for missing timestamps

---

### SQLiteStorage (`core/SQLiteStorage.ts`)

**Purpose**: SQLite database storage with FTS5 search

```typescript
export class SQLiteStorage implements IGraphStorage {
  constructor(dbPath: string)

  async loadGraph(): Promise<KnowledgeGraph>
  async saveGraph(graph: KnowledgeGraph): Promise<void>

  // SQLite-specific methods
  searchFTS(query: string): Entity[]
  close(): void
}
```

**Key Features**:
- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- Referential integrity with ON DELETE CASCADE
- ACID transactions

---

### GraphTraversal (`core/GraphTraversal.ts`)

**Purpose**: Graph algorithms

```typescript
export class GraphTraversal {
  constructor(storage: IGraphStorage)

  // Path finding
  async findShortestPath(from: string, to: string): Promise<string[] | null>
  async findAllPaths(from: string, to: string, options?: PathOptions): Promise<string[][]>

  // Centrality
  async getCentrality(options?: CentralityOptions): Promise<Map<string, number>>

  // Components
  async getConnectedComponents(): Promise<string[][]>

  // Traversal
  async bfs(startNode: string, visitor: (node: string) => void): Promise<void>
  async dfs(startNode: string, visitor: (node: string) => void): Promise<void>
}
```

**Centrality Algorithms**:
- `degree`: Node connection count
- `betweenness`: Node importance in paths
- `pagerank`: Recursive importance measure

---

### TransactionManager (`core/TransactionManager.ts`)

**Purpose**: Batch operations and transactions

```typescript
export class TransactionManager {
  constructor(storage: IGraphStorage, eventEmitter?: GraphEventEmitter)

  // Batch operations
  async executeBatch(operations: BatchOperation[]): Promise<BatchResult>

  // Transaction control
  beginTransaction(): void
  commitTransaction(): Promise<void>
  rollbackTransaction(): void
}
```

---

### GraphEventEmitter (`core/GraphEventEmitter.ts`)

**Purpose**: Event-driven updates for TF-IDF sync

```typescript
export class GraphEventEmitter {
  on(event: GraphEvent, listener: EventListener): void
  off(event: GraphEvent, listener: EventListener): void
  emit(event: GraphEvent, data: EventData): void
}

type GraphEvent = 'entity:created' | 'entity:updated' | 'entity:deleted' |
                  'relation:created' | 'relation:deleted' | 'graph:loaded';
```

---

## Search Components

### SearchManager (`search/SearchManager.ts`)

**Purpose**: Orchestrates all search types

```typescript
export class SearchManager {
  constructor(storage: IGraphStorage, options?: SearchManagerOptions)

  // Search methods
  async search(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
  async searchRanked(query: string, options?: RankedSearchOptions): Promise<SearchResult[]>
  async booleanSearch(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
  async fuzzySearch(query: string, options?: FuzzySearchOptions): Promise<KnowledgeGraph>
  async hybridSearch(query: string, options?: HybridSearchOptions): Promise<HybridSearchResult>
  async smartSearch(query: string, options?: SmartSearchOptions): Promise<SmartSearchResult>

  // Search utilities
  async getSearchSuggestions(query: string, limit?: number): Promise<string[]>

  // Saved searches
  async saveSearch(search: SavedSearchInput): Promise<SavedSearch>
  async executeSavedSearch(name: string): Promise<KnowledgeGraph>
  async listSavedSearches(): Promise<SavedSearch[]>
}
```

---

### BasicSearch (`search/BasicSearch.ts`)

**Purpose**: Simple text matching with filters

**Algorithm**: Case-insensitive substring matching across name, entityType, observations

```typescript
export class BasicSearch {
  constructor(storage: IGraphStorage)

  async search(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
  async openNodes(names: string[]): Promise<KnowledgeGraph>
  async searchByDateRange(options: DateRangeOptions): Promise<KnowledgeGraph>
}
```

---

### RankedSearch (`search/RankedSearch.ts`)

**Purpose**: TF-IDF relevance scoring

```typescript
export class RankedSearch {
  constructor(storage: IGraphStorage)

  async search(
    query: string,
    options?: RankedSearchOptions
  ): Promise<SearchResult[]>
}

interface SearchResult {
  entity: Entity;
  score: number;
  matchedFields: string[];
}
```

---

### BM25Search (`search/BM25Search.ts`)

**Purpose**: BM25 ranking algorithm (improved TF-IDF)

```typescript
export class BM25Search {
  constructor(storage: IGraphStorage, options?: BM25Options)

  async search(query: string, limit?: number): Promise<SearchResult[]>
}
```

**BM25 Parameters**:
- `k1`: Term frequency saturation (default: 1.2)
- `b`: Document length normalization (default: 0.75)

---

### BooleanSearch (`search/BooleanSearch.ts`)

**Purpose**: Boolean query parsing and evaluation

**Syntax**: `AND`, `OR`, `NOT`, parentheses, field prefixes

```typescript
export class BooleanSearch {
  constructor(storage: IGraphStorage)

  async search(
    query: string,
    options?: SearchOptions
  ): Promise<KnowledgeGraph>
}
```

**Query Examples**:
- `Alice AND Bob`
- `name:Alice OR type:person`
- `NOT archived AND (project OR task)`

---

### FuzzySearch (`search/FuzzySearch.ts`)

**Purpose**: Typo-tolerant search using Levenshtein distance

```typescript
export class FuzzySearch {
  constructor(storage: IGraphStorage)

  async search(
    query: string,
    options?: FuzzySearchOptions
  ): Promise<KnowledgeGraph>
}

interface FuzzySearchOptions {
  threshold?: number;  // 0.0-1.0, default 0.7
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
}
```

---

### SemanticSearch (`search/SemanticSearch.ts`)

**Purpose**: Vector similarity search

```typescript
export class SemanticSearch {
  constructor(
    storage: IGraphStorage,
    embeddingService: EmbeddingService,
    vectorStore: VectorStore
  )

  async search(query: string, options?: SemanticSearchOptions): Promise<SearchResult[]>
  async findSimilar(entityName: string, limit?: number): Promise<SearchResult[]>
  async indexEntity(entity: Entity): Promise<void>
  async indexAll(): Promise<void>
}
```

---

### HybridSearchManager (`search/HybridSearchManager.ts`)

**Purpose**: Three-layer hybrid search combining semantic, lexical, and symbolic signals

```typescript
export class HybridSearchManager {
  constructor(
    storage: IGraphStorage,
    semanticSearch?: SemanticSearch,
    tfidfManager?: TFIDFIndexManager
  )

  async search(
    query: string,
    options?: HybridSearchOptions
  ): Promise<HybridSearchResult>
}

interface HybridSearchOptions {
  weights?: { semantic?: number; lexical?: number; symbolic?: number };
  filters?: SymbolicFilters;
  limit?: number;
  minScore?: number;
}
```

**Scoring Layers**:
- **Semantic**: Vector similarity via embeddings (default weight: 0.4)
- **Lexical**: TF-IDF/BM25 text matching (default weight: 0.4)
- **Symbolic**: Metadata filtering (default weight: 0.2)

---

### QueryAnalyzer (`search/QueryAnalyzer.ts`)

**Purpose**: Natural language query understanding

```typescript
export class QueryAnalyzer {
  analyze(query: string): QueryAnalysis
}

interface QueryAnalysis {
  extractedEntities: ExtractedEntity[];
  temporalReferences: TemporalRange[];
  questionType: string;  // who, what, when, where, why, how
  complexity: string;    // simple, moderate, complex
  suggestedSearchMethods: string[];
}
```

---

### EmbeddingService (`search/EmbeddingService.ts`)

**Purpose**: Embedding generation providers

```typescript
export interface EmbeddingService {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

// Implementations
export class OpenAIEmbeddingService implements EmbeddingService { }
export class LocalEmbeddingService implements EmbeddingService { }
export class MockEmbeddingService implements EmbeddingService { }
```

---

### VectorStore (`search/VectorStore.ts`)

**Purpose**: Vector storage and similarity search

```typescript
export interface VectorStore {
  add(id: string, vector: number[]): Promise<void>
  search(vector: number[], limit: number): Promise<VectorSearchResult[]>
  delete(id: string): Promise<void>
}

// Implementations
export class InMemoryVectorStore implements VectorStore { }
export class SQLiteVectorStore implements VectorStore { }
export class QuantizedVectorStore implements VectorStore { }  // Compressed
```

---

### SearchFilterChain (`search/SearchFilterChain.ts`)

**Purpose**: Unified filter logic for all search implementations

```typescript
export class SearchFilterChain {
  static applyFilters(entities: Entity[], filters: SearchFilters): Entity[]
  static entityPassesFilters(entity: Entity, filters: SearchFilters): boolean
  static hasActiveFilters(filters: SearchFilters): boolean
  static filterAndPaginate(entities, filters, offset?, limit?): Entity[]
}
```

---

## Feature Components

### IOManager (`features/IOManager.ts`)

**Purpose**: Import, export, and backup functionality

```typescript
export class IOManager {
  constructor(storage: IGraphStorage, backupDir?: string)

  // Export
  async exportGraph(format: ExportFormat, options?: ExportOptions): Promise<string>

  // Import
  async importGraph(
    format: 'json' | 'csv' | 'graphml',
    data: string,
    options?: ImportOptions
  ): Promise<ImportResult>

  // Backup
  async createBackup(options?: BackupOptions): Promise<BackupInfo>
  async restoreBackup(backupId: string): Promise<void>
  async listBackups(): Promise<BackupInfo[]>
  async deleteBackup(backupId: string): Promise<void>
}

type ExportFormat = 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid';
```

---

### TagManager (`features/TagManager.ts`)

**Purpose**: Tag aliases and synonyms

```typescript
export class TagManager {
  constructor(tagAliasesFilePath: string)

  async resolveTag(tag: string): Promise<string>
  async addTagAlias(alias: string, canonical: string, description?: string): Promise<TagAlias>
  async listTagAliases(): Promise<TagAlias[]>
  async removeTagAlias(alias: string): Promise<boolean>
  async getAliasesForTag(canonicalTag: string): Promise<string[]>
}
```

---

### CompressionManager (`features/CompressionManager.ts`)

**Purpose**: Duplicate detection and merging

```typescript
export class CompressionManager {
  constructor(storage: IGraphStorage)

  async findDuplicates(threshold?: number): Promise<string[][]>
  async mergeEntities(entityNames: string[], targetName?: string): Promise<Entity>
  async compressGraph(threshold?: number, dryRun?: boolean): Promise<CompressionResult>
}
```

**Similarity Algorithm**:
```
score = (nameSim × 0.4) + (typeSim × 0.3) + (obsSim × 0.2) + (tagSim × 0.1)
```

---

### AnalyticsManager (`features/AnalyticsManager.ts`)

**Purpose**: Graph statistics and validation

```typescript
export class AnalyticsManager {
  constructor(storage: IGraphStorage)

  async getGraphStats(): Promise<GraphStats>
  async validateGraph(): Promise<ValidationReport>
}

interface GraphStats {
  entityCount: number;
  relationCount: number;
  entityTypes: Record<string, number>;
  tagCounts: Record<string, number>;
  importanceDistribution: Record<number, number>;
}
```

---

### ArchiveManager (`features/ArchiveManager.ts`)

**Purpose**: Entity archival

```typescript
export class ArchiveManager {
  constructor(storage: IGraphStorage)

  async archiveEntities(criteria: ArchiveCriteria, dryRun?: boolean): Promise<ArchiveResult>
}

interface ArchiveCriteria {
  olderThan?: string;
  minImportance?: number;
  maxImportance?: number;
  tags?: string[];
  entityTypes?: string[];
}
```

---

## Utility Components

### schemas (`utils/schemas.ts`)

**Purpose**: Zod validation schemas

**Key Schemas**:
- `EntitySchema`, `CreateEntitySchema`
- `RelationSchema`, `CreateRelationSchema`
- `BatchCreateEntitiesSchema`, `BatchCreateRelationsSchema`
- `SearchQuerySchema`, `DateRangeSchema`

### constants (`utils/constants.ts`)

**Purpose**: Centralized configuration values

```typescript
export const SIMILARITY_WEIGHTS = { NAME: 0.4, TYPE: 0.3, OBSERVATIONS: 0.2, TAGS: 0.1 };
export const DEFAULT_DUPLICATE_THRESHOLD = 0.8;
export const SEARCH_LIMITS = { DEFAULT: 50, MAX: 1000 };
export const IMPORTANCE_RANGE = { MIN: 0, MAX: 10 };
```

### searchAlgorithms (`utils/searchAlgorithms.ts`)

**Purpose**: Text search algorithms

```typescript
export function levenshteinDistance(s1: string, s2: string): number
export function calculateTF(term: string, document: string): number
export function calculateIDF(term: string, documents: string[]): number
export function calculateTFIDF(term: string, doc: string, docs: string[]): number
export function tokenize(text: string): string[]
```

### entityUtils (`utils/entityUtils.ts`)

**Purpose**: Entity manipulation utilities

**Categories**:
- Entity lookup: `findEntityByName`, `entityExists`
- Tag utilities: `normalizeTag`, `normalizeTags`, `hasMatchingTag`
- Date utilities: `isWithinDateRange`, `getCurrentTimestamp`
- Filter utilities: `isWithinImportanceRange`, `filterByImportance`

---

## Type Definitions

### Entity Types (`types/types.ts`)

```typescript
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  parentId?: string;
  tags?: string[];
  importance?: number;
  createdAt?: string;
  lastModified?: string;
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
  createdAt?: string;
  lastModified?: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}
```

### Agent Memory Types (`types/agent-memory.ts`)

```typescript
interface AgentEntity extends Entity {
  memoryType: 'working' | 'episodic' | 'semantic';
  sessionId?: string;
  expiresAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
  confidence: number;
  agentId?: string;
  visibility: 'private' | 'shared' | 'public';
}

interface SessionEntity extends AgentEntity {
  entityType: 'session';
  memoryType: 'episodic';
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'abandoned';
  goalDescription?: string;
  memoryCount: number;
}

interface SalienceContext {
  currentTask?: string;
  currentSession?: string;
  recentEntities?: string[];
  queryText?: string;
  temporalFocus?: 'recent' | 'historical' | 'any';
}

interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  excluded: string[];
}
```

### Search Types

```typescript
interface SearchResult {
  entity: Entity;
  score: number;
  matchedFields: string[];
}

interface SearchFilters {
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  entityType?: string;
  createdAfter?: string;
  createdBefore?: string;
}
```

---

## Component Dependencies

```
┌──────────────────────────────────────────────────────────────┐
│  ManagerContext                                              │
│    │                                                         │
│    ├── AgentMemoryManager ─────────┐                         │
│    │     ├── SessionManager ───────┤                         │
│    │     ├── WorkingMemoryMgr ─────┤                         │
│    │     ├── DecayEngine ──────────┤                         │
│    │     ├── SalienceEngine ───────┤                         │
│    │     ├── ContextWindowMgr ─────┤                         │
│    │     └── MultiAgentMemMgr ─────┤                         │
│    │                               │                         │
│    ├── EntityManager ──────────────┤                         │
│    │                               │                         │
│    ├── RelationManager ────────────┤                         │
│    │                               │                         │
│    ├── ObservationManager ─────────┤                         │
│    │                               │                         │
│    ├── HierarchyManager ───────────┤                         │
│    │                               │                         │
│    ├── SearchManager ──────────────┼──► IGraphStorage        │
│    │     ├── BasicSearch ──────────┤        │                │
│    │     ├── RankedSearch ─────────┤        ▼                │
│    │     ├── BooleanSearch ────────┤   GraphStorage (JSONL)  │
│    │     ├── FuzzySearch ──────────┤        OR               │
│    │     ├── SemanticSearch ───────┤   SQLiteStorage         │
│    │     └── HybridSearchMgr ──────┤                         │
│    │                               │                         │
│    ├── IOManager ──────────────────┤                         │
│    │                               │                         │
│    ├── TagManager ─────────────────► tag-aliases.jsonl       │
│    │                                                         │
│    └── GraphTraversal ─────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

**Shared Dependencies**:
- All managers receive `IGraphStorage` via dependency injection
- `SearchFilterChain` used by all search implementations
- `utils/schemas.ts` used for input validation across managers
- `utils/constants.ts` provides shared configuration
- `utils/searchAlgorithms.ts` provides Levenshtein + TF-IDF algorithms
- Agent components share `AccessTracker` for memory access patterns

---

**Document Version**: 1.2
**Last Updated**: 2026-01-14
**Maintained By**: Daniel Simon Jr.
