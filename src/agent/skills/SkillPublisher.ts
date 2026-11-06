/**
 * Publishes skills as a SKILL.md tree and absorbs human edits back (spec RS-3).
 *
 * Entities are the source of truth. The tree is the published view a harness loads.
 *
 * - {@link SkillPublisher.publish} writes every non-retired skill to
 *   `<dir>.tmp-<random>`, adds the change marker `.memoryjs-skills.json`, then
 *   swaps the tree into place with two renames. A reader never sees a half-written tree.
 * - {@link SkillPublisher.importSkills} compares each file with its publish
 *   baseline (the hash recorded in the marker). Unchanged files are no-ops.
 *   A changed file whose entity is unchanged is absorbed into the entity. When
 *   both sides changed, the pair is reported as a conflict and nothing is overwritten.
 *
 * The publish baseline lives in the marker (mirrored on the entity as
 * `SkillRecord.publishedHash`). A missing marker means no baseline, so every
 * difference is a conflict. Import only reads regular, non-symlinked files
 * inside the tree, compares content after CRLF normalisation, and rewrites
 * files with `durableWriteFile` (tmp + rename). Publish and import first
 * recover an interrupted swap (`skillTreeFs.recoverPublishedTree`).
 *
 * @module agent/skills/SkillPublisher
 * @experimental Spec RS-3. The marker format and conflict policy may evolve.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, join, resolve } from 'path';
import type { IGraphStorage } from '../../types/types.js';
import { isSkillEntity, toIsoDateTime } from '../../types/agent-memory.js';
import type { SkillId } from '../../types/skills.js';
import { durableWriteFile, renameOver } from '../../utils/durableWriteFile.js';
import { pathExists, readConfinedSkillFile, recoverPublishedTree, removeBestEffort } from './skillTreeFs.js';
import { SkillManager, type SkillPatch } from './SkillManager.js';
import {
  loadOptionalYaml,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  skillContentHash,
  type ParsedSkillDocument,
} from './SkillFormat.js';

/** Name of the change marker written at the root of a published tree. */
export const SKILL_MARKER_FILE = '.memoryjs-skills.json';

/** Contents of {@link SKILL_MARKER_FILE}. */
export interface SkillPublishMarker {
  /** ISO timestamp of the publish. */
  publishedAt: string;
  /** Knowledge snapshot the tree was built from, or `null` when not supplied. */
  snapshotId: string | null;
  /** Publish baseline: SHA-256 of each published SKILL.md, keyed by skill id. */
  skills: Record<string, string>;
}

/** Result of {@link SkillPublisher.publish}. */
export interface PublishResult {
  /** Absolute path of the published tree. */
  dir: string;
  /** Absolute path of the change marker. */
  markerPath: string;
  /** Number of skills written. */
  skillCount: number;
  /** The marker written into the tree. */
  marker: SkillPublishMarker;
}

/** A file and entity that both changed since the last publish. */
export interface ImportConflict {
  /** Skill id. */
  id: SkillId;
  /** SHA-256 of the edited file. */
  fileHash: string;
  /** SHA-256 of the entity's current serialization. */
  entityHash: string;
}

/** A file that could not be parsed. */
export interface ImportParseError {
  /** Skill id (directory name). */
  id: string;
  /** 1-based line of the first unsupported construct. */
  line: number;
  /** Reason naming the construct. */
  reason: string;
}

/** Result of {@link SkillPublisher.importSkills}. */
export interface ImportReport {
  /** Entities updated from an edited file. */
  absorbed: SkillId[];
  /** Files left alone (unchanged, or already equal to the entity). */
  unchanged: SkillId[];
  /** Pairs that changed on both sides; never overwritten. */
  conflicts: ImportConflict[];
  /** Files that could not be parsed. */
  parseErrors: ImportParseError[];
  /** Directories with no matching live skill. */
  unmatched: string[];
}

/** Options for {@link SkillPublisher.publish}. */
export interface PublishOptions {
  /** Snapshot identifier recorded in the marker. */
  snapshotId?: string;
}

/** Publishes and imports the SKILL.md tree for a storage. */
export class SkillPublisher {
  private readonly storage: IGraphStorage;
  private readonly skills: SkillManager;

  /**
   * Create a publisher over the storage and skill manager.
   *
   * @param storage - Graph storage holding the skill entities.
   * @param skills - Skill manager used for reads and edits.
   */
  constructor(storage: IGraphStorage, skills: SkillManager) {
    this.storage = storage;
    this.skills = skills;
  }

  /**
   * Publish every non-retired skill to `dir` atomically.
   *
   * @param dir - Target directory. Replaced as a whole on success.
   * @param options - Optional snapshot id for the marker.
   * @returns The published location and marker.
   */
  async publish(dir: string, options: PublishOptions = {}): Promise<PublishResult> {
    const target = resolve(dir);
    const hex = randomBytes(6).toString('hex');
    const tmp = `${target}.tmp-${hex}`;
    const old = `${target}.old-${hex}`;
    await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await recoverPublishedTree(target);
    await fs.mkdir(tmp, { recursive: true });

    const hashes: Record<string, string> = {};
    try {
      const skills = await this.skills.list();
      for (const skill of skills) {
        const text = serializeSkillMarkdown(skill);
        await fs.mkdir(join(tmp, skill.id), { recursive: true });
        await fs.writeFile(join(tmp, skill.id, 'SKILL.md'), text, { encoding: 'utf8', flag: 'wx' });
        hashes[skill.id] = skillContentHash(text);
      }
      const marker: SkillPublishMarker = {
        publishedAt: toIsoDateTime(new Date()),
        snapshotId: options.snapshotId ?? null,
        skills: hashes,
      };
      await fs.writeFile(join(tmp, SKILL_MARKER_FILE), JSON.stringify(marker, null, 2) + '\n', 'utf8');

      const existed = await pathExists(target);
      if (existed) await renameOver(target, old);
      try {
        await renameOver(tmp, target);
      } catch (err) {
        if (existed) await renameOver(old, target);
        throw err;
      }
      if (existed) await removeBestEffort(old);
      for (const [id, hash] of Object.entries(hashes)) await this.skills.setPublishedHash(id, hash);
      return {
        dir: target,
        markerPath: join(target, SKILL_MARKER_FILE),
        skillCount: skills.length,
        marker,
      };
    } finally {
      await removeBestEffort(tmp);
    }
  }

  /**
   * Compare the tree at `dir` with the entities and absorb or report each skill.
   * Never overwrites a file and an entity that both changed.
   *
   * @param dir - Published tree directory.
   * @returns What was absorbed, left alone, conflicting or unparseable.
   */
  async importSkills(dir: string): Promise<ImportReport> {
    const root = resolve(dir);
    const report: ImportReport = { absorbed: [], unchanged: [], conflicts: [], parseErrors: [], unmatched: [] };
    await recoverPublishedTree(root);
    const baseline = await readMarkerHashes(join(root, SKILL_MARKER_FILE));
    const yaml = await loadOptionalYaml();
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const markerHashes = { ...baseline };

    for (const entry of entries) {
      const id = entry.name;
      if (entry.isSymbolicLink()) {
        report.unmatched.push(id);
        continue;
      }
      if (!entry.isDirectory()) continue;
      const filePath = join(root, id, 'SKILL.md');
      const read = await readConfinedSkillFile(root, filePath);
      if (!read.ok && read.reason !== 'missing') {
        report.parseErrors.push({ id, line: 0, reason: `SKILL.md refused: ${read.reason}` });
        continue;
      }
      const skill = this.skills.get(id);
      if (!read.ok || !skill || skill.retired) {
        report.unmatched.push(id);
        continue;
      }
      const text = read.text.replace(/\r\n/g, '\n');
      const parsed = parseSkillMarkdown(text, yaml ? { yaml } : {});
      if (!parsed.ok) {
        report.parseErrors.push({ id, line: parsed.line, reason: parsed.reason });
        continue;
      }
      const fileHash = skillContentHash(text);
      const entityText = serializeSkillMarkdown(skill);
      const entityHash = skillContentHash(entityText);
      const published = baseline[id];
      const parsedText = serializeSkillMarkdown({ ...parsed.value, lineage: skill.lineage });

      if (fileHash === published || fileHash === entityHash || parsedText === entityText) {
        report.unchanged.push(id as SkillId);
        continue;
      }
      if (published !== undefined && entityHash === published) {
        const outcome = await this.absorb(id as SkillId, parsed.value);
        if (outcome === 'updated') {
          const rewritten = serializeSkillMarkdown(this.skills.get(id)!);
          await durableWriteFile(filePath, rewritten);
          markerHashes[id] = skillContentHash(rewritten);
          await this.skills.setPublishedHash(id, markerHashes[id]);
          report.absorbed.push(id as SkillId);
        } else {
          report.conflicts.push({ id: id as SkillId, fileHash, entityHash });
        }
        continue;
      }
      report.conflicts.push({ id: id as SkillId, fileHash, entityHash });
    }

    if (report.absorbed.length > 0) await this.rewriteMarkerHashes(root, markerHashes);
    return report;
  }

  // ==================== Internal ====================

  private async absorb(id: SkillId, doc: ParsedSkillDocument): Promise<'updated' | 'version-conflict' | 'not-found'> {
    const entity = this.storage.getEntityByName(id);
    if (!isSkillEntity(entity)) return 'not-found';
    const patch: SkillPatch = {
      name: doc.name,
      description: doc.description,
      kind: doc.kind,
      scope: doc.scope,
      uncertainty: doc.uncertainty,
      body: doc.body,
      sources: doc.sources,
      resources: doc.resources,
      lineage: { ...entity.skillRecord.lineage, producedBy: 'manual' },
      ...(doc.extra !== undefined ? { extra: doc.extra } : {}),
    };
    return this.skills.update(id, patch, { expectedVersion: entity.version ?? 1 });
  }

  private async rewriteMarkerHashes(root: string, hashes: Record<string, string>): Promise<void> {
    const markerPath = join(root, SKILL_MARKER_FILE);
    const previous = await readMarkerFile(markerPath);
    const marker: SkillPublishMarker = {
      publishedAt: previous?.publishedAt ?? toIsoDateTime(new Date()),
      snapshotId: previous?.snapshotId ?? null,
      skills: hashes,
    };
    await durableWriteFile(markerPath, JSON.stringify(marker, null, 2) + '\n');
  }
}

// ==================== Helpers ====================

async function readMarkerFile(path: string): Promise<SkillPublishMarker | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<SkillPublishMarker>;
    if (typeof parsed.publishedAt !== 'string' || typeof parsed.skills !== 'object' || parsed.skills === null) {
      return undefined;
    }
    return {
      publishedAt: parsed.publishedAt,
      snapshotId: typeof parsed.snapshotId === 'string' ? parsed.snapshotId : null,
      skills: parsed.skills as Record<string, string>,
    };
  } catch {
    return undefined;
  }
}

async function readMarkerHashes(path: string): Promise<Record<string, string>> {
  return (await readMarkerFile(path))?.skills ?? {};
}
