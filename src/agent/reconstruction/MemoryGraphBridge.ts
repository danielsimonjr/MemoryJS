/**
 * Bridge between the Cue–Tag–Content graph and MemoryJS's live memory modules.
 *
 * The paper organises memory into multi-granular layers (episodic / semantic /
 * topic) that mirror cognitive memory types (§3.2). MemoryJS already implements
 * those types, so the bridge persists each CTC content node into the
 * corresponding module so reconstructed memory is durable and visible to the
 * rest of the stack:
 *
 *   - **Episodic** → first-class `memoryType: 'episodic'` entities stamped with
 *     the conversation timestamp, so they land on the
 *     {@link EpisodicMemoryManager} timeline and are temporally linked
 *     (`precedes`/`follows`).
 *   - **Semantic** → `memoryType: 'semantic'` fact entities anchored to their
 *     person entity via a typed relation, and indexed for `SemanticSearch`.
 *   - **Topic** → topic entities linked to their constituent episodes via a
 *     `summarizes` relation (queryable through `GraphTraversal`).
 *
 * The bridge writes through narrow structural interfaces so it can be driven by
 * the real `ManagerContext` managers or by fakes in tests.
 *
 * @module agent/reconstruction/MemoryGraphBridge
 * @experimental
 */

import type { Entity, Relation } from '../../types/types.js';
import type { AgentEntity } from '../../types/agent-memory.js';
import { EpisodicRelations } from '../EpisodicMemoryManager.js';
import type { DistillationResult } from '../../types/reconstruction.js';
import { CueTagContentGraph, normalizeKey } from './CueTagContentGraph.js';

/** Relation type connecting a topic entity to one of its episodes. */
export const TOPIC_SUMMARIZES = 'summarizes';

/**
 * The live-store dependencies the bridge writes through. Satisfied by the
 * `ManagerContext` managers (`entityManager`, `relationManager`,
 * `semanticSearch`) or by test doubles.
 */
export interface ReconstructiveBacking {
  /** Persist entities (existing names are skipped by `EntityManager`). */
  createEntities(entities: Entity[]): Promise<unknown>;
  /** Persist relations. */
  createRelations(relations: Relation[]): Promise<unknown>;
  /** Optional semantic similarity in `[0, 1]` for routing/answer ranking. */
  similarity?(a: string, b: string): Promise<number>;
  /** Optional: index a freshly-created entity for semantic search. */
  indexEntity?(entity: Entity): Promise<unknown>;
  /** Session id used to scope episodes onto the timeline. Default `mragent`. */
  sessionId?: string;
}

/** Summary of what a {@link MemoryGraphBridge.persist} call wrote. */
export interface BridgePersistResult {
  episodes: number;
  semanticFacts: number;
  topics: number;
  relations: number;
}

/** Convert a possibly-partial date to an ISO datetime, offset to keep order. */
function toIso(date: string | undefined, orderOffsetMs: number): string {
  const base = date ? new Date(date) : new Date(0);
  const ms = Number.isNaN(base.getTime()) ? orderOffsetMs : base.getTime() + orderOffsetMs;
  return new Date(ms).toISOString();
}

/** Make a string safe to embed in an entity name / relation type. */
function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export class MemoryGraphBridge {
  private readonly sessionId: string;

  constructor(private readonly backing: ReconstructiveBacking) {
    this.sessionId = backing.sessionId ?? 'mragent';
  }

  /** The session id episodes are written under (use with `getTimeline`). */
  get session(): string {
    return this.sessionId;
  }

  /**
   * Persist a distillation result into the live store and annotate the in-memory
   * graph's content nodes with their backing entity names.
   */
  async persist(result: DistillationResult, graph: CueTagContentGraph): Promise<BridgePersistResult> {
    const prefix = `mragent-${slug(this.sessionId)}`;
    const entities: AgentEntity[] = [];
    const relations: Relation[] = [];
    const persons = new Set<string>();

    // ---- Topic abstraction layer ----
    const topicEntityName = new Map<string, string>();
    for (const [topicId, description] of Object.entries(result.topics)) {
      const name = `${prefix}-topic-${slug(topicId)}`;
      topicEntityName.set(topicId, name);
      entities.push(agentEntity(name, 'topic', description, 'semantic'));
      annotate(graph, topicId, name);
    }

    // ---- Episodic layer (timeline + temporal links) ----
    const ordered = [...result.sentences].sort((a, b) =>
      (a.time ?? '').localeCompare(b.time ?? ''),
    );
    let previousEpisode: string | undefined;
    ordered.forEach((sentence, idx) => {
      const name = `${prefix}-ep-${slug(sentence.id)}`;
      const cues = result.keywords[sentence.id] ?? [];
      const ep = agentEntity(name, 'episode', sentence.text, 'episodic', {
        sessionId: this.sessionId,
        createdAt: toIso(sentence.time ?? result.conversationTime, idx * 1000),
        tags: cues,
      });
      entities.push(ep);
      annotate(graph, sentence.id, name);

      // Topic → episode links.
      for (const topicId of sentence.topics ?? []) {
        const topicName = topicEntityName.get(topicId);
        if (topicName) {
          relations.push({ from: topicName, to: name, relationType: TOPIC_SUMMARIZES });
        }
      }

      // Unified timeline: link consecutive episodes (precedes/follows).
      if (previousEpisode) {
        relations.push({ from: previousEpisode, to: name, relationType: EpisodicRelations.PRECEDES });
        relations.push({ from: name, to: previousEpisode, relationType: EpisodicRelations.FOLLOWS });
      }
      previousEpisode = name;
    });

    // ---- Semantic layer (person-anchored facts + SemanticSearch) ----
    for (const fact of result.personalFacts) {
      const name = `${prefix}-fact-${slug(fact.id)}`;
      entities.push(agentEntity(name, 'semantic_fact', fact.text, 'semantic', {
        tags: [fact.person, fact.tag],
      }));
      annotate(graph, fact.id, name);

      const personName = fact.person?.trim();
      if (personName) {
        persons.add(personName);
        relations.push({
          from: personName,
          to: name,
          relationType: `has_${slug(fact.tag) || 'attribute'}`,
        });
      }
    }

    // Ensure anchor person entities exist (createEntities skips duplicates).
    for (const person of persons) {
      entities.push(agentEntity(person, 'person', `Person: ${person}`, 'semantic'));
    }

    // ---- Commit ----
    if (entities.length) await this.backing.createEntities(entities as Entity[]);
    if (relations.length) await this.backing.createRelations(relations);

    // Index episodic + semantic content for semantic search.
    if (this.backing.indexEntity) {
      for (const e of entities) {
        if (e.memoryType === 'episodic' || e.entityType === 'semantic_fact') {
          try {
            await this.backing.indexEntity(e as Entity);
          } catch {
            // Indexing is best-effort; lexical routing remains available.
          }
        }
      }
    }

    return {
      episodes: ordered.length,
      semanticFacts: result.personalFacts.length,
      topics: Object.keys(result.topics).length,
      relations: relations.length,
    };
  }
}

/** Annotate a graph content node with its backing entity name (best-effort). */
function annotate(graph: CueTagContentGraph, contentId: string, entityName: string): void {
  const node = graph.getContent(contentId);
  if (node) node.entityName = entityName;
}

/** Build an `AgentEntity` for a CTC content node. */
function agentEntity(
  name: string,
  entityType: string,
  content: string,
  memoryType: 'episodic' | 'semantic',
  extra?: { sessionId?: string; createdAt?: string; tags?: string[] },
): AgentEntity {
  return {
    name,
    entityType,
    observations: [content],
    memoryType,
    accessCount: 0,
    confirmationCount: 0,
    visibility: 'private',
    importance: memoryType === 'semantic' ? 6 : 5,
    confidence: 0.8,
    sessionId: extra?.sessionId,
    createdAt: extra?.createdAt,
    tags: extra?.tags && extra.tags.length ? dedupeTags(extra.tags) : undefined,
  };
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const key = normalizeKey(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
