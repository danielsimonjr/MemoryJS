import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ContextWindowManager.compressForContext', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-cfc-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('compresses repeated substrings with §-codes', () => {
    const amm = ctx.agentMemory();
    const text = 'The authentication service handles authentication tokens. The authentication flow requires authentication middleware.';
    const result = amm.contextWindowManager.compressForContext(text);
    expect(result.compressed).toContain('§');
    expect(result.stats.savedTokens).toBeGreaterThan(0);
    expect(result.stats.savedPercent).toBeGreaterThan(0);
  });

  it('generates a legend mapping codes to originals', () => {
    const amm = ctx.agentMemory();
    const text = 'PostgreSQL database. PostgreSQL connection. PostgreSQL query. PostgreSQL index.';
    const result = amm.contextWindowManager.compressForContext(text);
    expect(Object.keys(result.legend).length).toBeGreaterThan(0);
    expect(result.compressed).toContain('Legend');
  });

  it('respects compression levels', () => {
    const amm = ctx.agentMemory();
    const text = 'function getData() { return await fetchData(); } function processData() { return await transform(); }';
    const light = amm.contextWindowManager.compressForContext(text, { level: 'light' });
    const aggressive = amm.contextWindowManager.compressForContext(text, { level: 'aggressive' });
    // Aggressive should compress more (or equal) than light
    expect(aggressive.stats.compressedTokens).toBeLessThanOrEqual(light.stats.compressedTokens);
  });

  it('returns original text when nothing to compress', () => {
    const amm = ctx.agentMemory();
    const text = 'Short unique text.';
    const result = amm.contextWindowManager.compressForContext(text, { level: 'light' });
    expect(result.compressed).toBe(text);
    expect(result.stats.savedTokens).toBe(0);
  });

  it('reports accurate token stats', () => {
    const amm = ctx.agentMemory();
    const text = 'The service processes requests. The service handles errors. The service logs events. The service validates input.';
    const result = amm.contextWindowManager.compressForContext(text);
    expect(result.stats.originalTokens).toBeGreaterThan(0);
    expect(result.stats.compressedTokens).toBeGreaterThan(0);
    expect(result.stats.savedTokens).toBe(result.stats.originalTokens - result.stats.compressedTokens);
    expect(result.stats.savedPercent).toBeCloseTo(
      (result.stats.savedTokens / result.stats.originalTokens) * 100,
      0
    );
  });
});

describe('ContextWindowManager.compressEntitiesForContext', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-cec-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'auth-service', entityType: 'component', observations: ['Handles authentication', 'Uses JWT tokens', 'Validates credentials'], importance: 8 },
      { name: 'api-gateway', entityType: 'component', observations: ['Routes requests', 'Rate limiting', 'Authentication middleware'], importance: 7 },
      { name: 'user-db', entityType: 'database', observations: ['Stores user profiles', 'PostgreSQL backend', 'Connection pooling'], importance: 6 },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('formats entities and compresses the result', async () => {
    const amm = ctx.agentMemory();
    const graph = await ctx.storage.loadGraph();
    const result = amm.contextWindowManager.compressEntitiesForContext(graph.entities);
    expect(result.entityCount).toBe(3);
    expect(result.compressed).toContain('auth-service');
    expect(result.compressed).toContain('api-gateway');
    expect(result.stats.originalTokens).toBeGreaterThan(0);
  });

  it('respects maxTokens budget', async () => {
    const amm = ctx.agentMemory();
    const graph = await ctx.storage.loadGraph();
    const result = amm.contextWindowManager.compressEntitiesForContext(graph.entities, { maxTokens: 20 });
    expect(result.entityCount).toBeLessThan(3);
  });

  it('sorts entities by importance', async () => {
    const amm = ctx.agentMemory();
    const graph = await ctx.storage.loadGraph();
    const result = amm.contextWindowManager.compressEntitiesForContext(graph.entities);
    // auth-service (importance 8) should appear before user-db (importance 6)
    const authIdx = result.compressed.indexOf('auth-service');
    const dbIdx = result.compressed.indexOf('user-db');
    expect(authIdx).toBeLessThan(dbIdx);
  });
});

describe('ContextWindowManager.wakeUp with compression', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wuc-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'service-alpha', entityType: 'service', observations: ['Handles authentication requests', 'Processes authentication tokens'], importance: 8 },
      { name: 'service-beta', entityType: 'service', observations: ['Handles authentication validation', 'Manages authentication sessions'], importance: 7 },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('compresses L1 when compress option is set', async () => {
    const amm = ctx.agentMemory();
    const raw = await amm.contextWindowManager.wakeUp();
    const compressed = await amm.contextWindowManager.wakeUp({ compress: 'medium' });
    // Compressed should use fewer or equal tokens
    expect(compressed.totalTokens).toBeLessThanOrEqual(raw.totalTokens);
  });

  it('does not compress when compress is not set', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l1).not.toContain('§');
    expect(result.l1).not.toContain('Legend');
  });
});
