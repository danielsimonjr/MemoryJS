# Memory Types Expansion — Gap Analysis & Design Sketch

**Draft**: 2026-05-13 · **Status**: Proposal for review · **Owner**: TBD

This document surveys gaps in MemoryJS's memory-type taxonomy, compares against external libraries, and sketches the most concrete addition (`ProspectiveMemoryManager`) end-to-end with integration points. Companion to [`ROADMAP.md`](./ROADMAP.md); if the user approves any item below, lift it into the roadmap as P1/P2.

---

## 1. Current state — what MemoryJS already has

The canonical `MemoryType` union in `src/types/agent-memory.ts`:

```typescript
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
```

Backed by four managers in `src/agent/`:

| Memory type | Manager | Storage characteristics |
|-------------|---------|------------------------|
| Working | `WorkingMemoryManager` | TTL-bounded, session-scoped, promotion-eligible |
| Episodic | `EpisodicMemoryManager` | Timeline-indexed, sequence-aware, causally linkable |
| Semantic | (long-term entities themselves) | Persistent, importance-weighted, decay-subject |
| Procedural | `ProcedureManager` + `ProcedureStore` + `StepSequencer` | EWMA-refined, context-matchable |

Plus three retrieval-side facilities that any new memory type must integrate with:

- **`SalienceEngine`** — `calculateSalience`, `getTopSalient`, `getMostSalient` (combines importance / recency / frequency / context / novelty weights)
- **`DecayEngine`** — `applyDecay`, `getDecayedMemories`, `reinforceMemory`, `forgetWeakMemories` (exponential half-life + PRD-scale variant)
- **`ConsolidationPipeline`** — pluggable `PipelineStage[]`; current stages cover summarization, pattern extraction, promotion, dedup-merge

> **Integration constraint**: Any new memory type must (a) extend or alias `MemoryType`, (b) plug into `SalienceEngine` weighting, (c) declare a `DecayEngine` half-life or opt out explicitly, and (d) either reuse existing `ConsolidationPipeline` stages or register new ones. Otherwise it becomes an orphan module — same risk we saw with `HeuristicManager` and `CRDT.ts` sitting unwired in `unused-analysis.md`.

---

## 2. Competitive lens — what other libraries offer

| Library | Memory types offered | Differentiation vs MemoryJS |
|---------|----------------------|----------------------------|
| **MemPalace** | Identity (L0) / Critical facts (L1) / Wing-scoped (L2) / Full search (L3) — *layered by token budget, not cognitive taxonomy* | Has wake-up stack; MJ matched with `ContextWindowManager.wakeUp()` (η.4 series) |
| **Supermemory** | Static profile / Dynamic profile / Memory documents / Document chunks | Has profile (static + dynamic); MJ matched with `ProfileManager` |
| **mem0** (Python) | User memory / Agent memory / Session memory — *scope-based, not type-based* | MJ matched via session + project scoping + visibility hierarchies |
| **LangChain** | `ConversationBufferMemory`, `ConversationSummaryMemory`, `VectorStoreRetrieverMemory`, `EntityMemory`, `KnowledgeGraphMemory` | MJ has stronger graph + retrieval; LC stronger LLM-integration ergonomics |
| **LlamaIndex** | `ChatMemoryBuffer`, `VectorMemory`, `ChatSummaryMemoryBuffer` | LI is retrieval-focused; MJ covers more ground |
| **Letta (formerly MemGPT)** | Core memory (in-context) / Recall memory (conv history) / Archival memory (long-term searchable) | Letta's "core memory" parallels MJ's L0 wake-up; archival parallels semantic |

**Key observation — what NOBODY in this list has**:

- **Prospective memory** (intentions to act in the future) — zero coverage across all six libraries above
- **Sensory / perceptual buffer** (pre-working-memory raw input scratchpad) — implied by some streaming-ingest pipelines but never formalised as a typed memory tier
- **Affective / sentiment-tagged memory** — zero formal coverage; metadata-tag workarounds at best

**Strategic implication**: All three candidates are green-field design space. Adding any of them is a genuine differentiator, not a catch-up move.

---

## 3. Three-way gap analysis

### Side-by-side summary

| Dimension | Prospective | Sensory buffer | Affective tagging |
|-----------|-------------|----------------|-------------------|
| **Cognitive-science basis** | Einstein & McDaniel 1990 — established | Atkinson-Shiffrin 1968 — foundational | Damasio's somatic-marker — controversial |
| **Concrete user need** | High — "remind me to ask about X next session", scheduled context-injection | Medium — buffer before WMM promotion decisions | Medium — better salience for emotionally-charged memories |
| **Existing MJ overlap** | Low — `TaskQueue` is functional, not memory-typed | High — `AccessTracker` + ingest pipeline cover most of this | Low — `Entity.importance` is unsigned, no valence axis |
| **New entity type required** | Yes — `ProspectiveEntity` with `triggerAt` / `triggerCondition` | Optional — could be a pre-stage of `WorkingMemoryManager` | No — annotation on existing entities |
| **Integration cost** | Medium — wires into TaskScheduler + DecayEngine + ConsolidationPipeline | Low — extend `WorkingMemoryManager` with an upstream buffer | Low surface, medium semantics — adds `affect` field everywhere |
| **Eval story** | Easy — "did the reminder fire at the right time?" | Hard — buffer behaviour is implicit | Hard — culture-/context-dependent ground truth |
| **Implementation effort** | M (1–2 weeks) | S (3–5 days) | M (1 week) but high test-design cost |
| **Risk of orphan-module** | Low — concrete user calls drive it | Medium — buffer is invisible to consumers | High — affect tags need consumers (SalienceEngine integration) to matter |
| **Roadmap fit** | New P1 item | New P2 item | New P3 item |

### Per-type deeper detail

#### 3.1 Prospective memory — highest ROI

**Definition**: Memory for intentions to perform actions at specific future times or in specific future contexts. Cognitive psych distinguishes **time-based** (T+5h) from **event-based** (when I see X) prospective memory.

**Examples in agent context**:
- Time-based: "Tomorrow morning, brief me on overnight CI failures."
- Event-based: "When the user mentions the migration plan again, remind them about the deadline."
- Conditional: "If observation count for `project-x` exceeds 100, trigger a consolidation pass."

**Why it's a clean addition**:
- `TaskQueue` already provides bounded scheduling primitives (`MAX_QUEUE` 100k, priority levels)
- `ConsolidationScheduler` already runs background recursive passes — same pattern fits
- `Entity` already supports a `validFrom` field (η.4.4) — `validFrom > now()` IS prospective
- Wake-up stack (`ContextWindowManager.wakeUp`) already knows how to inject memories at session start — natural delivery channel

**Why it complements rather than duplicates**:
- `TaskQueue` runs *code*; prospective memory delivers *content* (observations) into agent context
- Semantic memory is "what I know"; prospective memory is "what I intend to do" — orthogonal axes
- Episodic memory records past events; prospective memory records future-tense intentions

**Concrete first cut**: see §4 below for `ProspectiveMemoryManager` design.

#### 3.2 Sensory / perceptual buffer — defensible but smaller

**Definition**: Very-short-term raw input storage (Atkinson-Shiffrin's sensory register) — observations enter, get filtered by attention, and either decay within seconds or promote to working memory.

**Examples in agent context**:
- Streaming user input that hasn't yet been chunked into observations
- Tool-call output before it's normalized into observations
- Multi-modal sensor data (audio transcripts, screen captures) pre-extraction

**Why it's smaller value**:
- `IOManager.ingest()` (v1.9.0) and `ObservationNormalizer` together already cover most of the "pre-working-memory" pipeline
- `AccessTracker` covers the "attention filter" piece
- Adding a typed buffer mostly adds a *name* to behaviour that's already implemented in line

**Where it would actually add value**:
- A standardized place for *unstructured incoming data* (multi-modal, multi-format) before promotion
- Per-modality TTL (visual buffer 250ms, auditory buffer 4s in classic models — translated to "raw text 30s, tool output 5min")
- Backpressure handling — currently `IOManager.ingest` is unbounded; sensory buffer would add a ring-buffer cap

**Risk**: hard to evaluate. "Did the buffer hold the right thing for the right time?" has no clean test predicate. Without that, it'll degrade into an unused abstraction.

#### 3.3 Affective / sentiment-tagged memory — high upside but hard

**Definition**: Memory annotated with affect (valence + arousal axes from Russell's circumplex model, or simpler positive/negative/neutral). Damasio's somatic-marker hypothesis argues affect tags drive memory salience and recall biasing.

**Examples in agent context**:
- "User was frustrated when X happened" → bias future retrieval to surface X when discussing similar problems
- Failure-distillation already uses something like this implicitly (failure trajectories get higher abstraction priority)
- Tone-matching across sessions ("user prefers terse responses")

**Why it's deferred**:
- Affect inference is its own ML problem (sentiment classifiers, prompt-based scoring with calibration drift)
- `SalienceEngine` weighting is a hard-to-tune surface — adding an `affectWeight: 0.2` knob to its 5-weight config means re-tuning everyone's deployments
- "Is this memory correctly tagged?" has no ground truth — culture, language, individual baseline all vary

**Where it could quietly start**:
- Optional `Entity.affect?: { valence: number; arousal: number }` field — purely opt-in, no consumer wiring
- Plugin `IAffectExtractor` interface so users can BYO classifier
- One `SalienceEngine` test of "if affect provided, weight by |valence|" — see if the eval moves before fully integrating

---

## 4. ProspectiveMemoryManager — design sketch

### 4.1 Data model addition

```typescript
// src/types/agent-memory.ts

// Extend the canonical union
export type MemoryType =
  | 'working'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'prospective';   // NEW

// New ProspectiveEntity extending AgentEntity
export interface ProspectiveEntity extends AgentEntity {
  memoryType: 'prospective';

  /** When the intention should activate. */
  trigger:
    | { kind: 'time'; at: string /* ISO 8601 */ }
    | { kind: 'time-window'; from: string; until?: string }
    | { kind: 'event'; condition: TriggerCondition }
    | { kind: 'conditional'; predicate: string /* DSL */; checkInterval?: number };

  /** What to do when the trigger fires. */
  action:
    | { kind: 'inject-context'; targetSession?: string; format?: 'brief' | 'full' }
    | { kind: 'invoke'; procedureId: string /* references ProcedureManager */ }
    | { kind: 'tag-related'; tagsToAdd: string[]; relatedEntityFilter: EntityFilter };

  /** Lifecycle. */
  status: 'pending' | 'fired' | 'expired' | 'cancelled';
  firedAt?: string;
  fireCount?: number;        // For recurring intentions
  maxFireCount?: number;     // Optional cap for recurring intentions

  /** Cancellability. */
  cancelOnEvent?: TriggerCondition;
}

export interface TriggerCondition {
  /** Plain-text match against incoming observations. */
  text?: string;
  /** Tag match. */
  tags?: string[];
  /** Entity-type filter. */
  entityType?: string;
  /** Session-id filter. */
  sessionId?: string;
}
```

### 4.2 Manager interface

```typescript
// src/agent/ProspectiveMemoryManager.ts

export interface ProspectiveMemoryConfig {
  /** Polling interval for time-based triggers (ms). Default 60_000. */
  pollIntervalMs?: number;
  /** Maximum number of pending prospective memories per session. Default 100. */
  maxPendingPerSession?: number;
  /** Default half-life for un-fired prospective memories (hours). Default 168 (1 week). */
  defaultExpiryHours?: number;
  /** Whether to inject fired prospective content into the wake-up stack. Default true. */
  injectIntoWakeUp?: boolean;
}

export class ProspectiveMemoryManager {
  constructor(
    private storage: IGraphStorage,
    private taskQueue: TaskQueue,
    private decayEngine: DecayEngine,
    private salienceEngine: SalienceEngine,
    config?: ProspectiveMemoryConfig
  );

  // ─── Create ─────────────────────────────────────────────────────────────

  /** Create a time-based reminder. */
  async scheduleAt(
    content: string,
    at: Date,
    options?: { sessionId?: string; agentId?: string; importance?: number }
  ): Promise<ProspectiveEntity>;

  /** Create an event-triggered intention. */
  async scheduleOnEvent(
    content: string,
    condition: TriggerCondition,
    options?: { sessionId?: string; agentId?: string; importance?: number; maxFireCount?: number }
  ): Promise<ProspectiveEntity>;

  /** Create a conditional intention (periodic predicate evaluation). */
  async scheduleConditional(
    content: string,
    predicate: string,
    options?: { checkInterval?: number; sessionId?: string; agentId?: string }
  ): Promise<ProspectiveEntity>;

  // ─── Read ───────────────────────────────────────────────────────────────

  /** All pending intentions for a session/agent, sorted by next fire time. */
  async getPending(filter?: { sessionId?: string; agentId?: string }): Promise<ProspectiveEntity[]>;

  /** All intentions that have fired (audit / history). */
  async getFired(filter?: { sessionId?: string; agentId?: string; sinceDate?: Date }): Promise<ProspectiveEntity[]>;

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /** Check and fire any time-based intentions whose `at` has passed. */
  async tick(now?: Date): Promise<FiredEvent[]>;

  /** Process an incoming observation, firing any event-based intentions that match. */
  async onObservation(observation: string, context: ObservationContext): Promise<FiredEvent[]>;

  /** Cancel a pending intention. */
  async cancel(entityName: string, reason?: string): Promise<void>;

  /** Mark expired intentions and apply decay. */
  async expireOverdue(now?: Date): Promise<number>;

  // ─── Lifecycle hooks ────────────────────────────────────────────────────

  /** Start the background tick loop. */
  start(): void;

  /** Stop the background tick loop. */
  stop(): void;
}

export interface FiredEvent {
  entity: ProspectiveEntity;
  firedAt: Date;
  injectionPayload?: string;   // Formatted content for wake-up injection
  invokedProcedureId?: string;  // For action: 'invoke'
}
```

### 4.3 Integration points

| System | Integration |
|--------|------------|
| **`ManagerContext`** | New lazy getter: `ctx.prospectiveMemory` |
| **`TaskQueue`** | `ProspectiveMemoryManager.start()` enqueues a recurring `tick` task at `pollIntervalMs`. Reuses bounds (`MAX_QUEUE`) — no new resource ceiling needed. |
| **`DecayEngine`** | Pending intentions get standard half-life decay; un-fired intentions past `defaultExpiryHours` become `status: 'expired'` and feed `forgetWeakMemories` |
| **`SalienceEngine`** | Pending intentions whose trigger is imminent (within the next `pollIntervalMs * 2`) get a salience boost; expired ones get penalized |
| **`ConsolidationPipeline`** | ✅ shipped — `ProspectivePromotionStage` exported from `src/agent/ConsolidationPipeline.ts`. Scans storage for fired prospective intentions with `action.kind === 'inject-context'` and promotes them to `memoryType: 'episodic'` with a `prospective-fulfilled` tag. `invoke` and `tag-related` actions are NOT promoted (side-effects only, no payload). Idempotent; partial-batch error aggregation per `StageResult.errors`. |
| **`ContextWindowManager.wakeUp()`** | ✅ shipped — L1.5 layer surfaces pending prospective intentions sorted by next-fire-time, capped by `maxL1_5Tokens` (default 200). Format: `[at <iso>]` / `[window from <iso>]` / `[event: tags=... type=... session=...]` / `[conditional: <predicate>]` line per intention. Filters by `sessionId` when provided. `WakeUpResult` gains `l1_5: string` and `pendingIntentionCount: number`. Backward-compatible (additive). |
| **`AuditLog`** | All fire events logged; `cancel` events logged with reason |
| **`MemoryEngine`** | Dedup chain runs over `content` of incoming prospective intentions — prevents "remind me about X" being added twice |
| **`VisibilityResolver`** | Prospective intentions respect existing 5-level visibility (`private` / `team` / `org` / `shared` / `public`) — agents can share or hoard intentions |
| **`SearchManager`** | New `searchManager.searchProspective(filter)` for "what reminders do I have?" queries; also filter ?-type to existing search methods |

### 4.4 Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MEMORY_PROSPECTIVE_ENABLED` | `false` | Master toggle |
| `MEMORY_PROSPECTIVE_POLL_INTERVAL_MS` | `60000` | Tick frequency for time-based triggers |
| `MEMORY_PROSPECTIVE_MAX_PENDING_PER_SESSION` | `100` | Bound per session to prevent runaway scheduling |
| `MEMORY_PROSPECTIVE_DEFAULT_EXPIRY_HOURS` | `168` | Auto-expire after 1 week if not fired |
| `MEMORY_PROSPECTIVE_INJECT_INTO_WAKEUP` | `true` | Surface pending intentions in `wakeUp()` L1.5 |

### 4.5 Example usage

```typescript
const ctx = new ManagerContext('./memory.jsonl');
const pm = ctx.prospectiveMemory;

// Time-based reminder
await pm.scheduleAt(
  'Brief Daniel on overnight CI failures',
  new Date(Date.now() + 8 * 3600 * 1000),
  { sessionId: 'daily-standup', importance: 8 }
);

// Event-based intention
await pm.scheduleOnEvent(
  'Remind about the migration deadline',
  { tags: ['migration', 'plan'], entityType: 'project' },
  { sessionId: 'project-x', maxFireCount: 1 }
);

// Conditional intention (periodic check)
await pm.scheduleConditional(
  'Trigger consolidation pass for project-x',
  'observation_count(project-x) > 100',
  { checkInterval: 3600_000 }   // hourly
);

// Manually inspect
const pending = await pm.getPending({ sessionId: 'daily-standup' });
console.log(pending);

// Manually fire the tick loop (test-friendly)
const fired = await pm.tick();
for (const event of fired) {
  console.log(`Fired: ${event.entity.name} at ${event.firedAt}`);
}
```

### 4.6 Test surface (TDD outline)

| Test class | Cases |
|-----------|-------|
| `ProspectiveMemoryManager.scheduleAt` | Future date succeeds / past date rejects / very-near future fires on next tick / TTL respects `defaultExpiryHours` |
| `ProspectiveMemoryManager.scheduleOnEvent` | Matching observation fires / non-matching observation no-op / multi-tag AND / multi-tag OR / `maxFireCount` exhaustion |
| `ProspectiveMemoryManager.scheduleConditional` | Predicate true fires / predicate false no-op / `checkInterval` honoured / DSL syntax errors throw at schedule time |
| `ProspectiveMemoryManager.tick` | Idempotent over zero-elapsed time / fires exactly once per past-due intention / handles `MAX_PENDING_PER_SESSION` boundary |
| `ProspectiveMemoryManager.onObservation` | Fires on tag match / fires on entityType match / handles `cancelOnEvent` correctly |
| `ProspectiveMemoryManager.cancel` | Cancels pending / no-op on already-fired / audit-logged |
| `ProspectiveMemoryManager.expireOverdue` | Marks status correctly / fires `DecayEngine.forgetWeakMemories` for `status: 'expired'` |
| **Integration** | Wake-up L1.5 includes top-5 imminent intentions / `ConsolidationPipeline` promotes fired→episodic / `VisibilityResolver` filters per agent |
| **MemoryEngine dedup** | Identical reminder content rejected on schedule |
| **Edge cases** | DST transitions / clock skew / `tick()` called from multiple sessions concurrently (mutex) |

### 4.7 Effort breakdown

| Sub-task | Effort | Notes |
|---------|--------|-------|
| Type additions (`MemoryType`, `ProspectiveEntity`, `TriggerCondition`) | 0.5 day | `src/types/agent-memory.ts` |
| `ProspectiveMemoryManager` core (schedule + tick + cancel + expire) | 3 days | New file `src/agent/ProspectiveMemoryManager.ts` |
| `TaskQueue` integration (recurring tick task) | 0.5 day | Reuse existing scheduler |
| `DecayEngine` + `SalienceEngine` wiring | 1 day | New salience knob, decay opt-in for prospective |
| `ConsolidationPipeline` stage (`ProspectivePromotion`) | 1 day | Plug new stage in |
| `ContextWindowManager.wakeUp` L1.5 layer | 0.5 day | Token-budget-bounded injection |
| `SearchManager.searchProspective` filter | 0.5 day | Add filter to existing search methods |
| `ManagerContext` lazy getter + `agent-memory.ts` exports | 0.5 day | Standard wiring |
| Test suite (per §4.6) | 2 days | TDD strict per project conventions |
| CHANGELOG + docs (README, COMPONENTS, API, AGENT_MEMORY) | 1 day | Doc-coupling required by `dev-workflow` skill |
| **Total** | **~10 days** (1–2 weeks) | Aligns with P1 estimate |

### 4.8 Risks

- **DST / timezone correctness**: Time-based triggers crossing DST boundaries need explicit testing. Default to UTC internally, accept TZ-aware inputs.
- **Clock skew**: If `Date.now()` jumps backward (NTP corrections, VM resume), `tick()` should not re-fire intentions that fired during the original time. Track `firedAt` as monotonic — last-write-wins on the entity.
- **Polling vs. push**: 60s polling is wasteful for long-horizon reminders. Future optimisation: schedule next `tick` at `min(pending.map(p => p.trigger.at))` rather than fixed-interval. Defer until proven needed.
- **Concurrency**: Two sessions calling `tick()` simultaneously could double-fire. Use `async-mutex` (already a runtime dep) around the fire-and-mark-fired transition.
- **Adoption**: Without a CLI surface (`memory prospective schedule "..." --at "..."`) and an MCP tool, prospective memory is library-only. Add both alongside the manager.

---

## 5. Recommendation

1. **Adopt prospective memory as P1.** Clear cognitive-science basis, no competitor coverage, concrete user value, ~10 days effort, integrates cleanly with every existing facility.
2. **Adopt affective tagging as P3, opt-in only.** Land the field + interface; defer the inference layer until a concrete user pulls.
3. **Defer sensory buffer.** Most of its value is already covered by the ingest pipeline; adding a typed tier mostly adds a name. Re-evaluate if/when multi-modal ingest becomes a P1 user need.

**Roadmap insertions** (if this proposal is accepted):
- `ROADMAP.md` → new P1 item "Prospective memory" alongside the existing two (Heuristic Manager wiring, Entity-level dedup)
- `future_features.md` → new section §11.2 "Prospective Memory" with proposal-level detail mirroring §4 of this doc
- `CHANGELOG.md` → new `[Unreleased]` entry slot

## 6. Decisions (2026-05-13)

The four open questions raised in the original draft were resolved as follows. These decisions are binding on the implementation — any deviation requires updating this section first.

### D1. `action: 'invoke'` invokes `ProcedureManager` via **dependency injection** — ✅ shipped

Direct import would create a hard coupling between two memory managers. Instead, `ProspectiveMemoryManager`'s constructor accepts an optional `procedureInvoker?: (procedureId: string, context: FiredEvent) => Promise<void>` callback. `ManagerContext.prospectiveMemory` wires a closure that calls `this.procedureManager.invoke(procedureId)` and throws on `found: false`. Tests pass a stub; consumers who don't use procedural memory pay nothing.

**Rationale**: Same pattern used by `LLMQueryPlanner` for the optional `LLMProvider` — keeps the dep optional, breaks the import cycle, makes the manager testable in isolation.

**Status (2026-05-13)**: `ProcedureManager.invoke()` returning `InvocationResult` discriminated union shipped in commit `1efd905`; `ManagerContext.prospectiveMemory` lazy getter with the wired invoker shipped in the next commit.

### D2. `cancelOnEvent` uses **OR semantics (first match)**

Matches `TriggerCondition` firing semantics — tags / entityType / sessionId filters are all any-match. Compound AND-style cancellation can be composed by chaining: cancel reminder A on tag X, schedule reminder B that cancels on tag Y.

**Rationale**: De Morgan's reasoning at the schema level — AND is always recoverable from OR + composition; OR is not recoverable from AND alone without negation. Consistency over expressiveness; users can compose if they need more.

### D3. Default visibility is **`private`**

Matches every other memory type's default. The user's existing `MEMORY_DEFAULT_VISIBILITY` env var (default `private`, see `CLAUDE.md > Agent Memory`) is the global lever for users who want a more permissive default.

**Rationale**: Principle of least surprise. Hardcoding `team` would make prospective memory the one weird memory type in a multi-agent deployment and would silently leak intentions across agent boundaries.

### D4. **CLI in same release, MCP follow-up**

Ship `memory prospective schedule "..." --at "..."`, `memory prospective list`, and `memory prospective cancel <name>` in the same release as the library feature (in-repo, `src/cli/commands/prospective.ts`). MCP tools (`schedule_reminder`, `list_pending_reminders`, `cancel_reminder`) land in the next minor release of `@danielsimonjr/memory-mcp` — separate package, separate release schedule.

**Rationale**: Coupling MemoryJS's release cadence to the downstream MCP package's release is wrong. CLI is in-repo, can be validated end-to-end in this PR; MCP is downstream packaging concern. 2 net-new CLI subcommands fit inside the 10-day estimate.

**Caveat**: if download stats show `@danielsimonjr/memory-mcp` drives the majority of MemoryJS usage, revisit and ship MCP tools in the same release. Worth checking before starting implementation.

---

## 7. Open implementation questions (deferred to TDD pass)

The decisions above lock the *contract*; the following are *implementation details* that the test-driven implementation pass should resolve naturally as it goes:

- **Tick scheduling**: fixed-interval polling (default `60_000ms`) is the v1 pick per §4.4. Migration to "schedule next tick at `min(pending.trigger.at)`" deferred until proven needed.
- **Conditional predicate DSL**: §4.1 specifies a `predicate: string`; the parser surface is reused from `QueryParser` + `QueryDslError`. Concrete grammar (literal `observation_count(name) > N`? or arbitrary boolean expression?) lands during implementation.
- **`maxFireCount` exhaustion**: when a recurring event-based intention exhausts its cap, it should transition `status: 'expired'` and feed `DecayEngine.forgetWeakMemories` — same as time-based expiry. Implementation needs to confirm the audit-log entry shape.
- **Re-firing on schema migration**: if the manager picks up entities created under an older schema version, the migrator needs to handle missing `fireCount` / `status` fields gracefully. Standard project pattern — see `GraphStorage.migrateEntitiesTable`.
