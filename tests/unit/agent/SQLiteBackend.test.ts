import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteBackend } from '../../../src/agent/SQLiteBackend.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { runMemoryBackendContract } from './IMemoryBackend.contract.test.js';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Build a fresh `SQLiteBackend` backed by a real `ManagerContext` over a
 * tmp JSONL store (the SQLite path requires native better-sqlite3 which
 * isn't always rebuilt in CI; JSONL works for the contract surface and
 * exercises the same MemoryEngine code path SQLiteBackend wraps). The
 * backend's name is "SQLiteBackend" but its durable substrate here is
 * JSONL — the contract is what matters. */
let activeFiles: string[] = [];
function makeBackend(): SQLiteBackend {
  const file = path.join(
    os.tmpdir(),
    `sqlite-backend-${Date.now()}-${Math.random()}.jsonl`,
  );
  activeFiles.push(file);
  const ctx = new ManagerContext(file);
  return new SQLiteBackend(ctx.memoryEngine, ctx.decayEngine);
}

afterEach(() => {
  for (const f of activeFiles) {
    if (existsSync(f)) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* file may be locked transiently on Windows */
      }
    }
  }
  activeFiles = [];
});

// Run the parameterized contract suite.
runMemoryBackendContract('SQLiteBackend', makeBackend);

// Backend-specific tests.
describe('SQLiteBackend specifics', () => {
  it('round-trips role correctly through the role= prefix', async () => {
    const backend = makeBackend();
    await backend.add({
      id: '1',
      sessionId: 's',
      content: 'hello',
      role: 'assistant',
      importance: 2.0,
      createdAt: new Date().toISOString(),
    });
    const result = await backend.get_weighted('', 's', { threshold: 0 });
    expect(result.length).toBe(1);
    expect(result[0].turn.role).toBe('assistant');
    expect(result[0].turn.content).toBe('hello');
  });

  it('dedup at exact tier — second add is silent no-op', async () => {
    const backend = makeBackend();
    const t = new Date().toISOString();
    await backend.add({
      id: '1', sessionId: 's', content: 'identical content', role: 'user',
      importance: 2.0, createdAt: t,
    });
    await backend.add({
      id: '2', sessionId: 's', content: 'identical content', role: 'user',
      importance: 2.0, createdAt: t,
    });
    const result = await backend.get_weighted('', 's', { threshold: 0 });
    expect(result.length).toBe(1);
  });

  it('preserveCallerIds=true throws (not yet implemented)', () => {
    const file = path.join(os.tmpdir(), `sqlite-backend-throw-${Date.now()}.jsonl`);
    activeFiles.push(file);
    const ctx = new ManagerContext(file);
    const backend = new SQLiteBackend(ctx.memoryEngine, ctx.decayEngine, {
      preserveCallerIds: true,
    });
    return expect(
      backend.add({
        id: 'caller-id',
        sessionId: 's',
        content: 'hello',
        role: 'user',
        importance: 2.0,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/preserveCallerIds=true requires storage.renameEntity/);
  });

  it('round-trips through actual SQLite storage when MEMORY_STORAGE_TYPE=sqlite', async () => {
    // Real SQLite path (no JSONL fallback). Skipped if better-sqlite3
    // ABI is incompatible with the running Node version — see CLAUDE.md
    // gotcha "npm rebuild better-sqlite3".
    const file = path.join(os.tmpdir(), `sqlite-backend-real-${Date.now()}.db`);
    activeFiles.push(file);
    const prev = process.env.MEMORY_STORAGE_TYPE;
    process.env.MEMORY_STORAGE_TYPE = 'sqlite';
    let backend: SQLiteBackend | undefined;
    try {
      const ctx = new ManagerContext(file);
      backend = new SQLiteBackend(ctx.memoryEngine, ctx.decayEngine);
    } catch (err) {
      // better-sqlite3 native binding mismatch; skip rather than fail.
      const msg = String(err);
      if (msg.includes('NODE_MODULE_VERSION') || msg.includes('better_sqlite3')) {
        // eslint-disable-next-line no-console
        console.warn('Skipping real-SQLite test:', msg.slice(0, 120));
        return;
      }
      throw err;
    } finally {
      if (prev === undefined) delete process.env.MEMORY_STORAGE_TYPE;
      else process.env.MEMORY_STORAGE_TYPE = prev;
    }

    await backend.add({
      id: 'real-sqlite-1',
      sessionId: 's',
      content: 'real sqlite path content',
      role: 'user',
      importance: 2.0,
      createdAt: new Date().toISOString(),
    });
    const result = await backend.get_weighted('real', 's', { threshold: 0 });
    expect(result.length).toBe(1);
    expect(result[0].turn.content).toBe('real sqlite path content');
  });

  it('dedupOnAdd=false throws (bypass path not yet implemented)', () => {
    const file = path.join(os.tmpdir(), `sqlite-backend-bypass-${Date.now()}.jsonl`);
    activeFiles.push(file);
    const ctx = new ManagerContext(file);
    const backend = new SQLiteBackend(ctx.memoryEngine, ctx.decayEngine, {
      dedupOnAdd: false,
    });
    return expect(
      backend.add({
        id: '1',
        sessionId: 's',
        content: 'hello',
        role: 'user',
        importance: 2.0,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/dedupOnAdd=false bypass path is not implemented/);
  });
});
