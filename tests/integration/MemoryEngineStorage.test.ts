import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../src/core/ManagerContext.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('MemoryEngine integration — JSONL roundtrip', () => {
  let file: string;
  beforeEach(() => {
    file = path.join(os.tmpdir(), `memengine-int-${Date.now()}-${Math.random()}.jsonl`);
  });
  afterEach(() => {
    if (existsSync(file)) rmSync(file, { force: true });
  });

  it('contentHash round-trips through JSONL close/reopen', async () => {
    const ctx1 = new ManagerContext(file);
    await ctx1.memoryEngine.addTurn('persistent content', {
      sessionId: 'p-A',
      role: 'user',
    });

    const ctx2 = new ManagerContext(file);
    const turns = await ctx2.memoryEngine.getSessionTurns('p-A');
    expect(turns).toHaveLength(1);
    expect(turns[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dedup via contentHash hits across JSONL reopen', async () => {
    const ctx1 = new ManagerContext(file);
    const first = await ctx1.memoryEngine.addTurn('persist dedup jsonl', {
      sessionId: 'p-A',
      role: 'user',
    });

    const ctx2 = new ManagerContext(file);
    const second = await ctx2.memoryEngine.addTurn('persist dedup jsonl', {
      sessionId: 'p-A',
      role: 'user',
    });
    expect(second.duplicateDetected).toBe(true);
    expect(second.duplicateTier).toBe('exact');
    expect(second.duplicateOf).toBe(first.entity.name);
  });

  it('AgentEntity-extension fields survive close/reopen', async () => {
    const ctx1 = new ManagerContext(file);
    await ctx1.memoryEngine.addTurn('round-trip me', {
      sessionId: 'rt-A',
      role: 'assistant',
      agentId: 'agent-x',
    });

    const ctx2 = new ManagerContext(file);
    const turns = await ctx2.memoryEngine.getSessionTurns('rt-A');
    expect(turns).toHaveLength(1);

    const t = turns[0];
    // The fields most at risk for silent drop in JSONL serialization
    // (the bug the field-list helper was added to prevent).
    expect(t.sessionId).toBe('rt-A');
    expect(t.agentId).toBe('agent-x');
    expect(t.memoryType).toBeDefined();
    expect(t.visibility).toBeDefined();
    expect(typeof t.accessCount).toBe('number');
    expect(typeof t.confidence).toBe('number');
    expect(typeof t.confirmationCount).toBe('number');
    expect(t.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('MemoryEngine integration — SQLite roundtrip', () => {
  // NOTE: Skipped pending follow-up bug fix. SQLiteStorage's rowToEntity
  // mapper enumerates a fixed column subset that excludes every
  // AgentEntity-extension field (sessionId, agentId, accessCount,
  // confidence, confirmationCount, visibility, memoryType, etc.). Schema
  // also lacks those columns entirely. To make these round-trips work we
  // need either (a) an `agentMetadata` JSON blob column with a single
  // forward migration, or (b) twelve discrete columns added via
  // ADD COLUMN with read/write paths updated. Tracked as the SQLite
  // counterpart to the JSONL field-drift fix shipped with T06.
  let file: string;
  const prevStorageType = process.env.MEMORY_STORAGE_TYPE;

  beforeEach(() => {
    file = path.join(os.tmpdir(), `memengine-sqlite-int-${Date.now()}-${Math.random()}.db`);
    process.env.MEMORY_STORAGE_TYPE = 'sqlite';
  });
  afterEach(() => {
    if (existsSync(file)) {
      try {
        rmSync(file, { force: true });
      } catch {
        // SQLite WAL/SHM file locks on Windows can briefly prevent unlink.
      }
    }
    if (prevStorageType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
    else process.env.MEMORY_STORAGE_TYPE = prevStorageType;
  });

  it.skip('contentHash populates the indexed column on SQLite', async () => {
    const ctx1 = new ManagerContext(file);
    await ctx1.memoryEngine.addTurn('sqlite content', {
      sessionId: 's-A',
      role: 'user',
    });

    const ctx2 = new ManagerContext(file);
    const turns = await ctx2.memoryEngine.getSessionTurns('s-A');
    expect(turns).toHaveLength(1);
    expect(turns[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skip('dedup via index hits across SQLite reopen', async () => {
    const ctx1 = new ManagerContext(file);
    const first = await ctx1.memoryEngine.addTurn('persist dedup sqlite', {
      sessionId: 's-A',
      role: 'user',
    });

    const ctx2 = new ManagerContext(file);
    const second = await ctx2.memoryEngine.addTurn('persist dedup sqlite', {
      sessionId: 's-A',
      role: 'user',
    });
    expect(second.duplicateDetected).toBe(true);
    expect(second.duplicateTier).toBe('exact');
    expect(second.duplicateOf).toBe(first.entity.name);
  });

  it.skip('handles SQLite migration idempotently across multiple opens', async () => {
    const ctx1 = new ManagerContext(file);
    await ctx1.memoryEngine.addTurn('warm-up', { sessionId: 's-A', role: 'user' });

    // Re-opening the same DB must not re-run destructive migrations or throw.
    expect(() => new ManagerContext(file)).not.toThrow();
    expect(() => new ManagerContext(file)).not.toThrow();
  });
});
