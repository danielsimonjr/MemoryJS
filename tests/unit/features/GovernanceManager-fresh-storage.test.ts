/**
 * Regression: governed single-entity ops must load storage before their
 * synchronous cache lookups (fresh storage, file already populated).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GovernanceManager } from '../../../src/features/GovernanceManager.js';
import { AuditLog } from '../../../src/features/AuditLog.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

type Kind = 'jsonl' | 'sqlite';

describe.each(['jsonl', 'sqlite'] as Kind[])('GovernanceManager fresh storage first-op (%s)', (kind) => {
  let dir: string;
  const path = (): string => join(dir, kind === 'jsonl' ? 'memory.jsonl' : 'memory.db');
  const open = (): GraphStorage | SQLiteStorage =>
    kind === 'jsonl' ? new GraphStorage(path()) : new SQLiteStorage(path());
  const gov = (s: GraphStorage | SQLiteStorage, n: string): GovernanceManager =>
    new GovernanceManager(s as GraphStorage, new AuditLog(join(dir, `${n}.jsonl`)));

  beforeEach(async () => {
    dir = join(tmpdir(), `gov-fresh-${kind}-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    const seed = open();
    await seed.saveGraph({
      entities: [{ name: 'A', entityType: 't', observations: ['x'], createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z' }],
      relations: [],
    });
    (seed as unknown as { close?: () => void }).close?.();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('createEntity rejects a duplicate of a persisted entity', async () => {
    const s = open();
    await expect(
      gov(s, 'a1').withTransaction(async (tx) => {
        await tx.createEntity({ name: 'A', entityType: 't', observations: [] });
      }),
    ).rejects.toThrow(/already exists/);
    (s as unknown as { close?: () => void }).close?.();
  });

  it('updateEntity finds a persisted entity', async () => {
    const s = open();
    await gov(s, 'a2').withTransaction(async (tx) => {
      await tx.updateEntity('A', { observations: ['y'] });
    });
    expect((await s.loadGraph()).entities.find((e) => e.name === 'A')?.observations).toEqual(['y']);
    (s as unknown as { close?: () => void }).close?.();
  });

  it('deleteEntity finds a persisted entity', async () => {
    const s = open();
    await gov(s, 'a3').withTransaction((tx) => tx.deleteEntity('A'));
    expect((await s.loadGraph()).entities.find((e) => e.name === 'A')).toBeUndefined();
    (s as unknown as { close?: () => void }).close?.();
  });
});
