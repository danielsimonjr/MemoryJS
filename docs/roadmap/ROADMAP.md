# MemoryJS Future Features Development Roadmap

This document outlines the strategic development roadmap for MemoryJS, organized by priority phases and feature categories.

## Current State Assessment

### Production-Ready Features
- Entity-Relation-Observation data model with full CRUD operations
- Dual storage backends (JSONL & SQLite with FTS5)
- Comprehensive search: TF-IDF, BM25, Boolean, Fuzzy, Semantic, Hybrid
- Semantic search with embedding provider abstraction (OpenAI, local, mock)
- Vector quantization for memory-efficient embeddings
- Reflection-based query refinement with progressive search
- Early termination for search result optimization
- Graph algorithms: shortest path, centrality (degree/betweenness/PageRank), connected components
- Import/Export: JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid with Brotli compression
- Hierarchical entity nesting with parent-child relationships
- Tag management with aliases and bulk operations
- Streaming exports for large graphs (>5000 entities)
- Transaction management with batch processing

### Areas for Documentation/Testing Expansion
- Semantic search configuration guides
- Performance tuning documentation for vector operations
- Advanced query refinement tutorials

---

## Phase 1: Foundation (Months 1-2)

High value, low effort improvements to establish a stronger base.

### 1.1 CLI Interface
- Command-line operations for create, query, export, import
- Interactive mode for exploration
- Pipe support for scripting workflows

### 1.2 Relation Properties
- Extend core Relation type with metadata object (WeightedRelation interface exists but not integrated)
- Support arbitrary key-value pairs on relations
- Integrate with storage backends and CRUD operations
- Backward-compatible with existing relations

### 1.3 Search Enhancements
- Query logging and tracing for debugging
- Search result explanation (show signal contributions)
- Full-text search operators (phrase search, wildcards, proximity)

### 1.4 Developer Experience
- Entity validation helpers with custom field support
- Batch import progress callbacks
- Improved error messages with recovery suggestions

---

## Phase 2: Developer Experience (Months 2-3)

Medium effort improvements focused on usability and observability.

### 2.1 GraphQL Support
- Auto-generated GraphQL schema from entity types
- Query and mutation resolvers
- Subscription support for real-time updates

### 2.2 Advanced Analytics
- Graph density metrics
- Clique detection algorithms
- Authority/hub scores (HITS algorithm)
- Network modularity analysis

### 2.3 Entity Lifecycle
- Draft/published/archived states
- State transition rules and hooks
- Bulk state change operations

### 2.4 Search Intelligence
- Spell correction with context awareness
- Query expansion with synonyms
- Search suggestions ("Did you mean?")

### 2.5 Performance Profiling
- Operation latency metrics
- Cache hit rate monitoring
- Query plan visualization
- Memory usage dashboard

---

## Phase 3: Agent Memory System (Months 3-5)

**Priority Track**: Transform MemoryJS into a comprehensive memory system for AI agents supporting short-term (working memory) and long-term (persistent knowledge) memory patterns.

> See [Agent Memory Architecture](../architecture/AGENT_MEMORY.md) for detailed specifications.

### 3.1 Memory Lifecycle Foundation

**Data Model Extensions**:
- Add `accessCount`, `lastAccessedAt` fields to Entity for access tracking
- Add `sessionId`, `conversationId`, `taskId` for session/context grouping
- Add `expiresAt`, `isWorkingMemory` for TTL-based working memory
- Add `confidence` (0.0-1.0), `confirmationCount` for memory strength
- Add `memoryType` enum: `working`, `episodic`, `semantic`, `procedural`

**Access Tracker Service**:
```typescript
interface AccessTracker {
  recordAccess(entityName: string, context?: AccessContext): Promise<void>;
  calculateRecencyScore(entityName: string, halfLifeHours?: number): number;
  getFrequentlyAccessed(limit: number): Promise<Entity[]>;
  getRecentlyAccessed(limit: number): Promise<Entity[]>;
}
```

**Implementation**:
- Track every entity retrieval with timestamp and context
- Calculate access patterns (frequent/occasional/rare)
- Integrate recency scoring into search ranking
- Add access statistics to entity metadata

### 3.2 Working Memory Manager

**Purpose**: Session-scoped, TTL-based short-term memory for current task context.

**Working Memory Service**:
```typescript
interface WorkingMemoryManager {
  createWorkingMemory(sessionId: string, content: string, options?: WorkingMemoryOptions): Promise<AgentEntity>;
  getSessionMemories(sessionId: string): Promise<AgentEntity[]>;
  clearExpired(): Promise<number>;
  extendTTL(entityNames: string[], additionalHours: number): Promise<void>;
  markForPromotion(entityName: string): Promise<void>;
}
```

**Implementation**:
- Default 24-hour TTL for working memories
- Session-scoped queries (retrieve only current session memories)
- Automatic cleanup of expired memories (background job)
- Promotion candidates tracking for consolidation

### 3.3 Decay Engine

**Purpose**: Implement natural memory decay with importance modulation.

**Decay Formula**:
```
effective_importance = base_importance * decay_factor * strength_multiplier

decay_factor = e^(-ln(2) * age_hours / half_life_hours)
strength_multiplier = 1 + (confirmation_count * 0.1) + (access_count * 0.01)
```

**Decay Engine Service**:
```typescript
interface DecayEngine {
  calculateEffectiveImportance(entity: AgentEntity): number;
  calculateDecayFactor(lastAccessedAt: string, halfLifeHours: number): number;
  getDecayedMemories(threshold: number): Promise<AgentEntity[]>;
  applyDecay(options?: DecayOptions): Promise<DecayResult>;
  reinforceMemory(entityName: string, amount?: number): Promise<void>;
  forgetWeakMemories(options: ForgetOptions): Promise<ForgetResult>;
}
```

**Implementation**:
- Exponential decay based on time since last access
- High-importance memories decay slower (importance modulation)
- Frequently accessed memories decay slower (access modulation)
- Configurable forgetting threshold (archive or delete below threshold)
- Memory reinforcement on access (reset decay, increment confirmation)

### 3.4 Consolidation Pipeline

**Purpose**: Transition short-term memories to long-term storage with summarization.

**Consolidation Service**:
```typescript
interface ConsolidationPipeline {
  consolidateSession(sessionId: string, options?: ConsolidateOptions): Promise<ConsolidationResult>;
  summarizeObservations(entityName: string, similarityThreshold: number): Promise<SummarizationResult>;
  promoteMemory(entityName: string, targetType: 'episodic' | 'semantic'): Promise<void>;
  extractPatterns(entityType: string, minOccurrences: number): Promise<PatternResult[]>;
  mergeMemories(entityNames: string[], strategy: MergeStrategy): Promise<Entity>;
  runAutoConsolidation(rules: ConsolidationRule[]): Promise<ConsolidationResult>;
}
```

**Consolidation Rules**:
```typescript
interface ConsolidationRule {
  trigger: 'session_end' | 'time_elapsed' | 'confirmation_threshold' | 'manual';
  conditions: {
    minConfidence?: number;      // Minimum confidence to promote
    minConfirmations?: number;   // Minimum confirmations required
    minAccessCount?: number;     // Minimum access frequency
  };
  action: 'promote' | 'summarize' | 'merge' | 'archive';
}
```

**Implementation**:
- Observation clustering and summarization (LLM-powered)
- Pattern extraction from repeated observations
- Automatic promotion based on configurable rules
- Session-end consolidation workflow
- De-duplication during merge

### 3.5 Salience & Context-Aware Retrieval

**Purpose**: Dynamic relevance scoring based on current task context.

**Salience Engine**:
```typescript
interface SalienceEngine {
  calculateSalience(entity: AgentEntity, context: SalienceContext): number;
  getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>;
  calculateNovelty(entity: AgentEntity): number;
  calculateTaskRelevance(entity: AgentEntity, taskDescription: string): Promise<number>;
}

interface SalienceContext {
  currentTask?: string;
  currentSession?: string;
  recentEntities?: string[];
  queryText?: string;
  temporalFocus?: 'recent' | 'historical' | 'any';
}
```

**Salience Scoring**:
```
salience = (
  base_importance * decay_factor +
  recency_boost * recency_weight +
  frequency_boost * frequency_weight +
  context_relevance * context_weight +
  novelty_bonus * novelty_weight
)
```

**Implementation**:
- Context-aware importance (same fact, different salience per context)
- Task relevance via semantic similarity to current goal
- Novelty scoring (unexpected/surprising facts boosted)
- Recent entity boosting for conversation continuity

### 3.6 Context Window Manager

**Purpose**: Optimize memory retrieval for LLM context window constraints.

**Context Window Service**:
```typescript
interface ContextWindowManager {
  retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>;
  estimateTokens(entity: AgentEntity): number;
  prioritize(entities: AgentEntity[], maxTokens: number): AgentEntity[];
  handleSpillover(included: AgentEntity[], excluded: AgentEntity[]): SpilloverResult;
}

interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  breakdown: { workingMemory: number; episodic: number; semantic: number };
  excluded: string[];
  suggestions: string[];
}
```

**Implementation**:
- Token budget-aware retrieval
- Priority-based inclusion (working > recent episodic > relevant semantic)
- Spillover handling (what to store for next context window)
- Must-include entity support (always include specified memories)

### 3.7 Session & Episodic Memory

**Purpose**: Group memories by conversation/session with temporal ordering.

**Session Entity**:
```typescript
interface SessionEntity extends Entity {
  entityType: 'session';
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'abandoned';
  goalDescription?: string;
  taskType?: string;
  memoryCount: number;
  previousSessionId?: string;
}
```

**Implementation**:
- Session lifecycle management (start, update, end)
- Session-scoped queries
- Session continuation (link related sessions)
- Episodic timeline generation
- Event sequencing within sessions

### 3.8 Multi-Agent Memory Support

**Purpose**: Enable shared memory spaces and agent identity tracking.

**Multi-Agent Extensions**:
```typescript
interface AgentEntity extends Entity {
  agentId?: string;
  visibility: 'private' | 'shared' | 'public';
  source?: {
    agentId: string;
    timestamp: string;
    method: 'observed' | 'inferred' | 'told' | 'consolidated';
    reliability: number;
  };
}

interface MultiAgentMemoryManager {
  registerAgent(agentId: string, metadata?: AgentMetadata): Promise<void>;
  createAgentMemory(agentId: string, entity: Partial<AgentEntity>): Promise<AgentEntity>;
  getVisibleMemories(agentId: string, filter?: MemoryFilter): Promise<AgentEntity[]>;
  shareMemory(entityName: string, targetAgents: string[] | 'all'): Promise<void>;
  resolveConflict(conflictingEntities: string[], strategy: ConflictStrategy): Promise<AgentEntity>;
}
```

**Conflict Resolution Strategies**:
- `most_recent` - Latest timestamp wins
- `highest_confidence` - Highest confidence score wins
- `most_confirmations` - Most confirmed memory wins
- `trusted_agent` - Higher trust agent wins
- `merge_all` - Combine all observations

**Implementation**:
- Agent registration and trust levels
- Visibility-based query filtering
- Memory sharing protocols
- Conflict detection and resolution
- Cross-agent memory merge with trust weighting

### 3.9 Environment Configuration

**New Environment Variables**:
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
MEMORY_SUMMARIZATION_PROVIDER=openai

# Context Window
MEMORY_DEFAULT_TOKEN_BUDGET=4000
MEMORY_TOKEN_ESTIMATOR=tiktoken

# Multi-Agent
MEMORY_MULTI_AGENT_ENABLED=false
MEMORY_DEFAULT_VISIBILITY=private
```

### 3.10 Testing Requirements

**Unit Tests**:
- Decay calculations (exponential decay, modulation)
- Access tracking (frequency, recency scoring)
- Salience scoring (context relevance, novelty)
- Token estimation accuracy
- Consolidation rule evaluation

**Integration Tests**:
- Full memory lifecycle (create → access → decay → forget)
- Session management (start → memories → consolidate → end)
- Multi-agent scenarios (visibility, sharing, conflicts)
- Context window optimization

**Performance Tests**:
- Decay processing at scale (10k+ entities)
- Retrieval latency with token budgeting
- Consolidation throughput
- Concurrent multi-agent access

---

## Phase 4: Integration & Scale (Months 5-7)

Medium-high effort features for broader ecosystem integration.

### 4.1 Database Adapters
- PostgreSQL adapter with pg_trgm for text search
- MongoDB integration for document-oriented storage
- Connection pooling for concurrent operations

### 4.2 REST API Generation
- Fastify plugin for automatic API generation
- OpenAPI/Swagger documentation
- Rate limiting and pagination

### 4.3 Elasticsearch Integration
- Offload advanced full-text search
- Sync entities to Elasticsearch index
- Hybrid local + Elasticsearch queries

### 4.4 Temporal Versioning
- Entity/relation change history
- Point-in-time queries
- Audit trail with user attribution
- Rollback capabilities

### 4.5 Scalability Improvements
- Streaming exports for 100k+ entities
- Lazy entity loading on demand
- Memory-mapped file support for large graphs
- Index partitioning by entity type

### 4.6 Graph Visualization
- Browser-based graph explorer
- Interactive filtering and search
- Export to SVG/PNG

---

## Phase 5: Advanced Features (Months 7-10)

High effort features for sophisticated use cases.

### 5.1 Vector Database Integration
- Weaviate/Pinecone adapter for semantic search
- Multi-vector embeddings per entity type
- Automatic embedding synchronization

### 5.2 Graph Embeddings
- node2vec implementation for entity embeddings
- GraphSAGE for inductive learning
- Embedding-based entity similarity

### 5.3 ML-Powered Features
- Auto-tagging based on observations
- Anomaly detection in relationships
- Entity clustering by similarity
- Knowledge graph completion (predict missing relations)

### 5.4 Standards Compliance
- SPARQL query support
- RDF import/export
- Linked Data compatibility

### 5.5 Collaboration Features
- Multi-user graph editing
- Change conflict resolution
- Real-time collaboration via WebSockets

---

## Phase 6: Enterprise (Months 10+)

Very high effort features for enterprise deployments.

### 6.1 Access Control
- Role-Based Access Control (RBAC)
- Attribute-Based Access Control (ABAC)
- Row-level security for entities
- API key management

### 6.2 Distributed Architecture
- Graph sharding by entity type or hierarchy
- Read replicas for query scaling
- Write-ahead log for consistency
- Conflict-free replicated data types (CRDTs)

### 6.3 Security & Compliance
- Encryption at rest (AES-256)
- Encryption in transit (TLS)
- GDPR compliance tools (right to deletion)
- PII detection and masking
- Complete audit logging

### 6.4 Cloud-Native Deployment
- Kubernetes manifests and Helm charts
- Docker images for containerization
- Serverless adapters (AWS Lambda, Cloud Functions)
- Cloud storage backends (S3, GCS, Azure Blob)

### 6.5 GPU Acceleration
- CUDA-accelerated similarity search
- Batch embedding generation
- Parallel graph algorithm execution

---

## Feature Categories

### Query Language Enhancements
- Domain-specific query language (DSL)
- SQL-like syntax for familiarity
- Visual query builder

### Integration Possibilities

| Integration | Purpose | Priority |
|-------------|---------|----------|
| PostgreSQL | Production-grade backend | High |
| Elasticsearch | Advanced text search | High |
| Neo4j | Graph database bridge | Medium |
| Redis | Distributed caching | Medium |
| OpenAI/Anthropic | Embeddings and reasoning | High |
| LangChain | LLM memory backend | High |
| Llama Index | Data connector | Medium |

### Framework Integrations

| Framework | Integration Type | Priority |
|-----------|------------------|----------|
| NestJS | Module with decorators | Medium |
| Fastify | REST API plugin | High |
| Express | Middleware | Medium |
| Next.js | API routes support | Medium |

---

## Performance Optimization Roadmap

### Quick Wins
- Incremental index updates (only reindex changes)
- Search result caching with TTL
- Lazy loading for relations
- Connection pooling

### Architectural Improvements
- Graph partitioning strategies
- Bloom filters for negative lookups
- Approximate algorithms (LSH for fuzzy search)
- Columnar storage for observations

### Long-term Redesign
- Distributed multi-node architecture
- GPU acceleration for similarity
- Time-series optimized indexes
- Adaptive indexing based on query patterns

---

## Test Coverage Expansion

### Current Coverage
- 90 test files with comprehensive unit, integration, and performance tests
- Strong coverage of core functionality

### Planned Test Additions
- CLI tool testing
- GraphQL resolver tests
- Property-based testing for search algorithms
- Chaos engineering for concurrency
- Load testing for scaling scenarios
- Security fuzzing for input validation

---

## Dependency Strategy

### Current Dependencies (Minimal)
- `@danielsimonjr/workerpool` - Worker pool management
- `async-mutex` - Concurrency control
- `better-sqlite3` - SQLite backend
- `zod` - Runtime validation

### Recommended Additions
| Purpose | Library | Rationale |
|---------|---------|-----------|
| GraphQL | `graphql`, `graphql-tools` | Standard GraphQL support |
| CLI | `commander` | CLI argument parsing |
| REST | `fastify` | High-performance HTTP |
| Vector DB | `@weaviate/weaviate-client` | Semantic search |
| Embeddings | `@xenova/transformers` | Local embedding fallback |

### Principles
- Keep the core library lean
- Add integrations as optional peer dependencies
- Maintain backward compatibility
- Prefer well-maintained, actively developed libraries

---

## Breaking Change Policy

### Avoid Breaking
- Core Entity/Relation/KnowledgeGraph interfaces
- Search result ranking algorithms (without deprecation)
- JSONL storage format (backward compatibility)

### Gradual Rollout
- Feature flags for experimental features (env vars)
- Deprecation periods (2 minor versions minimum)
- Beta releases for major features
- Migration guides for breaking changes

---

## Contributing to the Roadmap

This roadmap is a living document. To propose features:

1. Open an issue with the `roadmap` label
2. Describe the use case and expected benefits
3. Indicate preferred priority tier
4. Include implementation considerations if known

The maintainers will review proposals quarterly and update this roadmap accordingly.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-12 | Initial roadmap creation |
| 1.1 | 2025-01-13 | Added Phase 3: Agent Memory System with comprehensive short-term and long-term memory support for AI agents. Includes memory lifecycle, decay engine, consolidation pipeline, salience scoring, context window management, session/episodic memory, and multi-agent support. See [Agent Memory Architecture](../architecture/AGENT_MEMORY.md) for detailed specifications. |
