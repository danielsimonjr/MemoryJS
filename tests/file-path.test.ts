import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureMemoryFilePath, defaultMemoryPath } from '../src/index.js';

describe('ensureMemoryFilePath', () => {
  // The ensureMemoryFilePath function uses paths relative to src/utils/entityUtils.ts
  // After relocation, paths are now in project root (../../ from dist/utils/)
  // So oldMemoryPath = memory.json and newMemoryPath = memory.jsonl in project root
  const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const oldMemoryPath = path.join(projectRoot, 'memory.json');
  const newMemoryPath = path.join(projectRoot, 'memory.jsonl');

  let originalEnv: string | undefined;
  let existingMemoryContent: string | null = null;
  let existingMemoryJsonContent: string | null = null;

  beforeEach(async () => {
    // Save original environment variable
    originalEnv = process.env.MEMORY_FILE_PATH;
    // Delete environment variable
    delete process.env.MEMORY_FILE_PATH;

    // Backup existing files if they exist (to preserve real data)
    try {
      existingMemoryContent = await fs.readFile(newMemoryPath, 'utf-8');
      await fs.unlink(newMemoryPath);
    } catch {
      existingMemoryContent = null;
    }
    try {
      existingMemoryJsonContent = await fs.readFile(oldMemoryPath, 'utf-8');
      await fs.unlink(oldMemoryPath);
    } catch {
      existingMemoryJsonContent = null;
    }
  });

  afterEach(async () => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.MEMORY_FILE_PATH = originalEnv;
    } else {
      delete process.env.MEMORY_FILE_PATH;
    }

    // Clean up test files
    try {
      await fs.unlink(oldMemoryPath);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await fs.unlink(newMemoryPath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Restore original files if they existed
    if (existingMemoryContent !== null) {
      await fs.writeFile(newMemoryPath, existingMemoryContent);
    }
    if (existingMemoryJsonContent !== null) {
      await fs.writeFile(oldMemoryPath, existingMemoryJsonContent);
    }
  });

  describe('with MEMORY_FILE_PATH environment variable', () => {
    // CONTRACT: MEMORY_FILE_PATH is explicit user config and may legitimately
    // point anywhere on disk. `ensureMemoryFilePath` calls `validateFilePath`
    // with `confineToBase=false` for that reason. The `..` traversal guard
    // (defense-in-depth) runs unconditionally.
    // See `src/utils/entityUtils.ts:798` JSDoc + the inline rationale.

    it('should return absolute path when MEMORY_FILE_PATH is absolute', async () => {
      // Use platform-appropriate absolute path
      const absolutePath = process.platform === 'win32'
        ? 'C:\\tmp\\custom-memory.jsonl'
        : '/tmp/custom-memory.jsonl';
      process.env.MEMORY_FILE_PATH = absolutePath;

      const result = await ensureMemoryFilePath();
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toBe(absolutePath);
    });

    it('should convert relative path to absolute when MEMORY_FILE_PATH is relative', async () => {
      const relativePath = 'custom-memory.jsonl';
      process.env.MEMORY_FILE_PATH = relativePath;

      const result = await ensureMemoryFilePath();

      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toContain('custom-memory.jsonl');
    });

    it('should handle Windows absolute paths', async () => {
      const windowsPath = 'C:\\temp\\memory.jsonl';
      process.env.MEMORY_FILE_PATH = windowsPath;

      const result = await ensureMemoryFilePath();
      expect(path.isAbsolute(result)).toBe(true);
      if (process.platform === 'win32') {
        expect(result).toBe(windowsPath);
      }
      // On non-Windows, "C:\\temp\\..." is treated as a relative path —
      // `path.resolve` joins it with cwd. Just assert it resolved.
    });
  });

  describe('without MEMORY_FILE_PATH environment variable', () => {
    it('should return default path when no files exist', async () => {
      const result = await ensureMemoryFilePath();

      expect(result).toBe(defaultMemoryPath);
    });

    it('should migrate from memory.json to memory.jsonl when only old file exists', async () => {
      // Create old memory.json file
      await fs.writeFile(oldMemoryPath, '{"test":"data"}');

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await ensureMemoryFilePath();

      expect(result).toBe(defaultMemoryPath);

      // Verify migration happened
      const newFileExists = await fs.access(newMemoryPath).then(() => true).catch(() => false);
      const oldFileExists = await fs.access(oldMemoryPath).then(() => true).catch(() => false);

      expect(newFileExists).toBe(true);
      expect(oldFileExists).toBe(false);

      // Verify console messages (now using console.log instead of console.error)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Found legacy memory.json file')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Successfully migrated')
      );

      consoleLogSpy.mockRestore();
    });

    it('should use new file when both old and new files exist', async () => {
      // Create both files
      await fs.writeFile(oldMemoryPath, '{"old":"data"}');
      await fs.writeFile(newMemoryPath, '{"new":"data"}');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await ensureMemoryFilePath();

      expect(result).toBe(defaultMemoryPath);

      // Verify no migration happened (both files should still exist)
      const newFileExists = await fs.access(newMemoryPath).then(() => true).catch(() => false);
      const oldFileExists = await fs.access(oldMemoryPath).then(() => true).catch(() => false);

      expect(newFileExists).toBe(true);
      expect(oldFileExists).toBe(true);

      // Verify no console messages about migration
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should preserve file content during migration', async () => {
      const testContent = '{"entities": [{"name": "test", "type": "person"}]}';
      await fs.writeFile(oldMemoryPath, testContent);

      await ensureMemoryFilePath();

      const migratedContent = await fs.readFile(newMemoryPath, 'utf-8');
      expect(migratedContent).toBe(testContent);
    });
  });

  describe('security and path traversal', () => {
    // CONTRACT (from ensureMemoryFilePath JSDoc + entityUtils.ts:732):
    // - `..` segments in the raw or resolved path are ALWAYS rejected
    //   (defense-in-depth, regardless of confineToBase).
    // - Absolute paths are allowed even outside cwd because MEMORY_FILE_PATH
    //   is explicit user-supplied config.

    it('should throw for path traversal with ..', async () => {
      process.env.MEMORY_FILE_PATH = '../../../../etc/passwd';
      await expect(ensureMemoryFilePath()).rejects.toThrow(/Path traversal detected/);
    });

    it('should accept absolute paths outside cwd (intentional — MEMORY_FILE_PATH is explicit user config)', async () => {
      const outsidePath = process.platform === 'win32'
        ? 'C:\\windows\\system32\\config'
        : '/etc/passwd';
      process.env.MEMORY_FILE_PATH = outsidePath;

      // Should NOT throw — caller asked for it explicitly via env var.
      const result = await ensureMemoryFilePath();
      expect(result).toBe(outsidePath);
    });

    it('should accept normalized paths that resolve to within cwd', async () => {
      // path.join normalizes `..` away, so the input string passed to
      // validateFilePath has no `..` segments. The defense-in-depth `..`
      // check therefore doesn't fire and the path is accepted.
      const subDir = path.join(projectRoot, 'subdir-test');
      await fs.mkdir(subDir, { recursive: true });
      const normalized = path.join(subDir, '..', 'memory.jsonl'); // normalized → projectRoot/memory.jsonl

      process.env.MEMORY_FILE_PATH = normalized;

      const result = await ensureMemoryFilePath();
      expect(path.isAbsolute(result)).toBe(true);
      expect(result.endsWith('memory.jsonl')).toBe(true);

      await fs.rmdir(subDir);
    });
  });

  describe('defaultMemoryPath', () => {
    it('should end with memory.jsonl', () => {
      expect(defaultMemoryPath).toMatch(/memory\.jsonl$/);
    });

    it('should be an absolute path', () => {
      expect(path.isAbsolute(defaultMemoryPath)).toBe(true);
    });
  });
});
