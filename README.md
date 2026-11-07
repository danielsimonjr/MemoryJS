# MemoryJS

[![NPM](https://img.shields.io/npm/v/@danielsimonjr/memoryjs.svg)](https://www.npmjs.com/package/@danielsimonjr/memoryjs)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0+-blue.svg)](https://www.typescriptlang.org/)

A TypeScript knowledge-graph library for AI agents and applications that need structured long-term memory.
Entities, relations and observations are stored on JSONL, SQLite or (optionally) PostgreSQL. On top sit search
(BM25, TF-IDF, fuzzy, semantic, hybrid, temporal, LLM-planned), graph algorithms, bitemporal versioning, RBAC, an
Agent Memory System, and the experimental Recursa skill and learning harness.

Runtime: Node.js 22.12.0 or later. Development: Bun 1.4.2 or later.
The CLI is `memory` (or `memoryjs`): `bunx --package @danielsimonjr/memoryjs memory --help`.

> Powers [@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp), a Model Context
> Protocol server. The library and the MCP server share one core; this package is published separately.

## Table of Contents

- [Features](#features) · [Installation](#installation) · [Quick Start](#quick-start) · [Core Concepts](#core-concepts)
- [Storage](#storage-options) · [Search](#search-capabilities) · [Graph Algorithms](#graph-algorithms)
- [Import, Export and Skills](#import-export-and-skills) · [Agent Memory](#agent-memory-system)
- [Governance and Audit](#governance-access-control-and-audit) · [Temporal and Causal](#bitemporal-versioning-and-causal-reasoning)
- [Recursa](#recursa-skills-knowledge-and-learning) · [Reconstructive Memory and Procedural Graphs](#reconstructive-memory-and-procedural-graphs)
- [Adapters and CLI](#adapters-and-the-cli) · [API Reference](#api-reference) · [Configuration](#configuration)
- [Troubleshooting](#troubleshooting) · [Development](#development) · [Documentation](#documentation) · [License and Related](#license-and-related)

## Features

Every entry point below is exercised by a runnable file in [`examples/`](examples/); the examples run under the
`tests/examples/` gate, so the samples in this README stay in step with the API.

| Area | What you get | Entry points |
|---|---|---|
| Knowledge graph | CRUD, bitemporal entities and relations, hierarchies, stable refs, event reification, import and export, batched writes | `ctx.entityManager`, `ctx.relationManager`, `ctx.ioManager`, `ctx.batch()`, `ctx.eventManager` |
| Search | Auto, ranked (BM25), boolean, fuzzy, temporal, semantic, hybrid with evidence paths, LLM-planned | `ctx.searchManager`, `ctx.rankedSearch`, `ctx.hybridSearchManager`, `ctx.semanticSearch` |
| Graph algorithms | Shortest path, centrality, communities, cliques, components, traversal | `ctx.graphTraversal` |
| Agent Memory | Sessions, working and episodic memory, turn dedup, wake-up context, decay, consolidation, causal reasoning, world model | `ctx.agentMemory()`, `ctx.memoryEngine`, `ctx.causalReasoner`, `ctx.worldModelManager` |
| Specialised memory | Procedural, prospective, failure, plan, reflection, heuristic, decision, project-context, tool-affordance | `ctx.procedureManager`, `ctx.prospectiveMemory`, `ctx.failureManager`, and others (API Reference) |
| Recursa (`@experimental`) | Skills, instruction sets, knowledge snapshots, SKILL.md publishing, leaf and recursive learning, bootstrapping, evaluation, harness tools | `ctx.skillManager`, `ctx.instructionSets`, `ctx.knowledgeRepository`, `ctx.learningLoop()`, `ctx.bootstrapper()`, `createRecursaTools()` |
| Reconstructive memory (`@experimental`) | Cue, tag and content graph built from dialogue, with bounded reconstruction | `ctx.reconstructiveMemory()` |
| Procedural graphs (`@experimental`) | Execution graphs with per-step guidance | `ctx.createProceduralGraph()` |
| Storage | JSONL, SQLite (FTS5), PostgreSQL; segment-sharded JSONL; mmap loading; backups | `MEMORY_STORAGE_TYPE`, `ctx.ioManager.createBackup()` |
| Governance and security | Policy enforcement, tamper-evident audit, RBAC, attribution, PII redaction, ABAC, API keys | `ctx.governanceManager`, `ctx.auditLog`, `ctx.rbacMiddleware`, `PiiRedactor`, `APIKeyStore` |
| Integration | REST router, rate limiter, MCP observer, LangChain adapter, `memory` CLI | `RestRouter`, `RateLimiter`, `MCPToolObserverAdapter`, `LangChainMemoryAdapter` |

## Installation

Install with `bun add @danielsimonjr/memoryjs`.

npm and pnpm consumers can install the same package from the npm registry. Subpath imports keep load footprints
small (`sideEffects` is `false`): `/sqlite`, `/core`, `/search`, `/agent`, `/features`, `/utils`, `/types`,
`/adapters` and `/security` are available next to the root entry point.

Requirements: Node.js 22.12.0 or later at runtime; Bun 1.4.2 or later for development (`bun.lock` is authoritative).

Optional peer dependencies:

| Package | Needed for |
|---|---|
| `@huggingface/transformers` ^4.3.1 | The `local` embedding provider, the default. Without it, `ctx.semanticSearch` is unavailable. It pins `onnxruntime-node` 1.30.0, which has no macOS x64 (Intel) binary; on Intel Macs set `MEMORY_EMBEDDING_PROVIDER` to `openai`, `llamacpp` or `none`. |
| `yaml` >= 2.0.0 | Full YAML front matter in Recursa `SKILL.md` files (a built-in subset parser is used without it). |
| `pg` >= 8.0.0 | The PostgreSQL backend (`MEMORY_STORAGE_TYPE=postgres`). |

## Quick Start

Create a context over a file, then write and read entities.

```ts
import { EntityNotFoundError, ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

await ctx.entityManager.createEntities([
  {
    name: 'TypeScript',
    entityType: 'language',
    observations: ['A typed superset of JavaScript'],
    tags: ['programming', 'frontend'],
    importance: 8,
  },
  {
    name: 'Node.js',
    entityType: 'runtime',
    observations: ['JavaScript runtime built on V8'],
    tags: ['backend', 'server'],
  },
]);

await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'Node.js', relationType: 'runs_on' },
]);
```

Full example: [`examples/01-quick-start.ts`](examples/01-quick-start.ts)

```ts
import { EntityNotFoundError, ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const matches = await ctx.searchManager.searchNodes('runtime');

const entity = await ctx.entityManager.getEntity('TypeScript');

const languages = await ctx.entityManager.listEntities({ entityType: 'language' });

const relations = await ctx.relationManager.getRelations('TypeScript');

const observations = await ctx.observationManager.getObservationsFor('Node.js');
```

Full example: [`examples/01-quick-start.ts`](examples/01-quick-start.ts)

`ctx.close()` releases the storage handles and is idempotent.

## Core Concepts

- **Entity**: a named node; `name` is the public key. `tags`, `importance` (0 to 10), `ttl`, `confidence`, `version`,
  `validFrom` and `validUntil` are optional and enable freshness, versioning and bitemporal queries.
- **Relation**: a directed edge `from` to `to` with a `relationType` in active voice (`depends_on`, `works_at`).
- **Observation**: one atomic fact. `addObservations()` appends; `invalidateObservation()` closes a window so history is kept.
- **ManagerContext**: the facade, `new ManagerContext('./memory.jsonl')` or `new ManagerContext({ storagePath, storageType })`. Managers are created on first access.
- **Batch**: `ctx.batch(fn)` applies queued mutations in one load-apply-save pass; if `fn` throws, nothing is applied ([`examples/04-import-export.ts`](examples/04-import-export.ts)).

## Storage Options

| Backend | Select with | Path argument | Notes |
|---|---|---|---|
| JSONL (default) | nothing, or `MEMORY_STORAGE_TYPE=jsonl` | File path | Human-readable. Single process only. |
| SQLite | `storageType: 'sqlite'`, or `MEMORY_STORAGE_TYPE=sqlite` | Database file | FTS5 with BM25, WAL mode. Needs `better-sqlite3`, or `node:sqlite` on Node 22.16+. |
| PostgreSQL | `MEMORY_STORAGE_TYPE=postgres` (or `postgresql`) | Connection string, such as `postgres://user:pass@host:5432/db` | Needs `pg`. The pool opens on first use and the schema is created then. Search is LIKE-based in this version. |

The `storageType` option takes `jsonl` or `sqlite`. A set `MEMORY_STORAGE_TYPE` overrides it, so deployments can switch
backends without code changes. PostgreSQL is selected only through the environment. Its tests mock the `pg` client; the
repository's suite does not run it against a live server.

SQLite notes: `better-sqlite3` loads first, else `node:sqlite`; `MEMORY_SQLITE_DRIVER=node` forces the latter.

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { SQLiteStorage } from '@danielsimonjr/memoryjs/sqlite';

const storagePath = './memory.db';

const ctx = new ManagerContext({ storagePath, storageType: 'sqlite' });

const storage: unknown = ctx.storage;
const ranked = storage instanceof SQLiteStorage
  ? storage.fullTextSearch('refund ledger', { limit: 5 })
  : [];
```

Full example: [`examples/15-sqlite.ts`](examples/15-sqlite.ts)

## Search Capabilities

| Method | Use it for |
|---|---|
| `searchManager.searchNodes(query)` | Substring and tag matching |
| `searchManager.autoSearch(query)` | Default entry point; returns `selectedMethod` and `selectionReason` |
| `searchManager.booleanSearch(query)` | AND, OR, NOT, with parentheses |
| `searchManager.fuzzySearch(query, threshold?)` | Typo tolerance (threshold 0 to 1, positional) |
| `rankedSearch.searchNodesRanked(query, ...)` | Relevance order with a score |
| `searchManager.searchByTime(query)` | "last hour", "since 2024-01-01" |
| `hybridSearchManager.search(graph, query, options)` | Semantic, lexical and symbolic signals combined |
| `queryNaturalLanguage(text)` | LLM-planned search; set the provider first with `ctx.llmQueryPlanner({ llmProvider })` |

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const ranked = await ctx.rankedSearch.searchNodesRanked('runtime platform', undefined, undefined, undefined, 5);

const fuzzyPositional = await ctx.searchManager.fuzzySearch('Typscript', 0.7);

const fuzzyOptions = await ctx.searchManager.fuzzySearch('Typscript', { tags: ['programming'], minImportance: 5 });

const boolean = await ctx.searchManager.booleanSearch('person AND (frontend OR backend)');

const filtered = await ctx.searchManager.searchNodes('engineer', { tags: ['backend'], minImportance: 5 });
```

Full example: [`examples/02-search.ts`](examples/02-search.ts)

Hybrid search takes the graph (`ctx.storage.loadGraph()`) and per-signal weights. Filters go in `symbolic`. Options
`semantic`, `lexical`, `explain`, `graphWeight` and `expandNeighbors` are optional. The example uses `semanticWeight: 0`
so it never loads an embedding model:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const recent = await ctx.searchManager.searchByTime('last hour');

const graph = await ctx.storage.loadGraph();

const hybrid = await ctx.hybridSearchManager.search(graph, 'runtime', {
  semanticWeight: 0,
  lexicalWeight: 0.7,
  symbolicWeight: 0.3,
  symbolic: { tags: ['backend', 'company'], importance: { min: 5 } },
  limit: 5,
});
```

Full example: [`examples/02-search.ts`](examples/02-search.ts)

`ctx.semanticSearch` is `null` when no embedding provider is available, so check it before a semantic query.

## Graph Algorithms

`calculatePageRank(damping, iterations, tolerance, topN)` returns a `CentralityResult` (`scores`, a `Map`;
`topEntities`; `algorithm`). `findShortestPath()` returns a `PathResult` or `null`. `findCommunities()` returns
`communities` and `modularity`; `findCliques({ minSize, maxCliques })` returns `string[][]`.

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const shortest = await ctx.graphTraversal.findShortestPath('A', 'Z');

const components = await ctx.graphTraversal.findConnectedComponents();

const pagerank = await ctx.graphTraversal.calculatePageRank(0.85, 100, 1e-6, 3);

const degree = await ctx.graphTraversal.calculateDegreeCentrality();
```

Full example: [`examples/03-graph-algorithms.ts`](examples/03-graph-algorithms.ts)

## Import, Export and Skills

`exportGraph(graph, format)` is synchronous and returns text. `importGraph(format, data, mergeStrategy, dryRun)` takes
`json`, `csv` or `graphml`, with merge strategies `replace`, `skip`, `merge` or `fail`. `createBackup()` returns a
`BackupResult` with `path`; `restoreFromBackup(path)` restores it.

```ts
import { join } from 'node:path';
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const graph = await ctx.storage.loadGraph();

const json = ctx.ioManager.exportGraph(graph, 'json');

const targetPath = join(join(storagePath, '..'), 'target.jsonl');

const target = new ManagerContext(targetPath);

const dry = await target.ioManager.importGraph('json', json, 'skip', true);

const real = await target.ioManager.importGraph('json', json, 'skip');
```

Full example: [`examples/04-import-export.ts`](examples/04-import-export.ts)

`exportSkills(dir)` and `importSkills(dir)` publish and read `SKILL.md` trees below the storage directory
(see [`examples/04-import-export.ts`](examples/04-import-export.ts)).

## Agent Memory System

Working memory is short-term and may expire or be promoted. Episodic memory is a timeline of events. Every memory is an
entity, so it is searchable and versioned.

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const agent = ctx.agentMemory({
  decay: { halfLifeHours: 168, minImportance: 0.1 },
});

const session = await agent.startSession({ agentId: 'support-bot', goalDescription: 'Answer billing questions' });

const sessionId = session.name;

const working = await agent.addWorkingMemory({
  sessionId,
  content: 'User prefers dark mode and short answers',
  importance: 7,
  ttlHours: 24,
});

const episode = await agent.createEpisode('Resolved a duplicate-charge ticket', {
  sessionId,
  importance: 8,
});

const first = await ctx.memoryEngine.addTurn('How do I update my card?', {
  sessionId,
  role: 'user',
  importance: 6,
});

const repeat = await ctx.memoryEngine.addTurn('How do I update my card?', {
  sessionId,
  role: 'user',
});
```

Full example: [`examples/05-agent-memory.ts`](examples/05-agent-memory.ts)

`wakeUp({ knowledge, taskHint, maxL0Tokens, maxL1Tokens })` builds a token-budgeted context block; the `knowledge`
argument adds shared instructions and the skills that match `taskHint`. `runDecayCycle()` applies time decay. Both are
shown in [`examples/05-agent-memory.ts`](examples/05-agent-memory.ts).

Memory types (`MEMORY_TYPES`) are working, episodic, semantic, procedural, prospective, failure, plan, reflection,
heuristic, exclusion, decision, project_context, tool_affordance, skill and instruction_set. `MemorySource.trustLevel`
(`ground-truth`, `verified`, `inferred`, `unverified`) is set by hand or with `inferTrustLevel(source)`.

## Governance, Access Control and Audit

### Multi-agent memory

Each memory has an `agentId` and a visibility: `private`, `team`, `org`, `shared` or `public`. `MultiAgentMemoryManager`
decides who can read what. `collaborativeSynthesis` walks the graph from a seed, ranks neighbours by salience, and reports
conflicts: two agents' claims with the same identity (`rootEntityName`, or `name`).

```ts
import { CollaborativeSynthesis, ManagerContext, MultiAgentMemoryManager, type Entity } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const multi = new MultiAgentMemoryManager(ctx.storage);

await multi.registerAgent('researcher', { name: 'Researcher', type: 'llm' });

const shared = await multi.createAgentMemory('researcher', {
  name: 'research-finding',
  entityType: 'finding',
  memoryType: 'semantic',
  observations: ['Latency dropped 30% after caching'],
});

await multi.shareMemory(shared.name, 'researcher');
```

Full example: [`examples/06-multi-agent.ts`](examples/06-multi-agent.ts)

`createAgentMemory()` does not persist `rootEntityName`, so identity-linked claims are written with
`entityManager.createEntities()`; the example shows both halves, including the conflict winner that `collaborativeSynthesis` recommends.

### Policy and audit

With `MEMORY_GOVERNANCE_ENABLED=true` (exact string), every mutation is checked against the policy and audited; a denial
throws `GovernanceError`. Audit writes are fire-and-forget.

```ts
import {
  AuditLog,
  CollaborationAuditEnforcer,
  GovernanceError,
  ManagerContext,
  PiiRedactor,
} from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
process.env.MEMORY_GOVERNANCE_ENABLED = 'true';
const ctx = new ManagerContext(storagePath);

ctx.governanceManager.setPolicy({
  canCreate: (entity) => entity.entityType !== 'secret',
});

let denied = false;
try {
  await ctx.entityManager.createEntities([{ name: 'API key', entityType: 'secret', observations: ['redacted'] }]);
} catch (err) {
  denied = err instanceof GovernanceError;
}
```

Full example: [`examples/07-governance-rbac.ts`](examples/07-governance-rbac.ts)

Audit entries go to `MEMORY_AUDIT_LOG_FILE` or a `<basename>-audit.jsonl` sidecar. `ctx.auditLog.verifyChain()` checks the
SHA-256 hash chain; `memory audit verify` does the same from the CLI.

### RBAC, attribution and PII

Grants are data. `checkPermission()` is synchronous and takes `read`, `write`, `delete` or `manage`. Roles are `reader`,
`writer`, `admin`, `owner`, or a custom string. `CollaborationAuditEnforcer` rejects mutations that do not name an agent.
`PiiRedactor` masks emails, SSNs, card numbers, phone numbers and IP addresses.

```ts
import { join } from 'node:path';
import {
  AuditLog,
  CollaborationAuditEnforcer,
  GovernanceError,
  ManagerContext,
  PiiRedactor,
} from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

await ctx.roleAssignmentStore.assign({ agentId: 'alice', role: 'writer', resourceType: 'entity' });

const aliceWrite = ctx.rbacMiddleware.checkPermission('alice', 'write', 'entity');

const aliceManage = ctx.rbacMiddleware.checkPermission('alice', 'manage', 'entity');

const enforcer = new CollaborationAuditEnforcer(ctx.entityManager, new AuditLog(join(storagePath, '..', 'attr-audit.jsonl')));

const attributed = await enforcer.createEntities(
  [{ name: 'Attributed note', entityType: 'note', observations: ['written by alice'] }],
  'alice',
);

const redactor = new PiiRedactor();

const { text, stats } = redactor.redactWithStats('Contact jane@example.com or 555-123-4567');
```

Full example: [`examples/07-governance-rbac.ts`](examples/07-governance-rbac.ts)

## Bitemporal Versioning and Causal Reasoning

`invalidateEntity()` and `invalidateRelation()` close a validity window; the `asOf` queries read the graph as it was. Relations
have no `validFrom`: they are valid from creation until invalidated.

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const before = await ctx.relationManager.queryAsOf('Alice', '2100-01-01', { direction: 'outgoing' });

await ctx.relationManager.invalidateRelation('Alice', 'works_at', 'Acme', '2025-01-01T00:00:00Z');

const in2024 = await ctx.relationManager.queryAsOf('Alice', '2024-06-01', { direction: 'outgoing' });

const history = await ctx.relationManager.timeline('Alice', { direction: 'outgoing' });

await ctx.entityManager.invalidateEntity('Globex', '2030-01-01T00:00:00Z');

const globexIn2026 = await ctx.entityManager.entityAsOf('Globex', '2026-01-01T00:00:00Z');
```

Full example: [`examples/08-versioning-causal.ts`](examples/08-versioning-causal.ts)

Causal reasoning walks `causes`, `enables`, `prevents`, `precedes` and `correlates` relations. The counterfactual removes
one edge and reports which paths to the effect survive. `detectStateChange()` diffs two world-state snapshots:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const effects = await ctx.causalReasoner.findEffects('Rain', ['Flooding', 'Erosion']);

const causes = await ctx.causalReasoner.findCauses('Erosion', ['Rain', 'Flooding']);

const withoutLink = await ctx.causalReasoner.counterfactual({
  seed: 'Rain',
  removeFrom: 'Flooding',
  removeTo: 'Erosion',
  predict: 'Erosion',
});

const snapshotBefore = await ctx.worldModelManager.getCurrentState();

const snapshotAfter = await ctx.worldModelManager.getCurrentState();

const change = ctx.worldModelManager.detectStateChange(snapshotBefore, snapshotAfter);
```

Full example: [`examples/08-versioning-causal.ts`](examples/08-versioning-causal.ts)

## Recursa: Skills, Knowledge and Learning

Recursa is `@experimental`: shapes may change in a minor release, and changes are recorded in the changelog.

- **Skills** have a scope (`domains` is required), matching and outcome tracking. **Instruction sets** hold role-scoped
  sections (`solver`, `learner`, `shared`). **Knowledge** combines both with failure lessons into a snapshot, and
  `loadForContext()` loads them for a task within a token budget.
- **SKILL.md publishing** writes live skills to a directory. Publish paths are confined to `skillPublishRoot`
  (default `process.cwd()`), so pass the root explicitly as the example does.

```ts
import { dirname, join } from 'node:path';
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext({ storagePath, skillPublishRoot: dirname(storagePath) });

const refundId = await ctx.skillManager.add({
  name: 'Refund duplicate charges',
  description: 'Use when a customer reports the same charge twice',
  kind: 'procedure',
  scope: { domains: ['billing'], tasks: ['billing-dispute'] },
  uncertainty: 0.15,
  body: '1. Confirm both charges in the ledger.\n2. Refund the later one.',
  sources: [{ ref: 'runbook:billing', kind: 'document' }],
});

const matches = await ctx.skillManager.match('customer charged twice billing', { limit: 3 });

await ctx.skillManager.recordOutcome(refundId, 'helped');

const instructionId = await ctx.instructionSets.add({
  role: 'solver',
  sections: [
    {
      heading: 'Tone',
      text: 'Be brief and confirm the amount before acting.',
      sources: [{ ref: 'style-guide', kind: 'document' }],
      uncertainty: 0.1,
    },
  ],
});

const rendered = await ctx.instructionSets.render('solver', { budgetTokens: 200 });

const snapshot = await ctx.knowledgeRepository.snapshot('before-review');

const loaded = await ctx.knowledgeRepository.loadForContext({
  role: 'solver',
  taskHint: 'customer charged twice',
  budgetTokens: 400,
});

const published = await ctx.skillPublisher.publish('published-skills');
```

Full example: [`examples/09-recursa-skills-knowledge.ts`](examples/09-recursa-skills-knowledge.ts)

### Learning loop

`ctx.learningLoop(deps)` runs solve, judge, diagnose and edit rounds. `learn()` returns a `LearnResult` (`before`, `after`,
`stoppedBecause`). Runs with more tasks than `MEMORY_LEARNING_LEAF_THRESHOLD` (default 20), or with a `split`, use the
recursive learner. The step-wise protocol (`start()`, `next()`, `submit()`) lets the caller run the solve and judge steps.
The deterministic diagnoser may stop a small run with `no-progress`; the example checks the protocol, not a score.

```ts
import {
  DeterministicJudge,
  ManagerContext,
  type LearningSolver,
  type LoadedKnowledge,
  type SolveResult,
  type TaskRecord,
} from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const tasks: TaskRecord[] = [
  { id: 'task-refund', input: 'Refund a duplicate charge', category: 'billing', rubric: [
    { id: 'c1', text: 'Names the refund action', kind: 'fact', expected: 'refund' },
  ] },
  { id: 'task-reset', input: 'Reset a locked account', category: 'auth', rubric: [
    { id: 'c1', text: 'Mentions the reset link', kind: 'fact', expected: 'reset link' },
  ] },
  { id: 'task-invoice', input: 'Resend an invoice', category: 'billing', rubric: [
    { id: 'c1', text: 'Mentions the invoice', kind: 'fact', expected: 'invoice' },
  ] },
];

const solver: LearningSolver = {
  async solve(task: TaskRecord, knowledge: LoadedKnowledge): Promise<SolveResult> {
    const answer = knowledge.markdown.includes(task.id)
      ? task.rubric.map((c) => String(c.expected)).join(' ')
      : 'I am not sure';
    return { answer, traceAddrs: [] };
  },
};

const judge = new DeterministicJudge();

const loop = ctx.learningLoop({ solver, judge });

const result = await loop.learn({ taskIds: tasks.map((t) => t.id), tasks, budget: { maxRounds: 3 } });

const stepLoop = ctx.learningLoop({ solver, judge });

const started = await stepLoop.start({ taskIds: tasks.slice(0, 2).map((t) => t.id), tasks: tasks.slice(0, 2), budget: { maxRounds: 1 } });

const traceId = started.traceId;

let request = await stepLoop.next(traceId);

let steps = 0;

while (request.kind !== 'done' && steps++ < 20) {
  if (request.kind === 'solve') {
    const payload: Record<string, SolveResult> = {};
    for (const { task, knowledge } of request.tasks) payload[task.id] = await solver.solve(task, knowledge);
    await stepLoop.submit(traceId, 'solve', payload);
  } else if (request.kind === 'judge') {
    const payload: Record<string, Awaited<ReturnType<DeterministicJudge['judge']>>> = {};
    for (const answer of request.answers) payload[answer.task.id] = await judge.judge(answer.task, answer.answer);
    await stepLoop.submit(traceId, 'judge', payload);
  }
  request = await stepLoop.next(traceId);
}

const status = await stepLoop.status(traceId);
```

Full example: [`examples/10-recursa-learning.ts`](examples/10-recursa-learning.ts)

### Bootstrapping, evaluation and harness support

`ctx.bootstrapper(deps).run({ sources, solver, budget, corpusLabel, taskCount })` maps a corpus into a navigation tree,
records coverage, writes exploration notes, generates practice tasks, runs one learning pass and snapshots the result as
`bootstrap`. An injected `learner` replaces the learning adapter. Full example:
[`examples/11-recursa-bootstrap.ts`](examples/11-recursa-bootstrap.ts).

`DeterministicJudge` checks answers against rubric criteria. `Evaluator.evaluate()` returns metrics and per-task feedback,
`stratifiedSplit()` makes a seeded split, and `LLMRubricJudge` judges with a model. `InteractionLog` is an append-only
sidecar (`<basename>-interactions.jsonl`) addressed `e1`, `e2`, ...; `EvictionIndex` marks spilled ranges; `ConcurrencyLimiter`
runs work with bounded concurrency.

### Harness tool adapter

`createRecursaTools(ctx, deps)` exposes 14 tools as JSON-in, JSON-out calls. `call()` never throws; it returns `{ ok, result }`
or `{ ok: false, error: { code, message } }`. The tools are `recursa.knowledge.load`, `recursa.skills.publish`,
`recursa.skills.import`, `recursa.learn.*` (eight tools: `start`, `next`, `submit`, `plan`, `submitChild`, `merge`, `reflect`, `status`),
`recursa.log.append`, `recursa.log.select` and `recursa.eval.run`.

```ts
import { join } from 'node:path';
import {
  InteractionLog,
  ManagerContext,
  ToolCallObserver,
  createRecursaTools,
} from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const log = new InteractionLog(storagePath);

const tools = createRecursaTools(ctx, { interactionLog: log, publishDir: join(storagePath, '..', 'skills') });

const appended = await tools.call('recursa.log.append', {
  sessionId: 'session-1',
  kind: 'note',
  tag: 'triage',
  content: 'Customer reports two identical charges on order 42.',
});

const addr = appended.ok ? String((appended.result as { addr?: string }).addr ?? '') : '';

const selected = await tools.call('recursa.log.select', { addr: addr || 'e1', regex: 'charges' });

const observer = new ToolCallObserver(ctx.toolAffordanceManager);

observer.setInteractionLog(log, 'session-1');

const callId = observer.observeStart('search_nodes', { query: 'refund' });

await observer.observeComplete(callId, { result: '1 match' });
```

Full example: [`examples/12-harness-tools.ts`](examples/12-harness-tools.ts)

## Reconstructive Memory and Procedural Graphs

`@experimental`. Reconstructive memory follows the Cue, Tag, Content model of Ji, Li and Hooi (ICML 2026). `ingest()` distils
dialogue turns into a graph; `reconstruct()` runs a bounded loop of traversal actions and gathers evidence.

```ts
import { ManagerContext, ReconstructiveMemory, type DialogueTurn } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const dialogue: DialogueTurn[] = [
  { id: 'D1:1', speaker: 'Alice', text: 'I started learning rust in March.', timestamp: '2026-03-02T10:00:00Z' },
  { id: 'D1:2', speaker: 'Bob', text: 'Nice. Are you still using it for the parser project?', timestamp: '2026-03-02T10:01:00Z' },
  { id: 'D1:3', speaker: 'Alice', text: 'Yes, the parser is rewritten in rust now.', timestamp: '2026-04-10T09:30:00Z' },
];

const memory = ctx.reconstructiveMemory();

const distilled = await memory.ingest(dialogue);

const result = await memory.reconstruct('What language did Alice learn?', {
  maxSteps: 4,
  perStepBudget: 5,
  evidenceTarget: 3,
});

const restored = new ReconstructiveMemory({ snapshot: memory.toSnapshot() });
```

Full example: [`examples/13-reconstructive-memory.ts`](examples/13-reconstructive-memory.ts)

A procedural graph has actions and states as nodes, with conditions, guidance and pitfalls on edges; a session returns
guidance for the current task. Its `backing` (`memory`, `jsonl`, `sqlite`) is separate from `MEMORY_STORAGE_TYPE`. Full
example: [`examples/14-procedural-graph.ts`](examples/14-procedural-graph.ts).

```ts
import { ManagerContext, type PGEdge, type PGNode } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const nodes: PGNode[] = [
  { id: 'cart', type: 'STATE', description: 'Cart has items' },
  { id: 'pay', type: 'ACTION', description: 'Charge the card', actionName: 'pay' },
  { id: 'receipt', type: 'STATE', description: 'Receipt sent' },
];

const edges: PGEdge[] = [
  { source: 'cart', relation: 'LEADS_TO', target: 'pay', condition: null, guidance: 'Confirm the total first', pitfalls: 'Do not charge twice' },
  { source: 'pay', relation: 'LEADS_TO', target: 'receipt', condition: 'payment succeeded', guidance: null, pitfalls: null },
];

const graphs = await ctx.createProceduralGraph({ backing: { type: 'memory' } });

const created = await graphs.createGraph({ graphId: 'checkout', nodes, edges, entryNodeId: 'cart' });

const session = await graphs.openSession('checkout', {
  taskDescription: 'Complete checkout',
  toolCatalog: ['pay'],
  guidanceMode: 'attributes-only',
});

const guidance = session ? await session.guidance('what next?') : undefined;

const stats = await graphs.stats('checkout');
```

Full example: [`examples/14-procedural-graph.ts`](examples/14-procedural-graph.ts)

## Adapters and the CLI

| Adapter | Purpose |
|---|---|
| `RestRouter` | REST router over the managers. Takes an optional `ApiKeyAuthMiddleware` (Bearer or `X-Api-Key`). |
| `APIKeyStore` | Issues keys with `issue({ ownerId, scopes, projectIds, ttlSeconds })`. **A key without `projectIds` can access every project.** |
| `MCPToolObserverAdapter` | Observes MCP tool calls through `ToolCallObserver`. |
| `LangChainMemoryAdapter` | LangChain-style memory adapter. |
| `createRecursaTools()` | The 14-tool Recursa adapter above. |

The `memory` binary covers the graph, search, import and export, maintenance, audit and diagnostics; `memory --help`
lists every command, and `--storage <path>` comes before the command. [`examples/16-cli.sh`](examples/16-cli.sh) runs more of them after `bun run build`:

```bash
memory entity create Alice --type person --observation "Senior engineer" --tags core backend
memory relation create Alice works_at Acme
memory observation add Alice "Joined in 2024"
```

Full example: [`examples/16-cli.sh`](examples/16-cli.sh)

```bash
memory search engineer
memory search engineer --ranked --limit 5
memory search Alise --fuzzy --threshold 0.7
```

Full example: [`examples/16-cli.sh`](examples/16-cli.sh)

```bash
memory stats
memory check
memory doctor --json
memory audit verify
```

Full example: [`examples/16-cli.sh`](examples/16-cli.sh)

## API Reference

The most-used members. The full surface is in [`docs/architecture/API.md`](docs/architecture/API.md) and
[`docs/guides/API_REFERENCE.md`](docs/guides/API_REFERENCE.md); after a build, `dist/index.d.ts` has every type.

| Manager | Methods |
|---|---|
| `ctx.entityManager` | `createEntities`, `getEntity(name)`, `listEntities({ entityType? })`, `updateEntity(name, updates, { expectedVersion? })`, `renameEntity`, `deleteEntities`, `addTags`, `removeTags`, `setImportance`, `invalidateEntity`, `entityAsOf`, `entityTimeline`, `registerRef`, `resolveRef` |
| `ctx.relationManager` | `createRelations`, `getRelations(name)`, `deleteRelations`, `invalidateRelation(from, relationType, to)`, `queryAsOf(name, asOf, { direction? })`, `timeline(name)` |
| `ctx.observationManager` | `addObservations([{ entityName, contents }])`, `deleteObservations`, `getObservationsFor(name)`, `invalidateObservation`, `observationsAsOf` |
| `ctx.searchManager` | `searchNodes`, `openNodes`, `booleanSearch`, `fuzzySearch`, `autoSearch`, `searchByTime`, `explainPlan`, `saveSearch` |
| `ctx.rankedSearch` | `searchNodesRanked(query, tags?, minImportance?, maxImportance?, limit?)` |
| `ctx.hybridSearchManager` | `search(graph, query, options)` |
| `ctx.graphTraversal` | `findShortestPath`, `findAllPaths`, `findConnectedComponents`, `findCommunities`, `findCliques`, `calculateDegreeCentrality`, `calculateBetweennessCentrality`, `calculatePageRank`, `calculateHITS`, `getNeighborsWithRelations`, `bfs`, `dfs` |
| `ctx.ioManager` | `exportGraph(graph, format)`, `importGraph(format, data, mergeStrategy?, dryRun?)`, `ingest`, `createBackup`, `listBackups`, `restoreFromBackup`, `deleteBackup`, `exportSkills`, `importSkills` |
| `ctx.agentMemory(config?)` | `startSession`, `endSession`, `addWorkingMemory`, `createEpisode`, `retrieveForContext`, `wakeUp`, `confirmMemory`, `promoteMemory`, `runDecayCycle`, `getTimeline`, `collaborativeSynthesis` |
| `ctx.memoryEngine` | `addTurn`, `checkDuplicate`, `getSessionTurns`, `getRepeatedTurnCount`, `deleteSession`, `listSessions` |
| `ctx.skillManager` / `instructionSets` / `knowledgeRepository` | `add`, `match`, `recordOutcome`, `retire` / `add`, `render` / `snapshot`, `loadForContext`, `diff` |
| `ctx.learningLoop(deps)` | `learn`, `start`, `next`, `submit`, `status`, `plan`, `merge`, `reflect` |
| `ctx.governanceManager` | `setPolicy`, `withTransaction`, `rollback` |
| `ctx.auditLog` (getter: `governanceManager.auditLog`) | `append`, `query`, `getHistory`, `stats`, `verifyChain` |
| `ctx.roleAssignmentStore` / `rbacMiddleware` | `assign`, `revoke`, `list`, `listActive` / `checkPermission(agentId, action, resourceType, resourceName?)` |
| `ctx.causalReasoner` / `worldModelManager` | `findCauses`, `findEffects`, `counterfactual`, `detectCycles` / `getCurrentState`, `detectStateChange`, `predictOutcome` |
| `ctx.streamingExporter(path)` (factory: a new exporter per call), `ctx.freshnessManager`, `ctx.temporalSearch`, `ctx.semanticForget` | Streaming export; freshness reports; natural-language time search; two-tier deletion |

Role profiles are code helpers: `getRoleProfile(role)`, `resolveRoleProfile(agentType)`, `listRoleProfiles()`.
`MEMORY_AGENT_ROLE` is reserved and not read by the library.

Errors exported from the root: `EntityNotFoundError`, `ValidationError`, `CycleDetectedError`,
`InvalidImportanceError`, `FileOperationError`, `InsufficientEntitiesError`, `GovernanceError`, `VersionConflictError`
(OCC updates with `expectedVersion`) and `AttributionRequiredError` (strict `CollaborationAuditEnforcer`); match them with
`instanceof`.

## Configuration

Configuration is through environment variables. The table lists the most-used. The full reference (decay, salience,
context window, freshness, mmap, segments, SQLite pool, prospective memory, memory engine and more) is in
[docs/guides/CONFIGURATION.md](docs/guides/CONFIGURATION.md). RBAC is wired in code, not by an environment variable.

| Variable | Description | Default |
|---|---|---|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite`, `postgres` or `postgresql`. Overrides the `storageType` option | `jsonl` |
| `MEMORY_SQLITE_SYNCHRONOUS` | SQLite `synchronous` pragma: `NORMAL` or `FULL` | `NORMAL` |
| `MEMORY_BACKEND` | Memory Engine backend: `sqlite` or `in-memory` | `sqlite` |
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `llamacpp` or `none` | `local` |
| `MEMORY_GOVERNANCE_ENABLED` | `true` (exact) enforces the policy on every mutation | unset |
| `MEMORY_AUDIT_LOG_FILE` | Audit JSONL path | `<basename>-audit.jsonl` |
| `MEMORY_AUTO_CONSOLIDATION` | Enables the consolidation scheduler (alias `MEMORY_CONSOLIDATION_SCHEDULER_ENABLED`) | `false` |
| `MEMORY_AUTO_DECAY` / `MEMORY_DECAY_HALF_LIFE_HOURS` | Background decay; its half-life | `false` / `168` |
| `MEMORY_LEARNING_LEAF_THRESHOLD` | Task count above which the recursive learner runs | `20` |
| `MEMORY_INTERACTION_LOG_INLINE_BYTES` | Bytes kept inline per interaction record; larger content spills to a blob | `16384` |
| `MEMORY_HYBRID_GRAPH_WEIGHT` / `MEMORY_RANKED_GRAPH_BOOST` | Graph-connectivity signal in hybrid and ranked search | `0` / `0` |
| `MEMORY_STORAGE_SEGMENT_COUNT` | Shard JSONL into 2 to 1024 segments (read at startup) | unset |
| `MEMORY_USE_MMAP` / `MEMORY_MMAP_THRESHOLD_BYTES` | Range-read loading for large JSONL files | `false` / `104857600` |
| `MEMORY_VALIDATE_ON_STORE` / `MEMORY_OBSERVATION_DEDUP` / `MEMORY_AUTO_LINK` | Observation-write checks | `false` |
| `MEMORY_AGENT_ROLE` | **Reserved; not read by the library.** Use `getRoleProfile(role)` | — |
| `SKIP_BENCHMARKS` / `LOG_LEVEL` | Skip performance tests; logger level | `false` / unset |

## Troubleshooting

- `memory doctor [--json]` checks the Node version, the `better-sqlite3` native build, the worker bundle, the storage
  file, env-var typos and embedding-provider reachability.
- `NODE_MODULE_VERSION mismatch` (SQLite tests): run `bun run rebuild:native`.
- JSONL is single-process. For several processes, use SQLite or PostgreSQL.
- `ctx.semanticSearch` is `null`: no embedding provider is available. See the optional peer dependencies above.

The full guide is [docs/development/DEBUGGING_GUIDE.md](docs/development/DEBUGGING_GUIDE.md).

## Development

Bun installs dependencies and drives scripts. The published library targets Node; do not use Bun as the runtime for
long-lived consumers.

| Task | Command |
|---|---|
| Install from `bun.lock` | `bun install` (`--frozen-lockfile` in CI) |
| Build `dist/` (ESM and CJS, CLI and workers) | `bun run build` |
| Run all tests | `bun run test` (`SKIP_BENCHMARKS=true` skips performance tests) |
| Run the example gate | `bunx vitest run tests/examples` |
| Type check | `bun run typecheck`; examples: `bunx tsc --noEmit -p tsconfig.examples.json` |
| Lint | `bun run lint` (type-aware oxlint plus project lint rules) |

| Path | Contents |
|---|---|
| `src/index.ts`, `src/sqlite.ts` | Root entry point; SQLite subpath entry |
| `src/core/` | `ManagerContext` (its lazy getters delegate to the facades in `src/core/context/`), entity, relation and observation managers, storage backends, graph traversal, transactions |
| `src/search/`, `src/features/` | Search managers and indexes; import and export, backups, governance, audit, freshness |
| `src/agent/` | Agent Memory System; Recursa (`knowledge/`, `learning/`, `bootstrap/`, `evaluation/`, `harness/`); reconstruction; procedural graphs |
| `src/adapters/`, `src/security/`, `src/cli/` | Adapters; PII, ABAC, row-level filter and API keys; the CLI |
| `src/types/`, `src/utils/`, `src/workers/` | Shared types; utilities; the worker pool |
| `examples/`, `tests/` | Runnable examples and the CLI script; test suites, including `tests/examples/` |

The autogenerated module graph is in [`docs/architecture/DEPENDENCY_GRAPH.md`](docs/architecture/DEPENDENCY_GRAPH.md).

## Documentation

- [docs/README.md](docs/README.md) — index of every document under docs/
- [todo.md](todo.md) — open follow-up work (oversize-file split series)
- [docs/guides/QUICK_REFERENCE.md](docs/guides/QUICK_REFERENCE.md): the cheat sheet
- [docs/guides/CONFIGURATION.md](docs/guides/CONFIGURATION.md): full environment-variable reference
- [docs/architecture/API.md](docs/architecture/API.md), [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) and [AGENT_MEMORY.md](docs/architecture/AGENT_MEMORY.md)
- [docs/guides/AGENT_INTEGRATION.md](docs/guides/AGENT_INTEGRATION.md) and [docs/guides/SECURITY_GUIDE.md](docs/guides/SECURITY_GUIDE.md)
- [docs/development/DEVELOPMENT_SETUP.md](docs/development/DEVELOPMENT_SETUP.md), [ARCHITECTURE_DECISIONS.md](docs/development/ARCHITECTURE_DECISIONS.md), [ROADMAP.md](docs/roadmap/ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md)
- [examples/](examples/): runnable examples for every area above

## License and Related

MIT, see [LICENSE](LICENSE). The MCP server built on this library is [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp).

**Repository:** https://github.com/danielsimonjr/memoryjs · **Package:** https://www.npmjs.com/package/@danielsimonjr/memoryjs · **Issues:** https://github.com/danielsimonjr/memoryjs/issues
