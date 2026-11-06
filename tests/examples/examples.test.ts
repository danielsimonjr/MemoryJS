/**
 * Gate for the runnable examples in `examples/`. Every example's `main` runs against a fresh
 * temp path and the returned values are asserted, so a README sample that drifts from the API
 * fails here. Each example closes its own context in a `finally`, which runs before `afterEach`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as quickStart } from '../../examples/01-quick-start.js';
import { main as search } from '../../examples/02-search.js';
import { main as graphAlgorithms } from '../../examples/03-graph-algorithms.js';
import { main as importExport } from '../../examples/04-import-export.js';
import { main as agentMemory } from '../../examples/05-agent-memory.js';
import { main as multiAgent } from '../../examples/06-multi-agent.js';
import { main as governanceRbac } from '../../examples/07-governance-rbac.js';
import { main as versioningCausal } from '../../examples/08-versioning-causal.js';
import { main as recursaSkills } from '../../examples/09-recursa-skills-knowledge.js';
import { main as recursaLearning } from '../../examples/10-recursa-learning.js';
import { main as recursaBootstrap } from '../../examples/11-recursa-bootstrap.js';
import { main as harnessTools } from '../../examples/12-harness-tools.js';
import { main as reconstructive } from '../../examples/13-reconstructive-memory.js';
import { main as proceduralGraph } from '../../examples/14-procedural-graph.js';
import { main as sqlite } from '../../examples/15-sqlite.js';

type Result = Record<string, unknown>;
const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

/** Fresh temp directory per call; removed in afterEach. */
function tempPath(file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'memoryjs-examples-'));
  dirs.push(dir);
  return join(dir, file);
}

/** Every expected key is present and no value is undefined. */
function expectKeys(result: Result, keys: string[]): void {
  expect(Object.keys(result)).toEqual(expect.arrayContaining(keys));
  for (const [key, value] of Object.entries(result)) {
    expect(value, key).not.toBeUndefined();
  }
}

beforeAll(() => {
  // Examples choose their backend explicitly; keep the environment from overriding them and
  // keep embeddings off so the suite never loads a model.
  for (const key of ['MEMORY_STORAGE_TYPE', 'MEMORY_EMBEDDING_PROVIDER', 'MEMORY_GOVERNANCE_ENABLED']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe.each(['jsonl', 'sqlite'] as const)('examples on %s storage', (storageType) => {
  const file = storageType === 'sqlite' ? 'memory.db' : 'memory.jsonl';

  it('01-quick-start', async () => {
    const r = await quickStart(tempPath(file), { storageType });
    expectKeys(r, ['searchHits', 'entityImportance', 'languageNames', 'relationTypes', 'nodeObservations']);
    expect(r.searchHits).toEqual(['Node.js']);
    expect(r.entityImportance).toBe(8);
    expect(r.relationTypes).toEqual(['TypeScript runs_on Node.js']);
    expect(r.missingEntityError).toBe(true);
    expect(r.nodeObservations).toHaveLength(2);
  });

  it('02-search', async () => {
    const r = await search(tempPath(file), { storageType });
    expectKeys(r, ['rankedTop', 'fuzzyPositional', 'fuzzyOptions', 'booleanHits', 'filteredHits', 'hybridTop']);
    expect(typeof r.semanticAvailable).toBe('boolean');
    expect(r.rankedTop).toBe('Acme Corp');
    expect(r.rankedScoresPositive).toBe(true);
    expect(r.fuzzyPositional).toContain('Typescript');
    expect(r.fuzzyOptions).toEqual(['Typescript']);
    expect(r.booleanHits).toEqual(['Alice', 'Bob']);
    expect(r.filteredHits).toEqual(['Alice']);
    expect(r.hybridTop).toBe('Acme Corp');
  });
});

describe('examples on jsonl storage', () => {
  it('03-graph-algorithms', async () => {
    const r = await graphAlgorithms(tempPath('memory.jsonl'));
    expectKeys(r, ['shortestPath', 'componentCount', 'pagerankTopNames', 'pagerankScoreOfZ']);
    expect(r.shortestPath).toEqual(['A', 'D', 'Z']);
    expect(r.shortestLength).toBe(2);
    expect(r.unreachableIsNull).toBe(true);
    expect(r.componentCount).toBe(2);
    expect(r.largestComponentSize).toBe(5);
    expect(r.pagerankAlgorithm).toBe('pagerank');
    expect(r.pagerankTopNames).toHaveLength(3);
    expect(r.totalEntities).toBe(6);
    expect(r.totalRelations).toBe(5);
  });

  it('04-import-export', async () => {
    const r = await importExport(tempPath('memory.jsonl'));
    expectKeys(r, ['added', 'backupEntityCount', 'restoredEntityCount', 'entityNamesAfterRestore', 'publishedSkillCount']);
    expect(r.dryRunAdded).toBe(2);
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.backupEntityCount).toBe(2);
    expect(r.restoredEntityCount).toBe(2);
    expect(r.entityNamesAfterRestore).toEqual(['Acme', 'Alice']);
    expect(r.batchCreated).toBe(1);
    expect(r.publishedSkillCount).toBe(1);
  });

  it('05-agent-memory', async () => {
    const r = await agentMemory(tempPath('memory.jsonl'));
    expectKeys(r, ['sessionIsSession', 'episodeType', 'workingType', 'wakeUpMentionsSkill']);
    expect(r.sessionIsSession).toBe(true);
    expect(r.episodeType).toBe('episodic');
    expect(r.workingType).toBe('working');
    expect(r.firstTurnDuplicate).toBe(false);
    expect(r.repeatTurnDuplicate).toBe(true);
    expect(r.repeatCount).toBe(1);
    expect(r.userTurnCount).toBe(1);
    expect(r.wakeUpMentionsSkill).toBe(true);
    expect(r.timelineNonEmpty).toBe(true);
  });

  it('06-multi-agent', async () => {
    const r = await multiAgent(tempPath('memory.jsonl'));
    expectKeys(r, ['conflictCount', 'winnerAgents', 'directSeed']);
    expect(r.plannerViewIncludesShared).toBe(true);
    expect(r.plannerViewIncludesPrivate).toBe(true);
    expect(r.conflictCount).toBe(1);
    expect(r.conflictRecommended).toBe('researcher');
    expect(r.winnerAgents).toEqual(['researcher']);
    expect(r.directSeed).toBe('Launch plan');
  });

  it('07-governance-rbac', async () => {
    const r = await governanceRbac(tempPath('memory.jsonl'));
    expectKeys(r, ['governanceDeniedSecret', 'roadmapAuditEntries', 'auditChainValid', 'redactedText']);
    expect(r.governanceDeniedSecret).toBe(true);
    expect(r.roadmapAuditEntries).toBe(1);
    expect(r.auditChainValid).toBe(true);
    expect(r.aliceWrite).toBe(true);
    expect(r.aliceManage).toBe(false);
    expect(r.rootManage).toBe(true);
    expect(r.aliceGrants).toEqual(['writer']);
    expect(r.attributedEntity).toBe('Attributed note');
    expect(r.attributionRequired).toBe(true);
    expect(r.redactedText).toBe('Contact <EMAIL> or <PHONE>');
    expect(r.graphRedacted).toBe(true);
  });

  it('08-versioning-causal', async () => {
    const r = await versioningCausal(tempPath('memory.jsonl'));
    expectKeys(r, ['outgoingBeforeClose', 'acmeIn2024', 'acmeIn2026', 'effectTargets', 'causeSources']);
    expect(r.outgoingBeforeClose).toBe(1);
    expect(r.acmeIn2024).toBe(true);
    expect(r.acmeIn2026).toBe(false);
    expect(r.globexVisibleIn2026).toBe(true);
    expect(r.effectTargets).toEqual(['Flooding', 'Erosion']);
    expect(r.causeSources).toEqual(['Rain', 'Flooding']);
    expect(r.erosionWithoutFlooding).toBe(0);
    expect(r.stateChangeAdded).toEqual(['Drought']);
  });

  it('09-recursa-skills-knowledge', async () => {
    const r = await recursaSkills(tempPath('memory.jsonl'));
    expectKeys(r, ['matchedSkill', 'refundRetrieved', 'snapshotHasSkills', 'loadedMentionsRefund']);
    expect(r.matchedSkill).toBe('Refund duplicate charges');
    expect(r.refundRetrieved).toBe('Refund duplicate charges');
    expect(r.instructionSetId).toBe(true);
    expect(r.renderedHasTone).toBe(true);
    expect(r.snapshotHasSkills).toBe(2);
    expect(r.loadedMentionsRefund).toBe(true);
    expect(r.publishedSkillCount).toBe(2);
  });

  it('10-recursa-learning', async () => {
    const r = await recursaLearning(tempPath('memory.jsonl'));
    expectKeys(r, ['stoppedBecause', 'tasksBefore', 'tasksAfter', 'stepPhase']);
    expect(typeof r.stoppedBecause).toBe('string');
    expect(r.tasksBefore).toBe(3);
    expect(r.tasksAfter).toBe(3);
    expect(r.traceIdIsString).toBe(true);
    expect(r.stepProtocolFinished).toBe(true);
    expect(r.stepPhase).toBe('done');
  });

  it('11-recursa-bootstrap', async () => {
    const r = await recursaBootstrap(tempPath('memory.jsonl'));
    expectKeys(r, ['navigationLevels', 'practiceTaskCount', 'snapshotLabel', 'notesSkillKind']);
    expect(r.navigationLevels).toBe(2);
    expect(r.practiceTaskCount).toBe(4);
    expect(r.learnerCalls).toBe(1);
    expect(r.learnedSameTasks).toBe(true);
    expect(r.snapshotLabel).toBe('bootstrap');
    expect(r.notesSkillKind).toBe('convention');
  });

  it('12-harness-tools', async () => {
    const r = await harnessTools(tempPath('memory.jsonl'));
    expectKeys(r, ['toolCount', 'unknownToolCode']);
    expect(r.toolCount).toBe(14);
    expect(r.includesLoad).toBe(true);
    expect(r.loadOk).toBe(true);
    expect(r.loadMentionsSkill).toBe(true);
    expect(r.appendOk).toBe(true);
    expect(r.selectOk).toBe(true);
    expect(r.evalOk).toBe(true);
    expect(r.unknownToolCode).toBe('unknown_tool');
    expect(r.recordsLogged).toBe(true);
  });

  it('13-reconstructive-memory', async () => {
    const r = await reconstructive(tempPath('memory.jsonl'));
    expectKeys(r, ['sentencesDistilled', 'evidenceItems', 'trajectorySteps', 'contentNodes']);
    expect(r.sentencesDistilled).toBe(4);
    expect(r.evidenceItems).toBeGreaterThan(0);
    expect(r.trajectorySteps).toBeGreaterThan(0);
    expect(r.restoredContentNodes).toBe(r.contentNodes);
    expect(r.persisted).toBe(true);
  });

  it('14-procedural-graph', async () => {
    const r = await proceduralGraph(tempPath('memory.jsonl'));
    expectKeys(r, ['created', 'sessionOpened', 'guidanceStatus', 'nodeCount', 'edgeCount', 'headVersion']);
    expect(r.created).toBe(true);
    expect(r.sessionOpened).toBe(true);
    expect(r.guidanceStatus).toBe('ok');
    expect(r.nodeCount).toBe(3);
    expect(r.edgeCount).toBe(2);
    expect(r.headVersion).toBe(1);
  });

  it('15-sqlite', async () => {
    const r = await sqlite(tempPath('memory.db'));
    expectKeys(r, ['isSqlite', 'ftsTop', 'searchHits', 'persistedAcrossContexts']);
    expect(r.isSqlite).toBe(true);
    expect(r.ftsTop).toBe('Ledger');
    expect(r.ftsHasScore).toBe(true);
    expect(r.searchHits).toEqual(['Runbook']);
    expect(r.persistedAcrossContexts).toBe(true);
  });
});
