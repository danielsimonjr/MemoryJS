/**
 * MemoryDistiller mode config (R5) — heuristic-only / auto / llm-preferred
 * mapping, strict heuristic thresholds, and token-usage threading.
 */
import { describe, it, expect, vi } from 'vitest';
import { MemoryDistiller } from '../../../../src/agent/reconstruction/MemoryDistiller.js';
import type { LLMProvider } from '../../../../src/search/LLMQueryPlanner.js';
import type { DialogueTurn } from '../../../../src/types/reconstruction.js';

const TURNS: DialogueTurn[] = [
  { id: 'D1:1', speaker: 'Alice', text: 'I love hiking in the Alps.', timestamp: '2026-01-05' },
  { id: 'D1:2', speaker: 'Bob', text: 'Alice is quite adventurous.', timestamp: '2026-01-05' },
];

const DIALOGUE_JSON = JSON.stringify({
  conversation_time: '2026-01-05',
  sentence: [{ id: 's1', text: 'Alice loves hiking in the Alps.', tag: 'hiking', topic: [] }],
  topics: {},
  personal_sentences: [],
});

function makeProvider(): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  return { complete: vi.fn(async () => DIALOGUE_JSON) };
}

describe('MemoryDistiller mode config (R5)', () => {
  it('default (no config) uses the LLM when a provider is present — unchanged behaviour', async () => {
    const provider = makeProvider();
    const d = new MemoryDistiller(provider);
    const result = await d.distill(TURNS);
    expect(provider.complete).toHaveBeenCalled();
    expect(result.sentences[0].text).toBe('Alice loves hiking in the Alps.');
  });

  it('heuristic-only mode never calls the provider even when configured', async () => {
    const provider = makeProvider();
    const d = new MemoryDistiller(provider, { mode: 'heuristic-only' });
    const result = await d.distill(TURNS);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(result.sentences.length).toBeGreaterThan(0);
    expect(result.tokenUsage).toBeUndefined();
  });

  it('llm-preferred uses the LLM and falls back to heuristics on malformed output', async () => {
    const provider = { complete: vi.fn(async () => 'not json at all') };
    const d = new MemoryDistiller(provider, { mode: 'llm-preferred' });
    const result = await d.distill(TURNS);
    expect(provider.complete).toHaveBeenCalled();
    // Heuristic fallback produced sentences anyway
    expect(result.sentences.length).toBeGreaterThan(0);
    // Tokens spent on the failed attempt are still surfaced
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.approximate).toBe(true);
  });

  it('reports approximate chars/4 usage when the provider exposes no usage', async () => {
    const provider = makeProvider();
    const d = new MemoryDistiller(provider);
    const result = await d.distill(TURNS);
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.approximate).toBe(true);
    expect(result.tokenUsage!.input).toBeGreaterThan(0);
    expect(result.tokenUsage!.output).toBeGreaterThan(0);
  });

  it('reports exact usage (approximate: false) via getLastUsage when available', async () => {
    const provider = {
      complete: vi.fn(async () => DIALOGUE_JSON),
      getLastUsage: () => ({ inputTokens: 7, outputTokens: 3 }),
    };
    const d = new MemoryDistiller(provider);
    const result = await d.distill(TURNS);
    const calls = provider.complete.mock.calls.length;
    expect(result.tokenUsage).toEqual({
      input: calls * 7,
      output: calls * 3,
      approximate: false,
    });
  });

  it('strict heuristics drop attribute-catch-all personal facts', async () => {
    const turns: DialogueTurn[] = [
      // 'is named' → no concrete aspect keywords → classifies as 'attribute'
      { id: 'D1:1', speaker: 'Alice', text: 'The cat is named Whiskers.' },
      // 'works' → 'occupation' — survives strict mode
      { id: 'D1:2', speaker: 'Alice', text: 'I works at Acme Corp.' },
    ];
    const normal = await new MemoryDistiller().distill(turns);
    const strict = await new MemoryDistiller(undefined, { heuristicStrictness: 'strict' }).distill(turns);
    expect(normal.personalFacts.some(f => f.tag === 'attribute')).toBe(true);
    expect(strict.personalFacts.some(f => f.tag === 'attribute')).toBe(false);
    expect(strict.personalFacts.some(f => f.tag === 'occupation')).toBe(true);
  });

  it('strict heuristics require three episodes to form a topic', async () => {
    // Two sentences sharing the top cue 'Zephyr' — a topic in normal mode only.
    const turns: DialogueTurn[] = [
      { id: 'D1:1', text: 'Zephyr sailed north. Zephyr docked at dawn.' },
    ];
    const normal = await new MemoryDistiller().distill(turns);
    const strict = await new MemoryDistiller(undefined, { heuristicStrictness: 'strict' }).distill(turns);
    expect(Object.keys(normal.topics).length).toBeGreaterThan(0);
    expect(Object.keys(strict.topics)).toHaveLength(0);
  });
});
