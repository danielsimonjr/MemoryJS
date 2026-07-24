/**
 * Sec1 — Governance enforcement chokepoint (integration).
 *
 * Verifies that `MEMORY_GOVERNANCE_ENABLED=true` wires the
 * GovernanceManager policy + audit log into EntityManager mutations via
 * ManagerContext, on both storage backends; and that with the flag unset
 * nothing is checked and nothing is audited (zero-overhead path).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { GovernanceError } from '../../../src/features/GovernanceManager.js';
import { AuditLog, type AuditEntry } from '../../../src/features/AuditLog.js';

/** Poll the audit log until `predicate` passes (audits are fire-and-forget). */
async function waitForAudit(
  auditPath: string,
  predicate: (entries: AuditEntry[]) => boolean,
  timeoutMs = 2000,
): Promise<AuditEntry[]> {
  const log = new AuditLog(auditPath);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let entries: AuditEntry[] = [];
    try {
      entries = await log.loadAll();
    } catch {
      // File may not exist yet.
    }
    if (predicate(entries)) return entries;
    if (Date.now() > deadline) {
      throw new Error(`waitForAudit timed out; have ${entries.length} entries`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

const BACKENDS: Array<{ label: string; storageType?: string; ext: string }> = [
  { label: 'JSONL backend', ext: '.jsonl' },
  { label: 'SQLite backend', storageType: 'sqlite', ext: '.db' },
];

describe.each(BACKENDS)('governance enforcement — $label', ({ storageType, ext }) => {
  let dir: string;
  let storagePath: string;
  let auditPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ['MEMORY_GOVERNANCE_ENABLED', 'MEMORY_AUDIT_LOG_FILE', 'MEMORY_STORAGE_TYPE']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = join(tmpdir(), `gov-enforce-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storagePath = join(dir, `mem${ext}`);
    auditPath = join(dir, 'audit.jsonl');
    if (storageType) process.env.MEMORY_STORAGE_TYPE = storageType;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Let any fire-and-forget audit appends settle before removing the
    // dir (an in-flight append can otherwise recreate audit.jsonl while
    // rm is walking the tree — ENOTEMPTY).
    await new Promise((r) => setTimeout(r, 40));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  function enabledCtx(): ManagerContext {
    process.env.MEMORY_GOVERNANCE_ENABLED = 'true';
    process.env.MEMORY_AUDIT_LOG_FILE = auditPath;
    return new ManagerContext(storagePath);
  }

  it('policy denies a high-importance delete through ctx.entityManager', async () => {
    const ctx = enabledCtx();
    ctx.governanceManager.setPolicy({
      canDelete: (entity) => (entity.importance ?? 0) < 8,
    });

    await ctx.entityManager.createEntities([
      { name: 'critical', entityType: 'doc', observations: ['keep me'], importance: 9 },
      { name: 'disposable', entityType: 'doc', observations: [], importance: 1 },
    ]);

    await expect(ctx.entityManager.deleteEntities(['critical'])).rejects.toThrow(GovernanceError);
    await expect(ctx.entityManager.deleteEntities(['critical'])).rejects.toThrow(/critical/);

    // Entity survives the denied delete.
    expect(await ctx.entityManager.getEntity('critical')).not.toBeNull();

    // Low-importance delete still allowed.
    await ctx.entityManager.deleteEntities(['disposable']);
    expect(await ctx.entityManager.getEntity('disposable')).toBeNull();
  });

  it('policy denies update and create; a denied batch is all-or-nothing', async () => {
    const ctx = enabledCtx();
    ctx.governanceManager.setPolicy({
      canCreate: (entity) => entity.entityType !== 'restricted',
      canUpdate: (entity, updates) => (updates?.importance ?? 0) <= 5,
    });

    // Denied create blocks the whole batch.
    await expect(
      ctx.entityManager.createEntities([
        { name: 'ok', entityType: 'doc', observations: [] },
        { name: 'nope', entityType: 'restricted', observations: [] },
      ]),
    ).rejects.toThrow(/nope/);
    expect(await ctx.entityManager.getEntity('ok')).toBeNull();

    await ctx.entityManager.createEntities([{ name: 'a', entityType: 'doc', observations: [] }]);

    // canUpdate receives the proposed patch and can veto on it.
    await expect(
      ctx.entityManager.updateEntity('a', { importance: 9 }),
    ).rejects.toThrow(GovernanceError);
    const updated = await ctx.entityManager.updateEntity('a', { importance: 3 });
    expect(updated.importance).toBe(3);

    // batchUpdate goes through the same check.
    await expect(
      ctx.entityManager.batchUpdate([{ name: 'a', updates: { importance: 10 } }]),
    ).rejects.toThrow(GovernanceError);
  });

  it('renameEntity consults canUpdate', async () => {
    const ctx = enabledCtx();
    ctx.governanceManager.setPolicy({
      canUpdate: (entity) => entity.name !== 'frozen',
    });
    await ctx.entityManager.createEntities([
      { name: 'frozen', entityType: 'doc', observations: [] },
      { name: 'mobile', entityType: 'doc', observations: [] },
    ]);

    await expect(ctx.entityManager.renameEntity('frozen', 'thawed')).rejects.toThrow(
      GovernanceError,
    );
    const renamed = await ctx.entityManager.renameEntity('mobile', 'moved');
    expect(renamed.name).toBe('moved');
  });

  it('allowed mutations audit to the log and the hash chain stays valid', async () => {
    const ctx = enabledCtx();
    ctx.governanceManager.setPolicy({}); // allow-all

    await ctx.entityManager.createEntities([
      { name: 'aud', entityType: 'doc', observations: ['v1'] },
    ]);
    await ctx.entityManager.updateEntity('aud', { observations: ['v2'] });
    await ctx.entityManager.deleteEntities(['aud']);

    const entries = await waitForAudit(auditPath, (all) => all.length >= 3);
    const ops = entries.map((e) => e.operation);
    expect(ops).toContain('create');
    expect(ops).toContain('update');
    expect(ops).toContain('delete');

    const update = entries.find((e) => e.operation === 'update')!;
    expect(update.entityName).toBe('aud');
    expect((update.before as { observations: string[] }).observations).toEqual(['v1']);
    expect((update.after as { observations: string[] }).observations).toEqual(['v2']);
    expect(update.status).toBe('committed');

    const check = await new AuditLog(auditPath).verifyChain();
    expect(check.valid).toBe(true);
    expect(check.totalChecked).toBeGreaterThanOrEqual(3);
  });

  it('audit failure never fails the write (fire-and-forget swallow)', async () => {
    const ctx = enabledCtx();
    // Sabotage the audit sink after construction of the hooks by making
    // the audit file path a directory — appendFile will reject.
    await fs.mkdir(auditPath, { recursive: true });
    ctx.governanceManager.setPolicy({});

    const created = await ctx.entityManager.createEntities([
      { name: 'survives', entityType: 'doc', observations: [] },
    ]);
    expect(created).toHaveLength(1);
    // Give the swallowed rejection a tick to fire — must not unhandled-reject.
    await new Promise((r) => setTimeout(r, 30));
    expect(await ctx.entityManager.getEntity('survives')).not.toBeNull();
  });

  it('flag unset: policy is never consulted and nothing is audited', async () => {
    // No MEMORY_GOVERNANCE_ENABLED in env.
    process.env.MEMORY_AUDIT_LOG_FILE = auditPath;
    const ctx = new ManagerContext(storagePath);

    const canDelete = vi.fn().mockReturnValue(false);
    // Even a manually-set policy is not enforced on plain EntityManager
    // writes when the flag is off — governance stays manual opt-in.
    ctx.governanceManager.setPolicy({ canDelete });

    await ctx.entityManager.createEntities([
      { name: 'free', entityType: 'doc', observations: [], importance: 9 },
    ]);
    await ctx.entityManager.deleteEntities(['free']);

    expect(canDelete).not.toHaveBeenCalled();
    expect(await ctx.entityManager.getEntity('free')).toBeNull();
    await expect(fs.access(auditPath)).rejects.toThrow(); // no audit file
  });

  it('flag unset: no hook object is installed (zero-overhead path)', async () => {
    const ctx = new ManagerContext(storagePath);
    const em = ctx.entityManager;
    expect((em as unknown as { governanceHooks?: unknown }).governanceHooks).toBeUndefined();
  });
});
