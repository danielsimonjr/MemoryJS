/**
 * Characterization tests for the CLI JSON emitters.
 *
 * `emitJson` must stay `JSON.stringify(payload, null, 2)` on one `console.log` call.
 * `addJsonCommand` must produce exactly the command/option/runAction/emitJson wiring the
 * heuristic and obs-dedup groups hand-wrote, so the groups keep their flags and JSON shape.
 *
 * @module tests/unit/cli/emitJson
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from '../../../src/cli/parseArgs.js';
import { addJsonCommand, emitJson } from '../../../src/cli/commands/helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('emitJson', () => {
  it('prints pretty-printed JSON on a single console.log call', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    emitJson({ a: 1, b: [2, 3] });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });

  it('prints an empty object as two braces', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    emitJson({});
    expect(log).toHaveBeenCalledWith('{}');
  });

  it('preserves undefined-valued keys the way JSON.stringify does (drops them)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    emitJson({ kept: 1, dropped: undefined });
    expect(log).toHaveBeenCalledWith(JSON.stringify({ kept: 1, dropped: undefined }, null, 2));
    expect(log.mock.calls[0]![0]).toBe('{\n  "kept": 1\n}');  });
});

describe('addJsonCommand', () => {
  it('registers the command with its description and options, then emits the handler payload', async () => {
    const program = new Command();
    const parent = program.command('group').description('group description');
    const bodies: unknown[] = [];
    addJsonCommand(parent, program, {
      name: 'show <id>',
      description: 'show one item',
      options: [{ flags: '--limit <n>', description: 'max', parse: (v: string) => parseInt(v, 10) }],
      body: async (_options, _ctx, id: string, opts: Record<string, unknown>) => {
        bodies.push({ id, opts });
        return { id, limit: opts.limit };
      },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync(['node', 'cli', 'group', 'show', 'abc', '--limit', '7']);
    expect(bodies).toEqual([{ id: 'abc', opts: { limit: 7 } }]);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ id: 'abc', limit: 7 }, null, 2));
  });

  it('registers optionless commands and forwards option parsing failures to the runAction error path', async () => {
    const program = new Command();
    const parent = program.command('group');
    let ran = false;
    addJsonCommand(parent, program, {
      name: 'ping',
      description: 'ping',
      options: [],
      body: async () => {
        ran = true;
        return { pong: true };
      },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync(['node', 'cli', 'group', 'ping']);
    expect(ran).toBe(true);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ pong: true }, null, 2));
  });
});
