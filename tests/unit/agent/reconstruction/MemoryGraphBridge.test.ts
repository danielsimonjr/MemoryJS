import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { ReconstructiveMemory } from '../../../../src/agent/reconstruction/ReconstructiveMemory.js';
import { MemoryGraphBridge } from '../../../../src/agent/reconstruction/MemoryGraphBridge.js';
import type { Entity, Relation } from '../../../../src/types/types.js';
import type { DialogueTurn } from '../../../../src/types/reconstruction.js';

const TURNS: DialogueTurn[] = [
  { id: 'D1:1', speaker: 'Joanna', text: 'I submitted my first screenplay to a studio on 2023-01-05.', timestamp: '2023-01-05' },
  { id: 'D2:1', speaker: 'Joanna', text: 'The studio rejected my first screenplay on 2023-03-01.', timestamp: '2023-03-01' },
  { id: 'D3:1', speaker: 'Joanna', text: 'I prefer writing thriller screenplays.', timestamp: '2023-03-01' },
];

describe('MemoryGraphBridge — links CTC layers to live modules', () => {
  it('persists episodic, semantic and topic content with a fake backing', async () => {
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const backing = {
      createEntities: async (es: Entity[]) => { entities.push(...es); },
      createRelations: async (rs: Relation[]) => { relations.push(...rs); },
      sessionId: 'sess-1',
    };
    const rm = new ReconstructiveMemory({ backing });
    await rm.ingest(TURNS);

    // Episodic entities land on the timeline (memoryType episodic + sessionId).
    const episodes = entities.filter(e => (e as { memoryType?: string }).memoryType === 'episodic');
    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes.every(e => (e as { sessionId?: string }).sessionId === 'sess-1')).toBe(true);
    // Conversation timestamps drive createdAt → timeline order.
    expect(episodes.every(e => !!e.createdAt)).toBe(true);

    // Semantic facts persisted as entities + anchored to the person.
    const facts = entities.filter(e => e.entityType === 'semantic_fact');
    expect(facts.length).toBeGreaterThan(0);
    expect(entities.some(e => e.name === 'Joanna' && e.entityType === 'person')).toBe(true);
    expect(relations.some(r => r.from === 'Joanna' && r.relationType.startsWith('has_'))).toBe(true);

    // Temporal links between consecutive episodes.
    expect(relations.some(r => r.relationType === 'precedes')).toBe(true);
    expect(relations.some(r => r.relationType === 'follows')).toBe(true);

    // Content nodes annotated with their backing entity names.
    const snap = rm.toSnapshot();
    expect(snap.contents.some(c => c.layer === 'episodic' && !!c.entityName)).toBe(true);
    expect(snap.contents.some(c => c.layer === 'semantic' && !!c.entityName)).toBe(true);

    // Persist summary surfaced.
    expect(rm.lastPersistResult?.episodes).toBe(episodes.length);
  });

  it('reuses the backing similarity function for routing', async () => {
    const calls: Array<[string, string]> = [];
    const backing = {
      createEntities: async () => {},
      createRelations: async () => {},
      similarity: async (a: string, b: string) => {
        calls.push([a, b]);
        return /screenplay/i.test(b) ? 0.9 : 0.1;
      },
    };
    const rm = new ReconstructiveMemory({ backing });
    await rm.ingest(TURNS);
    const result = await rm.reconstruct('Which screenplays were rejected?');
    expect(calls.length).toBeGreaterThan(0); // similarity actually consulted
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('exposes the session id used for timeline scoping', () => {
    const bridge = new MemoryGraphBridge({
      createEntities: async () => {},
      createRelations: async () => {},
      sessionId: 'abc',
    });
    expect(bridge.session).toBe('abc');
  });
});

describe('ManagerContext.reconstructiveMemory — end-to-end live bridge', () => {
  let dir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mragent-bridge-'));
    ctx = new ManagerContext(join(dir, 'memory.jsonl'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists reconstructed memory into the real entity/relation store', async () => {
    const rm = ctx.reconstructiveMemory();
    await rm.ingest(TURNS);

    // Episodes are queryable as real entities in the live store.
    const all = (await ctx.storage.loadGraph()).entities;
    const episodes = all.filter(e => (e as { memoryType?: string }).memoryType === 'episodic');
    expect(episodes.length).toBeGreaterThan(0);

    // And visible on the EpisodicMemoryManager timeline (sorted by conversation date).
    const bridgeSession = 'mragent';
    const timeline = await ctx.agentMemory().episodicMemory.getTimeline(bridgeSession);
    expect(timeline.length).toBeGreaterThan(0);
    const times = timeline.map(e => new Date(e.createdAt ?? 0).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times); // ascending

    // Semantic facts + person anchor persisted.
    expect(all.some(e => e.entityType === 'semantic_fact')).toBe(true);
    expect(all.some(e => e.name === 'Joanna')).toBe(true);

    // Reconstruction still answers against the live-backed graph.
    const result = await rm.reconstruct('What did Joanna submit?');
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});
