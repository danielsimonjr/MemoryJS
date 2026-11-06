/**
 * 07 - Governance, RBAC, attribution, and PII redaction.
 *
 * Run: bun run examples/07-governance-rbac.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog,
  CollaborationAuditEnforcer,
  GovernanceError,
  ManagerContext,
  PiiRedactor,
} from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  // MEMORY_GOVERNANCE_ENABLED is read on first EntityManager access, so set it first
  // and restore it afterwards.
  const previous = process.env.MEMORY_GOVERNANCE_ENABLED;
  process.env.MEMORY_GOVERNANCE_ENABLED = 'true';
  const ctx = new ManagerContext(storagePath);
  try {
    // Policy: block creation of secret-typed entities. Denials throw GovernanceError.
    ctx.governanceManager.setPolicy({
      canCreate: (entity) => entity.entityType !== 'secret',
    });
    await ctx.entityManager.createEntities([{ name: 'Roadmap', entityType: 'doc', observations: ['Q3 plan'] }]);
    let denied = false;
    try {
      await ctx.entityManager.createEntities([{ name: 'API key', entityType: 'secret', observations: ['redacted'] }]);
    } catch (err) {
      denied = err instanceof GovernanceError;
    }
    // Enforced writes are audited fire-and-forget (an audit failure never fails the
    // write), so poll briefly for the entry; the hash chain is tamper-evident.
    let roadmapHistory: unknown[] = [];
    for (let i = 0; i < 50 && roadmapHistory.length === 0; i++) {
      roadmapHistory = await ctx.auditLog.getHistory('Roadmap');
      if (roadmapHistory.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const chain = await ctx.auditLog.verifyChain();

    // RBAC: grants are data; checkPermission is synchronous.
    await ctx.roleAssignmentStore.assign({ agentId: 'alice', role: 'writer', resourceType: 'entity' });
    await ctx.roleAssignmentStore.assign({ agentId: 'root', role: 'owner' });
    const aliceWrite = ctx.rbacMiddleware.checkPermission('alice', 'write', 'entity');
    const aliceManage = ctx.rbacMiddleware.checkPermission('alice', 'manage', 'entity');
    const rootManage = ctx.rbacMiddleware.checkPermission('root', 'manage', 'entity');
    const aliceGrants = ctx.roleAssignmentStore.list('alice').map((a) => a.role);

    // Attribution: every mutation through the enforcer must name an agent.
    const enforcer = new CollaborationAuditEnforcer(ctx.entityManager, new AuditLog(join(storagePath, '..', 'attr-audit.jsonl')));
    const attributed = await enforcer.createEntities(
      [{ name: 'Attributed note', entityType: 'note', observations: ['written by alice'] }],
      'alice',
    );
    let attributionRequired = false;
    try {
      await enforcer.createEntities([{ name: 'Anonymous note', entityType: 'note', observations: ['?'] }], undefined);
    } catch {
      attributionRequired = true;
    }

    // PII redaction for exports and logs.
    const redactor = new PiiRedactor();
    const { text, stats } = redactor.redactWithStats('Contact jane@example.com or 555-123-4567');
    const cleanGraph = redactor.redactGraph({
      entities: [{ name: 'Jane', observations: ['email jane@example.com'] }],
      relations: [],
    });

    return {
      governanceDeniedSecret: denied,
      roadmapAuditEntries: roadmapHistory.length,
      auditChainValid: chain.valid,
      aliceWrite,
      aliceManage,
      rootManage,
      aliceGrants,
      attributedEntity: attributed[0]?.name ?? null,
      attributionRequired,
      redactedText: text,
      redactionCount: stats.totalRedactedBytes > 0,
      graphRedacted: !cleanGraph.entities[0].observations[0].includes('jane@example.com'),
    };
  } finally {
    ctx.close();
    if (previous === undefined) delete process.env.MEMORY_GOVERNANCE_ENABLED;
    else process.env.MEMORY_GOVERNANCE_ENABLED = previous;
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-07-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
