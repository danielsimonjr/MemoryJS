/**
 * Revision machinery for `KnowledgeRepository` (Recursa RS-5/RS-6): applies
 * revision ops to an in-memory working copy of `K` and plans the batch writes
 * that bring live state to it. Pure except for `randomUUID` / `shortId` ids.
 * Split out of `KnowledgeRepository.ts` to keep both files under the size rule.
 *
 * @module agent/knowledge/knowledgeRevision
 * @experimental Part of the Recursa knowledge-repository work (spec RS-5).
 */

import { randomUUID } from 'crypto';
import type { Entity } from '../../types/types.js';
import type {
  InstructionSection,
  InstructionSetRecord,
  RevisionOp,
  SkillRecord,
  SkillSource,
} from '../../types/skills.js';
import {
  isInstructionSetEntity,
  isSkillEntity,
  toIsoDateTime,
  type Heuristic,
  type HeuristicId,
  type ReflectionId,
  type ReflectionRecord,
} from '../../types/agent-memory.js';
import { buildInstructionSetEntity } from './InstructionSetManager.js';
import { SKILL_KIND_VALUES, mintSkillId, skillDedupHash, skillObservations } from '../skills/skillRecordUtils.js';
import { canonicalKnowledgeJson, clone, compareIds, sha256Hex, shortId } from './knowledgeDigest.js';

/** Pre-write plan entry; `origin` is the revision op index responsible for it. */
export type PlannedWrite =
  | { kind: 'create'; entity: Entity; origin: number }
  | { kind: 'update'; name: string; updates: Partial<Entity>; origin: number };

/** Mutable working copy of `K` used while a revision is validated. */
export interface WorkState {
  /** Instruction sets by id. */
  sets: Map<string, InstructionSetRecord>;
  /** Skills by id (retired skills included). */
  skills: Map<string, SkillRecord>;
  /** Entities to create (heuristics, reflections). */
  creates: Array<{ entity: Entity; origin: number }>;
  /** Op index that last touched each id. */
  touched: Map<string, number>;
}

/** Working copy of the live payload. */
export function workFrom(live: { instructionSets: InstructionSetRecord[]; skills: SkillRecord[] }): WorkState {
  return {
    sets: new Map(live.instructionSets.map((set) => [set.id, clone(set)] as const)),
    skills: new Map(live.skills.map((skill) => [skill.id, clone(skill)] as const)),
    creates: [],
    touched: new Map(),
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateScope(scope: unknown): string | undefined {
  if (typeof scope !== 'object' || scope === null) return 'skill scope must be an object';
  const domains = (scope as { domains?: unknown }).domains;
  if (!isStringArray(domains) || domains.length === 0) return 'skill scope.domains must be a non-empty string array';
  return undefined;
}

function validateNewSkill(skill: unknown): string | undefined {
  if (typeof skill !== 'object' || skill === null) return 'skill.add requires a skill object';
  const s = skill as Record<string, unknown>;
  if (typeof s.name !== 'string' || s.name.trim().length === 0 || s.name.length > 80) {
    return 'skill name must be 1-80 characters';
  }
  if (typeof s.description !== 'string') return 'skill description must be a string';
  if (!SKILL_KIND_VALUES.includes(s.kind as SkillRecord['kind'])) {
    return `skill kind must be one of: ${SKILL_KIND_VALUES.join(', ')}`;
  }
  const scopeReason = validateScope(s.scope);
  if (scopeReason) return scopeReason;
  if (typeof s.body !== 'string') return 'skill body must be a string';
  if (!inUnitInterval(s.uncertainty as number)) return 'skill uncertainty must be within [0, 1]';
  if (!Array.isArray(s.resources) || !Array.isArray(s.sources)) return 'skill resources and sources must be arrays';
  if (typeof s.lineage !== 'object' || s.lineage === null) return 'skill lineage must be an object';
  return undefined;
}

/**
 * {@link applyOp} that never throws: an exception from a malformed op becomes
 * its rejection reason, so `applyRevision` keeps its never-throws contract.
 */
export function safeApplyOp(op: RevisionOp, work: WorkState, now: string, index: number): string | undefined {
  if (typeof op !== 'object' || op === null) return 'op must be an object';
  try {
    return applyOp(op, work, now, index);
  } catch (err) {
    return `malformed op: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function inUnitInterval(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function cloneSources(sources: readonly SkillSource[]): SkillSource[] {
  return sources.map((source) => ({ ...source }));
}

/**
 * Apply one revision op to the working state. Returns a rejection reason, or
 * `undefined` on success. The caller writes nothing when any op rejects.
 */
export function applyOp(op: RevisionOp, work: WorkState, now: string, index: number): string | undefined {
  switch (op.op) {
    case 'skill.add': {
      const reason = validateNewSkill(op.skill);
      if (reason) return reason;
      const id = mintSkillId(op.skill.name);
      const record: SkillRecord = {
        id,
        name: op.skill.name,
        description: op.skill.description,
        kind: op.skill.kind,
        scope: clone(op.skill.scope),
        uncertainty: op.skill.uncertainty,
        body: op.skill.body,
        resources: clone(op.skill.resources),
        sources: cloneSources(op.skill.sources),
        lineage: clone(op.skill.lineage),
        stats: { applied: 0, helped: 0, hurt: 0 },
        ...(op.skill.extra !== undefined ? { extra: clone(op.skill.extra) } : {}),
        createdAt: toIsoDateTime(now),
        lastUpdatedAt: toIsoDateTime(now),
      };
      work.skills.set(id, record);
      work.touched.set(id, index);
      return undefined;
    }
    case 'skill.update': {
      const current = work.skills.get(op.id);
      if (!current) return `unknown skill id: ${op.id}`;
      if (current.retired) return `skill is retired: ${op.id}`;
      const patch = op.patch;
      if (patch.uncertainty !== undefined && !inUnitInterval(patch.uncertainty)) {
        return 'skill uncertainty must be within [0, 1]';
      }
      if (typeof patch !== 'object' || patch === null) return 'skill.update requires a patch object';
      if (patch.scope !== undefined) {
        const scopeReason = validateScope(patch.scope);
        if (scopeReason) return scopeReason;
      }
      if (patch.body !== undefined && typeof patch.body !== 'string') return 'skill body must be a string';
      if (patch.description !== undefined && typeof patch.description !== 'string') {
        return 'skill description must be a string';
      }
      if (patch.sources !== undefined && !Array.isArray(patch.sources)) return 'skill sources must be an array';
      const next: SkillRecord = { ...current, lastUpdatedAt: toIsoDateTime(now) };
      if (patch.body !== undefined) next.body = patch.body;
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.scope !== undefined) next.scope = clone(patch.scope);
      if (patch.uncertainty !== undefined) next.uncertainty = patch.uncertainty;
      if (patch.sources !== undefined) next.sources = cloneSources(patch.sources);
      work.skills.set(op.id, next);
      work.touched.set(op.id, index);
      return undefined;
    }
    case 'skill.retire': {
      const current = work.skills.get(op.id);
      if (!current) return `unknown skill id: ${op.id}`;
      if (current.retired) return `skill already retired: ${op.id}`;
      if (typeof op.reason !== 'string' || op.reason.trim().length === 0) return 'retire reason must be non-empty';
      work.skills.set(op.id, { ...current, retired: { at: toIsoDateTime(now), reason: op.reason }, lastUpdatedAt: toIsoDateTime(now) });
      work.touched.set(op.id, index);
      return undefined;
    }
    case 'instruction.patch': {
      const set = work.sets.get(op.id);
      if (!set) return `unknown instruction set id: ${op.id}`;
      if (typeof op.heading !== 'string' || op.heading.trim().length === 0) return 'instruction heading must be non-empty';
      if (typeof op.text !== 'string' || !Array.isArray(op.sources)) return 'instruction text must be a string and sources an array';
      const existing = set.sections.find((section) => section.heading === op.heading);
      const replacement: InstructionSection = {
        heading: op.heading,
        text: op.text,
        sources: cloneSources(op.sources),
        uncertainty: existing?.uncertainty ?? 0.5,
      };
      const sections = existing
        ? set.sections.map((section) => (section.heading === op.heading ? replacement : section))
        : [...set.sections, replacement];
      work.sets.set(op.id, { ...set, sections, lastUpdatedAt: toIsoDateTime(now) });
      work.touched.set(op.id, index);
      return undefined;
    }
    case 'heuristic.add': {
      if (typeof op.condition !== 'string' || typeof op.action !== 'string' || op.condition.trim().length === 0 || op.action.trim().length === 0) {
        return 'heuristic condition and action must be non-empty';
      }
      const id = `h_${randomUUID()}`;
      const record: Heuristic = {
        id: id as HeuristicId,
        condition: op.condition,
        action: op.action,
        support: 0,
        contradictions: 0,
        confidence: 0.5,
        createdAt: toIsoDateTime(now),
        lastUpdatedAt: toIsoDateTime(now),
      };
      const entity = {
        name: id,
        entityType: 'heuristic',
        observations: [`[heuristic] ${op.condition} → ${op.action}`],
        createdAt: now,
        lastModified: now,
        importance: 5,
        memoryType: 'heuristic',
        visibility: 'private',
        accessCount: 0,
        confidence: 0.5,
        confirmationCount: 0,
        version: 1,
        heuristicRecord: record,
      } as unknown as Entity;
      work.creates.push({ entity, origin: index });
      work.touched.set(id, index);
      return undefined;
    }
    case 'memory.reflect': {
      if (typeof op.summary !== 'string' || op.summary.trim().length === 0) return 'reflection summary must be non-empty';
      if (!isStringArray(op.evidence)) return 'reflection evidence must be a string array';
      const id = `reflection-${shortId()}`;
      const evidence = [...op.evidence];
      const record: ReflectionRecord = {
        id: id as ReflectionId,
        timestamp: toIsoDateTime(now),
        scope: 'learning',
        summary: op.summary,
        keyInsights: [],
        evidence,
        generalization_confidence: 0.5,
        evidenceHash: sha256Hex(JSON.stringify(['learning', [...evidence].sort(compareIds)])),
      };
      const entity = {
        name: id,
        entityType: 'reflection',
        observations: [`[reflection] ${op.summary}`],
        createdAt: now,
        lastModified: now,
        importance: 5,
        memoryType: 'reflection',
        visibility: 'private',
        accessCount: 0,
        confidence: 0.5,
        confirmationCount: 0,
        version: 1,
        reflectionRecord: record,
      } as unknown as Entity;
      work.creates.push({ entity, origin: index });
      work.touched.set(id, index);
      return undefined;
    }
    default:
      return `unknown op: ${String((op as { op?: unknown }).op)}`;
  }
}

/** Entity for a skill record (used when a skill has no live entity yet). */
function buildSkillEntity(record: SkillRecord, now: string): Entity {
  return {
    name: record.id,
    entityType: 'skill',
    observations: skillObservations(record),
    contentHash: skillDedupHash(record.name, record.body),
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'skill',
    visibility: 'private',
    accessCount: 0,
    confidence: 1,
    confirmationCount: 0,
    version: 1,
    skillRecord: record,
  } as unknown as Entity;
}

/**
 * Diff the working state against live entities into a write plan. Records
 * compared canonically, so unchanged entities are not rewritten.
 */
export function planWrites(entities: readonly Entity[], work: WorkState, now: string): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  const liveSkills = new Map<string, Entity>();
  const liveSets = new Map<string, Entity>();
  for (const entity of entities) {
    if (isSkillEntity(entity)) liveSkills.set(entity.skillRecord.id, entity);
    if (isInstructionSetEntity(entity)) liveSets.set(entity.instructionSetRecord.id, entity);
  }
  for (const [id, record] of work.skills) {
    const origin = work.touched.get(id) ?? 0;
    const live = liveSkills.get(id);
    if (!live) {
      writes.push({ kind: 'create', entity: buildSkillEntity(record, now), origin });
    } else if (isSkillEntity(live) && canonicalKnowledgeJson(record) !== canonicalKnowledgeJson(live.skillRecord)) {
      writes.push({
        kind: 'update',
        name: live.name,
        updates: {
          skillRecord: record,
          lastModified: now,
          version: (live.version ?? 1) + 1,
          contentHash: skillDedupHash(record.name, record.body),
          observations: skillObservations(record),
        } as Partial<Entity>,
        origin,
      });
    }
  }
  for (const [id, record] of work.sets) {
    const origin = work.touched.get(id) ?? 0;
    const live = liveSets.get(id);
    if (!live) {
      writes.push({ kind: 'create', entity: buildInstructionSetEntity(record, now), origin });
    } else if (isInstructionSetEntity(live) && canonicalKnowledgeJson(record) !== canonicalKnowledgeJson(live.instructionSetRecord)) {
      writes.push({
        kind: 'update',
        name: live.name,
        updates: { instructionSetRecord: record, lastModified: now, version: (live.version ?? 1) + 1 } as Partial<Entity>,
        origin,
      });
    }
  }
  for (const created of work.creates) {
    writes.push({ kind: 'create', entity: created.entity, origin: created.origin });
  }
  return writes;
}

