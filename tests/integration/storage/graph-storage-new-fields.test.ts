import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Entity } from '../../../src/types/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GraphStorage persists new v1.8.0 fields', () => {
  let tmpDir: string;
  let storagePath: string;
  let storage: GraphStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-test-'));
    storagePath = path.join(tmpDir, 'memory.jsonl');
    storage = new GraphStorage(storagePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips projectId', async () => {
    const entity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['fact'],
      projectId: 'proj-1',
    };
    await storage.saveGraph({ entities: [entity], relations: [] });

    const storage2 = new GraphStorage(storagePath);
    const g = await storage2.loadGraph();
    expect(g.entities[0].projectId).toBe('proj-1');
  });

  it('round-trips version chain fields', async () => {
    const entity: Entity = {
      name: 'alice-v2',
      entityType: 'person',
      observations: ['fact'],
      version: 2,
      parentEntityName: 'alice',
      rootEntityName: 'alice',
      isLatest: true,
    };
    await storage.saveGraph({ entities: [entity], relations: [] });

    const storage2 = new GraphStorage(storagePath);
    const g = await storage2.loadGraph();
    expect(g.entities[0].version).toBe(2);
    expect(g.entities[0].parentEntityName).toBe('alice');
    expect(g.entities[0].rootEntityName).toBe('alice');
    expect(g.entities[0].isLatest).toBe(true);
  });

  it('round-trips supersededBy on old versions', async () => {
    const entity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['fact'],
      isLatest: false,
      supersededBy: 'alice-v2',
    };
    await storage.saveGraph({ entities: [entity], relations: [] });

    const storage2 = new GraphStorage(storagePath);
    const g = await storage2.loadGraph();
    expect(g.entities[0].isLatest).toBe(false);
    expect(g.entities[0].supersededBy).toBe('alice-v2');
  });
});
