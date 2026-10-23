/**
 * Pins for the error frame that wraps every converted CLI command action.
 *
 * The expected values are the behaviour of the inline frame that the actions
 * had before they moved to `runAction`: three setup calls outside the try
 * block, then `logger.error(formatError(error.message))` and `process.exit(1)`.
 *
 * @module tests/unit/cli/actionFrame.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorLines } from './helpers/cliTestHarness.js';

const rt = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    failAs: 'reject' as 'reject' | 'sync',
    failWith: undefined as unknown,
    failAt: 1,
    ctxCalls: 0,
    optionsThrow: false,
    loggerThrow: false,
    ctorThrow: false,
  };
  // A context stand-in: every property is another stand-in, and the failAt-th call on it fails.
  const hole = (): unknown =>
    new Proxy(function () {}, {
      get: (_target, prop) => {
        if (prop === 'then' || prop === Symbol.asyncIterator) return undefined;
        if (prop === Symbol.iterator) return function* () {};
        if (prop === Symbol.toPrimitive) return () => '';
        return hole();
      },
      apply: () => {
        state.ctxCalls += 1;
        if (state.ctxCalls === state.failAt) {
          if (state.failAs === 'sync') throw state.failWith;
          return Promise.reject(state.failWith);
        }
        return hole();
      },
    });
  return { state, hole };
});

vi.mock('../../../src/cli/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/cli/config.js')>('../../../src/cli/config.js');
  return {
    ...actual,
    findConfigFile: () => {
      rt.state.calls.push('findConfigFile');
      return undefined;
    },
    mergeCliConfig: (...args: Parameters<typeof actual.mergeCliConfig>) => {
      rt.state.calls.push('mergeCliConfig');
      return actual.mergeCliConfig(...args);
    },
  };
});

vi.mock('../../../src/cli/options.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/cli/options.js')>('../../../src/cli/options.js');
  return {
    ...actual,
    parseGlobalOptions: (...args: Parameters<typeof actual.parseGlobalOptions>) => {
      rt.state.calls.push('parseGlobalOptions');
      if (rt.state.optionsThrow) throw new Error('options boom');
      return actual.parseGlobalOptions(...args);
    },
    createLogger: (...args: Parameters<typeof actual.createLogger>) => {
      rt.state.calls.push('createLogger');
      if (rt.state.loggerThrow) throw new Error('logger boom');
      return actual.createLogger(...args);
    },
  };
});

vi.mock('../../../src/core/ManagerContext.js', () => ({
  ManagerContext: class MockManagerContext {
    constructor(storage: string) {
      rt.state.calls.push(`new ManagerContext ${storage}`);
      if (rt.state.ctorThrow) throw new Error('ctor boom');
      return rt.hole() as never;
    }
  },
}));

// Import after the mocks
import { registerCommands } from '../../../src/cli/commands/index.js';

const STORE = '/pins/store.jsonl';

/** The 60 command actions that share the frame, each with a minimal valid command line. */
const LEAVES: string[][] = [
  ['entity', 'create', 'x1'],
  ['entity', 'get', 'x1'],
  ['entity', 'list'],
  ['entity', 'update', 'x1'],
  ['entity', 'delete', 'x1'],
  ['relation', 'create', 'x1', 'x2', 'x3'],
  ['relation', 'list'],
  ['relation', 'delete', 'x1', 'x2', 'x3'],
  ['observation', 'add', 'x1', 'x2'],
  ['observation', 'remove', 'x1', 'x2'],
  ['observation', 'list', 'x1'],
  ['tag', 'add', 'x1', 'x2'],
  ['tag', 'remove', 'x1', 'x2'],
  ['tag', 'alias', 'x1', 'x2'],
  ['tag', 'aliases'],
  ['hierarchy', 'set-parent', 'x1', 'x2'],
  ['hierarchy', 'children', 'x1'],
  ['hierarchy', 'ancestors', 'x1'],
  ['hierarchy', 'descendants', 'x1'],
  ['hierarchy', 'roots'],
  ['graph', 'shortest-path', 'x1', 'x2'],
  ['graph', 'centrality'],
  ['graph', 'components'],
  ['import', 'x1'],
  ['export', 'x1'],
  ['stats'],
  ['validate'],
  ['exclude', 'remove', 'x1'],
  ['decision', 'propose', '--context', '3', '--decision', '3'],
  ['decision', 'accept', 'x1'],
  ['decision', 'reject', 'x1', '--reason', '3'],
  ['decision', 'supersede', 'x1', 'x2'],
  ['decision', 'export', 'x1'],
  ['decision', 'import', 'x1'],
  ['project-context', 'append-fact', 'x1', 'x2'],
  ['project-context', 'append-convention', 'x1', 'x2'],
  ['project-context', 'append-command', 'x1', '--name', '3', '--command', '3', '--purpose', '3'],
  ['project-context', 'append-glossary', 'x1', '--term', '3', '--definition', '3'],
  ['project-context', 'clear', 'x1'],
  ['diag'],
  ['health'],
  ['show', 'x1'],
  ['tree'],
  ['neighbors', 'x1'],
  ['size'],
  ['heuristic', 'add', 'x1', 'x2'],
  ['heuristic', 'list'],
  ['heuristic', 'count'],
  ['heuristic', 'get', 'x1'],
  ['heuristic', 'reinforce', 'x1'],
  ['heuristic', 'contradict', 'x1'],
  ['heuristic', 'conflicts'],
  ['heuristic', 'remove', 'x1'],
  ['heuristic', 'clear'],
  ['obs-dedup', 'find'],
  ['obs-dedup', 'find-jaccard'],
  ['spell', 'suggest', 'x1'],
  ['spell', 'rebuild'],
  ['spell', 'size'],
  ['check'],
];

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  program.option('-s, --storage <path>', 'Path to storage file', './memory.jsonl');
  program.option('--output-format <type>', 'Output format', 'json');
  program.option('-q, --quiet', 'Suppress output');
  program.option('--verbose', 'Enable verbose');
  registerCommands(program);
  return program;
}

const run = (argv: string[]) => makeProgram().parseAsync(['node', 'test', '--storage', STORE, ...argv]);

describe('CLI action frame (pins from the inline frame)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.assign(rt.state, {
      calls: [],
      failAs: 'reject',
      failWith: new Error('boom'),
      failAt: 1,
      ctxCalls: 0,
      optionsThrow: false,
      loggerThrow: false,
      ctorThrow: false,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The real process.exit never returns; this one does, so the code after the exit call is visible.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setup calls', () => {
    it('reads the options, creates the logger and then the context, once each, before the body', async () => {
      rt.state.failAt = Number.POSITIVE_INFINITY;
      await run(['tag', 'add', 'x1', 'x2']);
      expect(rt.state.calls).toEqual([
        'findConfigFile',
        'parseGlobalOptions',
        'mergeCliConfig',
        'createLogger',
        `new ManagerContext ${STORE}`,
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('rejects without a log or an exit when the options cannot be read', async () => {
      rt.state.optionsThrow = true;
      await expect(run(['tag', 'add', 'x1', 'x2'])).rejects.toThrow('options boom');
      expect(rt.state.calls).toEqual(['findConfigFile', 'parseGlobalOptions']);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('rejects without a log or an exit when the logger cannot be created, and builds no context', async () => {
      rt.state.loggerThrow = true;
      await expect(run(['tag', 'add', 'x1', 'x2'])).rejects.toThrow('logger boom');
      expect(rt.state.calls).toEqual(['findConfigFile', 'parseGlobalOptions', 'mergeCliConfig', 'createLogger']);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('rejects without a log or an exit when the context cannot be built', async () => {
      rt.state.ctorThrow = true;
      await expect(run(['tag', 'add', 'x1', 'x2'])).rejects.toThrow('ctor boom');
      expect(rt.state.calls).toEqual([
        'findConfigFile',
        'parseGlobalOptions',
        'mergeCliConfig',
        'createLogger',
        `new ManagerContext ${STORE}`,
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe.each(['reject', 'sync'] as const)('a thrown value (the body fails with a %s)', (flavor) => {
    const SHAPES: [string, () => unknown, string][] = [
      ['an Error', () => new Error('boom'), '[ERROR] ✗ boom'],
      ['an Error with an empty message', () => new Error(''), '[ERROR] ✗ '],
      ['an Error with a multi-line message', () => new Error('line1\nline2'), '[ERROR] ✗ line1\nline2'],
      ['a string', () => 'a string', '[ERROR] ✗ undefined'],
      ['a number', () => 42, '[ERROR] ✗ undefined'],
      ['a symbol', () => Symbol('s'), '[ERROR] ✗ undefined'],
      ['an object without a message', () => ({}), '[ERROR] ✗ undefined'],
      ['an object with a message', () => ({ message: 'obj-msg' }), '[ERROR] ✗ obj-msg'],
      ['an object with a numeric message', () => ({ message: 7 }), '[ERROR] ✗ 7'],
    ];

    it.each(SHAPES)('%s: one error line, then exit(1), and the action resolves', async (_name, make, expected) => {
      rt.state.failAs = flavor;
      rt.state.failWith = make();
      await run(['entity', 'get', 'x1']);
      expect(errorLines(errorSpy)).toEqual([expected]);
      expect(exitSpy.mock.calls).toEqual([[1]]);
    });

    it('logs before it exits', async () => {
      rt.state.failAs = flavor;
      await run(['entity', 'get', 'x1']);
      expect(errorSpy.mock.invocationCallOrder[0]).toBeLessThan(exitSpy.mock.invocationCallOrder[0]);
    });

    it('keeps the color codes of the message', async () => {
      rt.state.failAs = flavor;
      rt.state.failWith = new Error('\u001b[31mred\u001b[0m\nline2');
      await run(['entity', 'get', 'x1']);
      expect(String(errorSpy.mock.calls[0]?.[0]).endsWith(' \u001b[31mred\u001b[0m\nline2')).toBe(true);
    });

    it('reads the message of the thrown value once', async () => {
      const reads: string[] = [];
      rt.state.failAs = flavor;
      rt.state.failWith = new Proxy(new Error('boom'), {
        get(target, prop, receiver) {
          if (prop === 'message') reads.push('message');
          return Reflect.get(target, prop, receiver);
        },
      });
      await run(['entity', 'get', 'x1']);
      expect(reads).toEqual(['message']);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ])('%s: the catch itself fails on the missing message, so there is no log and no exit', async (_name, value) => {
      rt.state.failAs = flavor;
      rt.state.failWith = value;
      await expect(run(['entity', 'get', 'x1'])).rejects.toBeInstanceOf(TypeError);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('a message getter that throws escapes the catch: no log and no exit', async () => {
      const bad = new Error('x');
      Object.defineProperty(bad, 'message', {
        get() {
          throw new Error('getter boom');
        },
      });
      rt.state.failAs = flavor;
      rt.state.failWith = bad;
      await expect(run(['entity', 'get', 'x1'])).rejects.toThrow('getter boom');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('a logger that throws escapes the catch before the exit', async () => {
      errorSpy.mockImplementation(() => {
        throw new Error('stderr boom');
      });
      rt.state.failAs = flavor;
      await expect(run(['entity', 'get', 'x1'])).rejects.toThrow('stderr boom');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('an exit that throws makes the action reject with that error, after the log', async () => {
      exitSpy.mockImplementation(() => {
        throw new Error('exit boom');
      });
      rt.state.failAs = flavor;
      await expect(run(['entity', 'get', 'x1'])).rejects.toThrow('exit boom');
      expect(errorLines(errorSpy)).toEqual(['[ERROR] ✗ boom']);
    });
  });

  describe('every converted action', () => {
    // `health` reports a failing storage as JSON and exits without an error line.
    const NO_LINE = new Set(['health']);

    for (const argv of LEAVES) {
      const name = argv.join(' ');

      for (const flavor of ['reject', 'sync'] as const) {
        // `spell size` reads a synchronous value and never awaits the context call, so a rejection would stay unhandled.
        if (name === 'spell size' && flavor === 'reject') continue;

        it(`${name}: a failing first context call logs once and exits 1 (${flavor})`, async () => {
          rt.state.failAs = flavor;
          await run(argv);
          const lines = errorLines(errorSpy);
          if (NO_LINE.has(name)) {
            expect(lines).toEqual([]);
            expect(exitSpy.mock.calls).toEqual([[1]]);
            return;
          }
          expect(lines).toHaveLength(1);
          if (name === 'import x1' || name === 'decision import x1') {
            expect(lines[0]).toMatch(/^\[ERROR\] ✗ ENOENT: no such file or directory, open /);
          } else {
            expect(lines[0]).toBe('[ERROR] ✗ boom');
          }
          expect(exitSpy.mock.calls).toEqual([[1]]);
        });
      }

      it(`${name}: the setup runs once, in order, with the storage path of the program`, async () => {
        rt.state.failAt = Number.POSITIVE_INFINITY;
        await run(argv).catch(() => undefined);
        expect(rt.state.calls.slice(0, 5)).toEqual([
          'findConfigFile',
          'parseGlobalOptions',
          'mergeCliConfig',
          'createLogger',
          `new ManagerContext ${STORE}`,
        ]);
        expect(rt.state.calls.filter((c) => c === 'createLogger')).toHaveLength(1);
        expect(rt.state.calls.filter((c) => c.startsWith('new ManagerContext'))).toHaveLength(1);
      });
    }
  });

  describe('actions that read a file before their first context call', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'action-frame-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    for (const flavor of ['reject', 'sync'] as const) {
      it(`import: a failing import call logs once and exits 1 (${flavor})`, async () => {
        const file = join(dir, 'graph.json');
        writeFileSync(file, '{"entities":[],"relations":[]}');
        rt.state.failAs = flavor;
        await run(['import', file]);
        expect(errorLines(errorSpy)).toEqual(['[ERROR] ✗ boom']);
        expect(exitSpy.mock.calls).toEqual([[1]]);
      });

      it(`decision import: a failing propose call logs once and exits 1 (${flavor})`, async () => {
        const file = join(dir, 'adr.md');
        writeFileSync(file, '# ADR\n\n## Context\nWhy\n\n## Decision\nWhat\n');
        rt.state.failAs = flavor;
        await run(['decision', 'import', file]);
        expect(errorLines(errorSpy)).toEqual(['[ERROR] ✗ boom']);
        expect(exitSpy.mock.calls).toEqual([[1]]);
      });
    }
  });
});
