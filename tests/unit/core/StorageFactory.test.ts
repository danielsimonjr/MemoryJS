import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStorage, createStorageFromPath } from '../../../src/core/StorageFactory.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';

// Mock the storage classes with proper class syntax
vi.mock('../../../src/core/GraphStorage.js', () => ({
  GraphStorage: vi.fn().mockImplementation(function(this: { type: string; path: string }, path: string) {
    this.type = 'jsonl';
    this.path = path;
  }),
}));

vi.mock('../../../src/core/SQLiteStorage.js', () => ({
  SQLiteStorage: vi.fn().mockImplementation(function(this: { type: string; path: string }, path: string) {
    this.type = 'sqlite';
    this.path = path;
  }),
}));

describe('StorageFactory', () => {
  const originalEnv = process.env.MEMORY_STORAGE_TYPE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMORY_STORAGE_TYPE;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MEMORY_STORAGE_TYPE = originalEnv;
    } else {
      delete process.env.MEMORY_STORAGE_TYPE;
    }
  });

  describe('createStorage', () => {
    describe('JSONL storage', () => {
      it('should create GraphStorage when type is jsonl', () => {
        const storage = createStorage({ type: 'jsonl', path: './test.jsonl' });

        expect(GraphStorage).toHaveBeenCalledWith('./test.jsonl');
        expect(storage).toHaveProperty('type', 'jsonl');
        expect(storage).toHaveProperty('path', './test.jsonl');
      });

      it('should create GraphStorage when type is not specified (default)', () => {
        const storage = createStorage({ path: './default.jsonl' });

        expect(GraphStorage).toHaveBeenCalledWith('./default.jsonl');
        expect(storage).toHaveProperty('type', 'jsonl');
      });

      it('should use JSONL as default when config type is undefined', () => {
        const storage = createStorage({ type: undefined as unknown as 'jsonl', path: './memory.jsonl' });

        expect(GraphStorage).toHaveBeenCalledWith('./memory.jsonl');
      });
    });

    describe('SQLite storage', () => {
      it('should create SQLiteStorage when type is sqlite', () => {
        const storage = createStorage({ type: 'sqlite', path: './test.db' });

        expect(SQLiteStorage).toHaveBeenCalledWith('./test.db');
        expect(storage).toHaveProperty('type', 'sqlite');
        expect(storage).toHaveProperty('path', './test.db');
      });

      it('should create SQLiteStorage with .db extension', () => {
        const storage = createStorage({ type: 'sqlite', path: './memory.db' });

        expect(SQLiteStorage).toHaveBeenCalledWith('./memory.db');
      });
    });

    describe('environment variable override', () => {
      it('should override config type with MEMORY_STORAGE_TYPE=jsonl', () => {
        process.env.MEMORY_STORAGE_TYPE = 'jsonl';

        const storage = createStorage({ type: 'sqlite', path: './test.db' });

        expect(GraphStorage).toHaveBeenCalledWith('./test.db');
        expect(SQLiteStorage).not.toHaveBeenCalled();
      });

      it('should override config type with MEMORY_STORAGE_TYPE=sqlite', () => {
        process.env.MEMORY_STORAGE_TYPE = 'sqlite';

        const storage = createStorage({ type: 'jsonl', path: './test.jsonl' });

        expect(SQLiteStorage).toHaveBeenCalledWith('./test.jsonl');
        expect(GraphStorage).not.toHaveBeenCalled();
      });

      it('should use environment variable when config type is not specified', () => {
        process.env.MEMORY_STORAGE_TYPE = 'sqlite';

        const storage = createStorage({ path: './test.jsonl' });

        expect(SQLiteStorage).toHaveBeenCalledWith('./test.jsonl');
      });
    });

    describe('error handling', () => {
      it('should throw error for unsupported storage type', () => {
        expect(() => {
          createStorage({ type: 'mongodb' as 'jsonl', path: './test' });
        }).toThrow('Unknown storage type: mongodb. Supported types: jsonl, sqlite');
      });

      it('should throw error for unsupported storage type from env var', () => {
        process.env.MEMORY_STORAGE_TYPE = 'redis';

        expect(() => {
          createStorage({ type: 'jsonl', path: './test.jsonl' });
        }).toThrow('Unknown storage type: redis. Supported types: jsonl, sqlite');
      });

      it('should throw descriptive error with storage type name', () => {
        process.env.MEMORY_STORAGE_TYPE = 'unknown-type';

        expect(() => {
          createStorage({ path: './test' });
        }).toThrow('Unknown storage type: unknown-type');
      });
    });

    describe('path handling', () => {
      it('should pass absolute paths correctly', () => {
        createStorage({ type: 'jsonl', path: '/absolute/path/memory.jsonl' });

        expect(GraphStorage).toHaveBeenCalledWith('/absolute/path/memory.jsonl');
      });

      it('should pass relative paths correctly', () => {
        createStorage({ type: 'jsonl', path: './relative/memory.jsonl' });

        expect(GraphStorage).toHaveBeenCalledWith('./relative/memory.jsonl');
      });

      it('should pass Windows-style paths correctly', () => {
        createStorage({ type: 'sqlite', path: 'C:\\Users\\test\\memory.db' });

        expect(SQLiteStorage).toHaveBeenCalledWith('C:\\Users\\test\\memory.db');
      });
    });
  });

  describe('createStorageFromPath', () => {
    it('should create JSONL storage by default', () => {
      const storage = createStorageFromPath('./memory.jsonl');

      expect(GraphStorage).toHaveBeenCalledWith('./memory.jsonl');
    });

    it('should respect MEMORY_STORAGE_TYPE environment variable', () => {
      process.env.MEMORY_STORAGE_TYPE = 'sqlite';

      const storage = createStorageFromPath('./memory.db');

      expect(SQLiteStorage).toHaveBeenCalledWith('./memory.db');
    });

    it('should use jsonl when MEMORY_STORAGE_TYPE is not set', () => {
      delete process.env.MEMORY_STORAGE_TYPE;

      const storage = createStorageFromPath('./test.jsonl');

      expect(GraphStorage).toHaveBeenCalledWith('./test.jsonl');
      expect(SQLiteStorage).not.toHaveBeenCalled();
    });

    it('should pass path to createStorage correctly', () => {
      process.env.MEMORY_STORAGE_TYPE = 'jsonl';

      createStorageFromPath('/custom/path/data.jsonl');

      expect(GraphStorage).toHaveBeenCalledWith('/custom/path/data.jsonl');
    });

    it('should handle paths with spaces', () => {
      createStorageFromPath('./path with spaces/memory.jsonl');

      expect(GraphStorage).toHaveBeenCalledWith('./path with spaces/memory.jsonl');
    });

    it('should handle paths with special characters', () => {
      createStorageFromPath('./path-with_special.chars/memory.jsonl');

      expect(GraphStorage).toHaveBeenCalledWith('./path-with_special.chars/memory.jsonl');
    });
  });
});
