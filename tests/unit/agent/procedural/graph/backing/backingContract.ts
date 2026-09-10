/**
 * Shared IProceduralGraphBacking contract suite.
 *
 * `it()` names are fixed by the Wave 2 implementation plan.
 */

import { graphDigest } from '../../../../../../src/agent/procedural/graph/canonical.js';
import type {
  IProceduralGraphBacking,
  PGCommitInput,
} from '../../../../../../src/agent/procedural/graph/backing/IProceduralGraphBacking.js';
import { PG_BUILT_IN_RELATIONS } from '../../../../../../src/types/proceduralGraph.js';
import type {
  PGDiagnostic,
  PGEvaluationReport,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
} from '../../../../../../src/types/proceduralGraph.js';

export function runBackingContract(
  name: string,
  open: () => Promise<IProceduralGraphBacking>,
): void {
  describe(`${name} backing contract`, () => {
    let backing: IProceduralGraphBacking;

    beforeEach(async () => {
      backing = await open();
    });

    afterEach(async () => {
      await backing.close();
    });

    it('createGraph returns headVersion 1 with null validationMean; second createGraph with same id rejects', async () => {
      const snapshot = makeSnapshot();
      const head = await backing.createGraph(snapshot);
      expect(head.graphId).toBe(snapshot.graphId);
      expect(head.revisionId).toBe(snapshot.revisionId);
      expect(head.headVersion).toBe(1);
      expect(head.validationMean).toBeNull();
      expect(head.evaluationFingerprint).toBeNull();
      expect(head.graphDigest).toBe(graphDigest(snapshot));

      await expect(backing.createGraph(makeSnapshot({ revisionId: 'rev-other' }))).rejects.toThrow(
        /graph-exists/,
      );
      const still = await backing.loadHead(snapshot.graphId);
      expect(still?.headVersion).toBe(1);
      expect(still?.revisionId).toBe(snapshot.revisionId);
    });

    it('loadRevision returns a deep-equal snapshot including null attributes and Unicode/multiline text', async () => {
      const snapshot = makeSnapshot({
        graphId: 'graph-unicode',
        revisionId: 'rev-unicode',
        nodes: [
          { id: 'Start', type: 'STATE', description: 'café 日本語\nsecond line 🎉' },
          { id: 'Act', type: 'ACTION', description: 'do thing', actionName: 'do_thing' },
        ],
        edges: [
          {
            source: 'Start',
            relation: 'LEADS_TO',
            target: 'Act',
            condition: null,
            guidance: null,
            pitfalls: 'avoid\nthis path',
          },
        ],
      });
      await backing.createGraph(snapshot);
      const loaded = await backing.loadRevision(snapshot.graphId, snapshot.revisionId);
      expect(loaded).toEqual(snapshot);
    });

    it('commitRetainedRevision with matching expectedHeadVersion commits and bumps headVersion', async () => {
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      const next = makeSnapshot({
        revisionId: 'rev-2',
        parentRevisionId: 'rev-1',
        nodes: [
          { id: 'Start', type: 'STATE', description: 'start v2' },
          { id: 'End', type: 'STATE', description: 'end' },
        ],
      });
      const validation = makeReport({ fingerprint: 'fp-commit', meanScore: 0.81 });
      const result = await backing.commitRetainedRevision({
        expectedHeadVersion: 1,
        revision: next,
        validation,
        round: makeRound({ retainedRevisionId: 'rev-2', candidateRevisionId: 'rev-2' }),
      });
      expect(result.status).toBe('committed');
      if (result.status !== 'committed') return;
      expect(result.head.headVersion).toBe(2);
      expect(result.head.revisionId).toBe('rev-2');
      expect(result.head.validationMean).toBe(0.81);
      expect(result.head.evaluationFingerprint).toBe('fp-commit');
      expect(result.head.graphDigest).toBe(graphDigest(next));
      expect(await backing.loadRevision(next.graphId, 'rev-2')).toEqual(next);
      expect(await backing.loadEvaluation(next.graphId, 'rev-2', 'fp-commit')).toEqual(validation);
    });

    it('commitRetainedRevision with stale expectedHeadVersion returns conflict and leaves head/revisions unchanged', async () => {
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      const accepted = makeSnapshot({ revisionId: 'rev-2', parentRevisionId: 'rev-1' });
      const first = await backing.commitRetainedRevision(makeCommit(accepted, 1, 0.7, 'fp-ok'));
      expect(first.status).toBe('committed');

      const beforeHead = await backing.loadHead(initial.graphId);
      const beforeRevs = await backing.listRevisions(initial.graphId, { offset: 0, limit: 20 });
      const stale = await backing.commitRetainedRevision(
        makeCommit(makeSnapshot({ revisionId: 'rev-stale', parentRevisionId: 'rev-2' }), 1, 0.1, 'fp-stale'),
      );
      expect(stale.status).toBe('conflict');
      if (stale.status !== 'conflict') return;
      expect(stale.currentHead).toEqual(beforeHead);
      expect(await backing.loadHead(initial.graphId)).toEqual(beforeHead);
      expect(await backing.listRevisions(initial.graphId, { offset: 0, limit: 20 })).toEqual(beforeRevs);
      expect(await backing.loadRevision(initial.graphId, 'rev-stale')).toBeUndefined();
    });

    it('two concurrent commits with the same expectedHeadVersion: exactly one commits', async () => {
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      const left = makeSnapshot({ revisionId: 'rev-left', parentRevisionId: 'rev-1' });
      const right = makeSnapshot({ revisionId: 'rev-right', parentRevisionId: 'rev-1' });
      const [a, b] = await Promise.all([
        backing.commitRetainedRevision(makeCommit(left, 1, 0.4, 'fp-left')),
        backing.commitRetainedRevision(makeCommit(right, 1, 0.6, 'fp-right')),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual(['committed', 'conflict']);
      const committed = a.status === 'committed' ? a : b;
      const conflicted = a.status === 'conflict' ? a : b;
      if (committed.status !== 'committed' || conflicted.status !== 'conflict') return;
      const head = await backing.loadHead(initial.graphId);
      expect(head?.headVersion).toBe(2);
      expect(head?.revisionId).toBe(committed.head.revisionId);
      const listed = await backing.listRevisions(initial.graphId, { offset: 0, limit: 20 });
      expect(listed.total).toBe(2);
      const ids = listed.items.map((item) => item.revisionId);
      expect(ids).toContain('rev-1');
      expect(ids).toContain(committed.head.revisionId);
      const loserId = committed.head.revisionId === 'rev-left' ? 'rev-right' : 'rev-left';
      expect(ids).not.toContain(loserId);
      expect(await backing.loadRevision(initial.graphId, loserId)).toBeUndefined();
    });

    it('setHead (rollback) to an existing revision bumps headVersion and copies that revision\'s evaluation mean or null', async () => {
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      const next = makeSnapshot({ revisionId: 'rev-2', parentRevisionId: 'rev-1' });
      const committed = await backing.commitRetainedRevision(makeCommit(next, 1, 0.75, 'fp-rev2'));
      expect(committed.status).toBe('committed');

      const rollback = await backing.setHead(initial.graphId, 'rev-1', 2, makeRound({
        round: 2,
        retainedRevisionId: 'rev-1',
        outcome: 'accepted',
        candidateMean: null,
      }));
      expect(rollback.status).toBe('committed');
      if (rollback.status !== 'committed') return;
      expect(rollback.head.headVersion).toBe(3);
      expect(rollback.head.revisionId).toBe('rev-1');
      expect(rollback.head.validationMean).toBeNull();
      expect(rollback.head.evaluationFingerprint).toBeNull();

      const restore = await backing.setHead(initial.graphId, 'rev-2', 3, makeRound({
        round: 3,
        retainedRevisionId: 'rev-2',
        outcome: 'accepted',
      }));
      expect(restore.status).toBe('committed');
      if (restore.status !== 'committed') return;
      expect(restore.head.headVersion).toBe(4);
      expect(restore.head.revisionId).toBe('rev-2');
      expect(restore.head.validationMean).toBe(0.75);
      expect(restore.head.evaluationFingerprint).toBe('fp-rev2');
    });

    it('setHead to a missing revision returns conflict without bumping', async () => {
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      const before = await backing.loadHead(initial.graphId);
      const result = await backing.setHead(
        initial.graphId,
        'rev-missing',
        1,
        makeRound({ retainedRevisionId: 'rev-1', outcome: 'conflict' }),
      );
      expect(result.status).toBe('conflict');
      if (result.status !== 'conflict') return;
      expect(result.currentHead).toEqual(before);
      expect(await backing.loadHead(initial.graphId)).toEqual(before);
    });

    it('appendRejection/listRejections paginate newest-first with total', async () => {
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      await backing.appendRejection(makeRejection({ proposalDigest: 'p1', recordedAt: '2026-01-01T00:00:01.000Z' }));
      await backing.appendRejection(makeRejection({ proposalDigest: 'p2', recordedAt: '2026-01-01T00:00:02.000Z' }));
      await backing.appendRejection(makeRejection({ proposalDigest: 'p3', recordedAt: '2026-01-01T00:00:03.000Z' }));

      const page1 = await backing.listRejections(initial.graphId, { offset: 0, limit: 2 });
      expect(page1.total).toBe(3);
      expect(page1.items.map((item) => item.proposalDigest)).toEqual(['p3', 'p2']);
      const page2 = await backing.listRejections(initial.graphId, { offset: 2, limit: 2 });
      expect(page2.total).toBe(3);
      expect(page2.items.map((item) => item.proposalDigest)).toEqual(['p1']);
    });

    it('listRevisions paginates and total counts all', async () => {
      await backing.createGraph(makeSnapshot({ revisionId: 'rev-1' }));
      await backing.commitRetainedRevision(
        makeCommit(makeSnapshot({ revisionId: 'rev-2', parentRevisionId: 'rev-1' }), 1, 0.2, 'fp-2'),
      );
      await backing.commitRetainedRevision(
        makeCommit(makeSnapshot({ revisionId: 'rev-3', parentRevisionId: 'rev-2' }), 2, 0.3, 'fp-3'),
      );

      const page1 = await backing.listRevisions('graph-1', { offset: 0, limit: 2 });
      expect(page1.total).toBe(3);
      expect(page1.items.map((item) => item.revisionId)).toEqual(['rev-3', 'rev-2']);
      const page2 = await backing.listRevisions('graph-1', { offset: 2, limit: 2 });
      expect(page2.total).toBe(3);
      expect(page2.items.map((item) => item.revisionId)).toEqual(['rev-1']);
    });

    it('saveEvaluation/loadEvaluation round-trip by fingerprint; a different fingerprint returns undefined', async () => {
      const snapshot = makeSnapshot();
      await backing.createGraph(snapshot);
      const report = makeReport({ fingerprint: 'fp-exact', meanScore: 0.42 });
      await backing.saveEvaluation(snapshot.graphId, snapshot.revisionId, report);
      expect(await backing.loadEvaluation(snapshot.graphId, snapshot.revisionId, 'fp-exact')).toEqual(report);
      expect(await backing.loadEvaluation(snapshot.graphId, snapshot.revisionId, 'fp-other')).toBeUndefined();
    });

    it('reopen after close observes the same head and revisions', async () => {
      if (backing.kind === 'memory') return;
      const initial = makeSnapshot();
      await backing.createGraph(initial);
      await backing.commitRetainedRevision(
        makeCommit(makeSnapshot({ revisionId: 'rev-2', parentRevisionId: 'rev-1' }), 1, 0.55, 'fp-reopen'),
      );
      const head = await backing.loadHead(initial.graphId);
      const revisions = await backing.listRevisions(initial.graphId, { offset: 0, limit: 20 });
      const rev2 = await backing.loadRevision(initial.graphId, 'rev-2');
      await backing.close();

      const reopened = await open();
      try {
        expect(await reopened.loadHead(initial.graphId)).toEqual(head);
        expect(await reopened.listRevisions(initial.graphId, { offset: 0, limit: 20 })).toEqual(revisions);
        expect(await reopened.loadRevision(initial.graphId, 'rev-2')).toEqual(rev2);
      } finally {
        await reopened.close();
      }
    });
  });
}

function makeSnapshot(overrides: Partial<PGSnapshot> = {}): PGSnapshot {
  return {
    schemaVersion: 1,
    graphId: 'graph-1',
    revisionId: 'rev-1',
    entryNodeId: 'Start',
    relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    cyclePolicy: 'reject',
    toolCatalogHash: 'catalog-hash',
    nodes: [
      { id: 'Start', type: 'STATE', description: 'start' },
      { id: 'End', type: 'STATE', description: 'end' },
    ],
    edges: [
      {
        source: 'Start',
        relation: 'LEADS_TO',
        target: 'End',
        condition: null,
        guidance: 'go',
        pitfalls: 'none',
      },
    ],
    ...overrides,
  };
}

function makeReport(overrides: Partial<PGEvaluationReport> = {}): PGEvaluationReport {
  return {
    fingerprint: 'fp-1',
    graphDigest: 'digest',
    taskCount: 1,
    completed: 1,
    meanScore: 0.8,
    scores: [{ taskId: 't1', score: 0.8 }],
    incomplete: false,
    evaluatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRound(overrides: Partial<PGRoundRecord> = {}): PGRoundRecord {
  return {
    runId: 'run-1',
    round: 1,
    retainedRevisionId: 'rev-1',
    candidateRevisionId: 'rev-2',
    outcome: 'accepted',
    baselineMean: 0.5,
    candidateMean: 0.8,
    diagnostics: [],
    repairs: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

function makeRejection(overrides: Partial<PGRejectionRecord> = {}): PGRejectionRecord {
  return {
    runId: 'run-1',
    round: 1,
    proposalDigest: 'prop-1',
    edits: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [] },
    reason: 'structural',
    diagnostics: [],
    retainedMean: null,
    retainedRevisionId: 'rev-1',
    trajectoryRefs: [],
    fingerprint: 'fp-rej',
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCommit(
  revision: PGSnapshot,
  expectedHeadVersion: number,
  meanScore: number,
  fingerprint: string,
): PGCommitInput {
  return {
    expectedHeadVersion,
    revision,
    validation: makeReport({ fingerprint, meanScore, graphDigest: graphDigest(revision) }),
    round: makeRound({
      retainedRevisionId: revision.revisionId,
      candidateRevisionId: revision.revisionId,
      candidateMean: meanScore,
    }),
  };
}

export function makeAtomicFailureRound(): PGRoundRecord {
  const diagnostic = {
    severity: 'error',
    code: 'injected-failure',
    message: 'stringify should throw',
    boom: 1n,
  } as unknown as PGDiagnostic;
  return makeRound({ diagnostics: [diagnostic] });
}

export { makeSnapshot, makeCommit };
