# MemoryJS Use Cases & Examples

> **Code samples.** Samples assume `const ctx = new ManagerContext('./memory.jsonl')` and the placeholders `graph: KnowledgeGraph` (from `await ctx.storage.loadGraph()`), `entities: Entity[]` and `storage: IGraphStorage`. Every other name in a sample is imported or declared in it.

**Verified against 4.5.0**

Complete applications built from MemoryJS. Each use case states the problem,
the design, and a working core. Every code block is type-checked against the
4.5.0 source, and each call was checked against its implementation. Import from `@danielsimonjr/memoryjs`. Snippets are short on
purpose; the runnable versions are in `examples/` (see the notes at the end of
each use case). For single-purpose patterns, see [RECIPES.md](./RECIPES.md).

---

## Table of Contents

**Core knowledge work**

1. [Personal Knowledge Base](#1-personal-knowledge-base)
2. [AI Chatbot Memory](#2-ai-chatbot-memory)
3. [Retrieval-Augmented Generation (RAG)](#3-retrieval-augmented-generation-rag)
4. [Research Note System](#4-research-note-system)
5. [Project Documentation Hub](#5-project-documentation-hub)
6. [Contact Relationship Manager](#6-contact-relationship-manager)
7. [Learning Progress Tracker](#7-learning-progress-tracker)
8. [Content Recommendation Engine](#8-content-recommendation-engine)
9. [Codebase Knowledge Graph](#9-codebase-knowledge-graph)
10. [Meeting Notes and Action Items](#10-meeting-notes-and-action-items)

**Agents, governance and advanced memory**

11. [Multi-Agent Collaborative Knowledge Base](#11-multi-agent-collaborative-knowledge-base)
12. [Time-Travel Knowledge Graph (Bitemporal)](#12-time-travel-knowledge-graph-bitemporal)
13. [Linked-Data Export to a Triplestore](#13-linked-data-export-to-a-triplestore)
14. [Causal Reasoning Engine](#14-causal-reasoning-engine)
15. [Procedural Memory for Agent Workflows](#15-procedural-memory-for-agent-workflows)
16. [Adaptive Retrieval](#16-adaptive-retrieval)
17. [PII-Aware Export](#17-pii-aware-export)
18. [Graph-Connectivity-Aware Retrieval](#18-graph-connectivity-aware-retrieval)
19. [Governed and Audited Agent Deployment](#19-governed-and-audited-agent-deployment)

**Self-improvement and harnesses (Recursa, `@experimental`)**

20. [Self-Improving Coding Agent](#20-self-improving-coding-agent)
21. [Harness Integration: Interaction Log and Tool Adapter](#21-harness-integration-interaction-log-and-tool-adapter)
22. [Evidence-Based QA over a Corpus](#22-evidence-based-qa-over-a-corpus)

[Summary table](#summary-table)

---

## 1. Personal Knowledge Base

A Zettelkasten-style notebook: notes are entities, links are relations.

### Setup and note creation

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function createNote(
  kb: ManagerContext,
  title: string,
  body: string,
  links: string[],
  tags: string[],
) {
  await kb.entityManager.createEntities([
    {
      name: title,
      entityType: 'note',
      observations: body.split('\n').map((l) => l.trim()).filter(Boolean),
      tags: ['note', ...tags],
      importance: 5,
    },
  ]);

  // Only link to notes that exist; a link to a missing name would dangle.
  const existing: string[] = [];
  for (const target of links) {
    if (await kb.entityManager.getEntity(target)) existing.push(target);
  }
  if (existing.length > 0) {
    await kb.relationManager.createRelations(
      existing.flatMap((target) => [
        { from: title, to: target, relationType: 'links_to' },
        { from: target, to: title, relationType: 'linked_from' },
      ]),
    );
  }
  return title;
}

// Usage
const kb = new ManagerContext('./knowledge-base.jsonl');
await createNote(
  kb,
  'TypeScript Generics',
  'Generics give type safety with flexibility.\nUse <T> to declare type parameters.',
  ['TypeScript Basics'],
  ['programming', 'typescript'],
);
```

### Finding related notes

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

async function relatedNotes(kb: ManagerContext, title: string): Promise<Entity[]> {
  const rels = await kb.relationManager.getRelations(title);
  const names = new Set(rels.map((r) => (r.from === title ? r.to : r.from)));
  const out: Entity[] = [];
  for (const name of names) {
    const note = await kb.entityManager.getEntity(name);
    if (note) out.push(note);
  }
  return out;
}

// Notes similar to a query, restricted to the 'note' type.
async function similarNotes(kb: ManagerContext, query: string) {
  const results = await kb.searchManager.searchNodesRanked(query, ['note'], undefined, undefined, 10);
  return results.filter((r) => r.score >= 0.3);
}
```

### Visualising the link graph

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function linkDiagram(kb: ManagerContext): Promise<string> {
  const graph = await kb.storage.loadGraph();
  const notes = {
    entities: graph.entities.filter((e) => e.tags?.includes('note')),
    relations: graph.relations.filter((r) => r.relationType === 'links_to'),
  };
  return kb.ioManager.exportGraph(notes, 'mermaid');
}
```

**Notes.** `exportGraph` is synchronous and takes a graph. Paste the Mermaid
output into any Mermaid renderer. Example: `examples/01-quick-start.ts` covers the
basic entity and relation calls used here.

---

## 2. AI Chatbot Memory

Persistent memory for a conversational assistant: a profile per user, topics and
preferences as linked entities, and a recall step that feeds the prompt.

### Memory class

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

export class ChatbotMemory {
  constructor(private readonly ctx: ManagerContext) {}

  private userName(userId: string) {
    return `user_${userId}`;
  }

  /** Create or extend the user's profile. */
  async rememberUser(userId: string, facts: string[]) {
    const name = this.userName(userId);
    const existing = await this.ctx.entityManager.getEntity(name);
    if (!existing) {
      await this.ctx.entityManager.createEntities([
        { name, entityType: 'user', observations: facts, tags: ['user', 'profile'], importance: 9 },
      ]);
      return;
    }
    const fresh = facts.filter((f) => !existing.observations.includes(f));
    if (fresh.length > 0) {
      await this.ctx.observationManager.addObservations([{ entityName: name, contents: fresh }]);
    }
  }

  /** Record a topic the user discussed and link it to them. */
  async rememberTopic(userId: string, topic: string, details: string[]) {
    const name = `topic_${userId}_${topic.replace(/\s+/g, '_')}`;
    await this.ctx.entityManager.createEntities([
      { name, entityType: 'conversation_topic', observations: details, tags: ['topic'], importance: 6 },
    ]);
    await this.ctx.relationManager.createRelations([
      { from: this.userName(userId), to: name, relationType: 'discussed' },
    ]);
  }

  /** Store one preference as its own entity, linked to the user. */
  async setPreference(userId: string, key: string, value: string) {
    const name = `pref_${userId}_${key}`;
    const existing = await this.ctx.entityManager.getEntity(name);
    if (existing) {
      // Replace the old value: drop it, then add the new one.
      await this.ctx.observationManager.deleteObservations([
        { entityName: name, observations: existing.observations },
      ]);
      await this.ctx.observationManager.addObservations([
        { entityName: name, contents: [`${key}: ${value}`] },
      ]);
      return;
    }
    await this.ctx.entityManager.createEntities([
      { name, entityType: 'preference', observations: [`${key}: ${value}`], tags: ['preference'], importance: 8 },
    ]);
    await this.ctx.relationManager.createRelations([
      { from: this.userName(userId), to: name, relationType: 'prefers' },
    ]);
  }

  /** Read preferences back as a key/value map. */
  async getPreferences(userId: string): Promise<Map<string, string>> {
    const prefs = new Map<string, string>();
    const rels = await this.ctx.relationManager.getRelations(this.userName(userId));
    for (const rel of rels.filter((r) => r.relationType === 'prefers' && r.from === this.userName(userId))) {
      const pref = await this.ctx.entityManager.getEntity(rel.to);
      const line = pref?.observations[0];
      if (line) {
        const idx = line.indexOf(': ');
        prefs.set(line.slice(0, idx), line.slice(idx + 2));
      }
    }
    return prefs;
  }

  /** Build the context block for the next model call. */
  async recall(userId: string, query: string): Promise<string> {
    const user: Entity | null = await this.ctx.entityManager.getEntity(this.userName(userId));
    const hits = await this.ctx.searchManager.searchNodesRanked(query, undefined, undefined, undefined, 5);

    const parts: string[] = [];
    if (user) parts.push(`User profile:\n${user.observations.map((o) => `- ${o}`).join('\n')}`);
    if (hits.length > 0) {
      parts.push(
        'Relevant memories:\n' +
          hits.map((h) => `[${h.entity.entityType}] ${h.entity.name}: ${h.entity.observations.join('; ')}`).join('\n'),
      );
    }
    return parts.join('\n\n');
  }
}

// Usage
const memory = new ChatbotMemory(new ManagerContext('./chatbot-memory.jsonl'));
await memory.rememberUser('alice123', ['Name: Alice', 'Software engineer', 'Prefers concise answers']);
await memory.setPreference('alice123', 'response_style', 'technical');
await memory.rememberTopic('alice123', 'React Hooks', ['Asked about useEffect cleanup']);
const context = await memory.recall('alice123', 'How do I use React hooks?');
```

**Notes.** For turn-level storage with deduplication and session turns, use
`ctx.memoryEngine.addTurn` (see [RECIPES.md](./RECIPES.md#turn-level-memory-with-deduplication)).
For a token-budgeted prefix across sessions, use `ctx.agentMemory().wakeUp()`.
Example: `examples/05-agent-memory.ts`.

---

## 3. Retrieval-Augmented Generation (RAG)

Chunk documents into entities, index them for semantic search, and answer with
the best chunks plus their source.

### Ingestion

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

function chunk(text: string, size = 800, overlap = 100): string[] {
  const out: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    out.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return out;
}

async function ingestDocument(ctx: ManagerContext, docId: string, text: string) {
  const chunks = chunk(text);
  const entities: Entity[] = chunks.map((c, i) => ({
    name: `${docId}#${String(i).padStart(3, '0')}`,
    entityType: 'chunk',
    observations: [c],
    tags: [docId],
    importance: 5,
  }));
  await ctx.entityManager.createEntities(entities);
  await ctx.relationManager.createRelations(
    entities.map((e) => ({ from: e.name, to: docId, relationType: 'part_of' })),
  );
  return entities.length;
}
```

Create the parent `docId` entity first (`entityType: 'document'`) so the
`part_of` relations point at something real.

### Retrieval

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function answerContext(ctx: ManagerContext, question: string) {
  // Semantic channel when embeddings are configured; lexical otherwise.
  const graph = await ctx.storage.loadGraph();
  if (ctx.semanticSearch) {
    const hits = await ctx.semanticSearch.search(graph, question, 5, 0.3);
    return hits.map((h) => ({ source: h.entity.name, score: h.similarity, text: h.entity.observations.join(' ') }));
  }
  const ranked = await ctx.searchManager.searchNodesRanked(question, ['chunk'], undefined, undefined, 5);
  return ranked.map((r) => ({ source: r.entity.name, score: r.score, text: r.entity.observations.join(' ') }));
}

function promptFor(question: string, hits: Array<{ source: string; text: string }>): string {
  const context = hits.map((h, i) => `[${i + 1}] (${h.source}) ${h.text}`).join('\n');
  return `Answer using only the sources below and cite them as [n].\n\n${context}\n\nQuestion: ${question}`;
}
```

### Configuring embeddings

`ctx.semanticSearch` is `null` when no embedding provider is available. Choose the
provider with `MEMORY_EMBEDDING_PROVIDER` (`local` by default, `openai`, `llamacpp`,
or `none`). The OpenAI key is read from `MEMORY_OPENAI_API_KEY`; `OPENAI_API_KEY`
is not used. To build the pieces yourself:

```typescript
import { createEmbeddingService, createVectorStore, SemanticSearch } from '@danielsimonjr/memoryjs';

// Returns null for provider 'none'; throws for 'openai' without MEMORY_OPENAI_API_KEY.
const embeddings = createEmbeddingService();
if (embeddings) {
  const semantic = new SemanticSearch(embeddings, createVectorStore('jsonl'));
  // indexAll(graph) / search(graph, query, limit, minSimilarity)
}
```

**Notes.** `search(graph, query, limit?, minSimilarity?)` takes the graph as its
first argument. Without embeddings, the lexical path above still works, and
`hybridSearchManager.search` blends both. Example: `examples/02-search.ts`.

---

## 4. Research Note System

Papers, authors and concepts as entities; citation and authorship as relations.
Find central papers and near-duplicate notes.

### Setup

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function addPaper(
  ctx: ManagerContext,
  p: { id: string; title: string; year: number; authors: string[]; cites?: string[] },
) {
  await ctx.entityManager.createEntities([
    {
      name: p.id,
      entityType: 'paper',
      observations: [p.title, `Year: ${p.year}`],
      tags: ['paper'],
      importance: 6,
    },
  ]);
  const rels = p.authors.map((a) => ({ from: a, to: p.id, relationType: 'authored' }));
  for (const c of p.cites ?? []) rels.push({ from: p.id, to: c, relationType: 'cites' });
  // Authors must exist before the relation is written.
  for (const a of p.authors) {
    if (!(await ctx.entityManager.getEntity(a))) {
      await ctx.entityManager.createEntities([{ name: a, entityType: 'author', observations: [] }]);
    }
  }
  await ctx.relationManager.createRelations(rels);
}
```

### Influence ranking and duplicates

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function influentialPapers(ctx: ManagerContext) {
  // PageRank over the whole graph; citations flow influence.
  const pr = await ctx.graphTraversal.calculatePageRank(0.85, 100, 1e-6, 10);
  return pr.topEntities.filter((e) => e.name.startsWith('paper-'));
}

async function possibleDuplicates(ctx: ManagerContext) {
  // Groups of paper names whose similarity is at least 0.9.
  return ctx.compressionManager.findDuplicates(0.9);
}
```

### Literature search

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function search(ctx: ManagerContext, query: string) {
  // Ranked over all entities; restrict to papers with the tag filter.
  const results = await ctx.searchManager.searchNodesRanked(query, ['paper'], undefined, undefined, 20);
  return results.map((r) => ({ id: r.entity.name, title: r.entity.observations[0], score: r.score }));
}
```

**Notes.** Keep paper ids stable (for example a DOI). `calculatePageRank` returns a
`CentralityResult`; `topEntities` is the ranked list. Example: `examples/03-graph-algorithms.ts`.

---

## 5. Project Documentation Hub

Documentation pages arranged in a hierarchy, with freshness tracking and a
Markdown export for publishing.

### Pages as a tree

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function createPage(ctx: ManagerContext, name: string, parent: string | null, body: string) {
  await ctx.entityManager.createEntities([
    {
      name,
      entityType: 'doc',
      observations: [body],
      tags: ['docs'],
      ttl: 90 * 24 * 60 * 60 * 1000, // milliseconds; the freshness report uses this
      confidence: 0.9,
    },
  ]);
  if (parent) await ctx.hierarchyManager.setEntityParent(name, parent);
}

async function setupDocs(ctx: ManagerContext) {
  await createPage(ctx, 'Guides', null, 'All guides');
  await createPage(ctx, 'Install', 'Guides', 'Install with bun install');
  await createPage(ctx, 'Configure', 'Guides', 'Set MEMORY_STORAGE_TYPE');
}
```

### Stale-doc report

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function staleDocs(ctx: ManagerContext) {
  const stale = await ctx.freshnessManager.getStaleEntities(ctx.storage);
  const expired = await ctx.freshnessManager.getExpiredEntities(ctx.storage);
  return {
    stale: stale.map((e) => e.name),
    expired: expired.map((e) => e.name),
  };
}

// Mark a page as reviewed: refresh its freshness clock.
async function markReviewed(ctx: ManagerContext, name: string) {
  return ctx.freshnessManager.refreshEntity(name, ctx.storage);
}
```

### Publish as Markdown

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { writeFileSync } from 'node:fs';

async function publish(ctx: ManagerContext, outPath: string) {
  const graph = await ctx.storage.loadGraph();
  const docs = {
    entities: graph.entities.filter((e) => e.entityType === 'doc'),
    relations: graph.relations,
  };
  writeFileSync(outPath, ctx.ioManager.exportGraph(docs, 'markdown'), 'utf8');
}
```

**Notes.** `refreshEntity` returns the updated entity. `getSubtree('Guides')`
returns the whole section as a `KnowledgeGraph`. Example: `examples/04-import-export.ts`.

---

## 6. Contact Relationship Manager

People and organisations with relations that change over time. Ending a role keeps
its history, so "who was their employer in March?" still has an answer.

### Contacts and roles

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function addContact(ctx: ManagerContext, name: string, email: string) {
  await ctx.entityManager.createEntities([
    { name, entityType: 'person', observations: [`Email: ${email}`], tags: ['contact'], importance: 5 },
  ]);
}

async function addRole(ctx: ManagerContext, person: string, org: string, startedAt: string) {
  // Create the org if needed, then link the person to it.
  if (!(await ctx.entityManager.getEntity(org))) {
    await ctx.entityManager.createEntities([{ name: org, entityType: 'org', observations: [] }]);
  }
  await ctx.relationManager.createRelations([
    { from: person, to: org, relationType: 'works_at', createdAt: startedAt },
  ]);
}

async function endRole(ctx: ManagerContext, person: string, org: string, endedAt: string) {
  await ctx.relationManager.invalidateRelation(person, 'works_at', org, endedAt);
}
```

### Querying history

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function employerOn(ctx: ManagerContext, person: string, date: string) {
  // Relations valid on the given date (outgoing from the person).
  const rels = await ctx.relationManager.queryAsOf(person, date, { direction: 'outgoing' });
  return rels.filter((r) => r.relationType === 'works_at').map((r) => r.to);
}

async function careerTimeline(ctx: ManagerContext, person: string) {
  return ctx.relationManager.timeline(person, { direction: 'outgoing' });
}
```

### Finding people

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function findContacts(ctx: ManagerContext, query: string) {
  // Fuzzy matching tolerates typos in names. The second argument is the threshold.
  const graph = await ctx.searchManager.fuzzySearch(query, 0.6, ['contact']);
  return graph.entities.map((e) => e.name);
}
```

**Notes.** `invalidateRelation(from, relationType, to, ended?)` takes the triple, not
a relation object. Example: `examples/08-versioning-causal.ts` covers the same
time-travel calls in more depth.

---

## 7. Learning Progress Tracker

Skills as entities, practice as observations, mastery as importance.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function addSkill(ctx: ManagerContext, skill: string, prerequisites: string[] = []) {
  await ctx.entityManager.createEntities([
    { name: skill, entityType: 'skill', observations: [], importance: 1, tags: ['learning'] },
  ]);
  if (prerequisites.length > 0) {
    await ctx.relationManager.createRelations(
      prerequisites.map((p) => ({ from: skill, to: p, relationType: 'requires' })),
    );
  }
}

async function logPractice(ctx: ManagerContext, skill: string, minutes: number, note: string) {
  const day = new Date().toISOString().slice(0, 10);
  await ctx.observationManager.addObservations([
    { entityName: skill, contents: [`${day}: ${minutes} min - ${note}`] },
  ]);
  // Mastery rises with practice, capped at 10.
  const current = (await ctx.entityManager.getEntity(skill))?.importance ?? 1;
  await ctx.entityManager.setImportance(skill, Math.min(10, current + minutes / 60));
}

async function readyToLearn(ctx: ManagerContext): Promise<string[]> {
  // A skill is ready when every prerequisite has importance >= 5.
  const graph = await ctx.storage.loadGraph();
  const ready: string[] = [];
  for (const e of graph.entities.filter((x) => x.tags?.includes('learning'))) {
    const reqs = graph.relations.filter((r) => r.from === e.name && r.relationType === 'requires');
    const done = reqs.every((r) => (graph.entities.find((x) => x.name === r.to)?.importance ?? 0) >= 5);
    if (done && (e.importance ?? 0) < 5) ready.push(e.name);
  }
  return ready;
}
```

**Notes.** `setImportance(name, value)` validates the 0-10 range. For a weekly
summary, combine `searchByTime('practice last week')` with the observations.

---

## 8. Content Recommendation Engine

Recommend items that match a user's interests, boosted by how central they are in
the graph.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function recommend(ctx: ManagerContext, userInterests: string, limit = 5) {
  // Lexical/TF-IDF ranking with a PageRank boost for hub items.
  ctx.rankedSearch.setGraphPrior(ctx.graphRankPrior, 0.3);
  const ranked = await ctx.searchManager.searchNodesRanked(userInterests, ['article'], undefined, undefined, limit);
  return ranked.map((r) => ({ id: r.entity.name, score: r.score }));
}

async function recordClick(ctx: ManagerContext, userId: string, articleId: string) {
  // Clicks become relations; the graph then carries the signal for ranking.
  await ctx.relationManager.createRelations([
    { from: `user_${userId}`, to: articleId, relationType: 'read', createdAt: new Date().toISOString() },
  ]);
}
```

**Notes.** `setGraphPrior` is the code form of `MEMORY_RANKED_GRAPH_BOOST`. The
prior is cached and invalidated on graph changes. For semantic recommendations, use
`hybridSearchManager.search` with an embedding provider (see
[RECIPES.md](./RECIPES.md#hybrid-search-semantic--lexical--symbolic)).

---

## 9. Codebase Knowledge Graph

Modules, functions and their calls as a graph, built from a JSON export of your
own analysis tool, then queried for dependency paths.

### Loading the graph

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { readFileSync } from 'node:fs';

async function loadCodeGraph(ctx: ManagerContext, jsonPath: string) {
  // The file is a MemoryJS JSON export: { entities: [...], relations: [...] }.
  const data = readFileSync(jsonPath, 'utf8');
  const preview = await ctx.ioManager.importGraph('json', data, 'merge', true);
  if (preview.errors.length > 0) throw new Error(preview.errors.join('; '));
  return ctx.ioManager.importGraph('json', data, 'merge', false);
}
```

### Dependency questions

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function dependencyPath(ctx: ManagerContext, from: string, to: string) {
  const path = await ctx.graphTraversal.findShortestPath(from, to);
  return path?.path ?? null;
}

async function hubModules(ctx: ManagerContext) {
  // Degree centrality over 'in' edges: the most depended-upon modules.
  const c = await ctx.graphTraversal.calculateDegreeCentrality('in', 10);
  return c.topEntities;
}

async function clusters(ctx: ManagerContext) {
  const cc = await ctx.graphTraversal.findConnectedComponents();
  return { count: cc.count, largest: cc.largestComponentSize };
}
```

### Impact of a change

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

async function impactOf(ctx: ManagerContext, moduleName: string): Promise<Entity[]> {
  // Everything that transitively depends on the module.
  const dependents = await ctx.hierarchyManager.getDescendants(moduleName);
  return dependents;
}
```

**Notes.** `getDescendants` follows `parentId`. For call graphs that are not a tree,
walk `getRelations` instead (see the relation recipes). Example:
`examples/03-graph-algorithms.ts`.

---

## 10. Meeting Notes and Action Items

Turn a transcript into a summary entity, decisions and action items as events, and
a per-person view of what each person committed to.

### Ingesting a transcript

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function ingestMeeting(ctx: ManagerContext, meetingId: string, transcript: string) {
  // ingest() splits a conversation into chunks and writes entities and a manifest.
  return ctx.ioManager.ingest(
    {
      messages: transcript.split('\n').map((line) => {
        const [speaker, ...rest] = line.split(':');
        return { role: 'user' as const, content: rest.join(':').trim(), metadata: { speaker: speaker?.trim() } };
      }),
      source: meetingId,
    },
    { entityType: 'meeting_note', tags: ['meeting', meetingId], chunkBy: 'exchange' },
  );
}
```

### Action items as events

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function recordActionItem(
  ctx: ManagerContext,
  meetingId: string,
  owner: string,
  task: string,
  due: string,
) {
  await ctx.eventManager.recordEvent({
    action: 'committed',
    actor: owner,
    target: task,
    context: meetingId,
    flowKey: meetingId,
    occurredAt: due,
    detail: `Due ${due}`,
  });
}

async function whatDidOwnerCommit(ctx: ManagerContext, owner: string) {
  // Events recorded with this person as the actor.
  return ctx.eventManager.queryEvents({ actor: owner, action: 'committed' });
}
```

**Notes.** `ingest` returns `{ entitiesCreated, observationsAdded, skippedDuplicates,
ingestId, manifestEntity, chunkCount, ... }`. Pass `dryRun: true` to preview the
counts first. The event API is covered in
[RECIPES.md](./RECIPES.md#event-timeline-experimental).

---

## 11. Multi-Agent Collaborative Knowledge Base

Several agents write to one graph. Every write names the agent that made it, and
updates use optimistic concurrency so a stale write fails instead of overwriting.

```typescript
import {
  ManagerContext,
  CollaborationAuditEnforcer,
  AuditLog,
  VersionConflictError,
} from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./shared-kb.jsonl');
const enforcer = new CollaborationAuditEnforcer(
  ctx.entityManager,
  new AuditLog('./shared-kb-audit.jsonl'),
  { mode: 'strict' }, // a missing agentId throws AttributionRequiredError
);

export async function addFact(name: string, fact: string, agentId: string) {
  const existing = await ctx.entityManager.getEntity(name);
  if (!existing) {
    await enforcer.createEntities([{ name, entityType: 'person', observations: [fact] }], agentId);
    return;
  }
  await enforcer.updateEntity(
    name,
    { observations: [...existing.observations, fact] },
    agentId,
    { expectedVersion: existing.version ?? 1 },
  );
}

// Two agents read version 1; the second writer gets a conflict and re-reads.
export async function safeAddFact(name: string, fact: string, agentId: string) {
  try {
    await addFact(name, fact, agentId);
    return 'written';
  } catch (err) {
    if (err instanceof VersionConflictError) return 'retry';
    throw err;
  }
}
```

**Notes.** `VersionConflictError` is exported from the package root; match it with
`instanceof` as shown (see [RECIPES.md](./RECIPES.md#catch-the-typed-errors)). `AuditLog`
records every attributed operation in the file you pass. Example:
`examples/07-governance-rbac.ts` shows attribution and the enforcer in context.

---

## 12. Time-Travel Knowledge Graph (Bitemporal)

For facts that change over time: legal records, employment, configuration. Entities
and observations can be ended and queried as of a date; relations too (see
[use case 6](#6-contact-relationship-manager)).

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function history(ctx: ManagerContext) {
  await ctx.entityManager.createEntities([
    { name: 'Acme-HQ', entityType: 'location', observations: ['100 Main St, San Francisco'] },
  ]);

  // Replace the address: add the new fact, end the old one at the change date.
  await ctx.observationManager.addObservations([
    { entityName: 'Acme-HQ', contents: ['500 Market St, San Francisco'] },
  ]);
  await ctx.observationManager.invalidateObservation(
    'Acme-HQ',
    '100 Main St, San Francisco',
    '2024-01-01T00:00:00Z',
  );

  // As-of queries: observations valid at the given instant.
  const in2022 = await ctx.observationManager.observationsAsOf('Acme-HQ', '2022-06-15T00:00:00Z');
  const in2025 = await ctx.observationManager.observationsAsOf('Acme-HQ', '2025-06-15T00:00:00Z');

  // Entity-level: end the entity and read its timeline.
  const timeline = await ctx.entityManager.entityTimeline('Acme-HQ');
  return { in2022, in2025, timeline };
}
```

**Notes.** `invalidateEntity(name, ended?)` ends an entity; `entityAsOf` returns it as
it stood on a date, or `null` after it ended. The check that `asOf` is an ISO date
applies to the relation API. Example: `examples/08-versioning-causal.ts`.

---

## 13. Linked-Data Export to a Triplestore

Export the graph to W3C formats for Apache Jena, Blazegraph, GraphDB and similar.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { writeFileSync } from 'node:fs';

async function exportLinkedData(ctx: ManagerContext) {
  const graph = await ctx.storage.loadGraph();
  writeFileSync('export.ttl', ctx.ioManager.exportGraph(graph, 'turtle'), 'utf8');
  writeFileSync('export.rdf', ctx.ioManager.exportGraph(graph, 'rdf-xml'), 'utf8');
  writeFileSync('export.jsonld', ctx.ioManager.exportGraph(graph, 'json-ld'), 'utf8');
}
```

**Notes.** IRIs use `urn:memoryjs:entity:<percent-encoded-name>`. Relation types
that are valid NCNames become direct property triples; other relation types are
reified with `rdf:Statement`. Example: `examples/04-import-export.ts`.

---

## 14. Causal Reasoning Engine

Model cause and effect as relations with a strength, then ask "what causes this?"
and "what if this link were gone?".

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function buildCausalModel(ctx: ManagerContext) {
  await ctx.entityManager.createEntities([
    { name: 'high-disk-io', entityType: 'metric', observations: [] },
    { name: 'page-faults', entityType: 'symptom', observations: [] },
    { name: 'app-slowness', entityType: 'symptom', observations: [] },
  ]);
  await ctx.relationManager.createRelations([
    { from: 'high-disk-io', to: 'page-faults', relationType: 'causes', metadata: { causalStrength: 0.85 } },
    { from: 'page-faults', to: 'app-slowness', relationType: 'causes', metadata: { causalStrength: 0.7 } },
  ]);
}

async function explain(ctx: ManagerContext) {
  // Which candidates lead to the effect? Each chain has a path and a score.
  const causes = await ctx.causalReasoner.findCauses(
    'app-slowness',
    ['high-disk-io', 'memory-pressure', 'network-congestion'],
  );
  // Counterfactual: drop one link and see which chains survive.
  const without = await ctx.causalReasoner.counterfactual({
    seed: 'high-disk-io',
    removeFrom: 'high-disk-io',
    removeTo: 'page-faults',
    predict: 'app-slowness',
  });
  return {
    best: causes[0]?.path,
    bestScore: causes[0]?.score,
    survivingAfterRemoval: without.length,
  };
}
```

**Notes.** `findEffects` runs the other direction. `detectCycles(seed)` finds feedback
loops, which matter for causal claims. Example: `examples/08-versioning-causal.ts`.

---

## 15. Procedural Memory for Agent Workflows

Agents store multi-step procedures, match them to a request, step through them, and
refine each procedure's success rate from outcomes.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function onboardingFlow(ctx: ManagerContext) {
  const onboarding = await ctx.procedureManager.addProcedure({
    name: 'employee-onboarding',
    description: 'Send welcome packet, create accounts, schedule intro meeting',
    steps: [
      { order: 1, action: 'send-email', parameters: { template: 'welcome' } },
      { order: 2, action: 'create-account', parameters: { system: 'sso' } },
      { order: 3, action: 'create-account', parameters: { system: 'jira' } },
      { order: 4, action: 'schedule-meeting', parameters: { type: 'intro' } },
    ],
    triggers: ['new hire', 'onboard'],
  });

  // Which stored procedures fit this request?
  const matches = await ctx.procedureManager.matchProcedure(
    'we need to onboard a new engineer starting Monday',
    [onboarding],
  );

  // Walk the steps, falling back when a step fails.
  const seq = await ctx.procedureManager.openSequencer(onboarding.id);
  let failed = false;
  while (seq && !seq.isComplete()) {
    const step = seq.current();
    if (!step) break;
    try {
      await runStep(step.action, step.parameters); // your executor
      seq.next();
    } catch {
      if (step.fallback) seq.branchToFallback();
      else { failed = true; break; }
    }
  }

  // Feed the outcome back; the success rate moves by an exponentially weighted average.
  await ctx.procedureManager.refineProcedure(onboarding.id, { succeeded: !failed });
  return matches;
}

async function runStep(action: string, parameters: Record<string, string>): Promise<void> {
  void action;
  void parameters;
}
```

**Notes.** `getNextStep(id, order)` reads a step without advancing a sequencer.
Example: `examples/14-procedural-graph.ts` builds the procedural graph that powers
the same flow.

---

## 16. Adaptive Retrieval

When one search leaves gaps, run more rounds with query expansion until coverage is
good enough or the token budget is spent.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function retrieveUntilCovered(ctx: ManagerContext, query: string, task?: string) {
  const decision = ctx.activeRetrieval.shouldRetrieve({ query, task });
  if (!decision.retrieve) return { skipped: true as const };

  const result = await ctx.activeRetrieval.adaptiveRetrieve({
    query,
    task,
    budgetTokens: 2000,
  });

  return {
    skipped: false as const,
    bestCoverage: result.bestCoverage,
    rounds: result.rounds.map((r) => ({ query: r.query, coverage: r.coverage })),
    results: result.bestResults.map((r) => ({ name: r.entity.name, score: r.score })),
  };
}
```

**Notes.** The expansion is symbolic (token overlap), with no LLM call. Use
`shouldRetrieve` to skip the loop for queries that already match well.

---

## 17. PII-Aware Export

For exports that leave your trust boundary: scrub personal data from the output
without changing what is stored.

```typescript
import { ManagerContext, PiiRedactor } from '@danielsimonjr/memoryjs';

async function cleanExport(ctx: ManagerContext) {
  const redactor = new PiiRedactor({
    additionalPatterns: [{ name: 'license', regex: /\bDL\d{8}\b/g, replacement: '<DL>' }],
  });

  const graph = await ctx.storage.loadGraph();
  const clean = redactor.redactGraph(graph); // returns a copy; storage is unchanged

  // Counts per pattern, without the values.
  const sample = redactor.redactWithStats('Contact alice@example.com about DL12345678');
  return {
    json: ctx.ioManager.exportGraph(clean, 'json'),
    redactedBytes: sample.stats.totalRedactedBytes,
  };
}
```

**Notes.** The bundled patterns cover common email, SSN, card, phone and IPv4 shapes.
`exportGraph(graph, format, { redactPii: true })` applies the same redaction for you.
Example: `examples/07-governance-rbac.ts` shows the redactor alongside governance.

---

## 18. Graph-Connectivity-Aware Retrieval

Bias results toward well-connected entities (the canonical page, not a passing
mention) and pull in their close neighbours.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function authSearch(ctx: ManagerContext) {
  const graph = await ctx.storage.loadGraph();
  const results = await ctx.hybridSearchManager.search(graph, 'authentication flow', {
    semanticWeight: 0.4,
    lexicalWeight: 0.4,
    symbolicWeight: 0.2,
    graphWeight: 0.15,                      // normalised-PageRank channel
    expandNeighbors: { hops: 1, topK: 10 }, // add neighbours of the top results
  });
  return results.map((r) => ({ name: r.entity.name, combined: r.scores.combined }));
}
```

**Notes.** Both knobs are off by default. Set `MEMORY_HYBRID_GRAPH_WEIGHT` to make
the channel the default. The prior invalidates itself when the graph changes, so you do not clear it by hand. Simpler option:
`ctx.rankedSearch.setGraphPrior(ctx.graphRankPrior, boost)` for ranked search only.

---

## 19. Governed and Audited Agent Deployment

A multi-tenant deployment where every write is policy-checked, every allowed write is
audited, and a compliance reviewer can verify the trail from the command line.

```typescript
import { ManagerContext, GovernanceError, RoleAssignmentStore, RbacMiddleware } from '@danielsimonjr/memoryjs';

// Governance is wired into EntityManager only when this is the strict literal 'true'.
process.env.MEMORY_GOVERNANCE_ENABLED = 'true';

export async function tenantContext() {
  const ctx = new ManagerContext('./tenant-acme.jsonl');

  const roles = new RoleAssignmentStore({ persistencePath: './tenant-acme-roles.jsonl' });
  await roles.hydrate();
  await roles.assign({ agentId: 'agent-alice', role: 'writer' });
  const rbac = new RbacMiddleware(roles);

  ctx.governanceManager.setPolicy({
    canCreate: () => rbac.checkPermission('agent-alice', 'write', 'entity'),
    canUpdate: (entity) => rbac.checkPermission('agent-alice', 'write', 'entity', entity.name),
    canDelete: (entity) =>
      rbac.checkPermission('agent-alice', 'delete', 'entity', entity.name) && (entity.importance ?? 0) < 8,
  });

  return ctx;
}

export async function demo(ctx: ManagerContext) {
  await ctx.entityManager.createEntities([
    { name: 'customer-ticket-9821', entityType: 'ticket', observations: ['Refund requested'] },
  ]);
  try {
    await ctx.entityManager.deleteEntities(['customer-ticket-9821']);
  } catch (err) {
    if (err instanceof GovernanceError) {
      // Denied: nothing was written and no committed audit entry was made.
    } else {
      throw err;
    }
  }
}
```

A compliance reviewer checks the trail without application code:

```bash
memory audit verify --file ./tenant-acme-audit.jsonl   # non-zero exit if the chain is broken
memory audit log --entity customer-ticket-9821 --json  # full provenance for one entity
memory audit stats                                     # entry counts by operation
```

**Notes.** `GovernanceError` marks a denied write; the policy runs before the
storage change. Audit entries form a hash chain (`seq` plus `prevHash`), so an edited
or removed line breaks verification. Point `MEMORY_AUDIT_LOG_FILE` at write-once
storage for a stronger guarantee than a local sidecar. Example:
`examples/07-governance-rbac.ts`.

---

## 20. Self-Improving Coding Agent

*`@experimental`.* An agent that learns from its own failures. Each task has a rubric.
When the agent fails a task, the learning loop diagnoses why, writes a skill that
addresses it, republishes the skill as `SKILL.md`, and re-checks the tasks. Skills
learned in one run are loaded into the solver's context in the next.

```typescript
import { ManagerContext, DeterministicJudge, type LearningSolver, type TaskRecord } from '@danielsimonjr/memoryjs';

const tasks: TaskRecord[] = [
  {
    id: 'pagination-default-size',
    input: 'What is the default page size for list endpoints?',
    category: 'api',
    rubric: [{ id: 'size', text: 'states 50', kind: 'fact', expected: '50' }],
  },
  {
    id: 'retry-limit',
    input: 'How many times does the client retry a 503 response?',
    category: 'api',
    rubric: [{ id: 'retries', text: 'states 3', kind: 'number', expected: 3 }],
  },
];

// The solver is your model call. It receives the knowledge loaded for each task.
const solver: LearningSolver = {
  async solve(task, knowledge) {
    // Replace with: model.complete({ system: knowledge.markdown, user: task.input })
    const expected = String(task.rubric[0]?.expected ?? '');
    const answer = knowledge.markdown.includes(expected) ? expected : 'unknown';
    return { answer, traceAddrs: [] };
  },
};

export async function improve(ctx: ManagerContext, publishDir: string) {
  const loop = ctx.learningLoop({
    solver,
    judge: new DeterministicJudge(),
    publishDir,
    sessionId: 'coding-agent-2026-11',
  });

  const result = await loop.learn({
    taskIds: tasks.map((t) => t.id),
    tasks,
    budget: { maxRounds: 3 },
  });

  return {
    traceId: result.traceId,
    stoppedBecause: result.stoppedBecause,
    passedBefore: result.before.allPass,
    passedAfter: result.after.allPass,
  };
}

// Next session: load what was learned for the current task.
export async function nextSession(ctx: ManagerContext, task: string) {
  const knowledge = await ctx.knowledgeRepository.loadForContext({ role: 'solver', taskHint: task });
  return knowledge.markdown;
}
```

**How it works.**

- The **judge** scores each answer against the rubric. `DeterministicJudge` handles
  `fact`, `number` and `set-*` criteria; use `LLMRubricJudge` for `free` criteria.
- **Diagnosis** classifies each failure (for example missing knowledge) and writes it
  to the failure store. **Editing** turns diagnoses into one revision, which is
  validated on a scratch copy before it is applied. A revision that fixes nothing or
  breaks a passing task is rejected.
- Accepted skills are published under `publishDir` as `SKILL.md`, which other tools
  and reviewers can read.
- `result.before` and `result.after` are the metrics before and after the run.
  `result.report` carries the accounting for the run when it is present.

**Notes.** Small task sets run the leaf learner. Above
`MEMORY_LEARNING_LEAF_THRESHOLD` (default 20) the recursive learner splits the tasks by
category, learns each part, and merges the revisions. To see why a solver failed,
pass an `interactionLog` (use case 21). Example:
`examples/09-recursa-skills-knowledge.ts` and `examples/10-recursa-learning.ts`.

---

## 21. Harness Integration: Interaction Log and Tool Adapter

*`@experimental`.* An agent harness that records every model call and tool call to
an append-only log, and exposes the Recursa operations to the model as tools.

### Recording the session

```typescript
import { ManagerContext, InteractionLog } from '@danielsimonjr/memoryjs';

export async function openSession(ctx: ManagerContext, sessionId: string) {
  // Sidecar file: <basename>-interactions.jsonl next to the path you pass.
  const log = new InteractionLog('./agent.jsonl');

  // Tool calls made through the observer are appended automatically.
  ctx.toolCallObserver.setInteractionLog(log, sessionId);

  // Model turns and notes are written explicitly.
  const addr = await log.append({
    sessionId,
    kind: 'model',
    content: 'Planned: read the config, then run the migration.',
  });
  return { log, firstAddr: addr };
}
```

Each record gets an address (`e<n>`). Large content spills to a blob file, so the
log stays small. `log.select(addr, { regex })` returns a bounded excerpt around
matches, and `log.search(query)` ranks records by similarity.

### Exposing the Recursa tools

```typescript
import { ManagerContext, createRecursaTools, InteractionLog } from '@danielsimonjr/memoryjs';

export function harnessTools(ctx: ManagerContext, log: InteractionLog) {
  const tools = createRecursaTools(ctx, {
    publishDir: './published-skills',
    interactionLog: log,
    maxBytes: 64 * 1024, // results are bounded; long outputs are truncated
  });

  // Descriptors for the model's tool list, and a single entry point.
  return {
    descriptors: tools.list(),
    run: (name: string, args: unknown) => tools.call(name, args),
  };
}
```

`call` never throws. It returns `{ ok: true, result }` or
`{ ok: false, error: { code, message } }`. Codes include `invalid_args`,
`not_found`, `not_configured` (a dependency such as `publishDir` is missing) and
`aborted`. See [RECIPES.md](./RECIPES.md#wire-the-recursa-tools-into-an-mcp-server-shape-only)
for the MCP registration shape. Example: `examples/12-harness-tools.ts`.

**Notes.** The log is single-process: one writer per file. Address the solver's
trace from the learning loop by passing the same `interactionLog` to
`ctx.learningLoop` (use case 20), so diagnosis reads the real steps.

---

## 22. Evidence-Based QA over a Corpus

*`@experimental`.* Answer questions over a document folder with citations. The
bootstrapper maps the corpus, writes exploration notes, and creates practice
questions. Reconstructive memory answers questions by rebuilding the relevant
evidence from the conversation graph.

### Mapping the corpus

```typescript
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManagerContext, type CorpusSource } from '@danielsimonjr/memoryjs';

function corpusFrom(dir: string): CorpusSource[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ ref: f, title: f, text: readFileSync(join(dir, f), 'utf8') }));
}

export async function mapCorpus(ctx: ManagerContext, dir: string) {
  const boot = await ctx.bootstrapper({ learning: { publishDir: './published-skills' } }).run({
    sources: corpusFrom(dir),
    corpusLabel: 'handbook',
    budget: { maxRounds: 1 },
  });
  return { practiceQuestions: boot.taskIds.length, notesSkillId: boot.notesSkillId };
}
```

### Answering with citations

```typescript
import { ManagerContext, type DialogueTurn } from '@danielsimonjr/memoryjs';

export async function ask(ctx: ManagerContext, question: string, turns: DialogueTurn[]) {
  const memory = ctx.reconstructiveMemory();
  await memory.ingest(turns); // turns from the conversation or from the corpus sections

  const result = await memory.reconstruct(question, { maxSteps: 4, evidenceTarget: 3 });
  return {
    answer: result.answer ?? 'No answer found in the corpus.',
    confidence: result.confidence ?? 0,
    // Citations: the evidence node ids and the text that supports the answer.
    citations: result.evidence.map((e) => ({ id: e.id, layer: e.layer, text: e.text })),
    stoppedEarly: result.stoppedEarly,
  };
}
```

**How it works.**

- The bootstrapper's **notes** give the solver a map of the corpus; its **practice
  questions** are tasks with rubrics, so the same learning loop from use case 20 can
  check answer quality over time.
- **Reconstruction** links episodes, facts and topics in a cue-tag-content graph and
  walks it step by step, collecting evidence until `evidenceTarget` is reached or
  `maxSteps` runs out. An empty answer means the evidence did not reach the question;
  treat it as "not in the corpus", not as a failure to retrieve.
- Without an `llmProvider`, extraction and answering use deterministic heuristics.
  Add one in the config to use the paper's prompts.

**Notes.** Both stages are `@experimental`, so pin the version when you depend on the
exact answer text. Example: `examples/11-recursa-bootstrap.ts` and
`examples/13-reconstructive-memory.ts`.

---

## Summary table

| # | Use case | Main surface | Stability |
|---|----------|--------------|-----------|
| 1 | Personal knowledge base | entities, relations, mermaid export | stable |
| 2 | Chatbot memory | entities, observations, ranked search | stable |
| 3 | RAG | chunk entities, `semanticSearch` or ranked search | stable (embeddings optional) |
| 4 | Research notes | PageRank, `findDuplicates` | stable |
| 5 | Documentation hub | hierarchy, freshness, markdown export | stable |
| 6 | Contact manager | relations, `invalidateRelation`, `queryAsOf` | stable |
| 7 | Learning tracker | importance, prerequisite relations | stable |
| 8 | Recommendations | ranked search with graph prior | stable |
| 9 | Codebase graph | JSON import, shortest path, centrality | stable |
| 10 | Meeting notes | `ingest`, `eventManager` | stable |
| 11 | Multi-agent KB | `CollaborationAuditEnforcer`, OCC | stable |
| 12 | Bitemporal history | `invalidateObservation`, `entityAsOf` | stable |
| 13 | Linked-data export | turtle, rdf-xml, json-ld | stable |
| 14 | Causal reasoning | `causalReasoner` | stable |
| 15 | Procedural memory | `procedureManager`, `StepSequencer` | stable |
| 16 | Adaptive retrieval | `activeRetrieval` | stable |
| 17 | PII-aware export | `PiiRedactor`, `redactPii` | stable |
| 18 | Graph-aware retrieval | hybrid `graphWeight`, `expandNeighbors` | opt-in |
| 19 | Governed deployment | governance policy, RBAC, `memory audit` | stable |
| 20 | Self-improving agent | `learningLoop`, `skillPublisher` | `@experimental` |
| 21 | Harness integration | `InteractionLog`, `createRecursaTools` | `@experimental` |
| 22 | Evidence-based QA | `bootstrapper`, `reconstructiveMemory` | `@experimental` |
