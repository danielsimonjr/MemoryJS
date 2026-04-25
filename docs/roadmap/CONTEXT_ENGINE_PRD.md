# Context Engine — Product Requirements Document

> **Full specification for building a production-grade context engineering system:**  
> retrieval · re-ranking · memory decay · semantic compression · token budgeting · observability

---

| Field | Value |
|---|---|
| **Document** | PRD v1.0 |
| **Status** | ✅ Approved |
| **Date** | April 2026 |
| **Build Horizon** | 4 Phases · 16 Weeks |
| **Target Stack** | Python 3.12+ · asyncio · FastAPI |
| **Companion** | [CONTEXT_ENGINE_WHITEPAPER.md](./CONTEXT_ENGINE_WHITEPAPER.md) |

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [Users & Use Cases](#4-users--use-cases)
5. [System Architecture](#5-system-architecture)
6. [Component: Hybrid Retriever](#6-component-hybrid-retriever)
7. [Component: Two-Phase Re-ranker](#7-component-two-phase-re-ranker)
8. [Component: Memory Engine](#8-component-memory-engine)
9. [Component: Semantic Compressor](#9-component-semantic-compressor)
10. [Component: Token Budget Enforcer](#10-component-token-budget-enforcer)
11. [Component: Pipeline Orchestrator](#11-component-pipeline-orchestrator)
12. [API Design](#12-api-design)
13. [Core Data Models](#13-core-data-models)
14. [Performance Requirements (NFRs)](#14-performance-requirements-nfrs)
15. [Observability & Evaluation](#15-observability--evaluation)
16. [Implementation Phases](#16-implementation-phases)
17. [Testing Strategy](#17-testing-strategy)
18. [Success Metrics](#18-success-metrics)
19. [Risks & Mitigations](#19-risks--mitigations)
20. [Appendix: Configuration Reference](#20-appendix-configuration-reference)

---

## 1. Product Overview

The **Context Engine** is a standalone infrastructure component that sits between a document retrieval system and an LLM generation call. It implements **context engineering** — the discipline of deciding what information enters the model's context window, how much of it, in what order, and at what level of compression — as an explicit, observable, configurable software layer.

```mermaid
flowchart LR
    A["📄 Documents\n& Knowledge Base"] --> CE
    B["💬 Conversation\nHistory"] --> CE
    C["🔍 User Query"] --> CE

    subgraph CE["⚙️ Context Engine"]
        direction TB
        CE1["Hybrid Retrieval"]
        CE2["Two-Phase Re-ranking"]
        CE3["Memory Decay Filter"]
        CE4["Semantic Compression"]
        CE5["Token Budget Enforcement"]
        CE1 --> CE2 --> CE3 --> CE4 --> CE5
    end

    CE --> D["📦 ContextPacket\n(token-safe, ranked, compressed)"]
    D --> E["🤖 LLM API Call"]
    D --> F["🔭 Context Trace\n(fully observable)"]

    style CE fill:#0d1a2a,stroke:#00d4ff,stroke-width:2px,color:#d0dae8
```

### Why It Exists

Without a context engine, LLM systems operating under multi-turn, multi-document, token-constrained conditions degrade **predictably and immediately**:

| Symptom | Root Cause |
|---|---|
| Prompt overflows | No token budget enforcement |
| Model "forgets" recent turns | No memory decay; old turns crowd new ones |
| Relevant docs dropped | No re-ranking; near-duplicates fill top-K |
| 39% performance drop | Fragmented multi-turn context (Microsoft/Salesforce, 2025) |
| Accuracy cliff at unpredictable length | Context rot — confirmed on 18 models (Chroma, 2025) |

---

## 2. Problem Statement

### The Core Failure Mode

```mermaid
sequenceDiagram
    participant U as User
    participant RAG as Naive RAG
    participant LLM as LLM

    U->>RAG: Turn 1: "What is context engineering?"
    RAG->>LLM: [5 full docs + query] → 810 chars → OK
    LLM-->>U: Response

    U->>RAG: Turn 2: "How does memory decay help?"
    RAG->>LLM: [5 full docs + Turn 1 history + query] → OVERFLOW 💥
    Note over LLM: Token budget exceeded.<br/>Silent truncation or API error.
    LLM-->>U: Incoherent / truncated response

    U->>RAG: Turn 5: "Can you summarise what we discussed?"
    RAG->>LLM: [All history + 5 docs] → Context rot 💥
    Note over LLM: Attention diluted across irrelevant old turns.<br/>Performance -39% (Microsoft/Salesforce 2025)
    LLM-->>U: Confused, contradictory response
```

### What Existing Solutions Miss

| Tool | What It Provides | What It Misses |
|---|---|---|
| LangChain / LlamaIndex | RAG pipeline orchestration | Context assembly discipline; budget enforcement |
| Vector databases | Document storage + retrieval | Compression; memory decay; token budgeting |
| Prompt engineering libraries | Instruction quality | Information flow control |
| LLM APIs | Token acceptance | Context curation — they accept, not curate |
| Memory libraries (Mem0, Zep) | Session persistence | Integrated pipeline orchestration |

> **No existing off-the-shelf component addresses context engineering as a complete, integrated pipeline.  
> The Context Engine fills this gap.**

---

## 3. Goals & Non-Goals

### Goals

| ID | Requirement | Priority |
|---|---|---|
| `GOAL-01` | Guarantee context packets never exceed configured token budget, under any combination of document count, history depth, or query type | 🔴 Must |
| `GOAL-02` | Deliver measurably higher retrieval relevance than TF-IDF-only or embedding-only, validated by NDCG@5 (+15% minimum) | 🔴 Must |
| `GOAL-03` | Implement exponential memory decay with configurable parameters; high-importance turns must survive longer than low-importance turns without manual annotation | 🔴 Must |
| `GOAL-04` | Produce a full `ContextTrace` for every `build()` call — a serialised, queryable record of every allocation decision | 🔴 Must |
| `GOAL-05` | Persist memory state across sessions (SQLite single-user; PostgreSQL multi-user) with identical API across backends | 🟡 Should |
| `GOAL-06` | Expose the pipeline as an MCP server for integration with LangGraph, AutoGen, Semantic Kernel | 🟢 Could |

### Non-Goals

> ❌ This is **NOT** an LLM. The Context Engine assembles context; it does not generate responses.  
> ❌ This is **NOT** a vector database. It integrates with one; it does not replace one.  
> ❌ This is **NOT** a prompt engineering library. Prompt construction is a separate concern.  
> ❌ This is **NOT** a fine-tuning pipeline. Knowledge is retrieved, not baked into weights.  
> ❌ This is **NOT** a UI or chat interface. It is infrastructure consumed via API.

---

## 4. Users & Use Cases

### Primary Users

```mermaid
mindmap
  root((Context Engine Users))
    ML / AI Engineers
      Build production LLM apps
      Primary SDK consumers
      Need deterministic context control
    Platform Engineers
      Deploy as shared service
      Consume REST API
      Own observability stack
    AI Architects
      Design multi-agent systems
      Solve context assembly once
      Enforce architectural standards
```

### Use Cases by Profile

| Use Case | Key Requirements | Config Profile |
|---|---|---|
| Multi-turn chatbot | Memory decay · deduplication · session persistence | `profile: conversational` |
| Enterprise RAG (large KB) | Two-phase re-ranking · adaptive α · semantic compression | `profile: knowledge-retrieval` |
| AI Copilot / Code Assistant | tiktoken (code-aware) · file context injection · low latency | `profile: developer-copilot` |
| Multi-agent orchestration | MCP server · shared memory across agents · tool-call context | `profile: agent` |
| Long-document Research QA | Dense ingestion · LLM Wiki compiler · extractive compression | `profile: research` |

### When to Skip the Context Engine

> ℹ️ The full pipeline overhead is not justified for:
> - Single-turn queries with < 20 documents
> - Latency requirements < 50ms without embedding caching  
> - Fully deterministic keyword-only retrieval domains (legal contract parsing)
>
> A `lightweight` mode (keyword retrieval + truncation + no memory) must be available for these cases.

---

## 5. System Architecture

### Full Architecture

```mermaid
flowchart TD
    subgraph INGEST["📥 INGESTION PLANE"]
        I1["Doc Loader\nPDF · HTML · MD · Code"]
        I2["Semantic Chunker"]
        I3["Batch Embedder\nCPU / GPU"]
        I4a["Vector Store\nFAISS · Pinecone · pgvector"]
        I4b["BM25 Index"]
        I4c["LLM Wiki Compiler\n⏱ Background job"]
        I1 --> I2 --> I3
        I3 --> I4a
        I3 --> I4b
        I3 -.->|optional| I4c
    end

    subgraph RETRIEVE["🔎 RETRIEVAL PLANE"]
        R1["Incoming Query"]
        R2["Query Classifier\nAdaptive α routing"]
        R3["Hybrid Retriever\nα·emb + (1-α)·tfidf"]
        R4["Candidate Set (top-K)"]
        R1 --> R2 --> R3 --> R4
    end

    subgraph ENGINE["⚙️ CONTEXT ENGINEERING PLANE"]
        E1["Phase 1: Heuristic Re-ranker\n< 0.3ms"]
        E2{"> threshold?"}
        E3["Phase 2: Cross-Encoder\n40–80ms CPU"]
        E4["Skip Phase 2"]
        E5["Memory Engine\nDecay · Dedup · Persist"]
        E6["Semantic Compressor\nEmbedding-aware sentence scoring"]
        E7["Token Budget Enforcer\ntiktoken · slot-based · strict order"]
        E8["ContextPacket Builder"]
        E1 --> E2
        E2 -->|Yes| E3
        E2 -->|No| E4
        E3 --> E5
        E4 --> E5
        E5 --> E6
        E6 --> E7
        E7 --> E8
    end

    subgraph OBSERVE["🔭 OBSERVABILITY PLANE"]
        O1["ContextTrace Logger"]
        O2["Token Auditor"]
        O3["Quality Evaluator\nNDCG@5 · Compression sim"]
        O4["Drift Detector"]
        O5["A/B Experiment Runner"]
    end

    subgraph CONTROL["🎛️ CONTROL PLANE"]
        C1["Config API"]
        C2["Multi-Tenant Isolation"]
        C3["LRU Embedding Cache\n10k entries default"]
        C4["Rate Limiter"]
        C5["Health Monitor"]
    end

    I4a --> R3
    I4b --> R3
    R4 --> E1
    E8 --> O1
    E8 --> GEN["🤖 LLM Call"]

    style ENGINE fill:#0d1a2a,stroke:#00d4ff,stroke-width:3px,color:#d0dae8
    style RETRIEVE fill:#0d1a1a,stroke:#7fff6a,color:#d0dae8
    style INGEST fill:#1a1a0d,stroke:#ffb84d,color:#d0dae8
    style OBSERVE fill:#1a0d1a,stroke:#b57bff,color:#d0dae8
    style CONTROL fill:#111,stroke:#4ecdc4,color:#d0dae8
```

### Component Dependency Map

```mermaid
graph LR
    CFG["EngineConfig"]
    EMB["EmbeddingProvider"]
    RET["HybridRetriever"]
    RNK["TwoPhaseReRanker"]
    MEM["MemoryEngine"]
    CMP["SemanticCompressor"]
    BDG["TokenBudgetEnforcer"]
    ORC["ContextEngine\n(Orchestrator)"]
    TRC["ContextTraceLogger"]

    CFG --> ORC
    EMB --> RET
    EMB --> CMP
    RET --> ORC
    RNK --> ORC
    MEM --> ORC
    CMP --> ORC
    BDG --> ORC
    ORC --> TRC
```

---

## 6. Component: Hybrid Retriever

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| `RET-01` | Support three retrieval modes: `keyword` (BM25), `tfidf` (TF-IDF + cosine), `hybrid` (adaptive-α blend) | 🔴 Must |
| `RET-02` | Implement `QueryClassifier` that selects α dynamically: keyword-heavy (0.35–0.45), balanced (0.60–0.70), semantic (0.75–0.85) | 🔴 Must |
| `RET-03` | Implement LRU embedding cache (default: 10,000 entries). Cache hit < 2ms; miss triggers fresh computation | 🔴 Must |
| `RET-04` | Expose pluggable embedding provider interface: `LocalTransformer`, `OpenAIEmbeddings`, `CohereEmbeddings` | 🟡 Should |
| `RET-05` | Degrade gracefully when `sentence-transformers` unavailable: fall back to TF-IDF with logged `WARNING`. Random embeddings forbidden in production mode | 🔴 Must |

### Alpha Selection Decision Tree

```mermaid
flowchart TD
    Q["Incoming Query"] --> L{Token count?}
    L -->|< 5 tokens| K{Rare domain terms?}
    L -->|5–15 tokens| B{Noun-phrase\nheavy?}
    L -->|> 15 tokens| S["α = 0.80\nSemantic mode"]

    K -->|Yes| KW["α = 0.38\nKeyword mode"]
    K -->|No| B2["α = 0.50\nBalanced-keyword"]

    B -->|Yes| BAL["α = 0.65\nBalanced mode"]
    B -->|No| S2["α = 0.75\nSemantic-leaning"]

    style KW fill:#1a1a0d,stroke:#ffb84d,color:#d0dae8
    style BAL fill:#0d1a1a,stroke:#7fff6a,color:#d0dae8
    style S fill:#1a0d1a,stroke:#b57bff,color:#d0dae8
    style S2 fill:#1a0d1a,stroke:#b57bff,color:#d0dae8
    style B2 fill:#1a1a0d,stroke:#ffb84d,color:#d0dae8
```

### Performance Targets

| Mode | P95 Latency Target | Notes |
|---|---|---|
| `keyword` | < 1ms | In-memory inverted index |
| `tfidf` | < 5ms | Pre-computed matrix |
| `hybrid` (CPU, cache hit) | < 30ms | LRU cache hit rate target > 80% |
| `hybrid` (GPU) | < 10ms | Batch inference |

---

## 7. Component: Two-Phase Re-ranker

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| `RNK-01` | Phase 1 heuristic: `score = retrieval × 0.65 + tag_importance × 0.25 + freshness_bonus × 0.10`. All weights configurable | 🔴 Must |
| `RNK-02` | Domain tag sets and importance multipliers must be configurable per deployment | 🔴 Must |
| `RNK-03` | Phase 2 cross-encoder invoked when doc count > configurable threshold (default: 20). Default model: `cross-encoder/ms-marco-MiniLM-L-6-v2` | 🟡 Should |
| `RNK-04` | Cross-encoder interface must be pluggable: local BERT, Cohere Rerank API, custom provider | 🟡 Should |

### Two-Phase Decision Flow

```mermaid
sequenceDiagram
    participant ORC as Orchestrator
    participant P1 as Phase 1 Heuristic
    participant P2 as Phase 2 Cross-Encoder
    participant OUT as Ranked Output

    ORC->>P1: candidates (N documents)
    P1->>P1: score = retrieval×0.65 + tag×0.25 + fresh×0.10
    P1->>P1: Sort → Top-50

    alt N > threshold (default: 20)
        P1->>P2: Top-50 candidates
        P2->>P2: BERT forward pass per doc
        P2->>OUT: Top-5 (principled ranking)
    else N ≤ threshold
        P1->>OUT: Top-5 (heuristic ranking)
    end

    Note over P1: ~0.3ms
    Note over P2: ~40–80ms CPU / <10ms GPU
```

---

## 8. Component: Memory Engine

### Decay Model

```mermaid
flowchart TD
    T["New Turn Arrives"] --> DUP{Deduplication\n3-tier check}
    DUP -->|Duplicate| DROP["❌ Reject\nSave memory slot"]
    DUP -->|Unique| AI["Auto-Importance Score\n1.0 – 3.0"]
    AI --> STORE["Store Turn\n+ timestamp + importance"]

    STORE --> DECAY["Decay Calculation\n(at retrieval time)"]
    DECAY --> EFF["effective =\nimportance × recency × freshness\n+ relevance_boost"]
    EFF --> FILTER{effective >\nmin_threshold?}
    FILTER -->|Yes| KEEP["✅ Include in context"]
    FILTER -->|No| PRUNE["🗑️ Prune from context"]
```

### Decay Formula Components

```
effective = importance × recency × freshness + relevance_boost

recency         = e^(−decay_rate × age_seconds)          [time-based forgetting]
freshness       = e^(−0.01 × seconds_since_last_access)  [recency-of-use bonus]
relevance_boost = (|query_tokens ∩ turn_tokens| / |query|) × 0.35  [topic alignment]
importance      = auto_score(content)  range: [1.0, 3.0]
```

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| `MEM-01` | All decay parameters (`decay_rate`, `freshness_coefficient`, `relevance_weight`, `min_importance_threshold`) configurable per instance | 🔴 Must |
| `MEM-02` | Auto-importance scoring evaluates: content length (log-scaled), domain keyword presence, query token overlap with recent turns | 🔴 Must |
| `MEM-03` | Three-tier deduplication before storage: (1) exact containment, (2) 50% prefix overlap, (3) Jaccard token similarity ≥ threshold (default 0.72) | 🔴 Must |
| `MEM-04` | Storage backend interface with `InMemoryBackend` (default) and `SQLiteBackend` (persistent). Identical `add()` / `get_weighted()` API | 🔴 Must |
| `MEM-05` | `PostgreSQLBackend` for multi-user deployment. Tenant isolation via `session_id` + `user_id` scoping | 🟡 Should |
| `MEM-06` | `VectorMemoryBackend` storing turn embeddings for semantic recall across sessions | 🟢 Could |

### Storage Backend Architecture

```mermaid
classDiagram
    class MemoryBackend {
        <<interface>>
        +add(turn, session_id) None
        +get_weighted(query, session_id) list~MemoryTurn~
        +delete_session(session_id) None
        +list_sessions() list~str~
    }

    class InMemoryBackend {
        -store dict
        Scope: single session
        Latency: microseconds
    }

    class SQLiteBackend {
        -db_path str
        -conn Connection
        Scope: single user, persistent
        Latency: ~1ms
    }

    class PostgreSQLBackend {
        -dsn str
        -pool AsyncPool
        Scope: multi-user, multi-tenant
        Latency: ~3–8ms
    }

    class VectorMemoryBackend {
        -vector_store VectorStore
        Scope: semantic cross-session
        Latency: ~10–30ms
    }

    MemoryBackend <|-- InMemoryBackend
    MemoryBackend <|-- SQLiteBackend
    MemoryBackend <|-- PostgreSQLBackend
    MemoryBackend <|-- VectorMemoryBackend
```

---

## 9. Component: Semantic Compressor

### Strategy Comparison

| Strategy | Algorithm | Speed | Quality | Use When |
|---|---|---|---|---|
| `truncate` | Proportional character cutoff per chunk | ⚡ ~0.1ms | Low — blindly cuts tail | Legacy compatibility only |
| `sentence` | Greedy sentence-boundary selection | ⚡ ~1ms | Medium — clean stops | Budget very tight |
| `extractive_token` | Query-token recall scoring | ✅ ~4ms | Good — relevant sentences | Default |
| `extractive_semantic` | Cosine similarity of sentence embeddings to query | ✅✅ ~12ms | Best — catches paraphrases | Production default |

### Semantic Compression Flow

```mermaid
flowchart TD
    DOC["Retrieved Documents\n(ranked, post-rerank)"] --> SPLIT["Sentence Splitter"]
    SPLIT --> SCORE{Scoring Mode}

    SCORE -->|extractive_token| TS["Token Overlap Score\nquery_tokens ∩ sentence_tokens / |query|"]
    SCORE -->|extractive_semantic| ES["Embedding Cosine Score\ncos(embed(sentence), embed(query))"]

    TS & ES --> RANK["Rank Sentences by Score"]
    RANK --> SELECT["Greedy Selection\nwithin remaining budget"]
    SELECT --> RESTORE["⚠️ Restore Original\nDocument Order\n(relevance order → incoherence)"]
    RESTORE --> OUT["Compressed Context\nwithin token budget"]

    style RESTORE fill:#2a0d0d,stroke:#ff6b6b,color:#d0dae8
    style OUT fill:#0d1a0d,stroke:#7fff6a,color:#d0dae8
```

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| `CMP-01` | Support all four strategies: `truncate`, `sentence`, `extractive_token`, `extractive_semantic` | 🔴 Must |
| `CMP-02` | **All strategies must restore original document order.** Relevance-rank order is explicitly forbidden — it produces incoherent context | 🔴 Must |
| `CMP-03` | `extractive_semantic` uses cosine similarity between sentence and query embeddings, reusing the retrieval model (no additional model loading) | 🟡 Should |
| `CMP-04` | Report `compression_ratio`, `strategy_used`, `sentences_selected`, `sentences_dropped` in result, for context trace | 🔴 Must |

---

## 10. Component: Token Budget Enforcer

### Slot Reservation Order (Non-Negotiable)

```mermaid
flowchart LR
    T["Total Token Budget\n(e.g. 4096 tokens)"]
    T --> S1["Slot 1: system_prompt\n🔒 Fixed — reserve first\n~200 tokens"]
    S1 --> S2["Slot 2: history\n💬 Memory turns\n~300 tokens"]
    S2 --> S3["Slot 3: query\n🔍 Current user input\n~50 tokens"]
    S3 --> S4["Slot 4: retrieved_docs\n📄 Variable — compress to fit\nRemaining budget"]
    S4 --> S5["Slot 5: generation_reserve\n🤖 Output buffer\n~512 tokens"]

    style S1 fill:#2a1a0d,stroke:#ffb84d,color:#d0dae8
    style S2 fill:#0d1a2a,stroke:#00d4ff,color:#d0dae8
    style S3 fill:#1a0d2a,stroke:#b57bff,color:#d0dae8
    style S4 fill:#0d1a0d,stroke:#7fff6a,color:#d0dae8
    style S5 fill:#1a1a1a,stroke:#555,color:#888
```

> ⚠️ **Reserve in the wrong order and documents silently overflow the budget before history is accounted for. The reservation order is the entire design.**

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| `BDG-01` | Token estimation configurable: `char_heuristic` (÷4, < 1ms), `tiktoken` (~5ms/1k tokens), `model_specific`. Non-English or code content **must** use tiktoken | 🔴 Must |
| `BDG-02` | Raise structured `BudgetExceededError` (never silent truncation) if system prompt alone exceeds total budget | 🔴 Must |
| `BDG-03` | `budget_report()` returns per-slot allocation, remaining budget, overflow risk flag. Must be included in context trace | 🔴 Must |
| `BDG-04` | Support configurable `generation_reserve` slot (default: 512 tokens) that is never consumed by input content | 🟡 Should |

---

## 11. Component: Pipeline Orchestrator

### `build()` Sequence

```mermaid
sequenceDiagram
    participant CALLER as Caller
    participant ORC as ContextEngine
    participant RET as HybridRetriever
    participant RNK as TwoPhaseReRanker
    participant MEM as MemoryEngine
    participant CMP as SemanticCompressor
    participant BDG as TokenBudgetEnforcer
    participant TRC as TraceLogger

    CALLER->>ORC: await build(query, session_id)

    ORC->>RET: retrieve(query, top_k)
    RET-->>ORC: candidates[K]

    ORC->>RNK: rerank(query, candidates)
    RNK-->>ORC: ranked_docs[K]

    ORC->>MEM: get_weighted(query, session_id)
    MEM-->>ORC: memory_turns[]

    ORC->>BDG: reserve("system_prompt", text)
    ORC->>BDG: reserve("history", memory_turns)
    ORC->>BDG: reserve("query", query)
    BDG-->>ORC: remaining_chars

    ORC->>CMP: compress(ranked_docs, query, max_chars=remaining)
    CMP-->>ORC: CompressedResult{text, ratio, sentences_dropped}

    ORC->>BDG: reserve("retrieved_docs", compressed.text)
    BDG-->>ORC: BudgetReport{slots, remaining, overflow_risk}

    ORC->>TRC: log(ContextTrace{...})

    ORC-->>CALLER: ContextPacket{system_prompt, history,\nretrieved_docs, query,\nbudget_report, trace}
```

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| `ORC-01` | `build()` must be fully async. All I/O (embedding calls, DB reads, cache lookups) must be awaitable. Sync `build_sync()` wrapper acceptable as convenience | 🔴 Must |
| `ORC-02` | Config profiles (`conversational`, `knowledge-retrieval`, `developer-copilot`, `agent`, `research`, `lightweight`) must set all component defaults | 🔴 Must |
| `ORC-03` | All components must implement their degraded mode. Context assembly must always produce a valid `ContextPacket`, even under partial failure | 🔴 Must |
| `ORC-04` | Support `dry_run=True` mode: execute full pipeline, return trace + budget report, but do not consume memory slots or modify state | 🟡 Should |

---

## 12. API Design

### Python SDK (Primary Interface)

```python
from context_engine import ContextEngine, EngineConfig

# Initialise from a config profile
engine = ContextEngine.from_config(EngineConfig(
    profile="conversational",
    total_token_budget=4096,
    compression_strategy="extractive_semantic",
    memory_backend="sqlite",
    memory_db_path="./memory.db",
    reranker_mode="two_phase",
    reranker_cross_encoder_threshold=20,
    embedding_provider="local",        # or "openai", "cohere"
    embedding_cache_size=10_000,
    token_estimator="tiktoken",
))

# Build a context packet for an LLM call
packet = await engine.build(
    query="How does memory decay work in context engines?",
    session_id="user-abc-123",
)

# Use the packet to assemble your prompt (caller's responsibility)
prompt = f"{packet.system_prompt}\n\n{packet.retrieved_docs}\n\n{packet.query}"

# After the LLM responds, store the exchange
await engine.memory.add(
    content="How does memory decay work in context engines?",
    role="user",
    session_id="user-abc-123",
)
await engine.memory.add(
    content=llm_response,
    role="assistant",
    session_id="user-abc-123",
)

# Inspect the context trace
print(packet.trace.compression_ratio)   # e.g. 0.51
print(packet.budget_report.overflow_risk)  # False
```

### REST API Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/build` | Build a context packet. Returns `ContextPacket` JSON | Bearer token |
| `POST` | `/v1/memory/add` | Add conversation turn to session memory | Bearer token |
| `GET` | `/v1/memory/{session_id}` | Get weighted memory turns | Bearer token |
| `DELETE` | `/v1/memory/{session_id}` | Clear all memory for a session | Bearer token |
| `POST` | `/v1/documents/ingest` | Ingest documents (chunk + embed + index) | Admin |
| `GET` | `/v1/documents/{doc_id}` | Retrieve document metadata | Bearer token |
| `GET` | `/v1/traces/{trace_id}` | Retrieve stored context trace by ID | Bearer token |
| `GET` | `/v1/traces?session_id=&limit=` | List traces for a session | Bearer token |
| `GET` | `/v1/health` | Health check with per-component status | Public |
| `GET` | `/v1/metrics` | Prometheus-compatible metrics | Internal |

### Request / Response Shape

```python
# POST /v1/build
{
  "query": "How does memory decay work?",
  "session_id": "user-abc-123",
  "profile": "conversational",          # optional override
  "token_budget": 4096,                 # optional override
  "compression_strategy": "extractive_semantic"
}

# Response: ContextPacket
{
  "system_prompt": "You are a helpful assistant...",
  "history": [
    {"role": "user", "content": "...", "effective_score": 2.31},
    {"role": "assistant", "content": "...", "effective_score": 1.87}
  ],
  "retrieved_docs": "...(compressed, ordered)...",
  "query": "How does memory decay work?",
  "total_tokens": 1842,
  "overflow_risk": false,
  "budget_report": {
    "slots": {"system_prompt": 200, "history": 380, "retrieved_docs": 1200, "query": 62},
    "remaining": 254,
    "generation_reserve": 512
  },
  "trace": {
    "trace_id": "trc_7f3a...",
    "compression_ratio": 0.51,
    "reranker_phase": 1,
    "memory_turns_in": 8,
    "memory_turns_out": 2,
    "alpha_used": 0.65,
    "docs_before_compression": ["doc-001", "doc-003", "doc-007"],
    "docs_after_compression": ["doc-001", "doc-003", "doc-007"]
  }
}
```

---

## 13. Core Data Models

```mermaid
classDiagram
    class ContextPacket {
        +system_prompt: str
        +history: list~MemoryTurn~
        +retrieved_docs: str
        +query: str
        +total_tokens: int
        +overflow_risk: bool
        +budget_report: BudgetReport
        +trace: ContextTrace
    }

    class ContextTrace {
        +trace_id: str
        +session_id: str
        +query: str
        +timestamp: datetime
        +retrieval_mode: str
        +alpha_used: float
        +candidates_k: int
        +reranker_phase: int
        +docs_before_compression: list~str~
        +docs_after_compression: list~str~
        +compression_ratio: float
        +compression_strategy: str
        +memory_turns_in: int
        +memory_turns_out: int
        +budget_slots: BudgetSlotMap
    }

    class BudgetReport {
        +slots: BudgetSlotMap
        +remaining: int
        +generation_reserve: int
        +overflow_risk: bool
        +estimator_used: str
    }

    class BudgetSlotMap {
        <<type alias>>
        dict~str, int~
        slot_name → token_count
    }

    class MemoryTurn {
        +turn_id: str
        +session_id: str
        +content: str
        +role: str
        +timestamp: datetime
        +importance: float
        +effective_score: float
        +last_accessed: datetime
        +embedding: list~float~
    }

    class Document {
        +doc_id: str
        +content: str
        +tags: list~str~
        +metadata: dict
        +embedding: list~float~
        +created_at: datetime
        +chunk_index: int
    }

    class ScoredDocument {
        +document: Document
        +retrieval_score: float
        +rerank_score: float
        +tag_importance: float
        +phase: int
    }

    ContextPacket "1" --> "1" BudgetReport
    ContextPacket "1" --> "1" ContextTrace
    ContextPacket "1" --> "*" MemoryTurn
    BudgetReport "1" --> "1" BudgetSlotMap
    ContextTrace "1" --> "1" BudgetSlotMap
    ScoredDocument "1" --> "1" Document
```

> **Field notes.**
> - `trace_id` and `turn_id` are UUIDs serialised as strings — represented as `str` so the diagram renders cleanly across all Mermaid versions.
> - `embedding` on `MemoryTurn` and `Document` is optional in practice (populated only when the backend supports vector recall); implementations should accept `None` / empty list.
> - `BudgetSlotMap` is a typed alias for `dict[str, int]` (slot name → token count) extracted into its own class to keep the diagram Mermaid-safe. In code it is a plain dict.

---

## 14. Performance Requirements (NFRs)

| ID | Requirement | Target | Measurement | Priority |
|---|---|---|---|---|
| `PERF-01` | P95 `build()` latency — hybrid mode, CPU, cached | < 120ms | Load test: 100 concurrent, 5 min | 🔴 Must |
| `PERF-02` | P95 `build()` latency — tfidf mode, CPU | < 15ms | Same load test | 🔴 Must |
| `PERF-03` | Embedding cache hit rate at steady state | > 80% | Metrics endpoint | 🟡 Should |
| `PERF-04` | Token budget accuracy (tiktoken mode) | ≤ 2% over-budget | Unit tests: 1,000 packet samples | 🔴 Must |
| `PERF-05` | Memory deduplication false-positive rate | < 5% | Eval: 500-turn conversation dataset | 🔴 Must |
| `PERF-06` | Retrieval NDCG@5 vs TF-IDF baseline | +15% minimum | Domain eval set: 100 queries, 50 docs | 🔴 Must |
| `PERF-07` | Max memory per engine instance | < 500MB | Memory profiling at steady-state | 🟡 Should |
| `PERF-08` | Throughput — CPU, hybrid, cached, 4 workers | > 200 req/sec | Load test: 500 concurrent, 10 min | 🟡 Should |

### Latency Budget Breakdown

```mermaid
pie title P95 Latency Budget (120ms) — Hybrid Mode, CPU, Cached
    "Embedding (cache hit ~2ms)" : 2
    "TF-IDF scoring" : 3
    "Re-ranking Phase 1" : 1
    "Memory decay filter" : 2
    "Semantic compression" : 12
    "Token budget calc" : 1
    "I/O overhead (DB, cache)" : 8
    "Headroom" : 91
```

---

## 15. Observability & Evaluation

### Context Trace Coverage (Required for Production)

Every `build()` call produces a `ContextTrace`. No production deployment is complete without traces enabled.

```mermaid
flowchart LR
    BUILD["build() call"] --> TRACE["ContextTrace created"]
    TRACE --> PERSIST["Persist to trace store\n(SQLite / PostgreSQL)"]
    PERSIST --> API["Queryable via\nGET /v1/traces"]
    PERSIST --> AUDIT["Token Auditor\nper-slot accounting"]
    PERSIST --> EVAL["Quality Evaluator\nNDCG@5 · compression similarity"]
    PERSIST --> DRIFT["Drift Detector\nperformance regression alerts"]
    PERSIST --> AB["A/B Experiment Runner\nstrategy comparison"]
```

### Prometheus Metrics

| Metric | Type | Labels |
|---|---|---|
| `context_engine_build_latency_seconds` | Histogram | `mode`, `profile`, `cached` |
| `context_engine_token_budget_used_ratio` | Gauge | `slot`, `session_id` |
| `context_engine_compression_ratio` | Histogram | `strategy` |
| `context_engine_memory_turns_retained` | Gauge | `session_id` |
| `context_engine_cache_hits_total` | Counter | `cache_type` |
| `context_engine_cache_misses_total` | Counter | `cache_type` |
| `context_engine_reranker_phase_invocations` | Counter | `phase` |
| `context_engine_budget_overflow_total` | Counter | `slot` |

### Quality Evaluator (Background Job)

```mermaid
flowchart TD
    SCHED["Scheduler\n(every N hours)"] --> QE["Quality Evaluator"]
    QE --> R1["Retrieval Eval\nNDCG@5 on held-out query set"]
    QE --> R2["Compression Eval\nCosine sim: before vs after compression"]
    QE --> R3["Memory Eval\nFP rate on dedup · decay calibration"]
    QE --> R4["Budget Eval\nTokenizer accuracy vs tiktoken ground truth"]
    R1 & R2 & R3 & R4 --> METRICS["Update Prometheus metrics"]
    METRICS --> ALERT{Regression\ndetected?}
    ALERT -->|Yes| PAGE["Alert: PagerDuty / Slack"]
    ALERT -->|No| LOG["Log: all-clear"]
```

---

## 16. Implementation Phases

```mermaid
gantt
    title Context Engine — Implementation Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1: Core Pipeline
    Hybrid Retriever (fixed α)         :p1a, 2026-05-01, 5d
    Heuristic Re-ranker Phase 1        :p1b, after p1a, 3d
    Memory decay (in-process)          :p1c, after p1b, 5d
    All 4 compression strategies       :p1d, after p1c, 4d
    Token budget enforcer (char + tiktoken) :p1e, after p1d, 3d
    Sync build() orchestrator          :p1f, after p1e, 3d
    Unit tests ≥ 90% coverage          :p1g, after p1f, 5d

    section Phase 2: Production Hardening
    Async build() refactor             :p2a, 2026-05-29, 4d
    SQLite memory backend              :p2b, after p2a, 4d
    Query classifier + adaptive α      :p2c, after p2b, 5d
    Embedding-based sentence scoring   :p2d, after p2c, 4d
    Trace persistence + REST API       :p2e, after p2d, 4d
    Prometheus metrics endpoint        :p2f, after p2e, 3d
    Docker + docker-compose dev stack  :p2g, after p2f, 2d
    Integration tests (5 scenarios)    :p2h, after p2g, 4d

    section Phase 3: Scale & Accuracy
    Cross-encoder Phase 2 reranker     :p3a, 2026-06-26, 6d
    PostgreSQL backend                 :p3b, after p3a, 5d
    LLM Wiki ingestion pipeline        :p3c, after p3b, 5d
    Quality evaluator + alerts         :p3d, after p3c, 4d
    A/B experiment runner              :p3e, after p3d, 4d

    section Phase 4: Platform Integration
    MCP server exposure                :p4a, 2026-07-24, 6d
    LangChain/LangGraph adapter        :p4b, after p4a, 4d
    Vector memory backend              :p4c, after p4b, 5d
    Multi-tenant REST API isolation    :p4d, after p4c, 3d
    Production load testing            :p4e, after p4d, 4d
    Documentation site                 :p4f, after p4e, 5d
```

### Phase Deliverables Summary

| Phase | Duration | Key Deliverable | Accept Criteria |
|---|---|---|---|
| **Phase 1: Core Pipeline** | Weeks 1–4 | Working 5-component pipeline in Python | All unit tests pass; `build()` returns valid `ContextPacket` |
| **Phase 2: Production Hardening** | Weeks 5–8 | Async, persistent, observable system | SQLite backend; trace REST API; Prometheus metrics live |
| **Phase 3: Scale & Accuracy** | Weeks 9–12 | Cross-encoder + PostgreSQL + LLM Wiki | NDCG@5 +15% vs baseline; multi-user isolation verified |
| **Phase 4: Platform Integration** | Weeks 13–16 | MCP server + full docs + load tested | NFRs met at P95; MCP integration smoke test passes |

---

## 17. Testing Strategy

| Test Type | Scope | Coverage Target | Tooling |
|---|---|---|---|
| **Unit Tests** | Each component in isolation with mocked dependencies | ≥ 90% line coverage | `pytest`, `pytest-asyncio` |
| **Integration Tests** | Full `build()` pipeline with real retrieval store and memory backend | 5 canonical scenarios | `pytest` + in-memory SQLite |
| **Regression Eval** | NDCG@5, compression similarity, budget accuracy on fixed eval set | Run on every PR | Custom eval harness |
| **Load Tests** | 100 → 500 concurrent requests; 10-minute sustained runs | P95 within NFRs | `Locust` |
| **Property Tests** | Token budget never exceeded; dedup threshold respected; decay monotonically decreasing | Generative test suite | `Hypothesis` |
| **Chaos Tests** | Embedding provider unavailable; DB connection failure; OOM on large context | Graceful degradation verified | Manual + fault injection |

### Integration Test Scenarios

| Scenario | Description | Accept Criteria |
|---|---|---|
| `IT-01: overflow_prevention` | 5 full documents exceed 800-token budget | `ContextPacket.overflow_risk == False`; budget never exceeded |
| `IT-02: memory_decay_20turns` | 20-turn conversation; low-importance turns mixed with high | Low-importance turns pruned; high-importance turns retained after 12h |
| `IT-03: semantic_paraphrase_retrieval` | Query paraphrases document content without shared tokens | Relevant document retrieved in hybrid mode; not in TF-IDF-only |
| `IT-04: cross_session_continuity` | SQLite backend; engine restart; resume conversation | Memory turns from previous session available after restart |
| `IT-05: cross_encoder_threshold` | 25-document corpus; cross-encoder threshold = 20 | Phase 2 invoked; Phase 2 metrics logged in trace |

---

## 18. Success Metrics

```mermaid
quadrantChart
    title Success Metrics — Technical vs User-Facing
    x-axis Technical --> User-Facing
    y-axis Low Priority --> High Priority
    quadrant-1 Core Success
    quadrant-2 Must Hit
    quadrant-3 Monitor
    quadrant-4 Nice to Have

    Zero Budget Overflows: [0.2, 0.95]
    NDCG@5 Plus 15 Percent: [0.3, 0.90]
    P95 Below 120ms: [0.2, 0.85]
    100% Trace Coverage: [0.25, 0.80]
    Multi-turn Coherence: [0.75, 0.95]
    Cross-session Continuity: [0.80, 0.85]
    Cache Hit Rate 80pct: [0.15, 0.60]
    Dedup FP Rate Under 5pct: [0.2, 0.55]
```

### Technical KPIs

| KPI | Target | Measurement |
|---|---|---|
| Budget overflow rate | **0** | Count of `overflow_risk == True` in prod traces |
| NDCG@5 improvement vs TF-IDF | **+15%** | Quarterly eval on domain query set |
| P95 `build()` latency | **< 120ms** | Prometheus `p95(build_latency)` |
| Trace coverage | **100%** | `traces_logged / build_calls` |
| Embedding cache hit rate | **> 80%** | Prometheus `cache_hits / (hits + misses)` |
| Dedup false-positive rate | **< 5%** | Eval on conversation dataset |

### Product KPIs

| KPI | Target |
|---|---|
| Multi-turn chatbot coherence at turn 20 | No context overflow; high-importance turns retained |
| Enterprise RAG over 10,000-doc corpus | Zero budget overflows; relevant results in top-5 |
| Cross-session memory continuity | Users pick up where they left off after restart |
| Context auditability | Every allocation decision queryable via trace API |

---

## 19. Risks & Mitigations

```mermaid
flowchart TD
    subgraph RISKS["Risk Registry"]
        R1["⚠️ Embedding latency\nexceeds 120ms P95"]
        R2["⚠️ Cross-encoder\nunacceptable latency at scale"]
        R3["⚠️ Memory decay\nFP rate degrades quality"]
        R4["⚠️ tiktoken version\nbreaking change"]
        R5["⚠️ SQLite insufficient\nfor high-concurrency prod"]
    end

    subgraph MITIGATIONS["Mitigations"]
        M1["LRU cache + async prefetch\nGPU batch mode\nFallback to TF-IDF on >10 cold misses"]
        M2["Conditional on doc threshold\nDefault skips Phase 2 for ≤20 docs\nThreshold configurable"]
        M3["Threshold + decay_rate configurable\nA/B experiments on real sessions\nEval suite on every release"]
        M4["Pin tiktoken version\nTokenizer is pluggable interface\nChar heuristic always available as fallback"]
        M5["PostgreSQL backend in Phase 2\nSQLite documented as single-user only\nMigration script provided"]
    end

    R1 --> M1
    R2 --> M2
    R3 --> M3
    R4 --> M4
    R5 --> M5
```

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Embedding latency degrades P95 beyond 120ms | Medium | High | LRU cache + async prefetch + GPU mode; TF-IDF fallback on cache cold >10 concurrent misses |
| Cross-encoder adds unacceptable latency | Medium | Medium | Phase 2 is conditional on threshold (configurable); default skips for ≤ 20 docs |
| Memory decay FP rate degrades conversation quality | Low | High | All params configurable; A/B experiments; eval suite on every release |
| tiktoken dependency breaking change | Low | Medium | Pinned version; pluggable interface; char heuristic always available as fallback |
| SQLite insufficient for production concurrency | Medium | Medium | PostgreSQL backend in Phase 2; SQLite documented single-user; migration script provided |

### Graceful Degradation Policy

> **Design Principle: Graceful Degradation Over Failure**
>
> Every component must define a degraded mode:
> - Cross-encoder unavailable → heuristic re-ranking
> - Embedding model unavailable → TF-IDF mode + `WARNING` log
> - Memory backend down → in-process fallback + `WARNING` log  
> - tiktoken unavailable → char heuristic fallback
>
> Context assembly must **always** produce a valid (possibly lower-quality) `ContextPacket`.  
> **Silent failure is never acceptable.**

---

## 20. Appendix: Configuration Reference

```yaml
# context_engine.yaml — full configuration reference

profile: conversational          # conversational | knowledge-retrieval | developer-copilot | agent | research | lightweight

# Token budget
token_budget:
  total: 4096
  generation_reserve: 512
  estimator: tiktoken             # char_heuristic | tiktoken | model_specific

# Retrieval
retrieval:
  mode: hybrid                    # keyword | tfidf | hybrid
  top_k: 5
  alpha: adaptive                 # float (fixed) | "adaptive" (query-classifier)
  alpha_fixed: 0.65               # used only when alpha != "adaptive"
  embedding_provider: local       # local | openai | cohere
  embedding_model: sentence-transformers/all-MiniLM-L6-v2
  embedding_cache_size: 10000

# Re-ranking
reranker:
  mode: two_phase                 # heuristic | two_phase
  weights:
    retrieval: 0.65
    tag_importance: 0.25
    freshness_bonus: 0.10
  cross_encoder_threshold: 20     # Phase 2 invoked when N > this
  cross_encoder_model: cross-encoder/ms-marco-MiniLM-L-6-v2
  domain_tags:
    - context
    - memory
    - rag
    - embedding
  tag_importance_multiplier: 1.4

# Memory
memory:
  backend: sqlite                 # in_memory | sqlite | postgresql | vector
  db_path: ./memory.db            # for sqlite backend
  dsn: postgresql://...           # for postgresql backend
  decay_rate: 0.001
  freshness_coefficient: 0.01
  relevance_weight: 0.35
  min_importance_threshold: 0.10
  dedup_threshold: 0.72

# Compression
compression:
  strategy: extractive_semantic   # truncate | sentence | extractive_token | extractive_semantic

# Observability
observability:
  trace_enabled: true
  trace_backend: sqlite           # sqlite | postgresql
  metrics_enabled: true
  quality_eval_schedule: "0 */6 * * *"  # every 6 hours (cron)
  drift_alert_threshold: 0.10    # alert if NDCG@5 drops >10% from baseline
```

---

<div align="center">

*Context Engine PRD v1.0 · April 2026*  
*Companion document: [CONTEXT_ENGINE_WHITEPAPER.md](./CONTEXT_ENGINE_WHITEPAPER.md)*  
*Reference implementation: [github.com/Emmimal/context-engine](https://github.com/Emmimal/context-engine/)*

</div>
