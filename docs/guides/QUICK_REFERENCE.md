# MemoryJS Quick Reference

> **Code samples.** Samples assume `const ctx = new ManagerContext('./memory.jsonl')` and the placeholders `graph: KnowledgeGraph` (from `await ctx.storage.loadGraph()`), `entities: Entity[]` and `storage: IGraphStorage`. Every other name in a sample is imported or declared in it.

**Version 4.5.0.** A cheat sheet. Every snippet below is an excerpt of a runnable file in [`examples/`](../../examples/),
and the examples run under the `tests/examples/` gate. Full documentation: [README](../../README.md).

## Setup

Requirements: Node.js 22.12.0 or later at runtime; Bun 1.4.2 or later for development. Install with `bun add @danielsimonjr/memoryjs`.

- `new ManagerContext('./memory.jsonl')` (JSONL, default) or `new ManagerContext({ storagePath, storageType: 'sqlite' })`.
- Subpaths: `/sqlite`, `/core`, `/search`, `/agent`, `/features`, `/utils`, `/types`, `/adapters`, `/security`.
- `ctx.close()` releases handles and is idempotent.

## Entities, Relations and Observations

Create, relate and observe.

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
```

Full example: [`examples/01-quick-start.ts`](../../examples/01-quick-start.ts)

Read, list and look up:

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

Full example: [`examples/01-quick-start.ts`](../../examples/01-quick-start.ts)

Typed errors: a missing entity raises `EntityNotFoundError`.

```ts
import { EntityNotFoundError, ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

let missingEntityError = false;
try {
  await ctx.entityManager.setImportance('Missing', 5);
} catch (err) {
  missingEntityError = err instanceof EntityNotFoundError;
}
```

Full example: [`examples/01-quick-start.ts`](../../examples/01-quick-start.ts)

Other members: `updateEntity(name, updates, { expectedVersion })` (throws `VersionConflictError` on a stale version; match with `instanceof`),
`deleteEntities(names)`, `addTags`, `removeTags`, `setImportance`, `renameEntity(oldName, newName)`, `relationManager.deleteRelations`,
`observationManager.deleteObservations`, `hierarchyManager.setEntityParent(child, parent)`, `getChildren`, `getAncestors`.

## Search

Full example: [`examples/02-search.ts`](../../examples/02-search.ts).

| Method | Notes |
|---|---|
| `searchManager.searchNodes(query, tagsOrOptions?)` | Substring and tag match |
| `rankedSearch.searchNodesRanked(query, tags?, minImportance?, maxImportance?, limit?)` | Positional form returns `SearchResult[]` (`entity`, `score`) |
| `searchManager.booleanSearch(query)` | AND, OR, NOT; returns a `KnowledgeGraph` |
| `searchManager.fuzzySearch(query, threshold)` or `fuzzySearch(query, { tags, minImportance, maxImportance })` | Threshold is positional; the options form has no threshold |
| `searchManager.searchByTime(query)` | Natural-language ranges; returns `Entity[]` |
| `searchManager.autoSearch(query)` | Returns `selectedMethod`, `selectionReason`, `results` |
| `hybridSearchManager.search(graph, query, options)` | `graph` from `await ctx.storage.loadGraph()` |

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

Full example: [`examples/02-search.ts`](../../examples/02-search.ts)

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

Full example: [`examples/02-search.ts`](../../examples/02-search.ts)

Semantic search needs an embedding provider; `ctx.semanticSearch` is `null` without one:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const semantic = ctx.semanticSearch;
```

Full example: [`examples/02-search.ts`](../../examples/02-search.ts)

## Graph Algorithms



```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const shortest = await ctx.graphTraversal.findShortestPath('A', 'Z');

const components = await ctx.graphTraversal.findConnectedComponents();

const pagerank = await ctx.graphTraversal.calculatePageRank(0.85, 100, 1e-6, 3);

const degree = await ctx.graphTraversal.calculateDegreeCentrality();
```

Full example: [`examples/03-graph-algorithms.ts`](../../examples/03-graph-algorithms.ts)

`calculatePageRank` returns a `CentralityResult` (`scores: Map`, `topEntities`, `algorithm`). `calculateDegreeCentrality(direction?, topN?)`
and `calculateBetweennessCentrality(options?)` return the same shape. `findCommunities()` returns `communities` and `modularity`.
`findCliques({ minSize, maxCliques })` returns `string[][]`. `bfs(start, options?)` and `dfs(start, options?)` return a `TraversalResult`.

Graph statistics:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const stats = await ctx.analyticsManager.getGraphStats();
```

Full example: [`examples/03-graph-algorithms.ts`](../../examples/03-graph-algorithms.ts)

## Import, Export and Backups



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

Full example: [`examples/04-import-export.ts`](../../examples/04-import-export.ts)

`exportGraph(graph, format, options?)` is synchronous and returns text. Formats: `json`, `csv`, `graphml`, `gexf`, `dot`, `markdown`,
`mermaid`, `turtle`, `rdf-xml`, `json-ld`. `importGraph(format, data, mergeStrategy = 'skip', dryRun = false, options?)` takes `json`,
`csv` or `graphml` and returns an `ImportResult` (`entitiesAdded`, `entitiesSkipped`, `entitiesUpdated`, `relationsAdded`, `errors`).

Backups:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const backup = await ctx.ioManager.createBackup();

await ctx.entityManager.deleteEntities(['Acme']);

const restore = await ctx.ioManager.restoreFromBackup(backup.path);

const backups = await ctx.ioManager.listBackups();
```

Full example: [`examples/04-import-export.ts`](../../examples/04-import-export.ts)

`createBackup()` returns `BackupResult` (`path`, `entityCount`, `relationCount`); `listBackups()`, `restoreFromBackup(path)`, `deleteBackup(path)`,
`cleanOldBackups(keepCount?)`.

Skills as `SKILL.md` trees below the storage directory:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

await ctx.skillManager.add({
  name: 'Triage bug reports',
  description: 'Use when a bug report arrives without reproduction steps',
  kind: 'procedure',
  scope: { domains: ['support'] },
  uncertainty: 0.2,
  body: '1. Ask for steps.\n2. Attach logs.',
});

const published = await ctx.ioManager.exportSkills('skills');

const report = await ctx.ioManager.importSkills('skills');
```

Full example: [`examples/04-import-export.ts`](../../examples/04-import-export.ts)

## Batch and Transactions

Full example: [`examples/04-import-export.ts`](../../examples/04-import-export.ts).

`ctx.batch(fn, options?)` queues mutations on a `BatchTransaction` and applies them in one load-apply-save pass. If `fn`
throws, nothing is applied; with the default `stopOnError: true`, nothing is saved after the first failure. It resolves to a
`BatchResult` (`success`, `operationsExecuted`, `entitiesCreated`, ...).

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const batch = await ctx.batch((b) => {
  b.createEntity({ name: 'Initech', entityType: 'organization', observations: ['Vendor'] });
  b.createRelation({ from: 'Alice', to: 'Initech', relationType: 'consults_for' });
});
```

Full example: [`examples/04-import-export.ts`](../../examples/04-import-export.ts)

`TransactionManager` stages the same operations and commits with a full-graph save and backup-based rollback (`commit()`, `rollback()`).

## Agent Memory

Full example: [`examples/05-agent-memory.ts`](../../examples/05-agent-memory.ts).

`ctx.agentMemory(config?)` returns an `AgentMemoryManager`. Sessions scope working and episodic memory:

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

Full example: [`examples/05-agent-memory.ts`](../../examples/05-agent-memory.ts)

`ctx.memoryEngine` (turn-aware conversation memory) is the four-tier dedup chain: exact hash, prefix overlap, token Jaccard,
and an optional semantic tier (`MEMORY_ENGINE_SEMANTIC_DEDUP`). `getRepeatedTurnCount(sessionId)` counts rejections in this process
only; it is not persisted.

Wake-up context and decay:

```ts
import { ManagerContext } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const agent = ctx.agentMemory({
  decay: { halfLifeHours: 168, minImportance: 0.1 },
});

const wakeUp = await agent.wakeUp({
  knowledge: ctx.knowledgeRepository,
  taskHint: 'billing dispute',
  maxL0Tokens: 300,
  maxL1Tokens: 400,
});

const cycle = await agent.runDecayCycle();
```

Full example: [`examples/05-agent-memory.ts`](../../examples/05-agent-memory.ts)

Other methods: `retrieveForContext({ sessionId, maxTokens, includeEpisodicRecent })`, `promoteMemory(name, 'episodic' | 'semantic')`,
`confirmMemory(name, boost)` (working memory only), `getTimeline(sessionId)`, `writeDiary()`, `readDiary()`.

## Multi-agent



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

Full example: [`examples/06-multi-agent.ts`](../../examples/06-multi-agent.ts)

Collaborative synthesis from the agent facade, and the same class built directly from its four dependencies
(`storage`, `graphTraversal`, `salienceEngine`, and optional config):

```ts
import { CollaborativeSynthesis, ManagerContext, MultiAgentMemoryManager, type Entity } from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

const agent = ctx.agentMemory();

const synthesis = await agent.collaborativeSynthesis.synthesize('Launch plan');

const winners = agent.collaborativeSynthesis.resolveConflicts(synthesis, { strategy: 'highest_confidence' });

const direct = new CollaborativeSynthesis(
  ctx.storage,
  ctx.graphTraversal,
  agent.createRoleAwareSalienceEngine('reviewer'),
);
```

Full example: [`examples/06-multi-agent.ts`](../../examples/06-multi-agent.ts)

`resolveConflicts(result, policy)` takes `{ strategy }` where strategy is `most_recent`, `highest_confidence`, `highest_score`,
`trusted_agent` (with `trustedAgentId`) or `trust_level`. It returns a `Map` from entity name to winning `AgentEntity`.

## Governance, RBAC and PII

Full example: [`examples/07-governance-rbac.ts`](../../examples/07-governance-rbac.ts).

Set `MEMORY_GOVERNANCE_ENABLED=true` (exact string; read on the first entity-manager access) to enforce the policy on every mutation:

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

Full example: [`examples/07-governance-rbac.ts`](../../examples/07-governance-rbac.ts)

Grants and checks:

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

Full example: [`examples/07-governance-rbac.ts`](../../examples/07-governance-rbac.ts)

`checkPermission(agentId, action, resourceType, resourceName?, now?)` takes `read`, `write`, `delete` or `manage`. Roles: `reader`,
`writer`, `admin`, `owner` or a custom string. `PiiRedactor` methods: `redact(text)`, `redactWithStats(text)` (returns `{ text, stats }`), `redactGraph(graph)`.

Audit: `ctx.auditLog.getHistory(name)`, `query(filter)`, `stats()`, `verifyChain()`. The CLI has `memory audit log|history|verify|stats`.

## Bitemporal Versioning and Causal Reasoning



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

Full example: [`examples/08-versioning-causal.ts`](../../examples/08-versioning-causal.ts)

Entity timelines use `entityTimeline(name)`. Relations are valid from creation until `invalidateRelation` sets `validUntil`.

Causal reasoning and world-state diffs:

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

Full example: [`examples/08-versioning-causal.ts`](../../examples/08-versioning-causal.ts)

`findEffects(cause, candidates, maxDepth?)` and `findCauses(effect, candidates, maxDepth?)` return `CausalChain[]`. `detectCycles(seed)` returns the cycles.

## Recursa (`@experimental`)

Skills, instruction sets and knowledge.

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

Full example: [`examples/09-recursa-skills-knowledge.ts`](../../examples/09-recursa-skills-knowledge.ts)

Skill methods: `get(id)`, `list({ kind?, domain?, includeRetired? })`, `update(id, patch, { expectedVersion })`, `retire(id, reason)`.
`ctx.skillPublisher.importSkills(dir)` reads a tree back. `loadForContext({ role, taskHint, budgetTokens, sections? })` returns
`{ markdown, skillIds, instructionSetIds, failureIds, tokens }`.

Learning loop: `learn()` runs to completion; `start`, `next` and `submit` drive a leaf run step by step.

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

Full example: [`examples/10-recursa-learning.ts`](../../examples/10-recursa-learning.ts)

Bootstrapper: `ctx.bootstrapper({ learner?, summarizer?, keywords?, llmProvider?, learning? }).run({ sources, solver?, judge?, budget, corpusLabel?, taskCount? })`.

```ts
import {
  DeterministicJudge,
  ManagerContext,
  type BootstrapLearner,
  type CorpusSource,
  type LearningSolver,
  type LoadedKnowledge,
  type SolveResult,
  type TaskRecord,
} from '@danielsimonjr/memoryjs';

const storagePath = './memory.jsonl';
const ctx = new ManagerContext(storagePath);

function corpus(): CorpusSource[] {
  return Array.from({ length: 6 }, (_, i) => ({
    ref: `policy-${i}.md`,
    title: `Policy ${i}`,
    text: `Policy ${i} explains the ${i % 2 === 0 ? 'refund' : 'shipping'} rules for order batch ${i}.`,
    metadata: { group: i % 2 === 0 ? 'refunds' : 'shipping' },
  }));
}

const solver: LearningSolver = {
  async solve(task: TaskRecord, _knowledge: LoadedKnowledge): Promise<SolveResult> {
    return { answer: task.input, traceAddrs: [] };
  },
};

const learnedTaskCounts: number[] = [];

const learner: BootstrapLearner = {
  async learn(opts, deps) {
    learnedTaskCounts.push(opts.taskIds.length);
    return ctx.learningLoop(deps).learn(opts);
  },
};

const boot = ctx.bootstrapper({ learner });

const out = await boot.run({
  sources: corpus(),
  solver,
  judge: new DeterministicJudge(),
  budget: { maxRounds: 1 },
  corpusLabel: 'policies',
  taskCount: 4,
});

const snapshot = await ctx.knowledgeRepository.getSnapshot(out.snapshotId);
```

Full example: [`examples/11-recursa-bootstrap.ts`](../../examples/11-recursa-bootstrap.ts)

Tool adapter and interaction log. `createRecursaTools(ctx, deps)` returns `list()` and `call(name, args, signal?)`; the 14 tools are listed in the
README.

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

Full example: [`examples/12-harness-tools.ts`](../../examples/12-harness-tools.ts)

`InteractionLog` options: `MEMORY_INTERACTION_LOG_INLINE_BYTES` sets the inline budget before content spills to a blob.
`ToolCallObserver(manager)` accepts `setInteractionLog(log, sessionId?)`.

## Reconstructive Memory (`@experimental`)



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

Full example: [`examples/13-reconstructive-memory.ts`](../../examples/13-reconstructive-memory.ts)

`reconstruct(query, { maxSteps?, perStepBudget?, evidenceTarget? })` returns `evidence`, `trajectory`, `stoppedEarly` and an optional `answer`.
`toSnapshot()` and `loadSnapshot()` persist the graph.

## Procedural Graphs (`@experimental`)



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

Full example: [`examples/14-procedural-graph.ts`](../../examples/14-procedural-graph.ts)

`stats(graphId)` returns `headVersion`, `nodeCount`, `edgeCount`, `revisionCount`. `evolve(options, deps)` revises the graph from training
tasks under `maxRounds`, `batchSize` and `maxTokens` budgets.

## Specialised Memory Managers

Accessed on `ManagerContext` with no setup: `procedureManager` (`addProcedure`, `matchProcedure`, `refineProcedure`),
`prospectiveMemory` (`scheduleAt`, `scheduleOnEvent`, `tick`), `failureManager` (`record`, `lookupForTask`), `plan`, `reflectionManager`,
`heuristicManager`, `decisionManager`, `projectContextManager`, `toolAffordanceManager`, `causalReasoner`, `worldModelManager`,
`activeRetrieval` (`adaptiveRetrieve`).

| Entry point | Kind | Notes |
|---|---|---|
| `ctx.auditLog` | Getter | `governanceManager.auditLog`: `append`, `query`, `getHistory`, `stats`, `verifyChain` |
| `ctx.streamingExporter(path)` | Factory | A new `StreamingExporter` bound to `path` on every call (not cached): `streamJSONL(graph)`, `streamCSV(graph)` |
| `ctx.freshnessManager` / `ctx.temporalSearch` | Getters | Freshness reports over `ttl` / `confidence`; natural-language time-range search |
| `ctx.agentMemory().collaborativeSynthesis` | Getter | `synthesize(seed)`, `resolveConflicts(result, { strategy })` across agents |

## CLI



```bash
memory stats
memory check
memory doctor --json
memory audit verify
```

Full example: [`examples/16-cli.sh`](../../examples/16-cli.sh)

## Environment Variables

| Variable | Values | Default |
|---|---|---|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite`, `postgres` (or `postgresql`; the path is then the connection string) | `jsonl` |
| `MEMORY_SQLITE_SYNCHRONOUS` | `NORMAL`, `FULL` | `NORMAL` |
| `MEMORY_SQLITE_READ_POOL_SIZE` | Integer; `0` or `1` routes reads through the writer | `4` |
| `MEMORY_BACKEND` | `sqlite`, `in-memory` | `sqlite` |
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `llamacpp`, `none` | `local` |
| `MEMORY_GOVERNANCE_ENABLED` | `true` (exact) enforces the policy and audit on mutations | unset |
| `MEMORY_AUDIT_LOG_FILE` | Audit JSONL path | `<basename>-audit.jsonl` |
| `MEMORY_AUTO_CONSOLIDATION` | `true` enables the consolidation scheduler | `false` |
| `MEMORY_LEARNING_LEAF_THRESHOLD` | Integer >= 0; more tasks use the recursive learner | `20` |
| `MEMORY_INTERACTION_LOG_INLINE_BYTES` | Positive integer; larger content spills to a blob | `16384` |
| `MEMORY_HYBRID_GRAPH_WEIGHT` / `MEMORY_RANKED_GRAPH_BOOST` | Number (0 to 1) / number >= 0 | `0` / `0` |
| `MEMORY_STORAGE_SEGMENT_COUNT` | Integer 2 to 1024 (read at startup) | unset |

The complete list is in [CONFIGURATION.md](CONFIGURATION.md).

## Data Model

| Type | Required | Optional, most used |
|---|---|---|
| `Entity` | `name`, `entityType`, `observations` | `id`, `tags`, `importance`, `parentId`, `ttl`, `confidence`, `version`, `supersededBy`, `validFrom`, `validUntil`, `contentHash` |
| `Relation` | `from`, `to`, `relationType` | `createdAt`, `lastModified`, `validUntil` |
| `SearchResult` | `entity`, `score`, `matchedFields` | |
| `CentralityResult` | `scores`, `topEntities`, `algorithm` | |
| `GraphStats` | `totalEntities`, `totalRelations`, `entityTypesCounts`, `relationTypesCounts` | `oldestEntity`, `newestEntity` |

## Storage Files

| File | Purpose |
|---|---|
| `memory.jsonl` / `memory.db` | Main graph |
| `memory-saved-searches.jsonl`, `memory-tag-aliases.jsonl` | Saved searches, tag synonyms |
| `memory-audit.jsonl` | Audit trail (default; `MEMORY_AUDIT_LOG_FILE` overrides) |
| `memory-interactions.jsonl` | Interaction log (Recursa harness), with a blob directory |
| `.backups/` | Backups created by `createBackup()` |

## Common Commands

Run from the repository root:

- `bun install`, `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint`, `bun run bench`
- `bunx vitest run tests/examples` (the examples gate); `bunx tsc --noEmit -p tsconfig.examples.json`
- `bun run examples/01-quick-start.ts` runs one example.
