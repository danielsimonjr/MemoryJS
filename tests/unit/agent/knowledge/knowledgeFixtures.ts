/** Shared fixtures for the Recursa knowledge-repository tests (RS-4, RS-5). */
import type { Entity, IGraphStorage } from '../../../../src/types/types.js';
import {
  toIsoDateTime,
  type FailureRecord,
} from '../../../../src/types/agent-memory.js';
import type {
  KnowledgeRevisionRecord,
  RevisionOp,
  SkillId,
  SkillRecord,
} from '../../../../src/types/skills.js';
import type {
  FailureLookupLike,
  SkillManagerLike,
  SkillMatchLike,
} from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../../src/core/SQLiteStorage.js';
import type { BackendCase } from '../../../helpers/tempStorage.js';

export const FIXED_TIME = '2026-11-06T00:00:00.000Z';

/** Build a valid skill record; `overrides` replaces any field. */
export function makeSkill(id: string, overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: id as SkillId,
    name: id,
    description: 'use when paginating api results',
    kind: 'procedure',
    scope: { domains: ['api'] },
    uncertainty: 0.2,
    body: 'Follow the cursor until the response is exhausted.',
    resources: [],
    sources: [{ ref: 'doc:api-guide', kind: 'document' }],
    lineage: {},
    stats: { applied: 0, helped: 0, hurt: 0 },
    createdAt: toIsoDateTime(FIXED_TIME),
    lastUpdatedAt: toIsoDateTime(FIXED_TIME),
    ...overrides,
  };
}

/** Persist a skill record as a `skill` entity, bypassing SkillManager. */
export async function seedSkill(storage: IGraphStorage, record: SkillRecord): Promise<void> {
  const entity = {
    name: record.id,
    entityType: 'skill',
    observations: [`[skill-name]: ${record.name}`],
    createdAt: FIXED_TIME,
    lastModified: FIXED_TIME,
    importance: 5,
    memoryType: 'skill',
    visibility: 'private',
    accessCount: 0,
    confidence: 1,
    confirmationCount: 0,
    version: 1,
    skillRecord: record,
  } as unknown as Entity;
  await storage.appendEntity(entity);
}

/** Build a revision record. */
export function makeRevision(id: string, baseSnapshotId: string, ops: RevisionOp[]): KnowledgeRevisionRecord {
  return {
    id,
    baseSnapshotId,
    ops,
    rationale: 'fixture revision',
    diagnosedFailureIds: [],
    producedBy: 'manual',
    createdAt: toIsoDateTime(FIXED_TIME),
  };
}

/** Skill payload for a `skill.add` op (no id or timestamps). */
export function skillInput(name: string, overrides: Partial<SkillRecord> = {}): Extract<RevisionOp, { op: 'skill.add' }>['skill'] {
  const base = makeSkill(name, overrides);
  return {
    name: base.name,
    description: base.description,
    kind: base.kind,
    scope: base.scope,
    uncertainty: base.uncertainty,
    body: base.body,
    resources: base.resources,
    sources: base.sources,
    lineage: base.lineage,
    extra: base.extra,
  };
}

const notUsed = (name: string) => async (): Promise<never> => {
  throw new Error(`fake SkillManager.${name} is not used by this test`);
};

/** In-memory SkillManagerLike: `match` ranks every live skill equally. */
export function fakeSkills(records: readonly SkillRecord[]): SkillManagerLike {
  return {
    add: notUsed('add') as SkillManagerLike['add'],
    get: (id) => records.find((r) => r.id === id),
    list: async () => [...records],
    update: notUsed('update') as SkillManagerLike['update'],
    retire: notUsed('retire') as SkillManagerLike['retire'],
    recordOutcome: notUsed('recordOutcome') as SkillManagerLike['recordOutcome'],
    loadForContext: notUsed('loadForContext') as SkillManagerLike['loadForContext'],
    match: async (_hint, options = {}): Promise<SkillMatchLike[]> =>
      records
        .filter((r) => r.retired === undefined)
        .slice(0, options.limit ?? 5)
        .map((skill) => ({ skill, score: 1, matched: [] })),
  };
}

/** FailureLookupLike that always returns `records`. */
export function fakeFailures(records: readonly FailureRecord[]): FailureLookupLike {
  return { lookupForTask: async () => [...records] };
}

/** A failure record with the fields `loadForContext` renders. */
export function makeFailure(id: string): FailureRecord {
  return {
    id,
    timestamp: toIsoDateTime(FIXED_TIME),
    context: 'paginate results',
    attempted: 'read first page only',
    failure_mode: 'missed later pages',
    root_cause: 'no cursor loop',
    alternative_taken: 'loop on next cursor',
    applicability_hint: 'paginating api results',
    lifecycle: { status: 'open' },
  } as unknown as FailureRecord;
}

/**
 * Reopen the file behind `storage` as a new instance of the same backend.
 * The caller closes the returned instance; the original is left to the
 * `withBothBackends` cleanup.
 */
export function reopen(backend: BackendCase, storage: IGraphStorage): IGraphStorage {
  const path = (storage as unknown as { getFilePath(): string }).getFilePath();
  return backend.name === 'jsonl'
    ? (new GraphStorage(path) as unknown as IGraphStorage)
    : (new SQLiteStorage(path) as unknown as IGraphStorage);
}

/** Close a storage instance that exposes `close`. */
export function closeStorage(storage: IGraphStorage): void {
  (storage as unknown as { close?: () => void }).close?.();
}
