/**
 * Unit tests for RevisionMerger (spec RS-20).
 */

import { describe, it, expect } from 'vitest';
import { RevisionMerger } from '../../../../src/agent/learning/RevisionMerger.js';
import type { ChildOutcome } from '../../../../src/agent/learning/RevisionMerger.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import type { RevisionOp, SkillId } from '../../../../src/types/skills.js';
import { toIsoDateTime } from '../../../../src/types/agent-memory.js';
import { AbortError } from '../../../../src/agent/harness/ConcurrencyLimiter.js';

/**
 * Skill-add op with a distinguishable name.
 *
 * @param name - Skill name
 * @param body - Skill body
 * @param opts - Kind, domains and uncertainty
 * @returns Revision op
 */
function addOp(
  name: string,
  body: string,
  opts: { kind?: string; domains?: string[]; uncertainty?: number; sources?: string[] } = {},
): RevisionOp {
  return {
    op: 'skill.add',
    skill: {
      name,
      description: `when ${name}`,
      kind: (opts.kind ?? 'procedure') as 'procedure',
      scope: { domains: opts.domains ?? ['billing'] },
      uncertainty: opts.uncertainty ?? 0.2,
      body,
      resources: [],
      sources: (opts.sources ?? []).map((ref) => ({ ref, kind: 'document' as const })),
      lineage: {},
    },
  };
}

/**
 * Skill-update op.
 *
 * @param id - Target skill id
 * @param patch - Patch
 * @returns Revision op
 */
function updateOp(id: string, patch: { body?: string; uncertainty?: number }): RevisionOp {
  return { op: 'skill.update', id: id as SkillId, patch };
}

/**
 * Child outcome wrapping a list of ops.
 *
 * @param label - Child label
 * @param ops - Ops
 * @param fixed - Fixed task ids
 * @param evidenceDomains - Optional evidence domains
 * @returns Child outcome
 */
function child(label: string, ops: RevisionOp[], fixed: string[] = [], evidenceDomains?: string[]): ChildOutcome {
  return {
    label,
    revision: {
      id: `revision-${label}`,
      baseSnapshotId: 'K-1',
      ops,
      rationale: `why ${label}`,
      diagnosedFailureIds: [],
      producedBy: 'leaf',
      createdAt: toIsoDateTime(new Date(0)),
    },
    fixed,
    regressed: [],
    evidenceDomains,
  };
}

/**
 * Provider returning a fixed answer.
 *
 * @param reply - Reply text
 * @returns Provider
 */
function provider(reply: string): PGCompletionProvider {
  return { complete: async () => reply };
}

/**
 * Words `prefix0..prefixN-1`, joined by spaces.
 *
 * @param prefix - Word prefix
 * @param n - Count
 * @returns Space-joined text
 */
function words(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
}

describe('RevisionMerger: dedupe', () => {
  it('drops a skill.add at exactly Jaccard 0.85', async () => {
    const base = words('term', 17);
    const a = `${base} ${words('extra', 3)}`;
    const merger = new RevisionMerger();
    const result = await merger.merge([
      child('A', [addOp('A-skill', a)], ['t1']),
      child('B', [addOp('B-skill', base)], ['t1', 't2']),
    ]);
    expect(result.dedupedSkillAdds).toBe(1);
    expect(result.revision.ops).toHaveLength(1);
    expect(result.revision.ops[0]).toMatchObject({ op: 'skill.add', skill: { name: 'B-skill' } });
  });

  it('keeps both skill.add ops at Jaccard 0.84', async () => {
    const base = words('term', 21);
    const b = `${base} ${words('bx', 4)}`;
    const result = await new RevisionMerger().merge([
      child('A', [addOp('A-skill', base)], ['t1']),
      child('B', [addOp('B-skill', b, { domains: ['ops'] })], ['t1', 't2']),
    ]);
    expect(result.dedupedSkillAdds).toBe(0);
    expect(result.generalized).toEqual([]);
    expect(result.revision.ops).toHaveLength(2);
  });

  it('breaks a dedupe tie by the earlier child', async () => {
    const body = words('term', 10);
    const result = await new RevisionMerger().merge([
      child('A', [addOp('A-skill', body)], ['t1']),
      child('B', [addOp('B-skill', body)], ['t2']),
    ]);
    expect(result.revision.ops).toEqual([expect.objectContaining({ skill: expect.objectContaining({ name: 'A-skill' }) })]);
  });
});

describe('RevisionMerger: reconcile', () => {
  it('keeps the op from the child with the larger fixed set and records the conflict', async () => {
    const result = await new RevisionMerger().merge([
      child('A', [updateOp('skill-x', { body: 'be strict' })], ['t1', 't2']),
      child('B', [updateOp('skill-x', { body: 'be relaxed' })], ['t3']),
    ]);
    expect(result.revision.ops[0]).toEqual(updateOp('skill-x', { body: 'be strict' }));
    expect(result.revision.ops[1]).toEqual({
      op: 'memory.reflect',
      summary: '[conflict]: B',
      evidence: ['skill:skill-x'],
    });
    expect(result.reconciled).toEqual([{ target: 'skill:skill-x', keptFrom: 'A', droppedFrom: ['B'] }]);
  });

  it('reconciles opposite-direction edits of the same instruction section', async () => {
    const instr = (text: string): RevisionOp => ({
      op: 'instruction.patch',
      id: 'instructions-solver-1',
      heading: 'Style',
      text,
      sources: [],
    });
    const result = await new RevisionMerger().merge([
      child('A', [instr('Always cite.')], ['t1']),
      child('B', [instr('Never cite.')], ['t2', 't3']),
    ]);
    expect(result.reconciled).toEqual([
      { target: 'instruction:instructions-solver-1#Style', keptFrom: 'B', droppedFrom: ['A'] },
    ]);
    expect(result.revision.ops).toHaveLength(2);
    expect(result.revision.ops[0]).toMatchObject({ text: 'Never cite.' });
  });

  it('treats identical edits as one op without a conflict note', async () => {
    const result = await new RevisionMerger().merge([
      child('A', [updateOp('skill-x', { uncertainty: 0.3 })], ['t1']),
      child('B', [updateOp('skill-x', { uncertainty: 0.3 })], ['t2']),
    ]);
    expect(result.revision.ops).toEqual([updateOp('skill-x', { uncertainty: 0.3 })]);
    expect(result.reconciled).toHaveLength(1);
    expect(result.notes.some((n) => n.startsWith('[conflict]'))).toBe(false);
  });

  it('uses the LLM reconciled patch when the output is valid', async () => {
    const merger = new RevisionMerger({ llmProvider: provider('```json\n{"patch":{"body":"merged body"}}\n```') });
    const result = await merger.merge([
      child('A', [updateOp('skill-x', { body: 'strict' })], ['t1', 't2']),
      child('B', [updateOp('skill-x', { body: 'relaxed' })], ['t3']),
    ]);
    expect(result.revision.ops).toEqual([updateOp('skill-x', { body: 'merged body' })]);
    expect(result.reconciled[0]?.keptFrom).toBe('A');
  });

  it('falls back to the deterministic conflict note when the LLM output is malformed', async () => {
    const merger = new RevisionMerger({ llmProvider: provider('not json at all') });
    const result = await merger.merge([
      child('A', [updateOp('skill-x', { body: 'strict' })], ['t1', 't2']),
      child('B', [updateOp('skill-x', { body: 'relaxed' })], ['t3']),
    ]);
    expect(result.revision.ops[0]).toEqual(updateOp('skill-x', { body: 'strict' }));
    expect(result.revision.ops[1]).toMatchObject({ op: 'memory.reflect', summary: '[conflict]: B' });
  });
});

describe('RevisionMerger: generalize', () => {
  it('unions only the evidence domains and takes the maximum uncertainty', async () => {
    const result = await new RevisionMerger().merge([
      child('A', [addOp('A-skill', words('alpha', 6), { domains: ['billing'], uncertainty: 0.2 })], ['t1'], ['billing']),
      child('B', [addOp('B-skill', words('beta', 6), { domains: ['billing', 'ops'], uncertainty: 0.6 })], ['t2'], ['billing']),
    ]);
    expect(result.generalized).toEqual([{ kind: 'procedure', from: ['A', 'B'], domains: ['billing'] }]);
    expect(result.revision.ops).toHaveLength(1);
    const merged = result.revision.ops[0];
    expect(merged).toMatchObject({ op: 'skill.add', skill: { scope: { domains: ['billing'] }, uncertainty: 0.6 } });
    expect(result.revision.ops[0]?.op === 'skill.add' && result.revision.ops[0].skill.body).toContain('## From A');
    expect(result.revision.ops[0]?.op === 'skill.add' && result.revision.ops[0].skill.body).toContain('## From B');
  });

  it('falls back to the skill scope domains when no evidence domains are given', async () => {
    const result = await new RevisionMerger().merge([
      child('A', [addOp('A-skill', words('alpha', 6), { domains: ['billing'] })], ['t1']),
      child('B', [addOp('B-skill', words('beta', 6), { domains: ['billing', 'ops'] })], ['t2']),
    ]);
    expect(result.generalized[0]?.domains).toEqual(['billing', 'ops']);
  });

  it('does not generalize across kinds, without domain overlap, or within one child', async () => {
    const kinds = await new RevisionMerger().merge([
      child('A', [addOp('A-skill', words('alpha', 6), { kind: 'procedure' })], ['t1']),
      child('B', [addOp('B-skill', words('beta', 6), { kind: 'judgment' })], ['t2']),
    ]);
    expect(kinds.generalized).toEqual([]);
    const domains = await new RevisionMerger().merge([
      child('A', [addOp('A-skill', words('alpha', 6), { domains: ['billing'] })], ['t1']),
      child('B', [addOp('B-skill', words('beta', 6), { domains: ['ops'] })], ['t2']),
    ]);
    expect(domains.generalized).toEqual([]);
    const same = await new RevisionMerger().merge([
      child('A', [addOp('A1', words('alpha', 6)), addOp('A2', words('gamma', 6))], ['t1']),
    ]);
    expect(same.generalized).toEqual([]);
    expect(same.revision.ops).toHaveLength(2);
  });

  it('uses the LLM body when valid and falls back on malformed output', async () => {
    const pair = (): ChildOutcome[] => [
      child('A', [addOp('A-skill', words('alpha', 6))], ['t1']),
      child('B', [addOp('B-skill', words('beta', 6))], ['t2']),
    ];
    const good = await new RevisionMerger({ llmProvider: provider('{"body":"General guidance"}') }).merge(pair());
    expect(good.revision.ops[0]).toMatchObject({ skill: { body: 'General guidance' } });
    const bad = await new RevisionMerger({ llmProvider: provider('garbled {') }).merge(pair());
    expect(bad.revision.ops[0]?.op === 'skill.add' && bad.revision.ops[0].skill.body).toContain('## From A');
  });

  it('escapes triple backticks in LLM output placed outside a fence', async () => {
    const reply = JSON.stringify({ body: 'Run ```rm``` now' });
    const result = await new RevisionMerger({ llmProvider: provider(reply) }).merge([
      child('A', [addOp('A-skill', words('alpha', 6))], ['t1']),
      child('B', [addOp('B-skill', words('beta', 6))], ['t2']),
    ]);
    const body = result.revision.ops[0]?.op === 'skill.add' ? result.revision.ops[0].skill.body : '';
    expect(body).not.toContain('```');
  });
});

describe('RevisionMerger: ordering, provenance and abort', () => {
  it('keeps non-conflicting ops in child order and carries the base snapshot', async () => {
    const result = await new RevisionMerger().merge(
      [
        child('A', [{ op: 'memory.reflect', summary: 'one', evidence: [] }], ['t1']),
        child('B', [{ op: 'heuristic.add', condition: 'c', action: 'a' }], ['t2']),
      ],
      { baseSnapshotId: 'K-7' },
    );
    expect(result.revision.ops.map((o) => o.op)).toEqual(['memory.reflect', 'heuristic.add']);
    expect(result.revision.baseSnapshotId).toBe('K-7');
    expect(result.revision.producedBy).toBe('merge');
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new RevisionMerger().merge([], { baseSnapshotId: 'K-1', signal: controller.signal })).rejects.toBeInstanceOf(AbortError);
  });

  it('throws AbortError when the signal aborts during an LLM call', async () => {
    const controller = new AbortController();
    const hang: PGCompletionProvider = { complete: () => new Promise<string>(() => undefined) };
    const pending = new RevisionMerger({ llmProvider: hang }).merge(
      [
        child('A', [updateOp('skill-x', { body: 'strict' })], ['t1', 't2']),
        child('B', [updateOp('skill-x', { body: 'relaxed' })], ['t3']),
      ],
      { baseSnapshotId: 'K-1', signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toBeInstanceOf(AbortError);
  });
});
