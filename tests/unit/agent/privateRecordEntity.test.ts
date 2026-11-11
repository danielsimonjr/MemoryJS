/**
 * Characterization of the private-entity shell shared by every knowledge/learning record builder.
 *
 * Each builder used to spell out the same literal: importance 5, visibility `private`,
 * accessCount 0, confirmationCount 0, version 1, plus `createdAt`/`lastModified` set to the raw
 * `now` argument (not `toIsoDateTime(now)`) and one record property. Confidence and
 * `contentHash` are the only differences. These tests snapshot the whole entity per kind so a
 * shared builder cannot drift on any of those fields.
 *
 * @module tests/unit/agent/privateRecordEntity
 */

import { describe, it, expect } from 'vitest';
import type { Entity } from '../../../src/types/types.js';
import { buildTraceEntity } from '../../../src/agent/learning/LearningTrace.js';
import { buildInstructionSetEntity } from '../../../src/agent/knowledge/InstructionSetManager.js';
import { applyOp, planWrites, workFrom } from '../../../src/agent/knowledge/knowledgeRevision.js';

const NOW = '2026-11-11T00:00:00.000Z';

/** Fields every one of these entities sets, with the same values. */
function expectPrivateShell(entity: Entity & Record<string, unknown>): void {
  expect(entity.importance).toBe(5);
  expect(entity.visibility).toBe('private');
  expect(entity.accessCount).toBe(0);
  expect(entity.confirmationCount).toBe(0);
  expect(entity.version).toBe(1);
  // Raw `now`, not a re-branded ISO string.
  expect(entity.createdAt).toBe(NOW);
  expect(entity.lastModified).toBe(NOW);
}

describe('buildTraceEntity', () => {
  it('keeps the learning_trace shell with confidence 1 and no contentHash', () => {
    const entity = buildTraceEntity(
      { id: 'trace-1', learnerKind: 'leaf', round: 0, subsetLabel: 'all' } as never,
      NOW,
    ) as unknown as Entity & Record<string, unknown>;
    expect(entity.name).toBe('trace-1');
    expect(entity.entityType).toBe('learning_trace');
    expect(entity.memoryType).toBe('learning_trace');
    expect(entity.confidence).toBe(1);
    expect('contentHash' in entity).toBe(false);
    expect(entity.learningTraceRecord).toBeDefined();
    expectPrivateShell(entity);
  });
});

describe('buildInstructionSetEntity', () => {
  it('keeps the instruction_set shell with confidence 1 and no contentHash', () => {
    const entity = buildInstructionSetEntity(
      { id: 'set-1', role: 'solver', sections: [] } as never,
      NOW,
    ) as unknown as Entity & Record<string, unknown>;
    expect(entity.name).toBe('set-1');
    expect(entity.entityType).toBe('instruction_set');
    expect(entity.memoryType).toBe('instruction_set');
    expect(entity.confidence).toBe(1);
    expect('contentHash' in entity).toBe(false);
    expect(entity.instructionSetRecord).toBeDefined();
    expectPrivateShell(entity);
  });
});

describe('applyOp creates', () => {
  const apply = (op: unknown): Entity => {
    const work = workFrom({ instructionSets: [], skills: [] });
    const reason = applyOp(op as never, work, NOW, 0);
    expect(reason).toBeUndefined();
    const created = [...work.creates].at(-1)?.entity;
    expect(created).toBeDefined();
    return created as Entity & Record<string, unknown>;
  };

  it('builds a heuristic with confidence 0.5', () => {
    const entity = apply({ op: 'heuristic.add', condition: 'c', action: 'a' }) as Entity & Record<string, unknown>;
    expect(entity.entityType).toBe('heuristic');
    expect(entity.memoryType).toBe('heuristic');
    expect(entity.confidence).toBe(0.5);
    expect('contentHash' in entity).toBe(false);
    expect(entity.heuristicRecord).toBeDefined();
    expectPrivateShell(entity);
  });

  it('builds a reflection with confidence 0.5', () => {
    const entity = apply({ op: 'memory.reflect', summary: 's', evidence: ['e'] }) as Entity & Record<string, unknown>;
    expect(entity.entityType).toBe('reflection');
    expect(entity.memoryType).toBe('reflection');
    expect(entity.confidence).toBe(0.5);
    expect('contentHash' in entity).toBe(false);
    expect(entity.reflectionRecord).toBeDefined();
    expectPrivateShell(entity);
  });

  it('builds a skill entity through planWrites with confidence 1 and a contentHash', () => {
    const skill = {
      name: 'sk',
      description: 'd',
      kind: 'procedure',
      scope: { domains: ['x'] },
      uncertainty: 0.2,
      body: 'body',
      resources: [],
      sources: [],
      lineage: {},
    };
    const work = workFrom({ instructionSets: [], skills: [] });
    expect(applyOp({ op: 'skill.add', skill } as never, work, NOW, 0)).toBeUndefined();
    const write = planWrites([], work, NOW).find((w) => w.kind === 'create');
    expect(write).toBeDefined();
    const entity = write!.entity as unknown as Entity & Record<string, unknown>;
    expect(entity.entityType).toBe('skill');
    expect(entity.memoryType).toBe('skill');
    expect(entity.confidence).toBe(1);
    expect(typeof entity.contentHash).toBe('string');
    expect(entity.skillRecord).toBeDefined();
    expectPrivateShell(entity);
  });
});
