/**
 * StreamingExporter frame pins
 *
 * Pins the bytes, the progress callbacks and the cancellation of streamJSONL
 * and streamCSV. Progress is throttled to one call per 100 ms, so the clock is
 * frozen: only the 0% and 100% reports reach the callback. Each expected value
 * is the output of the exporter before any shared frame existed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StreamingExporter } from '../../../src/features/StreamingExporter.js';
import type { Entity } from '../../../src/types/types.js';

const FROZEN_NOW = 1767225600000;

const ALICE = {
  name: 'Alice',
  entityType: 'person',
  observations: ['Developer'],
  tags: ['team-a'],
  importance: 8,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-02T00:00:00.000Z',
};
const BOB = { name: 'Bob', entityType: 'person', observations: ['Manager', 'Remote'], tags: [], importance: 7 };
const PROJECT_X = { name: 'Project X', entityType: 'project', observations: ['Important project'], tags: ['active'] };
const KNOWS = { from: 'Alice', to: 'Bob', relationType: 'knows' };

const JSONL_THREE_ENTITIES =
  '{"name":"Alice","entityType":"person","observations":["Developer"],"tags":["team-a"],"importance":8,"createdAt":"2026-01-01T00:00:00.000Z","lastModified":"2026-01-02T00:00:00.000Z"}\n' +
  '{"name":"Bob","entityType":"person","observations":["Manager","Remote"],"tags":[],"importance":7}\n' +
  '{"name":"Project X","entityType":"project","observations":["Important project"],"tags":["active"]}\n';

const CSV_THREE_ENTITIES =
  'name,type,observations,tags,importance,createdAt,lastModified\n' +
  '"Alice","person","Developer","team-a","8","2026-01-01T00:00:00.000Z","2026-01-02T00:00:00.000Z"\n' +
  '"Bob","person","Manager; Remote","","7","",""\n' +
  '"Project X","project","Important project","active","","",""\n';

/**
 * Return the entity with an `importance` getter that aborts the signal on its
 * first read. Both formats read `importance` while they write the first row.
 */
function abortOnFirstRead(controller: AbortController, entity: object): Entity {
  Object.defineProperty(entity, 'importance', {
    enumerable: true,
    get: () => {
      controller.abort();
      return 8;
    },
  });
  return entity as Entity;
}

describe('StreamingExporter frames (pins)', () => {
  let testDir: string;
  let outPath: string;
  let exporter: StreamingExporter;

  beforeEach(async () => {
    testDir = join(tmpdir(), `stream-frame-pins-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    outPath = join(testDir, 'out.txt');
    exporter = new StreamingExporter(outPath);
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });

  afterEach(async () => {
    vi.mocked(Date.now).mockRestore();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('streamJSONL writes the exact bytes of a three-entity graph', async () => {
    const result = await exporter.streamJSONL({ entities: [ALICE, BOB, PROJECT_X], relations: [] } as never);

    expect(await fs.readFile(outPath, 'utf-8')).toBe(JSONL_THREE_ENTITIES);
    expect(result).toEqual({
      bytesWritten: Buffer.byteLength(JSONL_THREE_ENTITIES, 'utf-8'),
      entitiesWritten: 3,
      relationsWritten: 0,
      durationMs: 0,
    });
  });

  it('streamJSONL writes relations after entities and counts them', async () => {
    const result = await exporter.streamJSONL({ entities: [ALICE, BOB, PROJECT_X], relations: [KNOWS] } as never);

    expect(await fs.readFile(outPath, 'utf-8')).toBe(`${JSONL_THREE_ENTITIES}{"from":"Alice","to":"Bob","relationType":"knows"}\n`);
    expect(result.entitiesWritten).toBe(3);
    expect(result.relationsWritten).toBe(1);
  });

  it('streamJSONL reports the progress calls of a three-entity graph', async () => {
    const progress: unknown[] = [];

    await exporter.streamJSONL({ entities: [ALICE, BOB, PROJECT_X], relations: [] } as never, {
      onProgress: (p) => progress.push(p),
    });

    expect(JSON.stringify(progress)).toBe(
      '[{"completed":0,"total":3,"percentage":0,"currentTaskId":"streamJSONL"},' +
        '{"completed":3,"total":3,"percentage":100,"currentTaskId":"writing entities"},' +
        '{"completed":3,"total":3,"percentage":100,"currentTaskId":"streamJSONL"}]'
    );
  });

  it('streamJSONL reports the relation progress label with a relation', async () => {
    const progress: unknown[] = [];

    await exporter.streamJSONL({ entities: [ALICE, BOB, PROJECT_X], relations: [KNOWS] } as never, {
      onProgress: (p) => progress.push(p),
    });

    expect(JSON.stringify(progress)).toBe(
      '[{"completed":0,"total":4,"percentage":0,"currentTaskId":"streamJSONL"},' +
        '{"completed":4,"total":4,"percentage":100,"currentTaskId":"writing relations"},' +
        '{"completed":4,"total":4,"percentage":100,"currentTaskId":"streamJSONL"}]'
    );
  });

  it('streamJSONL stops after the first row when the signal aborts', async () => {
    const controller = new AbortController();
    const progress: unknown[] = [];
    const graph = {
      entities: [abortOnFirstRead(controller, { ...ALICE }), BOB, PROJECT_X],
      relations: [],
    };

    await expect(
      exporter.streamJSONL(graph as never, { signal: controller.signal, onProgress: (p) => progress.push(p) })
    ).rejects.toThrow("Operation 'streamJSONL' was cancelled");

    expect(JSON.stringify(progress)).toBe('[{"completed":0,"total":3,"percentage":0,"currentTaskId":"streamJSONL"}]');
  });

  it('streamCSV writes the exact bytes of a three-entity graph', async () => {
    const result = await exporter.streamCSV({ entities: [ALICE, BOB, PROJECT_X], relations: [] } as never);

    expect(await fs.readFile(outPath, 'utf-8')).toBe(CSV_THREE_ENTITIES);
    expect(result).toEqual({
      bytesWritten: Buffer.byteLength(CSV_THREE_ENTITIES, 'utf-8'),
      entitiesWritten: 3,
      relationsWritten: 0,
      durationMs: 0,
    });
  });

  it('streamCSV reports the progress calls of a three-entity graph', async () => {
    const progress: unknown[] = [];

    await exporter.streamCSV({ entities: [ALICE, BOB, PROJECT_X], relations: [] } as never, {
      onProgress: (p) => progress.push(p),
    });

    expect(JSON.stringify(progress)).toBe(
      '[{"completed":0,"total":3,"percentage":0,"currentTaskId":"streamCSV"},' +
        '{"completed":3,"total":3,"percentage":100,"currentTaskId":"writing entities"},' +
        '{"completed":3,"total":3,"percentage":100,"currentTaskId":"streamCSV"}]'
    );
  });

  it('streamCSV stops after the first row when the signal aborts', async () => {
    const controller = new AbortController();
    const progress: unknown[] = [];
    const graph = {
      entities: [abortOnFirstRead(controller, { ...ALICE }), BOB, PROJECT_X],
      relations: [],
    };

    await expect(
      exporter.streamCSV(graph as never, { signal: controller.signal, onProgress: (p) => progress.push(p) })
    ).rejects.toThrow("Operation 'streamCSV' was cancelled");

    expect(JSON.stringify(progress)).toBe('[{"completed":0,"total":3,"percentage":0,"currentTaskId":"streamCSV"}]');
  });
});
