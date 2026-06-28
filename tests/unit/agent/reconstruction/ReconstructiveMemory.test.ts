import { describe, it, expect } from 'vitest';
import { ReconstructiveMemory } from '../../../../src/agent/reconstruction/ReconstructiveMemory.js';
import { MemoryDistiller, extractJson } from '../../../../src/agent/reconstruction/MemoryDistiller.js';
import type { DialogueTurn } from '../../../../src/types/reconstruction.js';
import type { LLMProvider } from '../../../../src/search/LLMQueryPlanner.js';

const NATE_CAROLINE: DialogueTurn[] = [
  { id: 'D1:1', speaker: 'Nate', text: 'I won a video game tournament on 2023-07-04.', timestamp: '2023-07-04' },
  { id: 'D1:2', speaker: 'Caroline', text: 'I started a new painting class on 2023-07-10.', timestamp: '2023-07-10' },
  { id: 'D1:3', speaker: 'Nate', text: 'I prefer strategy games over shooters.', timestamp: '2023-07-04' },
];

describe('MemoryDistiller (heuristic construction)', () => {
  it('resolves pronouns to the speaker during rewriting', async () => {
    const d = new MemoryDistiller();
    const result = await d.distill(NATE_CAROLINE);
    const s = result.sentences.find(x => x.origin === 'D1:1')!;
    expect(s.text).toContain('Nate');
    expect(s.text).not.toMatch(/\bI\b/);
  });

  it('normalizes timestamps to YYYY-MM-DD', async () => {
    const d = new MemoryDistiller();
    const result = await d.distill(NATE_CAROLINE);
    expect(result.sentences.every(s => !s.time || /^\d{4}-\d{2}-\d{2}$/.test(s.time))).toBe(true);
  });

  it('extracts person-anchored semantic facts', async () => {
    const d = new MemoryDistiller();
    const result = await d.distill(NATE_CAROLINE);
    const pref = result.personalFacts.find(f => f.tag === 'preference');
    expect(pref?.person).toBe('Nate');
  });

  it('builds a multi-layer Cue–Tag–Content graph', async () => {
    const d = new MemoryDistiller();
    const result = await d.distill(NATE_CAROLINE);
    const graph = d.buildGraph(result);
    const stats = graph.stats();
    expect(stats.contents).toBeGreaterThan(0);
    expect(stats.triples).toBeGreaterThan(0);
    expect(graph.contentsByLayer('semantic').length).toBeGreaterThan(0);
  });
});

describe('ReconstructiveMemory — active reconstruction (Algorithm 1)', () => {
  it('ingests dialogue and answers via graph traversal', async () => {
    const rm = new ReconstructiveMemory();
    await rm.ingest(NATE_CAROLINE);
    const result = await rm.reconstruct('What did Caroline do in July?');
    expect(result.evidence.length).toBeGreaterThan(0);
    // Caroline's painting episode should be reconstructed.
    expect(result.evidence.some(e => /painting/i.test(e.text))).toBe(true);
    expect(result.trajectory.length).toBeGreaterThan(0);
  });

  it('records a multi-step traversal trajectory with typed actions', async () => {
    const rm = new ReconstructiveMemory();
    await rm.ingest(NATE_CAROLINE);
    const result = await rm.reconstruct('Nate tournament');
    const allActions = result.trajectory.flatMap(s => s.actions);
    expect(allActions).toContain('cue->tag');
    expect(allActions).toContain('cuetag->content');
  });

  it('respects the maxSteps budget', async () => {
    const rm = new ReconstructiveMemory();
    await rm.ingest(NATE_CAROLINE);
    const result = await rm.reconstruct('Nate', { maxSteps: 2 });
    expect(result.trajectory.length).toBeLessThanOrEqual(2);
  });

  it('returns an empty-evidence result for an unknown query', async () => {
    const rm = new ReconstructiveMemory();
    await rm.ingest(NATE_CAROLINE);
    const result = await rm.reconstruct('quantum chromodynamics in ancient Rome');
    expect(result.evidence).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('round-trips the graph through a snapshot', async () => {
    const rm = new ReconstructiveMemory();
    await rm.ingest(NATE_CAROLINE);
    const snap = rm.toSnapshot();
    const rm2 = new ReconstructiveMemory({ snapshot: snap });
    expect(rm2.stats()).toEqual(rm.stats());
  });
});

describe('ReconstructiveMemory — LLM path', () => {
  it('synthesizes an answer via the LLM provider when supplied', async () => {
    const llm: LLMProvider = {
      async complete(prompt: string): Promise<string> {
        if (prompt.includes('question-answering agent')) {
          return JSON.stringify({ answer: 'painting class', confidence: 0.9 });
        }
        // Force heuristic distillation by returning unparseable text.
        return 'n/a';
      },
    };
    const rm = new ReconstructiveMemory({ llmProvider: llm });
    await rm.ingest(NATE_CAROLINE);
    const result = await rm.reconstruct('What did Caroline do?');
    expect(result.answer).toBe('painting class');
    expect(result.confidence).toBe(0.9);
  });
});

describe('extractJson', () => {
  it('parses fenced and bare JSON, ignoring surrounding prose', () => {
    expect(extractJson('here: {"a":1} done')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"b":[1,2]}\n```')).toEqual({ b: [1, 2] });
    expect(extractJson('no json here')).toBeUndefined();
  });
});
