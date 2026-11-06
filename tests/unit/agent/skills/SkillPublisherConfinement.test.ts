/**
 * SkillPublisher path confinement (Phase 6 B1): publish and import resolve `dir` against the
 * publisher root and refuse traversal, absolute paths outside it, the root itself, symlink escapes
 * and special filesystems, before creating anything.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SkillPublisher } from '../../../../src/agent/skills/SkillPublisher.js';
import { SkillManager } from '../../../../src/agent/skills/SkillManager.js';
import { ValidationError } from '../../../../src/utils/errors.js';
import { GraphStorage } from '../../../../src/core/GraphStorage.js';
import { makeTempDir, makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import { skillInput } from '../knowledge/knowledgeFixtures.js';

/**
 * Expect a refusal with the given reason code.
 *
 * @param run - The publish or import call.
 * @param reason - Expected `dir:<reason>` code.
 */
async function expectRefused(run: Promise<unknown>, reason: string): Promise<void> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as ValidationError).errors).toEqual([`dir:${reason}`]);
}

describe('SkillPublisher confinement', () => {
  let base: string;
  let outside: string;
  let publisher: SkillPublisher;
  const stamp = `${process.pid}-${Date.now()}`;

  beforeEach(async () => {
    const storage = new GraphStorage(makeTempJsonlPath());
    const skills = new SkillManager(storage);
    await skills.add(skillInput('Confined skill'));
    base = makeTempDir('skill-confine-');
    outside = makeTempDir('skill-outside-');
    writeFileSync(join(outside, 'secret.txt'), 's');
    publisher = new SkillPublisher(storage, skills, { root: base });
  });

  afterEach(() => {
    cleanupTempDirs();
  });

  it('refuses ".." segments (absolute and relative) and creates nothing', async () => {
    const joined = join(base, '..', `esc-${stamp}`); // normalised: an absolute path outside the root
    await expectRefused(publisher.publish(joined), 'outside-root');
    await expectRefused(publisher.importSkills(joined), 'outside-root');
    const raw = `${base}/../esc-${stamp}`;
    await expectRefused(publisher.publish(raw), 'path-traversal');
    await expectRefused(publisher.importSkills(raw), 'path-traversal');
    expect(existsSync(resolve(raw))).toBe(false);
    const rel = `../rel-escape-${stamp}`;
    await expectRefused(publisher.publish(rel), 'path-traversal');
    await expectRefused(publisher.importSkills(rel), 'path-traversal');
    expect(existsSync(resolve(base, rel))).toBe(false);
  });

  it('refuses absolute paths outside the root, the root itself, and /etc', async () => {
    const abs = join(outside, 'tree');
    await expectRefused(publisher.publish(abs), 'outside-root');
    await expectRefused(publisher.importSkills(abs), 'outside-root');
    expect(existsSync(abs)).toBe(false);
    await expectRefused(publisher.publish('/etc/atk'), 'outside-root');
    expect(existsSync('/etc/atk')).toBe(false);
    await expectRefused(publisher.publish(base), 'is-root');
    await expectRefused(publisher.publish('.'), 'is-root');
    expect(readdirSync(base)).toEqual([]);
  });

  it('refuses /proc, /sys and /dev promptly, even under a root of "/"', async () => {
    const started = Date.now();
    await expectRefused(publisher.publish('/proc/x'), 'special-filesystem');
    await expectRefused(publisher.importSkills('/proc/x'), 'special-filesystem');
    const wide = new SkillPublisher(new GraphStorage(makeTempJsonlPath()), new SkillManager(new GraphStorage(makeTempJsonlPath())), { root: '/' });
    for (const dir of ['/proc/x', '/sys/x', '/dev/x', 'dev/shm/x']) {
      await expectRefused(wide.publish(dir), 'special-filesystem');
      await expectRefused(wide.importSkills(dir), 'special-filesystem');
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(existsSync('/dev/x')).toBe(false);
  });

  it('refuses a symlinked directory that resolves outside the root and writes nothing there', async () => {
    symlinkSync(outside, join(base, 'link'), 'dir');
    await expectRefused(publisher.publish('link'), 'symlink-escape');
    await expectRefused(publisher.publish(join(base, 'link', 'x')), 'symlink-escape');
    await expectRefused(publisher.importSkills('link'), 'symlink-escape');
    expect(readdirSync(outside)).toEqual(['secret.txt']);
    expect(existsSync(join(outside, 'x'))).toBe(false);
  });

  it('publishes and imports an in-root subdirectory (relative or absolute)', async () => {
    mkdirSync(join(base, 'sub'));
    const out = await publisher.publish('sub/tree');
    expect(out.dir).toBe(join(base, 'sub', 'tree'));
    expect(out.skillCount).toBe(1);
    const report = await publisher.importSkills(join(base, 'sub', 'tree'));
    expect(report.conflicts).toEqual([]);
    expect(report.parseErrors).toEqual([]);
  });
});
