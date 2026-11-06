/**
 * SkillPublisher (RS-3): atomic publish and the import no-op / absorb / conflict matrix.
 * Runs on JSONL and SQLite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SkillManager, type AddSkillInput } from '../../../../src/agent/skills/SkillManager.js';
import {
  SkillPublisher,
  SKILL_MARKER_FILE,
} from '../../../../src/agent/skills/SkillPublisher.js';
import { serializeSkillMarkdown, skillContentHash } from '../../../../src/agent/skills/SkillFormat.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { makeTempDir, withBothBackends } from '../../../helpers/tempStorage.js';

const SKILL: AddSkillInput = {
  name: 'Changelog entry',
  description: 'Use when writing a changelog entry for a release',
  kind: 'convention',
  scope: { domains: ['release'] },
  uncertainty: 0.3,
  body: '## Rules\nKeep entries short.',
};

function versionOf(storage: IGraphStorage, id: string): number {
  return storage.getEntityByName(id)?.version ?? 1;
}

withBothBackends('SkillPublisher', (backend) => {
  let storage: IGraphStorage;
  let skills: SkillManager;
  let publisher: SkillPublisher;
  let root: string;
  let treeDir: string;

  beforeEach(() => {
    storage = backend.create();
    skills = new SkillManager(storage);
    publisher = new SkillPublisher(storage, skills);
    root = makeTempDir('skill-publish-');
    treeDir = join(root, 'published');
  });

  describe('publish', () => {
    it('writes one SKILL.md per non-retired skill and a marker with each published hash', async () => {
      const live = await skills.add(SKILL);
      const retired = await skills.add({ ...SKILL, name: 'Old', body: 'old body' });
      await skills.retire(retired, 'superseded');

      const result = await publisher.publish(treeDir, { snapshotId: 'K-3' });

      expect(result.skillCount).toBe(1);
      expect(readdirSync(treeDir).sort()).toEqual([live, SKILL_MARKER_FILE].sort());
      const text = readFileSync(join(treeDir, live, 'SKILL.md'), 'utf8');
      expect(text).toBe(serializeSkillMarkdown(skills.get(live)!));
      const marker = JSON.parse(readFileSync(join(treeDir, SKILL_MARKER_FILE), 'utf8')) as {
        publishedAt: string;
        snapshotId: string;
        skills: Record<string, string>;
      };
      expect(marker.snapshotId).toBe('K-3');
      expect(marker.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(marker.skills).toEqual({ [live]: skillContentHash(text) });
      expect(result.markerPath).toBe(join(treeDir, SKILL_MARKER_FILE));
    });

    it('builds in a sibling temp directory and leaves no temp or old siblings behind', async () => {
      await skills.add(SKILL);
      await publisher.publish(treeDir);
      await skills.add({ ...SKILL, name: 'Second', body: 'second body' });
      await publisher.publish(treeDir);

      const siblings = readdirSync(root);
      expect(siblings).toEqual(['published']);
      expect(siblings.some((n) => n.includes('.tmp-') || n.includes('.old-'))).toBe(false);
    });

    it('replaces the previous tree as a whole, dropping a skill that was retired since', async () => {
      const id = await skills.add(SKILL);
      await publisher.publish(treeDir);
      expect(existsSync(join(treeDir, id, 'SKILL.md'))).toBe(true);

      await skills.retire(id, 'obsolete');
      await publisher.publish(treeDir);
      expect(existsSync(join(treeDir, id))).toBe(false);
      expect(JSON.parse(readFileSync(join(treeDir, SKILL_MARKER_FILE), 'utf8')).skills).toEqual({});
    });

    it('publishes an empty tree with an empty marker when there are no skills', async () => {
      const result = await publisher.publish(treeDir);
      expect(result.skillCount).toBe(0);
      expect(readdirSync(treeDir)).toEqual([SKILL_MARKER_FILE]);
    });
  });

  describe('importSkills', () => {
    async function publishOne(): Promise<string> {
      const id = await skills.add(SKILL);
      await publisher.publish(treeDir);
      return id;
    }

    function fileOf(id: string): string {
      return join(treeDir, id, 'SKILL.md');
    }

    it('is a no-op when the file is unchanged since publish', async () => {
      const id = await publishOne();
      const report = await publisher.importSkills(treeDir);
      expect(report).toEqual({ absorbed: [], unchanged: [id], conflicts: [], parseErrors: [], unmatched: [] });
    });

    it('absorbs a human edit when the entity is unchanged, rewrites the file, and is a no-op afterwards', async () => {
      const id = await publishOne();
      const edited = serializeSkillMarkdown({
        ...skills.get(id)!,
        description: 'Use when writing release notes for users',
        body: '## Rules\nWrite for end users.',
      });
      writeFileSync(fileOf(id), edited, 'utf8');

      const first = await publisher.importSkills(treeDir);
      expect(first.absorbed).toEqual([id]);
      expect(first.conflicts).toEqual([]);
      expect(skills.get(id)?.description).toBe('Use when writing release notes for users');
      // The file format stores bodies with a trailing newline, so the absorbed body carries one.
      expect(skills.get(id)?.body).toBe('## Rules\nWrite for end users.\n');
      expect(versionOf(storage, id)).toBe(2);

      const marker = JSON.parse(readFileSync(join(treeDir, SKILL_MARKER_FILE), 'utf8')) as { skills: Record<string, string> };
      expect(marker.skills[id]).toBe(skillContentHash(readFileSync(fileOf(id), 'utf8')));

      const second = await publisher.importSkills(treeDir);
      expect(second.absorbed).toEqual([]);
      expect(second.unchanged).toEqual([id]);
    });

    it('leaves the file alone when only the entity changed since publish', async () => {
      const id = await publishOne();
      await skills.update(id, { uncertainty: 0.9 }, { expectedVersion: versionOf(storage, id) });
      const before = readFileSync(fileOf(id), 'utf8');

      const report = await publisher.importSkills(treeDir);

      expect(report.unchanged).toEqual([id]);
      expect(report.conflicts).toEqual([]);
      expect(readFileSync(fileOf(id), 'utf8')).toBe(before);
      expect(skills.get(id)?.uncertainty).toBe(0.9);
    });

    it('reports a conflict when both the file and the entity changed, and overwrites neither', async () => {
      const id = await publishOne();
      await skills.update(id, { description: 'Entity-side change' }, { expectedVersion: versionOf(storage, id) });
      const humanEdit = serializeSkillMarkdown({ ...skills.get(id)!, body: 'Human-side change' });
      writeFileSync(fileOf(id), humanEdit, 'utf8');

      const report = await publisher.importSkills(treeDir);

      expect(report.absorbed).toEqual([]);
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0]).toEqual({
        id,
        fileHash: skillContentHash(humanEdit),
        entityHash: skillContentHash(serializeSkillMarkdown(skills.get(id)!)),
      });
      expect(readFileSync(fileOf(id), 'utf8')).toBe(humanEdit);
      expect(skills.get(id)?.description).toBe('Entity-side change');
    });

    it('reports a conflict for a changed file when the marker is unreadable, because no baseline exists', async () => {
      const id = await publishOne();
      corruptMarker();
      writeFileSync(fileOf(id), serializeSkillMarkdown({ ...skills.get(id)!, body: 'edited' }), 'utf8');
      const report = await publisher.importSkills(treeDir);
      expect(report.conflicts.map((c) => c.id)).toEqual([id]);
      expect(report.absorbed).toEqual([]);
    });

    it('treats a file equal to the current entity as unchanged even without a readable marker', async () => {
      const id = await publishOne();
      corruptMarker();
      const report = await publisher.importSkills(treeDir);
      expect(report.unchanged).toEqual([id]);
    });

    it('reports a parse error with the line of the first unsupported construct', async () => {
      const id = await publishOne();
      writeFileSync(fileOf(id), '---\nname: "x"\n# comment\n---\nbody\n', 'utf8');
      const report = await publisher.importSkills(treeDir);
      expect(report.parseErrors).toEqual([
        expect.objectContaining({ id, line: 3, reason: expect.stringMatching(/comments are not supported/) }),
      ]);
      expect(report.absorbed).toEqual([]);
    });

    it('lists a directory with no matching live skill as unmatched', async () => {
      await publishOne();
      mkdirSync(join(treeDir, 'skill-ghost-00000000'));
      writeFileSync(join(treeDir, 'skill-ghost-00000000', 'SKILL.md'), '---\n', 'utf8');
      const report = await publisher.importSkills(treeDir);
      expect(report.unmatched).toEqual(['skill-ghost-00000000']);
    });

    it('returns an empty report for a missing directory', async () => {
      const report = await publisher.importSkills(join(root, 'does-not-exist'));
      expect(report).toEqual({ absorbed: [], unchanged: [], conflicts: [], parseErrors: [], unmatched: [] });
    });

    /** Replace the marker with unreadable content, so no publish baseline exists. */
    function corruptMarker(): void {
      writeFileSync(join(treeDir, SKILL_MARKER_FILE), '{not json', 'utf8');
    }
  });
});
