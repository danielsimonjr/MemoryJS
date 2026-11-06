/**
 * Guard and vocabulary tests for the Recursa knowledge-repository entity types
 * (src/types/skills.ts, spec §3.0 / RS-1 / RS-4 / RS-5 / RS-6 / RS-10 / RS-11).
 */
import { describe, it, expect } from 'vitest';
import {
  MEMORY_TYPES,
  isSkillEntity,
  isInstructionSetEntity,
  isKnowledgeSnapshotEntity,
  isKnowledgeRevisionEntity,
  isNavigationNodeEntity,
  isCoverageEntity,
} from '../../../src/types/index.js';
import type { ReflectionScope } from '../../../src/types/agent-memory.js';

const NOW = '2026-11-06T00:00:00.000Z';

/** Shared AgentEntity base fields every valid fixture needs. */
function base(memoryType: string, name: string): Record<string, unknown> {
  return {
    name,
    entityType: memoryType,
    observations: [],
    memoryType,
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility: 'private',
  };
}

interface GuardCase {
  label: string;
  guard: (entity: unknown) => boolean;
  memoryType: string;
  recordKey: string;
  name: string;
  record: Record<string, unknown>;
  /** Fields the guard checks; deleting any one must make the guard reject. */
  required: string[];
}

const SKILL_RECORD = {
  id: 'skill-1',
  name: 'Find the config loader',
  description: 'Use when locating configuration loading code',
  kind: 'navigation',
  scope: { domains: ['config'] },
  uncertainty: 0.2,
  body: '## When\nconfig\n## Do\nsearch loaders',
  resources: [],
  sources: [{ ref: 'doc-1', kind: 'document' }],
  lineage: {},
  stats: { applied: 0, helped: 0, hurt: 0 },
  createdAt: NOW,
  lastUpdatedAt: NOW,
};

const CASES: GuardCase[] = [
  {
    label: 'isSkillEntity',
    guard: isSkillEntity,
    memoryType: 'skill',
    recordKey: 'skillRecord',
    name: 'skill-find-config-loader-a1',
    record: SKILL_RECORD,
    required: ['id', 'name', 'description', 'kind', 'scope', 'uncertainty', 'body',
      'resources', 'sources', 'lineage', 'stats', 'createdAt', 'lastUpdatedAt'],
  },
  {
    label: 'isInstructionSetEntity',
    guard: isInstructionSetEntity,
    memoryType: 'instruction_set',
    recordKey: 'instructionSetRecord',
    name: 'instructions-solver-b2',
    record: {
      id: 'instructions-solver-b2',
      role: 'solver',
      sections: [{ heading: 'Guardrails', text: 'Cite sources', sources: [], uncertainty: 0 }],
      createdAt: NOW,
      lastUpdatedAt: NOW,
    },
    required: ['id', 'role', 'sections', 'createdAt', 'lastUpdatedAt'],
  },
  {
    label: 'isKnowledgeSnapshotEntity',
    guard: isKnowledgeSnapshotEntity,
    memoryType: 'knowledge_snapshot',
    recordKey: 'knowledgeSnapshotRecord',
    name: 'K-0',
    record: {
      id: 'K-0',
      label: 'bootstrap',
      createdAt: NOW,
      instructionSets: [],
      skills: [SKILL_RECORD],
      memoryRefs: { heuristicIds: [], failureIds: [], reflectionIds: [] },
      digest: 'abc123',
    },
    required: ['id', 'createdAt', 'instructionSets', 'skills', 'memoryRefs', 'digest'],
  },
  {
    label: 'isKnowledgeRevisionEntity',
    guard: isKnowledgeRevisionEntity,
    memoryType: 'knowledge_revision',
    recordKey: 'knowledgeRevisionRecord',
    name: 'revision-c3',
    record: {
      id: 'revision-c3',
      baseSnapshotId: 'K-0',
      ops: [{ op: 'memory.reflect', summary: 'noted', evidence: [] }],
      rationale: 'missing config knowledge',
      diagnosedFailureIds: [],
      producedBy: 'leaf',
      createdAt: NOW,
    },
    required: ['id', 'baseSnapshotId', 'ops', 'rationale', 'diagnosedFailureIds', 'producedBy', 'createdAt'],
  },
  {
    label: 'isNavigationNodeEntity',
    guard: isNavigationNodeEntity,
    memoryType: 'navigation_node',
    recordKey: 'navigationNodeRecord',
    name: 'nav-0-d4',
    record: {
      level: 0,
      ref: 'doc-1',
      title: 'Config doc',
      summary: 'Explains loading',
      keywords: ['config'],
      metadata: {},
      contentHash: 'h1',
      sourceRefs: ['doc-1'],
    },
    required: ['level', 'ref', 'title', 'summary', 'keywords', 'metadata', 'contentHash', 'sourceRefs'],
  },
  {
    label: 'isCoverageEntity',
    guard: isCoverageEntity,
    memoryType: 'coverage',
    recordKey: 'coverageRecord',
    name: 'coverage-billing',
    record: {
      region: 'billing',
      status: 'partial',
      evidence: [{ ref: 'doc-2', kind: 'document' }],
      note: 'only the invoices are covered',
      recordedAt: NOW,
    },
    required: ['region', 'status', 'evidence', 'note', 'recordedAt'],
  },
];

/** Builds a complete, valid entity for a case. */
function validEntity(c: GuardCase, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base(c.memoryType, c.name), [c.recordKey]: structuredClone(c.record), ...overrides };
}

/** Clones a case record and applies a mutation to it. */
function withRecord(c: GuardCase, mutate: (r: Record<string, unknown>) => void): Record<string, unknown> {
  const record = structuredClone(c.record);
  mutate(record);
  return { ...base(c.memoryType, c.name), [c.recordKey]: record };
}

describe('Recursa entity guards (table-driven)', () => {
  for (const c of CASES) {
    describe(c.label, () => {
      it('accepts a valid fixture', () => {
        expect(c.guard(validEntity(c))).toBe(true);
      });

      it('rejects a wrong memoryType', () => {
        expect(c.guard(validEntity(c, { memoryType: 'working' }))).toBe(false);
      });

      it('rejects a non-canonical memoryType spelling', () => {
        expect(c.guard(validEntity(c, { memoryType: c.memoryType.toUpperCase() }))).toBe(false);
      });

      it('rejects an entity with no record field', () => {
        const entity = validEntity(c);
        delete entity[c.recordKey];
        expect(c.guard(entity)).toBe(false);
      });

      it('rejects a null record', () => {
        expect(c.guard(validEntity(c, { [c.recordKey]: null }))).toBe(false);
      });

      it('rejects a record stored under the wrong key', () => {
        const entity = validEntity(c);
        delete entity[c.recordKey];
        entity.someOtherRecord = structuredClone(c.record);
        expect(c.guard(entity)).toBe(false);
      });

      for (const field of c.required) {
        it(`rejects a record missing required field "${field}"`, () => {
          const entity = withRecord(c, (r) => {
            delete r[field];
          });
          expect(c.guard(entity)).toBe(false);
        });
      }

      it('rejects a record whose required fields have the wrong shape', () => {
        // Replacing every required field with a number makes every shape check fail.
        const entity = withRecord(c, (r) => {
          for (const field of c.required) r[field] = 42;
        });
        expect(c.guard(entity)).toBe(false);
      });

      for (const field of c.required) {
        it(`rejects a record whose "${field}" is the wrong shape`, () => {
          const entity = withRecord(c, (r) => {
            r[field] = Symbol.for('wrong-shape');
          });
          expect(c.guard(entity)).toBe(false);
        });
      }

      it('rejects non-objects', () => {
        expect(c.guard(null)).toBe(false);
        expect(c.guard('skill')).toBe(false);
        expect(c.guard(undefined)).toBe(false);
      });
    });
  }
});

describe('Recursa optional fields', () => {
  it('accepts a skill with retired, extra and lineage fields present', () => {
    const entity = withRecord(CASES[0], (r) => {
      r.retired = { at: NOW, reason: 'superseded' };
      r.extra = { 'allowed-tools': ['bash'] };
      r.lineage = { revisionId: 'revision-c3' };
    });
    expect(isSkillEntity(entity)).toBe(true);
  });

  it('rejects a skill whose retired field is null or a number', () => {
    expect(isSkillEntity(withRecord(CASES[0], (r) => { r.retired = null; }))).toBe(false);
    expect(isSkillEntity(withRecord(CASES[0], (r) => { r.retired = 5; }))).toBe(false);
  });

  it('accepts a skill with retired explicitly undefined', () => {
    expect(isSkillEntity(withRecord(CASES[0], (r) => { r.retired = undefined; }))).toBe(true);
  });

  it('accepts a snapshot with the optional label omitted', () => {
    const c = CASES[2];
    const record = structuredClone(c.record);
    delete record.label;
    expect(isKnowledgeSnapshotEntity({ ...base(c.memoryType, c.name), [c.recordKey]: record })).toBe(true);
  });
});

describe('MEMORY_TYPES and ReflectionScope (Recursa additions)', () => {
  it('contains the 13 original values followed by the 8 Recursa values, in order', () => {
    expect(MEMORY_TYPES).toEqual([
      'working', 'episodic', 'semantic', 'procedural', 'prospective', 'failure', 'plan',
      'reflection', 'heuristic', 'exclusion', 'decision', 'project_context', 'tool_affordance',
      'skill', 'instruction_set', 'knowledge_snapshot', 'knowledge_revision', 'navigation_node',
      'coverage', 'task', 'learning_trace',
    ]);
    expect(MEMORY_TYPES).toHaveLength(21);
  });

  it('accepts "learning" as a ReflectionScope', () => {
    const scopes: ReflectionScope[] = ['session', 'project', 'global', 'learning'];
    expect(scopes).toContain('learning');
    const scope: ReflectionScope = 'learning';
    expect(scope).toBe('learning');
  });
});
