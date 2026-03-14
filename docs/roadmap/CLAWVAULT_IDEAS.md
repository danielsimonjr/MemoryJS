# Ideas from ClawVault for MemoryJS

Analysis of [ClawVault](https://github.com/danielsimonjr/clawvault) — a markdown-native persistent memory system for AI agents — with actionable ideas for MemoryJS.

---

## 1. Observer Pipeline (Session → Observe → Score → Route → Store)

**What ClawVault does:** An `Observer` watches live agent sessions, accumulates messages until a token threshold is hit, then compresses them via LLM (with deterministic fallback) into typed observations scored by importance. A `Router` then distributes observations to categorized vault folders based on type and content patterns.

**Why it matters:** MemoryJS has `EpisodicMemoryManager` and `ConsolidationPipeline` but lacks a real-time observation pipeline that can watch a running session and automatically extract, score, and route knowledge.

**What to steal:**
- **Active session observer with cursor-based incremental reading** — track file offsets, only process new content since last observation. ClawVault uses size-based thresholds (50KB–300KB depending on file size) to avoid processing trivial updates.
- **LLM-powered compression with deterministic fallback** — compress conversations into typed observations using an LLM, but fall back to regex-based heuristics when the API is unavailable. Keeps the pipeline stable without hard dependencies.
- **Importance-based routing** — observations below 0.4 importance are dropped. Tasks route to backlog, decisions route to decisions/, relationships to people/. This automatic categorization is more useful than flat storage.
- **Keyword preservation rule** — "Observations must be searchable later. Preserve exact key terms." Product names, person names, monetary amounts, and dates are kept verbatim even during compression.

**Implementation sketch:**
```typescript
// New: src/agent/ObserverPipeline.ts
class ObserverPipeline {
  observe(messages: Message[]): Promise<ScoredObservation[]>  // compress + score
  route(observations: ScoredObservation[]): Promise<void>     // categorize + store
  watch(sessionId: string, opts: WatchOptions): AsyncIterable<ScoredObservation>
}
```

**Effort:** Medium. Builds on existing `ConsolidationPipeline` and `SummarizationService`.

---

## 2. Context Profiles (Task-Aware Retrieval)

**What ClawVault does:** Five context profiles (`default`, `planning`, `incident`, `handoff`, `auto`) that tune retrieval strategy based on what the agent is doing. Auto-detection uses regex patterns to infer the profile from task content (e.g., "outage|sev1|broken" → incident, "resume|continue|where was I" → handoff).

**Why it matters:** MemoryJS's `ContextWindowManager` does token budgeting but doesn't adjust *what* it retrieves based on task type. An incident response needs recent high-importance facts; a planning session needs broad architectural context; a handoff needs the last session's state.

**What to steal:**
- **Profile-aware retrieval strategies** — different weight distributions for recency/importance/relevance per profile.
- **Auto-detection from query content** — simple regex-based inference is cheap and surprisingly effective.
- **Handoff profile** — explicitly designed for session resumption, pulling last session state and unfinished tasks.

**Implementation sketch:**
```typescript
// New: src/agent/ContextProfile.ts
type ContextProfile = 'default' | 'planning' | 'incident' | 'handoff' | 'review' | 'auto';

interface ProfileConfig {
  recencyWeight: number;
  importanceWeight: number;
  relevanceWeight: number;
  maxTokens: number;
  preferredTypes: EntityType[];
}

function inferProfile(query: string): ContextProfile;  // regex-based
```

**Effort:** Low. Layered on top of existing `SalienceEngine` and `ContextWindowManager`.

---

## 3. Write-Time Fact Extraction & Entity Graph

**What ClawVault does:** When observations are stored, a `FactExtractor` parses them into structured `(entity, relation, value)` triples. Supports both rule-based (regex, fast, 0.7 confidence) and LLM-based (accurate, higher cost) extraction modes. Facts get deterministic IDs from hashed entity+relation+value, enabling deduplication. Stored in `.clawvault/facts.jsonl`.

**Why it matters:** MemoryJS stores observations as opaque strings. Automatically extracting structured facts at write time would enable multi-hop reasoning ("Alice works at Google" + "Google is in CA" → "Alice is in CA") and richer graph queries.

**What to steal:**
- **Dual extraction modes** — rule-based for speed, LLM for accuracy, with automatic fallback.
- **Deterministic fact IDs** — hash(entity + relation + value) prevents duplicates without needing a dedup pass.
- **Write-time extraction** — facts extracted when observations are added, not at query time. This front-loads the cost but makes queries instant.
- **Entity normalization** — "Dr. Smith" → "dr smith" for dedup.

**Implementation sketch:**
```typescript
// New: src/features/FactExtractor.ts
interface Fact {
  id: string;               // deterministic hash
  entity: string;           // normalized
  relation: string;         // e.g., "works_at", "prefers"
  value: string;
  confidence: number;       // 0-1
  source: string;           // observation that produced this
  timestamp: string;
}

class FactExtractor {
  extractRuleBased(text: string): Fact[];
  extractWithLLM(text: string, provider: LLMProvider): Promise<Fact[]>;
  extract(text: string, mode: 'rule' | 'llm' | 'hybrid'): Promise<Fact[]>;
}
```

**Effort:** Medium. The rule-based mode is straightforward. LLM mode needs the provider abstraction ClawVault already has.

---

## 4. Transition Ledger (Append-Only Audit Trail)

**What ClawVault does:** Every state change (task status transitions, thread ownership changes) is appended to a JSONL ledger organized by date. The ledger records who changed what, from which state to which state, confidence scores, and token costs. It can detect regressions (e.g., "done → open") and count blocking events.

**Why it matters:** MemoryJS tracks entity timestamps but has no audit trail for state changes. If an entity's importance changes, observations are added/removed, or relations shift, there's no history of *why* or *when*.

**What to steal:**
- **Append-only transition log** — never mutate, only append. Enables replay and debugging.
- **Regression detection** — flag suspicious state transitions automatically.
- **Agent attribution** — every change records which agent made it (critical for multi-agent).
- **Cost tracking** — recording token costs per operation enables budget awareness.

**Implementation sketch:**
```typescript
// New: src/core/TransitionLedger.ts
interface TransitionEvent {
  entityId: string;
  agentId?: string;
  field: string;           // what changed
  from: unknown;
  to: unknown;
  reason?: string;
  timestamp: string;
  tokenCost?: number;
}

class TransitionLedger {
  append(event: TransitionEvent): Promise<void>;
  query(filter: TransitionFilter): TransitionEvent[];
  detectRegressions(entityId: string): TransitionEvent[];
}
```

**Effort:** Low-Medium. Append-only JSONL is simple. Integration with existing managers needs care.

---

## 5. Workgraph: Thread-Based Multi-Agent Coordination

**What ClawVault does:** A `Thread` primitive with exclusive ownership, state machine (open → active → blocked → done/cancelled), decomposition into sub-threads, and ledger-backed coordination. Only one agent can claim a thread at a time. Threads can be blocked with dependency tracking and unblocked when dependencies resolve.

**Why it matters:** MemoryJS has `MultiAgentMemoryManager` with visibility controls but no coordination primitives. Agents can share memory but can't coordinate *work* — there's no "I'm working on X, don't touch it" mechanism.

**What to steal:**
- **Exclusive ownership with claim/release** — prevents duplicate work.
- **Thread decomposition** — break a task into sub-threads with parent/child references.
- **Dependency-based blocking** — "this thread is blocked by thread-123."
- **Ledger-backed state** — current ownership resolved from historical records, enabling replay and conflict detection without locks.

**Implementation sketch:**
```typescript
// New: src/agent/WorkThread.ts
interface WorkThread {
  id: string;
  title: string;
  status: 'open' | 'active' | 'blocked' | 'done' | 'cancelled';
  owner?: string;          // agent ID
  parentId?: string;       // decomposition
  blockedBy?: string[];    // dependency tracking
}

class WorkThreadManager {
  create(title: string, parentId?: string): WorkThread;
  claim(threadId: string, agentId: string): void;
  release(threadId: string): void;
  block(threadId: string, blockedBy: string[]): void;
  decompose(threadId: string, subtasks: string[]): WorkThread[];
}
```

**Effort:** Medium. New subsystem but well-defined scope.

---

## 6. Session Checkpointing & Crash Recovery

**What ClawVault does:** `sleep` serializes the full session state (pending observations, cursor positions, context). `wake` restores it. `checkpoint` creates a named snapshot. The system auto-detects "context death" (sessions that died mid-conversation) and can recover.

**Why it matters:** MemoryJS's `SessionManager` tracks session lifecycle but doesn't checkpoint mid-session state. If an agent crashes, the session's working memory is lost.

**What to steal:**
- **Named checkpoints** — save session state at critical points (before risky operations, at milestones).
- **Context death detection** — identify sessions that ended abnormally and recover gracefully.
- **Sleep/wake semantics** — explicit suspend/resume that preserves more state than just "session ended."

**Implementation sketch:**
```typescript
// Extend: src/agent/SessionManager.ts
class SessionManager {
  // Existing methods...
  checkpoint(name?: string): Promise<string>;  // returns checkpoint ID
  restore(checkpointId: string): Promise<void>;
  detectAbnormalEndings(): Promise<Session[]>;
  sleep(sessionId: string): Promise<void>;     // serialize full state
  wake(sessionId: string): Promise<void>;      // restore full state
}
```

**Effort:** Low-Medium. Mostly serialization of existing state objects.

---

## 7. Observation Deduplication with Similarity Scoring

**What ClawVault does:** Before storing observations, the `Router` checks for duplicates using:
1. Exact normalized content matching (whitespace/case-stripped)
2. Word-overlap similarity (>80% Jaccard triggers skip)
3. Title matching for tasks

When duplicates are found, it merges by taking max confidence/importance and the longer content.

**Why it matters:** MemoryJS's `CompressionManager` does entity merging but doesn't deduplicate observations at write time. Repeated agent sessions can accumulate redundant observations.

**What to steal:**
- **Write-time dedup** — check on insert, not as a batch maintenance job.
- **Similarity threshold** — 80% word overlap is a pragmatic threshold.
- **Merge strategy** — max(importance), max(confidence), longest(content) preserves the most useful version.

**Effort:** Low. Can be added as a hook in `ObservationManager.addObservations()`.

---

## 8. Wiki-Link Auto-Linking

**What ClawVault does:** The `AutoLinker` scans observation text and wraps known entity names in `[[wiki-link]]` brackets. This creates implicit graph edges between observations and entities, making the vault navigable.

**Why it matters:** MemoryJS entities reference each other through explicit relations. Auto-detecting entity mentions in observation text and creating implicit links would enrich the graph without manual effort.

**What to steal:**
- **Entity mention detection in observation text** — scan for known entity names when observations are added.
- **Auto-create relations** — when "Project Alpha" is mentioned in an observation on entity "Alice", create a `mentions` relation.

**Effort:** Low. Entity name matching against a dictionary of known entities.

---

## Priority Ranking

| # | Idea | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| 2 | Context Profiles | High | Low | **P0** |
| 7 | Observation Dedup | High | Low | **P0** |
| 3 | Fact Extraction | High | Medium | **P1** |
| 1 | Observer Pipeline | High | Medium | **P1** |
| 6 | Session Checkpointing | Medium | Low | **P1** |
| 4 | Transition Ledger | Medium | Low-Med | **P2** |
| 8 | Auto-Linking | Medium | Low | **P2** |
| 5 | Workgraph Threads | High | Medium | **P2** |
