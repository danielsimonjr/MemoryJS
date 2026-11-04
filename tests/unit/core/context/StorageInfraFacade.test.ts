/**
 * StorageInfraFacade (DES-4) — env-gated storage infrastructure reached
 * through ManagerContext. Verifies identity, lazy one-time resolution,
 * side-effect-free peeks, and listener detachment on close().
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { StorageInfraFacade } from '../../../../src/core/context/StorageInfraFacade.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import { sidecarPath } from '../../../../src/utils/sidecarPath.js';
import { existsSync } from 'fs';

const FLAGS = [
  'MEMORY_OBSERVATIONS_COLUMNAR',
  'MEMORY_TIERED_INDEX',
  'MEMORY_CACHE_COMPRESS',
  'MEMORY_FUZZY_BLOOM_PRESCREEN',
  'MEMORY_AUDIT_LOG_FILE',
] as const;

const contexts: ManagerContext[] = [];

function makeContext(env: Partial<Record<(typeof FLAGS)[number], string>> = {}): ManagerContext {
  for (const flag of FLAGS) vi.stubEnv(flag, env[flag] ?? '');
  const ctx = new ManagerContext(makeTempJsonlPath());
  contexts.push(ctx);
  return ctx;
}

afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.close();
  for (const flag of FLAGS) vi.unstubAllEnvs();
  cleanupTempDirs();
});

describe('StorageInfraFacade via ManagerContext', () => {
  it('returns null from every env-gated getter when the flags are unset', () => {
    const ctx = makeContext();
    expect(ctx.observationColumnStore).toBeNull();
    expect(ctx.tieredPostingsIndex).toBeNull();
    expect(ctx.compressedEntityCache).toBeNull();
    expect(ctx.bloomPreScreener).toBeNull();
  });

  it('treats non-literal flag values as disabled (strict literal contract)', () => {
    const ctx = makeContext({
      MEMORY_TIERED_INDEX: 'TRUE',
      MEMORY_CACHE_COMPRESS: '1',
      MEMORY_OBSERVATIONS_COLUMNAR: 'yes',
      MEMORY_FUZZY_BLOOM_PRESCREEN: 'on',
    });
    expect(ctx.tieredPostingsIndex).toBeNull();
    expect(ctx.compressedEntityCache).toBeNull();
    expect(ctx.observationColumnStore).toBeNull();
    expect(ctx.bloomPreScreener).toBeNull();
  });

  it('returns the same tiered index instance on every access when enabled', () => {
    const ctx = makeContext({ MEMORY_TIERED_INDEX: 'true' });
    const first = ctx.tieredPostingsIndex;
    expect(first).not.toBeNull();
    expect(ctx.tieredPostingsIndex).toBe(first);
  });

  it('returns the same compressed cache instance on every access when enabled', () => {
    const ctx = makeContext({ MEMORY_CACHE_COMPRESS: 'true' });
    const first = ctx.compressedEntityCache;
    expect(first).not.toBeNull();
    expect(ctx.compressedEntityCache).toBe(first);
  });

  it('returns the same column store instance on every access when enabled', () => {
    const ctx = makeContext({ MEMORY_OBSERVATIONS_COLUMNAR: 'true' });
    const first = ctx.observationColumnStore;
    expect(first).not.toBeNull();
    expect(ctx.observationColumnStore).toBe(first);
  });

  it('returns the same Bloom pre-screener instance on every access when enabled', () => {
    const ctx = makeContext({ MEMORY_FUZZY_BLOOM_PRESCREEN: 'true' });
    const first = ctx.bloomPreScreener;
    expect(first).not.toBeNull();
    expect(ctx.bloomPreScreener).toBe(first);
  });

  it('diagnostics() does not construct the tiered index when it was never accessed', () => {
    const ctx = makeContext({ MEMORY_TIERED_INDEX: 'true' });
    const report = ctx.diagnostics();
    expect(report.tieredIndexStats).toBeUndefined();
    // A later explicit access still constructs it (peek did not pre-resolve).
    expect(ctx.tieredPostingsIndex).not.toBeNull();
    expect(ctx.diagnostics().tieredIndexStats).toBeDefined();
  });

  it('diagnostics() does not attach or subscribe a Bloom pre-screener', () => {
    const ctx = makeContext({ MEMORY_FUZZY_BLOOM_PRESCREEN: 'true' });
    const events = ctx.storage.events;
    expect(events).toBeDefined();
    const before = events!.listenerCount();
    ctx.diagnostics();
    expect(events!.listenerCount()).toBe(before);
  });

  it('bloomPreScreener subscribes exactly five invalidation listeners and close() removes them', () => {
    const ctx = makeContext({ MEMORY_FUZZY_BLOOM_PRESCREEN: 'true' });
    const events = ctx.storage.events!;
    const before = events.listenerCount();
    expect(ctx.bloomPreScreener).not.toBeNull();
    expect(events.listenerCount()).toBe(before + 5);
    ctx.close();
    expect(events.listenerCount()).toBe(before);
  });

  it('close() forgets the Bloom pre-screener so the next access re-resolves it', () => {
    const ctx = makeContext({ MEMORY_FUZZY_BLOOM_PRESCREEN: 'true' });
    const first = ctx.bloomPreScreener;
    ctx.close();
    const second = ctx.bloomPreScreener;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('close() is idempotent', () => {
    const ctx = makeContext({ MEMORY_FUZZY_BLOOM_PRESCREEN: 'true' });
    void ctx.bloomPreScreener;
    expect(() => {
      ctx.close();
      ctx.close();
    }).not.toThrow();
  });
});

describe('governance audit sidecar (DES-5 wiring)', () => {
  it('writes the audit log to <basename>-audit.jsonl next to the storage file', async () => {
    const storagePath = makeTempJsonlPath();
    vi.stubEnv('MEMORY_AUDIT_LOG_FILE', '');
    const ctx = new ManagerContext(storagePath);
    contexts.push(ctx);
    await ctx.governanceManager.appendAudit({
      operation: 'create',
      entityName: 'sidecar-probe',
      status: 'committed',
    });
    expect(existsSync(sidecarPath(storagePath, '-audit'))).toBe(true);
  });
});

describe('StorageInfraFacade direct', () => {
  function fakeDeps(overrides: Partial<ConstructorParameters<typeof StorageInfraFacade>[0]> = {}) {
    const storage = {
      getFilePath: () => '/nonexistent/dir/memory.jsonl',
      events: undefined,
    } as unknown as ConstructorParameters<typeof StorageInfraFacade>[0]['storage'];
    const cachePressure = {
      enabled: false,
      register: vi.fn(),
      evictIfOverBudget: vi.fn(),
    } as unknown as ConstructorParameters<typeof StorageInfraFacade>[0]['cachePressure'];
    return { storage, cachePressure, columnStorePath: '/nonexistent/dir/memory-observations.jsonl', ...overrides };
  }

  it('peek methods return null before resolution and never construct', () => {
    vi.stubEnv('MEMORY_TIERED_INDEX', 'true');
    vi.stubEnv('MEMORY_FUZZY_BLOOM_PRESCREEN', 'true');
    const onReady = vi.fn();
    const facade = new StorageInfraFacade({ ...fakeDeps(), onBloomScreenerReady: onReady });
    expect(facade.peekTieredPostingsIndex()).toBeNull();
    expect(facade.peekBloomPreScreener()).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    facade.close();
    vi.unstubAllEnvs();
  });

  it('observationColumnStore resolves to the sidecar path given at construction', () => {
    vi.stubEnv('MEMORY_OBSERVATIONS_COLUMNAR', 'true');
    const deps = fakeDeps({ columnStorePath: sidecarPath('/nonexistent/dir/memory.jsonl', '-observations') });
    const facade = new StorageInfraFacade(deps);
    const store = facade.observationColumnStore as unknown as { sidecarPath: string };
    expect(store.sidecarPath.endsWith('memory-observations.jsonl')).toBe(true);
    vi.unstubAllEnvs();
  });
});
