import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { InMemoryBackend } from '../../../src/agent/InMemoryBackend.js';
import { SQLiteBackend } from '../../../src/agent/SQLiteBackend.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ManagerContext.memoryBackend wiring', () => {
  let file: string;
  const prevBackend = process.env.MEMORY_BACKEND;
  beforeEach(() => {
    file = path.join(os.tmpdir(), `memback-wire-${Date.now()}-${Math.random()}.jsonl`);
  });
  afterEach(() => {
    if (existsSync(file)) {
      try { rmSync(file, { force: true }); } catch { /* lock */ }
    }
    if (prevBackend === undefined) delete process.env.MEMORY_BACKEND;
    else process.env.MEMORY_BACKEND = prevBackend;
  });

  it('default backend is SQLiteBackend (regardless of storage type)', () => {
    delete process.env.MEMORY_BACKEND;
    const ctx = new ManagerContext(file);
    expect(ctx.memoryBackend).toBeInstanceOf(SQLiteBackend);
  });

  it('MEMORY_BACKEND=in-memory selects InMemoryBackend', () => {
    process.env.MEMORY_BACKEND = 'in-memory';
    const ctx = new ManagerContext(file);
    expect(ctx.memoryBackend).toBeInstanceOf(InMemoryBackend);
  });

  it('MEMORY_BACKEND=memory alias also selects InMemoryBackend', () => {
    process.env.MEMORY_BACKEND = 'memory';
    const ctx = new ManagerContext(file);
    expect(ctx.memoryBackend).toBeInstanceOf(InMemoryBackend);
  });

  it('memoryBackend getter is cached on repeat access', () => {
    delete process.env.MEMORY_BACKEND;
    const ctx = new ManagerContext(file);
    const a = ctx.memoryBackend;
    const b = ctx.memoryBackend;
    expect(a).toBe(b);
  });

  it('agentMemory(config) re-instantiation invalidates memoryBackend', () => {
    delete process.env.MEMORY_BACKEND;
    const ctx = new ManagerContext(file);
    const a = ctx.memoryBackend;
    ctx.agentMemory({});  // forces new AgentMemoryManager
    const b = ctx.memoryBackend;
    expect(b).not.toBe(a);
  });

  it('memoryBackend round-trips a turn end-to-end', async () => {
    delete process.env.MEMORY_BACKEND;
    const ctx = new ManagerContext(file);
    const backend = ctx.memoryBackend;
    await backend.add({
      id: 't', sessionId: 's', content: 'wire test', role: 'user',
      importance: 2.0, createdAt: new Date().toISOString(),
    });
    const result = await backend.get_weighted('wire', 's', { threshold: 0 });
    expect(result.length).toBe(1);
    expect(result[0].turn.content).toBe('wire test');
  });
});
