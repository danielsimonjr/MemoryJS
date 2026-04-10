import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('IOManager.splitTranscript', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-split-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('splits on --- separator', () => {
    const content = 'User: Hello\nAssistant: Hi\n---\nUser: Bye\nAssistant: Goodbye';
    const result = ctx.ioManager.splitTranscript(content);
    expect(result.sessionsFound).toBe(2);
    expect(result.sessionsKept).toBe(2);
  });

  it('splits on timestamp headers', () => {
    const content = '2026-04-01 10:00\nUser: First session\nAssistant: Response\n2026-04-02 14:00\nUser: Second session\nAssistant: Response';
    const result = ctx.ioManager.splitTranscript(content);
    expect(result.sessionsFound).toBe(2);
  });

  it('skips sessions below minMessages', () => {
    const content = 'User: Hello\n---\nUser: Only one line\n---\nUser: Third\nAssistant: Response';
    const result = ctx.ioManager.splitTranscript(content, { minMessages: 2 });
    expect(result.sessionsKept).toBeLessThan(result.sessionsFound);
  });

  it('returns single session when no delimiters found', () => {
    const content = 'User: Hello\nAssistant: Hi there\nUser: How are you?';
    const result = ctx.ioManager.splitTranscript(content);
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsKept).toBe(1);
  });

  it('provides preview of each session', () => {
    const content = 'User: Hello world\nAssistant: Hi\n---\nUser: Goodbye\nAssistant: Bye';
    const result = ctx.ioManager.splitTranscript(content);
    expect(result.sessions[0].preview).toContain('Hello world');
  });
});
