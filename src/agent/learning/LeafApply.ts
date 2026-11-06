/**
 * Apply phase of the leaf learner (Recursa RS-18): writes an accepted revision to live `K` with
 * OCC on the round-start snapshot, then publishes and starts the next round.
 *
 * - `conflict` (live `K` moved since the round began): the revision is not applied, the trace
 *   gets an `edit` action `apply-conflict: <reason>`, and the next round starts from a fresh
 *   snapshot of live `K` (the tasks are solved again against it), unless a budget is spent.
 * - `rejected` (an op does not apply): the trace gets `apply-rejected: failedOpIndex=<i> <reason>`
 *   and the round counts as no progress (the run stops with `no-progress`).
 * - Bookkeeping (`snapshotId`, `revisionCount`, `appliedRevisionIds`) is saved before the
 *   publisher runs. Publishing is best effort: a failure is recorded as
 *   `publish-failed: <message>` and never thrown.
 * - Apply is idempotent: a revision id already in `appliedRevisionIds`, or one whose
 *   `revision:<id>` snapshot already exists (a crash after `applyRevision` and before the save),
 *   is not applied again.
 *
 * @module agent/learning/LeafApply
 * @experimental Spec RS-18. Internal to the leaf learner.
 */

import { describeError } from './llmJson.js';
import { type Ctx, type LeafEnv, beginRound, budgetStopFor, recordAction, saveCtx, stopRun } from './LeafLearnerContext.js';

/**
 * Start the next round, or stop when a budget is spent.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 */
async function nextRoundOrStop(env: LeafEnv, ctx: Ctx): Promise<void> {
  const reason = budgetStopFor(ctx);
  if (reason) {
    await stopRun(env, ctx, reason);
    return;
  }
  await beginRound(env, ctx, ctx.run.state.round + 1);
}

/**
 * Apply the accepted revision (see the module JSDoc for conflict, rejection, publish and
 * idempotency rules). Never throws for a conflict, a rejected op or a publish failure.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run in the `apply` phase.
 * @param publish - Optional publisher callback, called with the new snapshot id.
 */
export async function applyStep(
  env: LeafEnv,
  ctx: Ctx,
  publish: ((snapshotId: string) => Promise<void>) | undefined,
): Promise<void> {
  const { run } = ctx;
  const revision = run.revision!;
  if (!run.appliedRevisionIds.includes(revision.id)) {
    const prior = await env.repository.snapshotForRevision(revision.id);
    let snapshotId: string;
    if (prior) {
      snapshotId = prior.id;
    } else {
      const result = await env.repository.applyRevision(revision, { expectedSnapshotId: run.roundSnapshotId });
      if (result.status === 'conflict') {
        await recordAction(env, ctx, 'edit', [], `apply-conflict: live K is ${result.currentSnapshotId}, round base was ${run.roundSnapshotId}`);
        run.revision = undefined;
        run.diagnoses = [];
        await nextRoundOrStop(env, ctx);
        return;
      }
      if (result.status === 'rejected') {
        await recordAction(env, ctx, 'edit', [], `apply-rejected: failedOpIndex=${result.failedOpIndex} ${result.reason}`);
        await stopRun(env, ctx, 'no-progress');
        return;
      }
      snapshotId = result.snapshotId;
    }
    run.snapshotId = snapshotId;
    run.revisionCount += 1;
    run.appliedRevisionIds.push(revision.id);
    await saveCtx(env, ctx);
  }
  await env.traces.addRevisionId(run.state.traceId, revision.id);
  if (publish) {
    try {
      await publish(run.snapshotId);
    } catch (err) {
      await recordAction(env, ctx, 'edit', [], `publish-failed: ${describeError(err)}`);
    }
  }
  await recordAction(env, ctx, 'edit', [], `applied ${revision.id} as ${run.snapshotId}`);
  run.revision = undefined;
  run.diagnoses = [];
  await nextRoundOrStop(env, ctx);
}
