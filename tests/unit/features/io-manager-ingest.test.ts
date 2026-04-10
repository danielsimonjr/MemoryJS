import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('IOManager.ingest', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-ing-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates entities from exchange-chunked messages', async () => {
    const result = await ctx.ioManager.ingest({
      messages: [
        { role: 'user', content: 'Why did we switch to GraphQL?' },
        { role: 'assistant', content: 'We switched for better type safety.' },
        { role: 'user', content: 'What about auth?' },
        { role: 'assistant', content: 'Auth uses JWT with refresh tokens.' },
      ],
      source: 'chat-2026-04-10',
    });
    expect(result.entitiesCreated).toBe(2);
    expect(result.entityNames).toHaveLength(2);
  });

  it('stores verbatim content as observations', async () => {
    await ctx.ioManager.ingest({
      messages: [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
      ],
      source: 'test',
    });
    const entity = await ctx.entityManager.getEntity('test-001');
    expect(entity).toBeDefined();
    expect(entity!.observations.some(o => o.includes('Hello world'))).toBe(true);
    expect(entity!.observations.some(o => o.includes('Hi there'))).toBe(true);
  });

  it('stamps projectId and tags from options', async () => {
    await ctx.ioManager.ingest(
      {
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' },
        ],
        source: 'tagged',
      },
      { projectId: 'proj-1', tags: ['imported'] }
    );
    const entity = await ctx.entityManager.getEntity('tagged-001');
    expect(entity?.projectId).toBe('proj-1');
    expect(entity?.tags).toContain('imported');
    expect(entity?.tags).toContain('ingested');
  });

  it('dryRun returns counts without creating entities', async () => {
    const result = await ctx.ioManager.ingest(
      {
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' },
        ],
        source: 'dry',
      },
      { dryRun: true }
    );
    expect(result.entitiesCreated).toBe(1);
    const entity = await ctx.entityManager.getEntity('dry-001');
    expect(entity).toBeNull();
  });

  it('skips exact duplicates', async () => {
    const input = {
      messages: [
        { role: 'user' as const, content: 'duplicate content' },
        { role: 'assistant' as const, content: 'duplicate response' },
      ],
      source: 'dup',
    };
    await ctx.ioManager.ingest(input);
    const result2 = await ctx.ioManager.ingest(input);
    expect(result2.skippedDuplicates).toBe(1);
    expect(result2.entitiesCreated).toBe(0);
  });

  it('handles multiple IngestInput items', async () => {
    const result = await ctx.ioManager.ingest([
      {
        messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
        source: 'batch1',
      },
      {
        messages: [{ role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }],
        source: 'batch2',
      },
    ]);
    expect(result.entitiesCreated).toBe(2);
  });
});
