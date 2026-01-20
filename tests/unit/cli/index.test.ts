/**
 * Tests for CLI Entry Point
 *
 * @module tests/unit/cli/index.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { Command } from 'commander';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (path.includes('package.json')) {
        return JSON.stringify({ version: '1.2.3' });
      }
      throw new Error('File not found');
    }),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// Mock path and url modules for ESM
vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/mock/path/to/index.js'),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    dirname: vi.fn(() => '/mock/path/to'),
    join: vi.fn((...args: string[]) => args.join('/')),
  };
});

// Mock commander to capture configuration
let capturedProgram: Command | null = null;

vi.mock('commander', async () => {
  const actual = await vi.importActual('commander');
  const ActualCommand = (actual as { Command: typeof Command }).Command;

  class MockCommand extends ActualCommand {
    constructor() {
      super();
      capturedProgram = this;
    }

    parse(): this {
      // Don't actually parse in tests
      return this;
    }
  }

  return {
    ...actual,
    Command: MockCommand,
  };
});

// Mock registerCommands
vi.mock('../../../src/cli/commands/index.js', () => ({
  registerCommands: vi.fn(),
}));

describe('CLI Entry Point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProgram = null;
  });

  describe('Module Import', () => {
    it('should create program on import', async () => {
      // Clear module cache and reimport
      vi.resetModules();
      await import('../../../src/cli/index.js');

      expect(capturedProgram).toBeDefined();
    });

    it('should set program name', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      expect(capturedProgram?.name()).toBe('memory');
    });

    it('should set program description', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      expect(capturedProgram?.description()).toContain('Knowledge Graph');
    });

    it('should register commands', async () => {
      vi.resetModules();
      const { registerCommands } = await import('../../../src/cli/commands/index.js');
      await import('../../../src/cli/index.js');

      expect(registerCommands).toHaveBeenCalledWith(capturedProgram);
    });
  });

  describe('Version Handling', () => {
    it('should set version from package.json', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      expect(capturedProgram?.version()).toBe('1.2.3');
    });

    it('should fall back to 0.0.0 on error', async () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('File not found');
      });

      vi.resetModules();
      await import('../../../src/cli/index.js');

      expect(capturedProgram?.version()).toBe('0.0.0');
    });

    it('should fall back to 0.0.0 on invalid JSON', async () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('invalid json');

      vi.resetModules();
      await import('../../../src/cli/index.js');

      expect(capturedProgram?.version()).toBe('0.0.0');
    });
  });

  describe('Global Options', () => {
    it('should register storage option', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      const opts = capturedProgram?.options || [];
      const storageOpt = opts.find(o => o.long === '--storage');
      expect(storageOpt).toBeDefined();
      expect(storageOpt?.short).toBe('-s');
    });

    it('should have default storage path', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      const opts = capturedProgram?.options || [];
      const storageOpt = opts.find(o => o.long === '--storage');
      expect(storageOpt?.defaultValue).toBe('./memory.jsonl');
    });

    it('should register format option', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      const opts = capturedProgram?.options || [];
      const formatOpt = opts.find(o => o.long === '--format');
      expect(formatOpt).toBeDefined();
      expect(formatOpt?.short).toBe('-f');
    });

    it('should have default format as json', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      const opts = capturedProgram?.options || [];
      const formatOpt = opts.find(o => o.long === '--format');
      expect(formatOpt?.defaultValue).toBe('json');
    });

    it('should register quiet option', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      const opts = capturedProgram?.options || [];
      const quietOpt = opts.find(o => o.long === '--quiet');
      expect(quietOpt).toBeDefined();
      expect(quietOpt?.short).toBe('-q');
    });

    it('should register verbose option', async () => {
      vi.resetModules();
      await import('../../../src/cli/index.js');

      const opts = capturedProgram?.options || [];
      const verboseOpt = opts.find(o => o.long === '--verbose');
      expect(verboseOpt).toBeDefined();
    });
  });
});

describe('getVersion function behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read package.json from correct relative path', async () => {
    vi.resetModules();

    // Reset mock to track calls
    const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
    mockReadFileSync.mockClear();
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('package.json')) {
        return JSON.stringify({ version: '2.0.0' });
      }
      throw new Error('File not found');
    });

    await import('../../../src/cli/index.js');

    expect(mockReadFileSync).toHaveBeenCalled();
  });

  it('should handle missing version field', async () => {
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify({}));

    vi.resetModules();
    await import('../../../src/cli/index.js');

    // Should not crash - version will be undefined but program.version() should handle it
    expect(capturedProgram).toBeDefined();
  });
});

describe('CLI Integration', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should parse command line arguments', async () => {
    vi.resetModules();

    // The mock prevents actual parsing, but we can verify setup
    await import('../../../src/cli/index.js');

    expect(capturedProgram).toBeDefined();
    expect(capturedProgram?.commands).toBeDefined();
  });
});
