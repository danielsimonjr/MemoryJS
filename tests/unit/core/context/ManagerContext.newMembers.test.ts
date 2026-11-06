/**
 * ManagerContext members: `auditLog` (same instance as governanceManager.auditLog),
 * and `streamingExporter(filePath)` (factory, one instance per call).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { AuditLog } from '../../../../src/features/AuditLog.js';
import { StreamingExporter } from '../../../../src/features/StreamingExporter.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';

afterEach(() => {
  cleanupTempDirs();
});

describe('ManagerContext.auditLog', () => {
  it('returns the same AuditLog instance as governanceManager.auditLog', () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    const log = ctx.auditLog;
    expect(log).toBeInstanceOf(AuditLog);
    expect(log).toBe(ctx.governanceManager.auditLog);
    expect(ctx.auditLog).toBe(log);
  });
});

describe('ManagerContext.streamingExporter', () => {
  it('creates a StreamingExporter bound to the given path on each call', () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    const path = makeTempJsonlPath() + '.export.jsonl';
    const a = ctx.streamingExporter(path);
    const b = ctx.streamingExporter(path);
    expect(a).toBeInstanceOf(StreamingExporter);
    expect(a).not.toBe(b);
  });
});
