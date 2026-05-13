/**
 * BackupManager Unit Tests
 *
 * Tests the standalone BackupManager extracted from IOManager in
 * Phase 2 step 29. Covers the create / list / restore / delete /
 * cleanOld lifecycle directly against the extracted class.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BackupManager } from '../../../src/features/BackupManager.js';
import { IOManager } from '../../../src/features/IOManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';

describe('BackupManager', () => {
  let storage: GraphStorage;
  let manager: IOManager;
  let backups: BackupManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `backup-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'memory.jsonl');
    storage = new GraphStorage(testFilePath);

    await storage.saveGraph({
      entities: [
        { name: 'alice', entityType: 'person', observations: ['likes coffee'] },
        { name: 'bob', entityType: 'person', observations: ['likes tea'] },
      ],
      relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
    });

    manager = new IOManager(storage);
    backups = manager.backupManager;
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('extraction wiring', () => {
    it('exposes a BackupManager via IOManager.backupManager', () => {
      expect(backups).toBeInstanceOf(BackupManager);
    });

    it('points at the .backups subdirectory of the storage file', () => {
      expect(backups.getDir()).toBe(join(testDir, '.backups'));
    });

    it('matches IOManager.getBackupDir()', () => {
      expect(manager.getBackupDir()).toBe(backups.getDir());
    });
  });

  describe('create', () => {
    it('creates a compressed backup with metadata sidecar', async () => {
      const result = await backups.create({ description: 'phase-29-test' });
      expect(result.compressed).toBe(true);
      expect(result.entityCount).toBe(2);
      expect(result.relationCount).toBe(1);
      expect(result.path).toMatch(/backup_.*\.jsonl\.br$/);

      const metaPath = `${result.path}.meta.json`;
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      expect(meta.description).toBe('phase-29-test');
      expect(meta.compressed).toBe(true);
      expect(meta.compressionFormat).toBe('brotli');
    });

    it('respects compress=false', async () => {
      const result = await backups.create({ compress: false });
      expect(result.compressed).toBe(false);
      expect(result.path).toMatch(/backup_.*\.jsonl$/);
      const content = await fs.readFile(result.path, 'utf-8');
      expect(content).toContain('alice');
    });

    it('accepts legacy string description argument', async () => {
      const result = await backups.create('legacy-string-arg');
      expect(result.description).toBe('legacy-string-arg');
    });
  });

  describe('list', () => {
    it('returns [] when the backup dir does not exist', async () => {
      const list = await backups.list();
      expect(list).toEqual([]);
    });

    it('returns backups sorted newest-first', async () => {
      await backups.create({ description: 'first' });
      await new Promise((r) => setTimeout(r, 10));
      await backups.create({ description: 'second' });
      const list = await backups.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.metadata.description).toBe('second');
      expect(list[1]!.metadata.description).toBe('first');
    });
  });

  describe('restore', () => {
    it('round-trips graph state via a compressed backup', async () => {
      const result = await backups.create({ description: 'restore-test' });

      await storage.saveGraph({ entities: [], relations: [] });
      storage.clearCache();
      expect((await storage.loadGraph()).entities).toHaveLength(0);

      const restored = await backups.restore(result.path);
      expect(restored.entityCount).toBe(2);
      expect(restored.relationCount).toBe(1);
      expect(restored.wasCompressed).toBe(true);
    });

    it('rejects paths outside the backup dir', async () => {
      const outside = join(testDir, 'evil.jsonl');
      await fs.writeFile(outside, '');
      await expect(backups.restore(outside)).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('removes the backup file and its metadata sidecar', async () => {
      const result = await backups.create();
      await backups.delete(result.path);
      await expect(fs.access(result.path)).rejects.toThrow();
      await expect(fs.access(`${result.path}.meta.json`)).rejects.toThrow();
    });
  });

  describe('cleanOld', () => {
    it('keeps the N most-recent backups and reports removed count', async () => {
      for (let i = 0; i < 4; i++) {
        await backups.create({ description: `b${i}` });
        await new Promise((r) => setTimeout(r, 2));
      }
      const removed = await backups.cleanOld(2);
      expect(removed).toBe(2);
      const remaining = await backups.list();
      expect(remaining).toHaveLength(2);
    });

    it('returns 0 when fewer backups exist than keepCount', async () => {
      await backups.create();
      const removed = await backups.cleanOld(10);
      expect(removed).toBe(0);
    });
  });

  describe('IOManager delegation parity', () => {
    it('IOManager.createBackup delegates to BackupManager.create', async () => {
      const result = await manager.createBackup({ description: 'parity' });
      expect(result.entityCount).toBe(2);

      const list = await backups.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.metadata.description).toBe('parity');
    });

    it('IOManager.listBackups returns the same set as BackupManager.list', async () => {
      await manager.createBackup({ description: 'a' });
      await manager.createBackup({ description: 'b' });
      const direct = await backups.list();
      const viaIO = await manager.listBackups();
      expect(viaIO.map((b) => b.fileName)).toEqual(direct.map((b) => b.fileName));
    });
  });
});
