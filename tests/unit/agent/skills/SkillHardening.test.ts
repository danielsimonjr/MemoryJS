/**
 * Regression tests for the Phase 1B/1C challenger findings on the skill side:
 * symlink-safe import (item 1), U+2028/U+2029 round trips (item 2), no
 * spurious absorb on CRLF / trailing-newline edits (item 3), publish crash
 * recovery and cleanup (item 4), dedup hash separation and retired skills
 * (item 9), and match option validation / provider fallback (item 11).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SkillManager, type AddSkillInput } from '../../../../src/agent/skills/SkillManager.js';
import { SkillPublisher } from '../../../../src/agent/skills/SkillPublisher.js';
import { parseSkillMarkdown, serializeSkillMarkdown } from '../../../../src/agent/skills/SkillFormat.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { makeTempDir, withBothBackends } from '../../../helpers/tempStorage.js';

const SKILL: AddSkillInput = {
  name: 'Paginate API',
  description: 'Use when paginating an api response',
  kind: 'tool',
  scope: { domains: ['api'] },
  uncertainty: 0.1,
  body: 'Follow the cursor.',
};

withBothBackends('Skill hardening', (backend) => {
  let storage: IGraphStorage;
  let skills: SkillManager;
  let publisher: SkillPublisher;
  let root: string;
  let tree: string;

  beforeEach(() => {
    storage = backend.create();
    skills = new SkillManager(storage);
    publisher = new SkillPublisher(storage, skills);
    root = makeTempDir('skill-harden-');
    tree = join(root, 'tree');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const versionOf = (id: string) => storage.getEntityByName(id)?.version ?? 1;

  it('item 1: a symlinked SKILL.md is refused and the link target is neither read nor written', async () => {
    const id = await skills.add(SKILL);
    await publisher.publish(tree);
    const secret = join(root, 'secret.md');
    const secretText = serializeSkillMarkdown({ ...skills.get(id)!, body: 'STOLEN' });
    writeFileSync(secret, secretText);
    await fs.rm(join(tree, id, 'SKILL.md'));
    symlinkSync(secret, join(tree, id, 'SKILL.md'));

    const report = await publisher.importSkills(tree);
    expect(report.absorbed).toEqual([]);
    expect(report.parseErrors.map((e) => e.id)).toEqual([id]);
    expect(readFileSync(secret, 'utf8')).toBe(secretText);
    expect(skills.get(id)?.body).toBe(SKILL.body);
  });

  it('item 1: a symlinked skill directory is reported unmatched', async () => {
    const id = await skills.add(SKILL);
    await publisher.publish(tree);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    renameSync(join(tree, id), join(outside, id));
    symlinkSync(join(outside, id), join(tree, id));
    const report = await publisher.importSkills(tree);
    expect(report.unmatched).toEqual([id]);
    expect(report.absorbed).toEqual([]);
  });

  it('item 3: CRLF-only and trailing-newline-only edits are unchanged, not absorbed', async () => {
    const id = await skills.add(SKILL);
    await publisher.publish(tree);
    const file = join(tree, id, 'SKILL.md');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace(/\n/g, '\r\n'));
    expect((await publisher.importSkills(tree)).unchanged).toEqual([id]);
    writeFileSync(file, text.replace(/\n$/, ''));
    expect((await publisher.importSkills(tree)).unchanged).toEqual([id]);
    expect(versionOf(id)).toBe(1);
  });

  it('item 4: a throwing list() leaves no tmp sibling behind', async () => {
    await skills.add(SKILL);
    vi.spyOn(skills, 'list').mockRejectedValueOnce(new Error('list boom'));
    await expect(publisher.publish(tree)).rejects.toThrow('list boom');
    expect(readdirSync(root).filter((n) => n.startsWith('tree.'))).toEqual([]);
  });

  it('item 4: a failed cleanup of the old tree does not fail the publish; the next publish sweeps it', async () => {
    await skills.add(SKILL);
    await publisher.publish(tree);
    const realRm = fs.rm.bind(fs);
    const spy = vi.spyOn(fs, 'rm').mockImplementation(async (p, o) => {
      if (String(p).includes('.old-')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return realRm(p, o);
    });
    await expect(publisher.publish(tree)).resolves.toBeDefined();
    spy.mockRestore();
    expect(readdirSync(root).some((n) => n.startsWith('tree.old-'))).toBe(true);
    await publisher.publish(tree);
    expect(readdirSync(root).filter((n) => n.startsWith('tree.'))).toEqual([]);
  });

  it('item 4: when the swap and its rollback both fail, the next import restores the old tree', async () => {
    const id = await skills.add(SKILL);
    await publisher.publish(tree);
    const realRename = fs.rename.bind(fs);
    let n = 0;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (a, b) => {
      n++;
      if (n >= 2) throw new Error(`inject ${n}`);
      return realRename(a, b);
    });
    await expect(publisher.publish(tree)).rejects.toThrow();
    spy.mockRestore();
    expect(existsSync(tree)).toBe(false);
    const report = await publisher.importSkills(tree);
    expect(existsSync(join(tree, id, 'SKILL.md'))).toBe(true);
    expect(report.unchanged).toEqual([id]);
    expect(readdirSync(root).filter((n) => n.startsWith('tree.'))).toEqual([]);
  });

  it('item 9: name/body concatenations do not collide and retired matches do not dedup', async () => {
    const a = await skills.add({ ...SKILL, name: 'ab', body: 'c' });
    const b = await skills.add({ ...SKILL, name: 'a', body: 'bc' });
    expect(a).not.toBe(b);
    expect(await skills.add({ ...SKILL, name: 'a', body: 'bc' })).toBe(b);
    await skills.retire(b, 'old');
    const again = await skills.add({ ...SKILL, name: 'a', body: 'bc' });
    expect(again).not.toBe(b);
    expect(skills.get(again)?.retired).toBeUndefined();
  });

  it('item 11: limit is clamped at 0, NaN minScore is rejected, a failing provider falls back to lexical', async () => {
    await skills.add(SKILL);
    await skills.add({ ...SKILL, name: 'Paginate 2', body: 'other' });
    expect(await skills.match('paginating api', { limit: -1 })).toEqual([]);
    expect(await skills.match('paginating api', { limit: 0 })).toEqual([]);
    await expect(skills.match('paginating api', { minScore: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    const lexical = await skills.match('paginating api');
    skills.setSemanticSearch({ calculateSimilarity: async () => { throw new Error('provider down'); } });
    const fallback = await skills.match('paginating api');
    expect(fallback.map((m) => [m.skill.id, m.score])).toEqual(lexical.map((m) => [m.skill.id, m.score]));
  });
});

describe('item 2: SKILL.md round trip with line and paragraph separators', () => {
  it('values and bodies holding U+2028 / U+2029 survive serialize and parse', () => {
    const skill = {
      name: 'sep name',
      description: 'desc x',
      kind: 'tool' as const,
      scope: { domains: ['d '], tasks: ['t '] },
      uncertainty: 0.5,
      sources: [{ kind: 'document' as const, ref: 'r ' }],
      resources: [],
      lineage: { revisionId: 'rev ' },
      body: 'line one\nline two\n',
    };
    const text = serializeSkillMarkdown(skill as never);
    expect(text.split('\n')[1]).not.toContain(' ');
    const parsed = parseSkillMarkdown(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
      lineage: skill.lineage,
      body: skill.body,
    });
  });
});
