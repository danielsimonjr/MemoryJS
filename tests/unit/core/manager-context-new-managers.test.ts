/**
 * Wiring tests for the η.6.1 + 3B.4 + 3B.6 managers exposed via
 * `ManagerContext` lazy getters.
 *
 * These verify only that the getter returns a valid instance and that
 * the lazy contract holds (same reference on re-access). Behavior is
 * tested in the per-manager test files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProcedureManager } from '../../../src/agent/procedural/ProcedureManager.js';
import { CausalReasoner } from '../../../src/agent/causal/CausalReasoner.js';
import { RbacMiddleware } from '../../../src/agent/rbac/RbacMiddleware.js';
import { RoleAssignmentStore } from '../../../src/agent/rbac/RoleAssignmentStore.js';

describe('ManagerContext — new manager wiring', () => {
  let testDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mc-new-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    ctx = new ManagerContext({ storagePath: join(testDir, 'memory.jsonl') });
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('procedureManager returns a ProcedureManager instance (lazy)', () => {
    const pm = ctx.procedureManager;
    expect(pm).toBeInstanceOf(ProcedureManager);
    // Same instance on re-access.
    expect(ctx.procedureManager).toBe(pm);
  });

  it('causalReasoner returns a CausalReasoner instance (lazy)', () => {
    const cr = ctx.causalReasoner;
    expect(cr).toBeInstanceOf(CausalReasoner);
    expect(ctx.causalReasoner).toBe(cr);
  });

  it('roleAssignmentStore returns a RoleAssignmentStore (lazy)', () => {
    const store = ctx.roleAssignmentStore;
    expect(store).toBeInstanceOf(RoleAssignmentStore);
    expect(ctx.roleAssignmentStore).toBe(store);
  });

  it('rbacMiddleware returns an RbacMiddleware backed by the same store', () => {
    const mw = ctx.rbacMiddleware;
    expect(mw).toBeInstanceOf(RbacMiddleware);
    expect(ctx.rbacMiddleware).toBe(mw);
  });

  it('procedureManager + entityManager share storage (end-to-end smoke)', async () => {
    const pm = ctx.procedureManager;
    const proc = await pm.addProcedure({
      name: 'smoke',
      steps: [{ order: 1, action: 'noop', parameters: {} }],
    });
    // Verify the underlying entity exists via the public entity manager.
    const e = await ctx.entityManager.getEntity(proc.id);
    expect(e?.entityType).toBe('procedure');
  });

  it('rbacMiddleware + roleAssignmentStore wired together (end-to-end smoke)', async () => {
    await ctx.roleAssignmentStore.assign({
      agentId: 'alice', role: 'writer', resourceType: 'entity',
    });
    expect(ctx.rbacMiddleware.checkPermission('alice', 'write', 'entity')).toBe(true);
    expect(ctx.rbacMiddleware.checkPermission('alice', 'delete', 'entity')).toBe(false);
  });
});
