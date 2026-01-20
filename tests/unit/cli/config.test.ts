/**
 * Tests for CLI Configuration File Support
 *
 * @module tests/unit/cli/config.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findConfigFile, loadConfig, mergeConfig } from '../../../src/cli/config.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock the fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

describe('CLI Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findConfigFile', () => {
    it('should find .memoryjsrc in current directory', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString().endsWith('.memoryjsrc');
      });

      const result = findConfigFile('/home/user/project');
      expect(result).toBe(path.resolve('/home/user/project', '.memoryjsrc'));
    });

    it('should find .memoryjsrc.json when .memoryjsrc not found', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString().endsWith('.memoryjsrc.json');
      });

      const result = findConfigFile('/home/user/project');
      expect(result).toBe(path.resolve('/home/user/project', '.memoryjsrc.json'));
    });

    it('should find memoryjs.config.json when other formats not found', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString().endsWith('memoryjs.config.json');
      });

      const result = findConfigFile('/home/user/project');
      expect(result).toBe(path.resolve('/home/user/project', 'memoryjs.config.json'));
    });

    it('should traverse parent directories to find config', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        // Config exists only in /home/user
        return filePath.toString() === path.resolve('/home/user', '.memoryjsrc');
      });

      const result = findConfigFile('/home/user/project/src');
      expect(result).toBe(path.resolve('/home/user', '.memoryjsrc'));
    });

    it('should return null when no config file found', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockReturnValue(false);

      const result = findConfigFile('/home/user/project');
      expect(result).toBeNull();
    });

    it('should prioritize .memoryjsrc over other formats in same directory', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        const p = filePath.toString();
        // All three exist
        return p.endsWith('.memoryjsrc') ||
               p.endsWith('.memoryjsrc.json') ||
               p.endsWith('memoryjs.config.json');
      });

      const result = findConfigFile('/home/user/project');
      // Should find .memoryjsrc first (first in CONFIG_FILES array)
      expect(result).toBe(path.resolve('/home/user/project', '.memoryjsrc'));
    });

    it('should handle root directory edge case', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockReturnValue(false);

      // Start from root should not infinite loop
      const result = findConfigFile('/');
      expect(result).toBeNull();
    });
  });

  describe('loadConfig', () => {
    it('should load and parse valid JSON config', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        storage: './custom.jsonl',
        format: 'table',
        quiet: true,
        verbose: false,
      }));

      const result = loadConfig('/path/to/config');
      expect(result).toEqual({
        storage: './custom.jsonl',
        format: 'table',
        quiet: true,
        verbose: false,
      });
    });

    it('should validate storage as string', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        storage: 123, // Invalid - should be string
      }));

      const result = loadConfig('/path/to/config');
      expect(result.storage).toBeUndefined();
    });

    it('should validate format values', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        format: 'invalid', // Not json, table, or csv
      }));

      const result = loadConfig('/path/to/config');
      expect(result.format).toBeUndefined();
    });

    it('should accept valid format values', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);

      for (const format of ['json', 'table', 'csv']) {
        mockReadFileSync.mockReturnValue(JSON.stringify({ format }));
        const result = loadConfig('/path/to/config');
        expect(result.format).toBe(format);
      }
    });

    it('should validate quiet as boolean', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        quiet: 'yes', // Invalid - should be boolean
      }));

      const result = loadConfig('/path/to/config');
      expect(result.quiet).toBeUndefined();
    });

    it('should validate verbose as boolean', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        verbose: 1, // Invalid - should be boolean
      }));

      const result = loadConfig('/path/to/config');
      expect(result.verbose).toBeUndefined();
    });

    it('should return empty object for invalid JSON', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue('{ invalid json }');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = loadConfig('/path/to/config');

      expect(result).toEqual({});
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should return empty object when file read fails', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: file not found');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = loadConfig('/path/to/nonexistent');

      expect(result).toEqual({});
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should handle empty config file', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue('{}');

      const result = loadConfig('/path/to/config');
      expect(result).toEqual({});
    });

    it('should ignore unknown config properties', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        storage: './test.jsonl',
        unknownProp: 'value',
        anotherUnknown: 123,
      }));

      const result = loadConfig('/path/to/config');
      expect(result).toEqual({ storage: './test.jsonl' });
      expect((result as Record<string, unknown>).unknownProp).toBeUndefined();
    });

    it('should handle partial config', () => {
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        format: 'csv',
      }));

      const result = loadConfig('/path/to/config');
      expect(result).toEqual({ format: 'csv' });
      expect(result.storage).toBeUndefined();
      expect(result.quiet).toBeUndefined();
    });
  });

  describe('mergeConfig', () => {
    it('should use CLI options over file config', () => {
      const fileConfig = {
        storage: './file.jsonl',
        format: 'table' as const,
        quiet: false,
        verbose: true,
      };
      const cliOptions = {
        storage: './cli.jsonl',
        format: 'csv' as const,
        quiet: true,
        verbose: false,
      };

      const result = mergeConfig(fileConfig, cliOptions);
      expect(result).toEqual(cliOptions);
    });

    it('should fall back to file config when CLI options not set', () => {
      const fileConfig = {
        storage: './file.jsonl',
        format: 'table' as const,
        quiet: true,
        verbose: false,
      };
      const cliOptions = {};

      const result = mergeConfig(fileConfig, cliOptions);
      expect(result.storage).toBe('./file.jsonl');
      expect(result.format).toBe('table');
      expect(result.quiet).toBe(true);
      expect(result.verbose).toBe(false);
    });

    it('should use defaults when neither file nor CLI provides values', () => {
      const result = mergeConfig({}, {});
      expect(result.storage).toBe('./memory.jsonl');
      expect(result.format).toBe('json');
      expect(result.quiet).toBe(false);
      expect(result.verbose).toBe(false);
    });

    it('should handle partial file config with CLI overrides', () => {
      const fileConfig = {
        storage: './file.jsonl',
      };
      const cliOptions = {
        format: 'csv' as const,
      };

      const result = mergeConfig(fileConfig, cliOptions);
      expect(result.storage).toBe('./file.jsonl');
      expect(result.format).toBe('csv');
      expect(result.quiet).toBe(false);
      expect(result.verbose).toBe(false);
    });

    it('should handle CLI option explicitly set to false', () => {
      const fileConfig = {
        quiet: true,
        verbose: true,
      };
      const cliOptions = {
        quiet: false,
        verbose: false,
      };

      const result = mergeConfig(fileConfig, cliOptions);
      expect(result.quiet).toBe(false);
      expect(result.verbose).toBe(false);
    });

    it('should handle undefined vs not present', () => {
      const fileConfig = {
        storage: './file.jsonl',
        format: 'table' as const,
      };
      const cliOptions = {
        storage: undefined as unknown as string,
      };

      const result = mergeConfig(fileConfig, cliOptions);
      // undefined should fall through to file config
      expect(result.storage).toBe('./file.jsonl');
    });
  });
});
