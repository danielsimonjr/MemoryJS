/**
 * Doctor CLI command tests (R9 preflight).
 *
 * Each check is an exported pure function with injected dependencies
 * (env fixtures, fake require, temp dirs), so no subprocesses are needed.
 * Command-level tests cover the --json report shape and the exit-1 contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkNodeVersion,
  checkBetterSqlite3,
  checkWorkersBuilt,
  checkStorageFile,
  checkEnvVarLint,
  checkEmbeddingProvider,
  numericEnvVarNames,
  runDoctorChecks,
  registerDoctorCommand,
  MIN_NODE_MAJOR,
  STRICT_TRUE_VARS,
  type DoctorReport,
} from '../../../src/cli/commands/doctor.js';

describe('doctor checks', () => {
  describe('checkNodeVersion', () => {
    it('passes for Node >= 18', () => {
      expect(checkNodeVersion('v18.0.0').status).toBe('pass');
      expect(checkNodeVersion('v20.11.1').status).toBe('pass');
      expect(checkNodeVersion('v22.0.0').status).toBe('pass');
    });

    it('fails below 18 with an install hint', () => {
      const result = checkNodeVersion('v16.20.2');
      expect(result.status).toBe('fail');
      expect(result.message).toContain(`>=${MIN_NODE_MAJOR}.0.0`);
      expect(result.hint).toContain(String(MIN_NODE_MAJOR));
    });

    it('warns on an unrecognized version string', () => {
      expect(checkNodeVersion('garbage').status).toBe('warn');
    });

    it('defaults to the running process version (which satisfies engines)', () => {
      expect(checkNodeVersion().status).toBe('pass');
    });
  });

  describe('checkBetterSqlite3', () => {
    it('passes when the module loads', () => {
      const result = checkBetterSqlite3(() => ({}));
      expect(result.status).toBe('pass');
    });

    it('fails with the documented rebuild hint on NODE_MODULE_VERSION mismatch', () => {
      const result = checkBetterSqlite3(() => {
        throw new Error(
          'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 108. ' +
          'This version of Node.js requires NODE_MODULE_VERSION 115.'
        );
      });
      expect(result.status).toBe('fail');
      expect(result.hint).toContain('npm rebuild better-sqlite3');
    });

    it('warns (not fails) when the dependency is not installed', () => {
      const result = checkBetterSqlite3(() => {
        const err = new Error("Cannot find module 'better-sqlite3'") as NodeJS.ErrnoException;
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      });
      expect(result.status).toBe('warn');
      expect(result.message).toContain('not installed');
    });

    it('fails on any other load error', () => {
      const result = checkBetterSqlite3(() => {
        throw new Error('dlopen failed: missing symbol');
      });
      expect(result.status).toBe('fail');
      expect(result.message).toContain('dlopen failed');
    });
  });

  describe('checkWorkersBuilt', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `doctor-workers-${Date.now()}-${Math.random()}`);
      await fs.mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('passes when levenshteinWorker.js exists in a candidate dir', async () => {
      await fs.writeFile(join(testDir, 'levenshteinWorker.js'), '// built');
      const result = checkWorkersBuilt([testDir]);
      expect(result.status).toBe('pass');
      expect(result.message).toContain('levenshteinWorker.js');
    });

    it('accepts the .cjs build output too', async () => {
      await fs.writeFile(join(testDir, 'levenshteinWorker.cjs'), '// built');
      expect(checkWorkersBuilt([testDir]).status).toBe('pass');
    });

    it('fails with the tsup hint when no worker bundle is found', () => {
      const result = checkWorkersBuilt([join(testDir, 'nope')]);
      expect(result.status).toBe('fail');
      expect(result.hint).toContain('npm run build');
      expect(result.hint).toContain('tsup');
    });
  });

  describe('checkStorageFile', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `doctor-storage-${Date.now()}-${Math.random()}`);
      await fs.mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('passes when MEMORY_FILE_PATH is not set', async () => {
      const result = await checkStorageFile({});
      expect(result.status).toBe('pass');
      expect(result.message).toContain('not set');
    });

    it('fails when the parent directory is missing', async () => {
      const result = await checkStorageFile({
        MEMORY_FILE_PATH: join(testDir, 'no-such-dir', 'memory.jsonl'),
      });
      expect(result.status).toBe('fail');
      expect(result.hint).toContain('mkdir');
    });

    it('passes for a not-yet-created file in a writable directory', async () => {
      const result = await checkStorageFile({ MEMORY_FILE_PATH: join(testDir, 'fresh.jsonl') });
      expect(result.status).toBe('pass');
      expect(result.message).toContain('created on first write');
    });

    it('passes for a valid JSONL file', async () => {
      const filePath = join(testDir, 'memory.jsonl');
      await fs.writeFile(filePath, JSON.stringify({ type: 'entity', name: 'A' }) + '\n');
      const result = await checkStorageFile({ MEMORY_FILE_PATH: filePath });
      expect(result.status).toBe('pass');
    });

    it('fails when the first JSONL line is not valid JSON', async () => {
      const filePath = join(testDir, 'memory.jsonl');
      await fs.writeFile(filePath, 'this is definitely not JSON\n');
      const result = await checkStorageFile({ MEMORY_FILE_PATH: filePath });
      expect(result.status).toBe('fail');
      expect(result.message).toContain('not valid JSON');
    });

    it('passes for an empty storage file', async () => {
      const filePath = join(testDir, 'memory.jsonl');
      await fs.writeFile(filePath, '');
      const result = await checkStorageFile({ MEMORY_FILE_PATH: filePath });
      expect(result.status).toBe('pass');
    });

    it('verifies SQLite magic bytes for .db files', async () => {
      const filePath = join(testDir, 'memory.db');
      const header = Buffer.concat([
        Buffer.from('SQLite format 3', 'latin1'),
        Buffer.from([0]),
        Buffer.from('rest of the header and pages', 'latin1'),
      ]);
      await fs.writeFile(filePath, header);
      const result = await checkStorageFile({ MEMORY_FILE_PATH: filePath });
      expect(result.status).toBe('pass');
      expect(result.message).toContain('magic bytes');
    });

    it('fails when a .db file lacks the SQLite magic', async () => {
      const filePath = join(testDir, 'memory.db');
      await fs.writeFile(filePath, 'hello, I am not a database');
      const result = await checkStorageFile({ MEMORY_FILE_PATH: filePath });
      expect(result.status).toBe('fail');
      expect(result.message).toContain('magic bytes');
    });

    it('treats MEMORY_STORAGE_TYPE=sqlite as SQLite regardless of extension', async () => {
      const filePath = join(testDir, 'memory.jsonl');
      await fs.writeFile(filePath, 'not a database at all');
      const result = await checkStorageFile({
        MEMORY_FILE_PATH: filePath,
        MEMORY_STORAGE_TYPE: 'sqlite',
      });
      expect(result.status).toBe('fail');
    });
  });

  describe('checkEnvVarLint', () => {
    it('passes on a clean environment', () => {
      expect(checkEnvVarLint({}).status).toBe('pass');
    });

    it("warns when a strict-literal flag is set to '1'/'yes'/'TRUE'", () => {
      for (const value of ['1', 'yes', 'TRUE', 'on']) {
        const result = checkEnvVarLint({ MEMORY_GOVERNANCE_ENABLED: value });
        expect(result.status).toBe('warn');
        expect(result.message).toContain("literal string 'true'");
        expect(result.message).toContain('MEMORY_GOVERNANCE_ENABLED');
      }
    });

    it('covers the whole strict-literal family', () => {
      for (const varName of STRICT_TRUE_VARS) {
        const result = checkEnvVarLint({ [varName]: 'TRUE' });
        expect(result.status).toBe('warn');
        expect(result.message).toContain(varName);
      }
    });

    it("does not warn for the correct literal 'true' or for 'false'", () => {
      expect(checkEnvVarLint({ MEMORY_OBSERVATIONS_COLUMNAR: 'true' }).status).toBe('pass');
      expect(checkEnvVarLint({ MEMORY_OBSERVATIONS_COLUMNAR: 'false' }).status).toBe('pass');
    });

    it('warns when a numeric var is not numeric', () => {
      const result = checkEnvVarLint({ MEMORY_INDEX_COALESCE_MS: 'fast' });
      expect(result.status).toBe('warn');
      expect(result.message).toContain('MEMORY_INDEX_COALESCE_MS');
      expect(result.message).toContain('not numeric');
    });

    it('accepts numeric values (integer and float)', () => {
      expect(checkEnvVarLint({
        MEMORY_INDEX_COALESCE_MS: '50',
        MEMORY_ENTROPY_THRESHOLD: '0.3',
        MEMORY_MMAP_THRESHOLD_BYTES: '104857600',
      }).status).toBe('pass');
    });

    it('reports multiple issues in one check result', () => {
      const result = checkEnvVarLint({
        MEMORY_GOVERNANCE_ENABLED: '1',
        MEMORY_SQLITE_READ_POOL_SIZE: 'lots',
      });
      expect(result.status).toBe('warn');
      expect(result.message).toContain('MEMORY_GOVERNANCE_ENABLED');
      expect(result.message).toContain('MEMORY_SQLITE_READ_POOL_SIZE');
    });

    it('numericEnvVarNames merges catalog numeric defaults with the extras', () => {
      const names = numericEnvVarNames();
      expect(names).toContain('MEMORY_INDEX_COALESCE_MS'); // from ENV_VAR_CATALOG
      expect(names).toContain('MEMORY_MMAP_THRESHOLD_BYTES'); // from EXTRA_NUMERIC_VARS
      expect(names).not.toContain('MEMORY_STORAGE_TYPE');
    });
  });

  describe('checkEmbeddingProvider', () => {
    it('fails for provider=openai without an API key', () => {
      const result = checkEmbeddingProvider({ MEMORY_EMBEDDING_PROVIDER: 'openai' });
      expect(result.status).toBe('fail');
      expect(result.hint).toContain('MEMORY_OPENAI_API_KEY');
    });

    it('passes for provider=openai with an API key', () => {
      const result = checkEmbeddingProvider({
        MEMORY_EMBEDDING_PROVIDER: 'openai',
        MEMORY_OPENAI_API_KEY: 'sk-test',
      });
      expect(result.status).toBe('pass');
    });

    it('passes for the zero-config local provider (default)', () => {
      expect(checkEmbeddingProvider({}).status).toBe('pass');
      const result = checkEmbeddingProvider({ MEMORY_EMBEDDING_PROVIDER: 'local' });
      expect(result.status).toBe('pass');
      expect(result.message).toContain('zero-config');
    });

    it('passes for provider=none (deliberate opt-out)', () => {
      expect(checkEmbeddingProvider({ MEMORY_EMBEDDING_PROVIDER: 'none' }).status).toBe('pass');
    });

    it('warns on an unknown provider value', () => {
      const result = checkEmbeddingProvider({ MEMORY_EMBEDDING_PROVIDER: 'cohere' });
      expect(result.status).toBe('warn');
      expect(result.hint).toContain('openai | local | none');
    });
  });
});

describe('doctor command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const touchedEnv = ['MEMORY_EMBEDDING_PROVIDER', 'MEMORY_OPENAI_API_KEY', 'MEMORY_FILE_PATH'] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    savedEnv = {};
    for (const key of touchedEnv) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    for (const key of touchedEnv) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.option('-s, --storage <path>', 'Storage path');
    registerDoctorCommand(program);
    return program;
  }

  function lastJson(): DoctorReport {
    const calls = logSpy.mock.calls.map((c) => c.join(' '));
    return JSON.parse(calls[calls.length - 1]) as DoctorReport;
  }

  it('runDoctorChecks returns all six checks with consistent counts', async () => {
    const report = await runDoctorChecks({});
    expect(report.checks).toHaveLength(6);
    expect(report.checks.map((c) => c.name)).toEqual([
      'node-version',
      'better-sqlite3',
      'workers-built',
      'storage-file',
      'env-var-lint',
      'embedding-provider',
    ]);
    expect(report.passed + report.warned + report.failed).toBe(report.checks.length);
    expect(report.ok).toBe(report.failed === 0);
    for (const check of report.checks) {
      expect(['pass', 'warn', 'fail']).toContain(check.status);
      expect(typeof check.message).toBe('string');
    }
  });

  it('--json emits the machine-readable report shape', async () => {
    // The report may legitimately fail in some environments (e.g. workers
    // not built), which exits 1 — swallow the sentinel and assert the shape.
    try {
      await makeProgram().parseAsync(['node', 'memory', 'doctor', '--json']);
    } catch (e) {
      expect((e as Error).message).toBe('exit:1');
    }
    const report = lastJson();
    expect(report.checks).toHaveLength(6);
    expect(typeof report.ok).toBe('boolean');
    expect(typeof report.failed).toBe('number');
  });

  it('exits 1 when a check fails (openai provider without API key)', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    await expect(
      makeProgram().parseAsync(['node', 'memory', 'doctor', '--json'])
    ).rejects.toThrow('exit:1');
    const report = lastJson();
    expect(report.ok).toBe(false);
    const embedding = report.checks.find((c) => c.name === 'embedding-provider');
    expect(embedding?.status).toBe('fail');
  });

  it('human output prints one [STATUS] line per check plus a summary', async () => {
    try {
      await makeProgram().parseAsync(['node', 'memory', 'doctor']);
    } catch (e) {
      expect((e as Error).message).toBe('exit:1');
    }
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toMatch(/\[(PASS|WARN|FAIL)\s*\] node-version/);
    expect(output).toMatch(/6 checks: \d+ passed, \d+ warned, \d+ failed/);
  });
});
