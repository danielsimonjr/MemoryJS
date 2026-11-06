/**
 * Recursa skill, instruction-set, knowledge-snapshot and navigation types.
 *
 * Data-only contracts (records, entities, unions). Behaviour lives in
 * `src/agent/skills`, `src/agent/knowledge` and `src/agent/bootstrap`.
 * This file imports only from other `src/types` modules.
 *
 * @module types/skills
 * @experimental Part of the Recursa knowledge-repository work (spec RS-1..RS-11).
 */

import type { AgentEntity, IsoDateTime } from './agent-memory.js';

/** Branded identifier for a skill record. */
export type SkillId = string & { readonly __brand: 'SkillId' };

/** Kind of knowledge a skill captures. */
export type SkillKind = 'navigation' | 'procedure' | 'judgment' | 'convention' | 'tool';

/** Provenance link retained by every skill, instruction section and navigation node. */
export interface SkillSource {
  /** Stable reference to the origin (document ref, entity name, URL, trace address or `task:<id>`). */
  ref: string;
  /** Category of the origin. */
  kind: 'document' | 'entity' | 'url' | 'trace' | 'task';
  /** Optional short quotation supporting the entry. */
  excerpt?: string;
}

/** A bundled file that accompanies a skill (script, reference doc or template). */
export interface SkillResource {
  /** File name as it appears in the skill directory. */
  name: string;
  /** Location of the resource content. */
  ref: string;
  /** Role of the resource. */
  kind: 'script' | 'reference' | 'template';
}

/**
 * Persisted skill: an Agent-Skills-style unit of retrievable knowledge.
 * `body` is the Markdown instruction text (the SKILL.md body).
 */
export interface SkillRecord {
  /** Stable skill identifier. */
  id: SkillId;
  /** Agent Skills `name` (human-readable, at most 80 characters). */
  name: string;
  /** When to apply the skill; the primary retrieval key. */
  description: string;
  /** Kind of knowledge captured. */
  kind: SkillKind;
  /** Applicable scope used for matching. */
  scope: { domains: string[]; tasks?: string[]; tools?: string[] };
  /** Self-assessed uncertainty in [0, 1]. */
  uncertainty: number;
  /** Markdown instructions (SKILL.md body). */
  body: string;
  /** Bundled resources. */
  resources: SkillResource[];
  /** Sources the skill was derived from. */
  sources: SkillSource[];
  /** Lineage back to the revision and tasks that produced the skill. */
  lineage: {
    revisionId?: string;
    parentSkillId?: SkillId;
    learnedFromTaskIds?: string[];
    /** What produced the current content (`'manual'` after a SKILL.md edit is absorbed). */
    producedBy?: 'leaf' | 'merge' | 'bootstrap' | 'manual';
  };
  /** Usage outcome counters. */
  stats: { applied: number; helped: number; hurt: number };
  /** Set when the skill is retired; retired skills are never deleted. */
  retired?: { at: IsoDateTime; reason: string };
  /** `skillContentHash` of the SKILL.md text from the last publish (spec RS-3). */
  publishedHash?: string;
  /** Harness front-matter keys preserved verbatim (for example `allowed-tools`). */
  extra?: Record<string, unknown>;
  /** Creation timestamp. */
  createdAt: IsoDateTime;
  /** Last modification timestamp. */
  lastUpdatedAt: IsoDateTime;
}

/** Entity wrapper for a {@link SkillRecord}. `name` follows `skill-<slug>-<shortId>`. */
export interface SkillEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'skill';
  /** The persisted skill record. */
  skillRecord: SkillRecord;
}

/** Role an instruction set applies to. */
export type InstructionSetRole = 'solver' | 'learner' | 'shared';

/** One heading-addressed section of an instruction set. */
export interface InstructionSection {
  /** Section heading (unique within the set). */
  heading: string;
  /** Section body text. */
  text: string;
  /** Sources supporting the section. */
  sources: SkillSource[];
  /** Self-assessed uncertainty in [0, 1]. */
  uncertainty: number;
}

/** Editable, versioned, source-linked instructions for a role. */
export interface InstructionSetRecord {
  /** Stable identifier (`instructions-<role>-<shortId>`). */
  id: string;
  /** Role the instructions apply to. */
  role: InstructionSetRole;
  /** Ordered sections. */
  sections: InstructionSection[];
  /** Creation timestamp. */
  createdAt: IsoDateTime;
  /** Last modification timestamp. */
  lastUpdatedAt: IsoDateTime;
}

/** Entity wrapper for an {@link InstructionSetRecord}. */
export interface InstructionSetEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'instruction_set';
  /** The persisted instruction-set record. */
  instructionSetRecord: InstructionSetRecord;
}

/** A single edit inside a knowledge revision. */
export type RevisionOp =
  | {
      /** Add a new skill. */
      op: 'skill.add';
      /** Skill content; identifiers and timestamps are assigned on apply. */
      skill: Omit<SkillRecord, 'id' | 'createdAt' | 'lastUpdatedAt' | 'stats' | 'retired'>;
    }
  | {
      /** Update fields of an existing skill. */
      op: 'skill.update';
      /** Target skill. */
      id: SkillId;
      /** Fields to overwrite. */
      patch: Partial<Pick<SkillRecord, 'body' | 'description' | 'scope' | 'uncertainty' | 'sources'>>;
    }
  | {
      /** Retire an existing skill (never deleted). */
      op: 'skill.retire';
      /** Target skill. */
      id: SkillId;
      /** Reason recorded on the retirement. */
      reason: string;
    }
  | {
      /** Replace or add one heading of an instruction set. */
      op: 'instruction.patch';
      /** Target instruction set. */
      id: string;
      /** Section heading. */
      heading: string;
      /** New section text. */
      text: string;
      /** Sources for the new text. */
      sources: SkillSource[];
    }
  | {
      /** Add a condition-to-action heuristic. */
      op: 'heuristic.add';
      /** Condition text. */
      condition: string;
      /** Action text. */
      action: string;
    }
  | {
      /** Record a reflection summary. */
      op: 'memory.reflect';
      /** Summary text. */
      summary: string;
      /** Evidence references. */
      evidence: string[];
    };

/** A proposed, validated batch of edits to the knowledge repository. */
export interface KnowledgeRevisionRecord {
  /** Stable identifier (`revision-<shortId>`). */
  id: string;
  /** Snapshot the revision was derived from. */
  baseSnapshotId: string;
  /** Ordered edits. */
  ops: RevisionOp[];
  /** Human-readable justification. */
  rationale: string;
  /** Failure records the revision addresses. */
  diagnosedFailureIds: string[];
  /** Origin of the revision. */
  producedBy: 'leaf' | 'merge' | 'bootstrap' | 'manual';
  /** Creation timestamp. */
  createdAt: IsoDateTime;
}

/** Entity wrapper for a {@link KnowledgeRevisionRecord}. */
export interface KnowledgeRevisionEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'knowledge_revision';
  /** The persisted revision record. */
  knowledgeRevisionRecord: KnowledgeRevisionRecord;
}

/**
 * Full-payload snapshot of the knowledge repository `K`.
 * `digest` is a SHA-256 over the canonical JSON of `instructionSets` and `skills`.
 */
export interface KnowledgeSnapshotRecord {
  /** Snapshot identifier (`K-<n>`). */
  id: string;
  /** Optional human-readable label (metadata only). */
  label?: string;
  /** Creation timestamp. */
  createdAt: IsoDateTime;
  /** Complete instruction-set payload. */
  instructionSets: InstructionSetRecord[];
  /** Complete skill payload. */
  skills: SkillRecord[];
  /** References to non-skill memory. */
  memoryRefs: { heuristicIds: string[]; failureIds: string[]; reflectionIds: string[] };
  /** SHA-256 digest of the canonical payload. */
  digest: string;
}

/** Entity wrapper for a {@link KnowledgeSnapshotRecord}. */
export interface KnowledgeSnapshotEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'knowledge_snapshot';
  /** The persisted snapshot record. */
  knowledgeSnapshotRecord: KnowledgeSnapshotRecord;
}

/** A node of the corpus navigation tree (leaf = one source, higher levels = summaries). */
export interface NavigationNodeRecord {
  /** Tree level; 0 for leaves. */
  level: number;
  /** Source reference (leaf) or shard reference (summary). */
  ref: string;
  /** Node title. */
  title: string;
  /** Summary text. */
  summary: string;
  /** Extracted keywords. */
  keywords: string[];
  /** Free-form structured metadata. */
  metadata: Record<string, unknown>;
  /** Content hash used for conflict detection. */
  contentHash: string;
  /** Source references covered by this node. */
  sourceRefs: string[];
}

/** Entity wrapper for a {@link NavigationNodeRecord}. */
export interface NavigationNodeEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'navigation_node';
  /** The persisted navigation record. */
  navigationNodeRecord: NavigationNodeRecord;
}

/** Recorded coverage status of a region of the corpus. */
export interface CoverageRecord {
  /** Region name or slug. */
  region: string;
  /** Whether the material is present, absent or only partly present. */
  status: 'present' | 'absent' | 'partial';
  /** Sources supporting the status. */
  evidence: SkillSource[];
  /** Free-form note. */
  note: string;
  /** When the status was recorded. */
  recordedAt: IsoDateTime;
}

/** Entity wrapper for a {@link CoverageRecord}. `name` follows `coverage-<region-slug>`. */
export interface CoverageEntity extends AgentEntity {
  /** Memory type discriminator. */
  memoryType: 'coverage';
  /** The persisted coverage record. */
  coverageRecord: CoverageRecord;
}
