/**
 * Sec7 — UpdateEntitySchema mass-assignment hardening.
 *
 * The schema switched from `.passthrough()` to `.strip()` with an
 * explicit allow-list of every field that legitimately flows through
 * `EntityManager.updateEntity` / `batchUpdate`. These tests pin:
 * - unknown junk keys are dropped (schema-level AND end-to-end),
 * - every allow-listed field survives a parse,
 * - the allow-list round-trips through a real EntityManager update.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UpdateEntitySchema } from '../../../src/utils/schemas.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import type { Entity } from '../../../src/types/index.js';

describe('Sec7 — UpdateEntitySchema .strip()', () => {
  it('drops unknown junk keys (mass-assignment)', () => {
    const result = UpdateEntitySchema.safeParse({
      importance: 5,
      isAdmin: true,
      __role: 'root',
      internalFlag: 'x',
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.importance).toBe(5);
    expect(data).not.toHaveProperty('isAdmin');
    expect(data).not.toHaveProperty('__role');
    expect(data).not.toHaveProperty('internalFlag');
  });

  it('drops identity fields that must never be updated via patch (name, id)', () => {
    const result = UpdateEntitySchema.safeParse({
      name: 'spoofed-name',
      id: 'spoofed-id',
      importance: 1,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('id');
  });

  it('every allow-listed field survives a parse', () => {
    const full: Record<string, unknown> = {
      // Core Entity
      entityType: 'doc',
      observations: ['obs'],
      tags: ['tag'],
      importance: 5,
      parentId: 'parent',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      ttl: 1000,
      confidence: 0.5,
      freshnessScore: 0.9,
      expiresAt: '2026-02-01T00:00:00.000Z',
      projectId: 'proj',
      isLatest: true,
      supersededBy: 'other',
      rootEntityName: 'root',
      parentEntityName: 'parent-v1',
      version: 2,
      contentHash: 'a'.repeat(64),
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      observationMeta: [{ content: 'obs', validFrom: '2026-01-01' }],
      lifecycleStatus: 'published',
      // AgentEntity
      memoryType: 'episodic',
      sessionId: 's1',
      conversationId: 'c1',
      taskId: 't1',
      isWorkingMemory: true,
      promotedAt: '2026-01-03T00:00:00.000Z',
      promotedFrom: 'wm-1',
      markedForPromotion: false,
      accessCount: 3,
      lastAccessedAt: '2026-01-04T00:00:00.000Z',
      accessPattern: 'frequent',
      confirmationCount: 2,
      decayRate: 1.5,
      agentId: 'agent-1',
      visibility: 'private',
      source: { type: 'user_input' },
      allowedRoles: ['reviewer'],
      visibleFrom: '2026-01-01T00:00:00.000Z',
      visibleUntil: '2026-06-01T00:00:00.000Z',
      // SessionEntity
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T01:00:00.000Z',
      status: 'completed',
      goalDescription: 'goal',
      taskType: 'research',
      userIntent: 'intent',
      memoryCount: 7,
      consolidatedCount: 1,
      previousSessionId: 's0',
      relatedSessionIds: ['s2'],
      outcome: { success: true },
      failureCauses: ['none'],
      // ArtifactEntity
      artifactType: 'report',
      toolName: 'export',
      shortId: 'abc123',
      // Subclass-manager records
      heuristicRecord: { condition: 'x', action: 'y' },
      decisionRecord: { title: 'd' },
      exclusionRule: { pattern: 'secret' },
      projectContextRecord: { facts: [] },
      toolAffordanceRecord: { successes: 1 },
      prospectiveRecord: { trigger: {} },
      failureRecord: { context: 'c' },
      planRecord: { goal: 'g' },
      reflectionRecord: { insight: 'i' },
    };

    const result = UpdateEntitySchema.safeParse(full);
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
    const data = result.data as Record<string, unknown>;
    for (const key of Object.keys(full)) {
      expect(data, `allow-listed field '${key}' was stripped`).toHaveProperty(key);
    }
  });

  describe('end-to-end through EntityManager.updateEntity', () => {
    let dir: string;
    let storage: GraphStorage;
    let manager: EntityManager;

    beforeEach(async () => {
      dir = join(tmpdir(), `schema-strip-${Date.now()}-${Math.random()}`);
      await fs.mkdir(dir, { recursive: true });
      storage = new GraphStorage(join(dir, 'mem.jsonl'));
      await storage.saveGraph({ entities: [], relations: [] });
      manager = new EntityManager(storage);
      await manager.createEntities([
        { name: 'target', entityType: 'doc', observations: ['v1'] },
      ]);
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('junk key never reaches the stored entity', async () => {
      const updated = await manager.updateEntity('target', {
        importance: 4,
        isAdmin: true,
        supersededBy: 'x',
      } as unknown as Partial<Entity>);
      expect(updated.importance).toBe(4);
      expect(updated.supersededBy).toBe('x');
      expect(updated).not.toHaveProperty('isAdmin');

      // Also gone after a cold reload from disk.
      storage.clearCache();
      const reloaded = await storage.loadGraph();
      const entity = reloaded.entities.find((e) => e.name === 'target')!;
      expect(entity).not.toHaveProperty('isAdmin');
      expect(entity.importance).toBe(4);
    });

    it('junk keys are dropped from batchUpdate patches too', async () => {
      const [updated] = await manager.batchUpdate([
        {
          name: 'target',
          updates: { importance: 6, exploit: 'payload' } as unknown as Partial<Entity>,
        },
      ]);
      expect(updated.importance).toBe(6);
      expect(updated).not.toHaveProperty('exploit');
    });

    it('subclass record + agent fields survive an update roundtrip', async () => {
      await manager.updateEntity('target', {
        memoryType: 'semantic',
        sessionId: 'sess-9',
        agentId: 'agent-7',
        confidence: 0.8,
        lastModified: '2026-03-01T00:00:00.000Z',
        heuristicRecord: { condition: 'if', action: 'then' },
      } as unknown as Partial<Entity>);

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      const entity = reloaded.entities.find((e) => e.name === 'target')! as Entity &
        Record<string, unknown>;
      expect(entity.memoryType).toBe('semantic');
      expect(entity.sessionId).toBe('sess-9');
      expect(entity.agentId).toBe('agent-7');
      expect(entity.confidence).toBe(0.8);
      expect(entity.heuristicRecord).toEqual({ condition: 'if', action: 'then' });
    });
  });
});
