/** PracticeTaskGenerator (RS-13): templates, LLM path with fallback, rubric audit, persistence. */
import { describe, it, expect } from 'vitest';
import { PracticeTaskGenerator } from '../../../../src/agent/bootstrap/PracticeTaskGenerator.js';
import { isTaskEntity } from '../../../../src/types/agent-memory.js';
import type { NavigationNodeRecord } from '../../../../src/types/skills.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { nodeFixture, scriptedLlm, syntheticCorpus } from './bootstrapFixtures.js';

/** Leaves with unique terms, plus two near-duplicates that share terms but differ in text. */
function nodesWithOverlap(): NavigationNodeRecord[] {
  return [
    nodeFixture('doc-a.md', { keywords: ['orion', 'ledger', 'vendor'], summary: 'A text', metadata: { group: 'g0' } }),
    nodeFixture('doc-b.md', { keywords: ['ledger', 'vendor', 'bravo'], summary: 'B text', metadata: { group: 'g0' } }),
    nodeFixture('doc-c.md', { keywords: ['quasar', 'lumen'], summary: 'C text', metadata: { group: 'g1' } }),
  ];
}

/** Sources matching the nodes above (for enumerate tasks). */
const SOURCES = [
  { ref: 'doc-a.md', metadata: { group: 'g0' } },
  { ref: 'doc-b.md', metadata: { group: 'g0' } },
  { ref: 'doc-c.md', metadata: { group: 'g1' } },
];

withBothBackends('PracticeTaskGenerator', (backend) => {
  it('produces locate, reconcile and enumerate tasks, each with a rubric and sources', async () => {
    const storage = backend.create();
    const { tasks } = await new PracticeTaskGenerator({ storage }).generate({ nodes: nodesWithOverlap(), sources: SOURCES });
    const categories = new Set(tasks.map((t) => t.category));
    expect(categories).toEqual(new Set(['locate', 'reconcile', 'enumerate']));
    for (const task of tasks) {
      expect(task.rubric.length).toBeGreaterThanOrEqual(1);
      expect(task.sources?.length).toBeGreaterThanOrEqual(1);
      expect(task.id).toMatch(/^task-/);
    }
    const reconcile = tasks.find((t) => t.category === 'reconcile')!;
    expect(reconcile.rubric.map((c) => c.kind)).toEqual(['fact', 'document']);
    const enumerate = tasks.find((t) => t.category === 'enumerate')!;
    expect(enumerate.rubric[0]!.kind).toBe('set-exact');
    expect(enumerate.rubric[0]!.expected).toEqual(['doc-a.md', 'doc-b.md']);
  });

  it('persists tasks as task entities once, even when generated twice', async () => {
    const storage = backend.create();
    const gen = new PracticeTaskGenerator({ storage });
    const first = await gen.generate({ nodes: nodesWithOverlap(), sources: SOURCES });
    await gen.generate({ nodes: nodesWithOverlap(), sources: SOURCES });
    const stored = (await storage.loadGraph()).entities.filter(isTaskEntity);
    expect(stored.length).toBe(first.tasks.length);
    expect(stored.map((e) => e.taskRecord.id).sort()).toEqual(first.tasks.map((t) => t.id).sort());
  });

  it('caps the number of tasks at count', async () => {
    const storage = backend.create();
    const { tasks } = await new PracticeTaskGenerator({ storage }).generate({
      nodes: nodesWithOverlap(),
      sources: SOURCES,
      count: 2,
    });
    expect(tasks.length).toBe(2);
  });

  it('returns nothing for an empty corpus', async () => {
    const storage = backend.create();
    expect(await new PracticeTaskGenerator({ storage }).generate({ nodes: [], sources: [] })).toEqual({ tasks: [], audit: [] });
  });

  it('template tasks produce no placeholder, omits or files findings', async () => {
    const storage = backend.create();
    const sources = syntheticCorpus(10, 2);
    const nodes = sources.map((s) =>
      nodeFixture(s.ref, { keywords: [`orion${s.ref.slice(4, 6)}`, 'ledger', 'quarterly'], metadata: s.metadata ?? {} }),
    );
    const { audit } = await new PracticeTaskGenerator({ storage }).generate({ nodes, sources });
    expect(audit.filter((i) => ['placeholder', 'omits', 'files'].includes(i.kind))).toEqual([]);
  });

  it('LLM tasks with sources are kept, and an unsatisfiable rubric is flagged, not dropped', async () => {
    const storage = backend.create();
    const llm = scriptedLlm([
      JSON.stringify({
        tasks: [
          {
            input: 'Summarise the ledger entries for region zone1.',
            category: 'custom',
            sources: ['doc-c.md'],
            rubric: [{ id: 'c1', text: 'states the [...] total', kind: 'fact', expected: 'total' }],
          },
          {
            input: 'Name a lumen source.',
            sources: ['not-a-source.md'],
            rubric: [{ id: 'c1', text: 'names lumen', kind: 'free' }],
          },
        ],
      }),
    ]);
    const { tasks, audit } = await new PracticeTaskGenerator({ storage }).generate({
      nodes: nodesWithOverlap(),
      sources: SOURCES,
      llmProvider: llm,
      guidance: 'prefer region questions',
    });
    expect(tasks.map((t) => t.category)).toEqual(['custom']);
    expect(audit.some((i) => i.kind === 'placeholder' && i.taskId === tasks[0]!.id)).toBe(true);
    expect(llm.calls).toBe(1);
  });

  it('falls back to templates after two malformed LLM replies', async () => {
    const storage = backend.create();
    const llm = scriptedLlm(['garbage', '{"tasks": []}']);
    const { tasks } = await new PracticeTaskGenerator({ storage }).generate({
      nodes: nodesWithOverlap(),
      sources: SOURCES,
      llmProvider: llm,
    });
    expect(llm.calls).toBe(2);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => ['locate', 'reconcile', 'enumerate'].includes(t.category ?? ''))).toBe(true);
  });

  it('rejects when the signal is already aborted', async () => {
    const storage = backend.create();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new PracticeTaskGenerator({ storage }).generate({ nodes: [], sources: [], signal: controller.signal }),
    ).rejects.toThrow();
  });
});
