/**
 * R4b (source-chunk provenance) + R5 (ingestion cost/quality dial) tests for
 * `IOManager.ingest()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'crypto';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import {
  INGEST_CHUNK_PREFIX,
  INGEST_DERIVED_FROM_RELATION,
  INGEST_MANIFEST_ENTITY_TYPE,
} from '../../../src/features/IOManager.js';
import type { LLMProvider } from '../../../src/search/LLMQueryPlanner.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Canned LLM response valid for the distiller's dialogue pass. */
const LLM_DIALOGUE_JSON = JSON.stringify({
  conversation_time: '2026-01-01',
  sentence: [
    { id: 's1', text: 'Alice prefers GraphQL for type safety.', tag: 'graphql', topic: [] },
  ],
  topics: {},
  personal_sentences: [],
});

function makeSpyProvider(): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  return { complete: vi.fn(async () => LLM_DIALOGUE_JSON) };
}

const MESSAGES = [
  { role: 'user' as const, content: 'Why GraphQL?' },
  { role: 'assistant' as const, content: 'Alice prefers GraphQL for type safety.' },
  { role: 'user' as const, content: 'And auth?' },
  { role: 'assistant' as const, content: 'JWT with refresh tokens.' },
];

describe('IOManager.ingest — R4b provenance + R5 modes', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-ingprov-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('R4b: ingest manifest', () => {
    it('returns ingestId, manifestEntity and chunkCount on the result', async () => {
      const result = await ctx.ioManager.ingest({ messages: MESSAGES, source: 'prov' });
      expect(result.ingestId).toMatch(/^[0-9a-f]{8}$/);
      expect(result.manifestEntity).toBe(`ingest-${result.ingestId}`);
      expect(result.chunkCount).toBe(2);
      expect(result.entitiesCreated).toBe(2);
    });

    it('writes a manifest entity with one escape-safe [chunk] line per chunk', async () => {
      const result = await ctx.ioManager.ingest({ messages: MESSAGES, source: 'prov' });
      const manifest = await ctx.entityManager.getEntity(result.manifestEntity);
      expect(manifest).toBeDefined();
      expect(manifest!.entityType).toBe(INGEST_MANIFEST_ENTITY_TYPE);

      const lines = manifest!.observations.filter(o => o.startsWith(INGEST_CHUNK_PREFIX));
      expect(lines).toHaveLength(2);

      const records = lines.map(l => JSON.parse(l.slice(INGEST_CHUNK_PREFIX.length)));
      records.forEach((rec, i) => {
        expect(rec.id).toBe(`${result.ingestId}-chunk-${i + 1}`);
        expect(rec.source).toBe('prov');
        expect(typeof rec.offset).toBe('number');
        expect(typeof rec.length).toBe('number');
        expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
        // No raw text without keepSourceText
        expect(rec.text).toBeUndefined();
      });

      // Hash of chunk 1 matches sha256 of its rendered observations
      const chunk1Text = ['[user] Why GraphQL?', '[assistant] Alice prefers GraphQL for type safety.'].join('\n');
      expect(records[0].hash).toBe(createHash('sha256').update(chunk1Text).digest('hex'));
      expect(records[0].offset).toBe(0);
      expect(records[0].length).toBe(chunk1Text.length);
      expect(records[1].offset).toBe(chunk1Text.length + 1);
    });

    it('survives content containing JSON-hostile characters (escape-safe)', async () => {
      const nasty = 'He said "quote} \\ and ]: [chunk]: {"fake": 1}';
      const result = await ctx.ioManager.ingest({
        messages: [
          { role: 'user', content: nasty },
          { role: 'assistant', content: 'ok' },
        ],
        source: 'nasty',
      }, { keepSourceText: true });
      const manifest = await ctx.entityManager.getEntity(result.manifestEntity);
      const line = manifest!.observations.find(o => o.startsWith(INGEST_CHUNK_PREFIX))!;
      const rec = JSON.parse(line.slice(INGEST_CHUNK_PREFIX.length));
      expect(rec.text).toContain(nasty);
    });

    it('keepSourceText stores the raw chunk text; default omits it', async () => {
      const withText = await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'kst' },
        { keepSourceText: true }
      );
      const manifest = await ctx.entityManager.getEntity(withText.manifestEntity);
      const recs = manifest!.observations
        .filter(o => o.startsWith(INGEST_CHUNK_PREFIX))
        .map(l => JSON.parse(l.slice(INGEST_CHUNK_PREFIX.length)));
      expect(recs[0].text).toContain('[user] Why GraphQL?');
      expect(recs[0].truncated).toBeUndefined();
    });

    it('creates derived_from relations from each ingested entity to the manifest', async () => {
      const result = await ctx.ioManager.ingest({ messages: MESSAGES, source: 'rel' });
      for (const name of result.entityNames) {
        const relations = await ctx.relationManager.getRelations(name);
        const derived = relations.filter(
          r => r.relationType === INGEST_DERIVED_FROM_RELATION && r.to === result.manifestEntity
        );
        expect(derived).toHaveLength(1);
        expect(derived[0].from).toBe(name);
      }
    });

    it('stamps per-observation sourceRef provenance via observationMeta', async () => {
      const result = await ctx.ioManager.ingest({ messages: MESSAGES, source: 'meta' });
      const manifest = await ctx.entityManager.getEntity(result.manifestEntity);
      const chunkIds = manifest!.observations
        .filter(o => o.startsWith(INGEST_CHUNK_PREFIX))
        .map(l => JSON.parse(l.slice(INGEST_CHUNK_PREFIX.length)).id as string);

      const entity = await ctx.entityManager.getEntity(result.entityNames[0]);
      expect(entity!.observationMeta).toBeDefined();
      expect(entity!.observationMeta!).toHaveLength(entity!.observations.length);
      for (const obs of entity!.observations) {
        const meta = entity!.observationMeta!.find(m => m.content === obs);
        expect(meta).toBeDefined();
        expect(meta!.sourceRef).toBe(chunkIds[0]);
        expect(chunkIds).toContain(meta!.sourceRef);
      }
    });

    it('dryRun writes neither manifest nor relations but still reports ids', async () => {
      const result = await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'dry' },
        { dryRun: true }
      );
      expect(result.ingestId).toMatch(/^[0-9a-f]{8}$/);
      expect(result.chunkCount).toBe(2);
      expect(await ctx.entityManager.getEntity(result.manifestEntity)).toBeNull();
    });

    it('re-ingesting identical content dedups against the stored contentHash', async () => {
      const input = { messages: MESSAGES, source: 'dup' };
      await ctx.ioManager.ingest(input);
      const second = await ctx.ioManager.ingest(input);
      expect(second.entitiesCreated).toBe(0);
      expect(second.skippedDuplicates).toBe(2);
      expect(second.chunkCount).toBe(2);
    });

    it('empty input produces no manifest and zero chunks', async () => {
      const result = await ctx.ioManager.ingest({ messages: [], source: 'empty' });
      expect(result.chunkCount).toBe(0);
      expect(await ctx.entityManager.getEntity(result.manifestEntity)).toBeNull();
    });
  });

  describe('R5: mode dial', () => {
    it('default mode (balanced, no provider) keeps raw observations only', async () => {
      const result = await ctx.ioManager.ingest({ messages: MESSAGES, source: 'default' });
      const entity = await ctx.entityManager.getEntity(result.entityNames[0]);
      expect(entity!.observations).toEqual([
        '[user] Why GraphQL?',
        '[assistant] Alice prefers GraphQL for type safety.',
      ]);
      expect(result.tokenUsage).toBeUndefined();
      expect(result.validation).toBeUndefined();
    });

    it('lightweight NEVER calls the LLM provider even when configured', async () => {
      const provider = makeSpyProvider();
      const result = await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'lw' },
        { mode: 'lightweight', llmProvider: provider }
      );
      expect(provider.complete).not.toHaveBeenCalled();
      expect(result.tokenUsage).toBeUndefined();
      // Heuristic enrichment still ran (distilled observations appended)
      const entity = await ctx.entityManager.getEntity(result.entityNames[0]);
      expect(entity!.observations.some(o => o.startsWith('[distilled] '))).toBe(true);
    });

    it('balanced calls the LLM when a provider is present and appends distilled observations', async () => {
      const provider = makeSpyProvider();
      const result = await ctx.ioManager.ingest(
        { messages: MESSAGES.slice(0, 2), source: 'bal' },
        { mode: 'balanced', llmProvider: provider }
      );
      expect(provider.complete).toHaveBeenCalled();
      const entity = await ctx.entityManager.getEntity(result.entityNames[0]);
      expect(entity!.observations).toContain('[distilled] Alice prefers GraphQL for type safety.');
      // Distilled observations also carry sourceRef provenance
      const meta = entity!.observationMeta!.find(
        m => m.content === '[distilled] Alice prefers GraphQL for type safety.'
      );
      expect(meta?.sourceRef).toBe(`${result.ingestId}-chunk-1`);
    });

    it('accurate invokes the validate hook with produced artifacts', async () => {
      const validate = vi.fn(async () => ({ valid: true, issues: ['looks fine'] }));
      const result = await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'acc' },
        { mode: 'accurate', validate }
      );
      expect(validate).toHaveBeenCalledTimes(1);
      const produced = validate.mock.calls[0][0];
      expect(produced.ingestId).toBe(result.ingestId);
      expect(produced.manifestEntity).toBe(result.manifestEntity);
      expect(produced.entities.map((e: { name: string }) => e.name)).toEqual(result.entityNames);
      expect(produced.relations).toHaveLength(2);
      expect(produced.relations[0].relationType).toBe(INGEST_DERIVED_FROM_RELATION);
      expect(result.validation).toEqual({ valid: true, issues: ['looks fine'] });
    });

    it('validate hook is NOT invoked in balanced or lightweight modes', async () => {
      const validate = vi.fn(async () => ({ valid: true }));
      await ctx.ioManager.ingest({ messages: MESSAGES, source: 'noval1' }, { mode: 'balanced', validate });
      await ctx.ioManager.ingest({ messages: MESSAGES.slice(2), source: 'noval2' }, { mode: 'lightweight', validate });
      expect(validate).not.toHaveBeenCalled();
    });

    it('sums approximate token usage (chars/4) when the provider reports none', async () => {
      const provider = makeSpyProvider();
      const result = await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'tokapprox' },
        { llmProvider: provider }
      );
      expect(result.tokenUsage).toBeDefined();
      expect(result.tokenUsage!.approximate).toBe(true);
      expect(result.tokenUsage!.input).toBeGreaterThan(0);
      expect(result.tokenUsage!.output).toBeGreaterThan(0);
    });

    it('sums exact token usage across chunks when the provider exposes getLastUsage', async () => {
      const provider = {
        complete: vi.fn(async () => LLM_DIALOGUE_JSON),
        getLastUsage: () => ({ inputTokens: 10, outputTokens: 5 }),
      };
      const result = await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'tokexact' },
        { llmProvider: provider }
      );
      // 2 chunks × 2 LLM calls each (dialogue + keyword) × 10/5 tokens
      const calls = provider.complete.mock.calls.length;
      expect(result.tokenUsage).toEqual({
        input: calls * 10,
        output: calls * 5,
        approximate: false,
      });
    });

    it('dryRun never calls the provider', async () => {
      const provider = makeSpyProvider();
      await ctx.ioManager.ingest(
        { messages: MESSAGES, source: 'drytok' },
        { llmProvider: provider, dryRun: true }
      );
      expect(provider.complete).not.toHaveBeenCalled();
    });
  });
});
