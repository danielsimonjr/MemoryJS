/**
 * IOManager.exportSkills / importSkills path confinement (RS-3).
 * A directory outside the storage root is rejected before any file is touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { IOManager } from '../../../../src/features/IOManager.js';
import { SkillManager } from '../../../../src/agent/skills/SkillManager.js';
import { SKILL_MARKER_FILE } from '../../../../src/agent/skills/SkillPublisher.js';
import { makeTempDir, makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

describe('IOManager skill publish confinement', () => {
  let storage: GraphStorage;
  let io: IOManager;
  let outside: string;

  beforeEach(async () => {
    storage = new GraphStorage(makeTempJsonlPath());
    io = new IOManager(storage);
    outside = makeTempDir('skills-outside-');
    await new SkillManager(storage).add({
      name: 'Confined',
      description: 'Use when testing path confinement',
      kind: 'tool',
      scope: { domains: ['tests'] },
      uncertainty: 0,
      body: 'body',
    });
  });

  afterEach(() => {
    cleanupTempDirs();
  });

  it('exports into a relative directory inside the storage root', async () => {
    const result = await io.exportSkills('published');
    expect(result.skillCount).toBe(1);
    expect(existsSync(join(result.dir, SKILL_MARKER_FILE))).toBe(true);
  });

  it('rejects an absolute export directory outside the storage root and writes nothing there', async () => {
    const target = join(outside, 'tree');
    await expect(io.exportSkills(target)).rejects.toThrow(/outside the allowed directory/);
    expect(existsSync(target)).toBe(false);
  });

  it('rejects a relative export path that climbs out with ..', async () => {
    await expect(io.exportSkills('../escape')).rejects.toThrow(/Path traversal/);
  });

  it('rejects an absolute import directory outside the storage root', async () => {
    await expect(io.importSkills(outside)).rejects.toThrow(/outside the allowed directory/);
  });

  it('imports from a relative directory inside the storage root', async () => {
    await io.exportSkills('published');
    const report = await io.importSkills('published');
    expect(report.unchanged).toHaveLength(1);
    expect(report.conflicts).toEqual([]);
  });
});
