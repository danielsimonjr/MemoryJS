/**
 * Sec6 — PiiRedactor wiring (opt-in) across export/backup/audit surfaces.
 *
 * Covers: IOManager.exportGraph / exportGraphWithCompression / createBackup,
 * StreamingExporter.streamJSONL / streamCSV, and GovernanceManager audit
 * snapshot redaction. Verifies the live graph is never mutated and that
 * default (no opt-in) behavior stays byte-identical.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { IOManager } from '../../../src/features/IOManager.js';
import { StreamingExporter } from '../../../src/features/StreamingExporter.js';
import { GovernanceManager } from '../../../src/features/GovernanceManager.js';
import { AuditLog } from '../../../src/features/AuditLog.js';
import type { KnowledgeGraph } from '../../../src/types/index.js';

const PII_EMAIL = 'alice@example.com';
const PII_SSN = '123-45-6789';

function piiGraph(): KnowledgeGraph {
  return {
    entities: [
      {
        name: 'Alice',
        entityType: 'person',
        observations: [`email is ${PII_EMAIL}`, `ssn ${PII_SSN} on file`],
      },
      { name: 'Bob', entityType: 'person', observations: ['no pii here'] },
    ],
    relations: [{ from: 'Alice', to: 'Bob', relationType: 'knows' }],
  };
}

describe('Sec6 — PII redaction wiring', () => {
  let dir: string;
  let storagePath: string;
  let storage: GraphStorage;
  let io: IOManager;

  beforeEach(async () => {
    dir = join(tmpdir(), `pii-export-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    storagePath = join(dir, 'mem.jsonl');
    storage = new GraphStorage(storagePath);
    await storage.saveGraph(piiGraph());
    io = new IOManager(storage);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('IOManager.exportGraph', () => {
    it('redactPii masks email/SSN in the export while the live graph is unchanged', async () => {
      const graph = await storage.loadGraph();
      const out = io.exportGraph(graph, 'json', { redactPii: true });

      expect(out).not.toContain(PII_EMAIL);
      expect(out).not.toContain(PII_SSN);
      expect(out).toContain('<EMAIL>');
      expect(out).toContain('<SSN>');
      // Non-PII text survives.
      expect(out).toContain('no pii here');

      // Live graph untouched (input objects AND stored state).
      expect(graph.entities[0].observations[0]).toContain(PII_EMAIL);
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities[0].observations[0]).toContain(PII_EMAIL);
    });

    it('default behavior is byte-identical to the pre-Sec6 export', async () => {
      const graph = await storage.loadGraph();
      const plain = io.exportGraph(graph, 'json');
      const explicitFalse = io.exportGraph(graph, 'json', { redactPii: false });
      expect(explicitFalse).toBe(plain);
      expect(plain).toContain(PII_EMAIL);
    });

    it('redacts across non-JSON formats too (csv, markdown)', async () => {
      const graph = await storage.loadGraph();
      for (const format of ['csv', 'markdown'] as const) {
        const out = io.exportGraph(graph, format, { redactPii: true });
        expect(out).not.toContain(PII_EMAIL);
        expect(out).not.toContain(PII_SSN);
      }
    });
  });

  describe('IOManager.exportGraphWithCompression', () => {
    it('threads redactPii through the uncompressed path', async () => {
      const graph = await storage.loadGraph();
      const result = await io.exportGraphWithCompression(graph, 'json', {
        redactPii: true,
        compress: false,
      });
      expect(result.content).not.toContain(PII_EMAIL);
      expect(result.content).toContain('<EMAIL>');
    });

    it('threads redactPii through the streaming path', async () => {
      const graph = await storage.loadGraph();
      const outPath = join(dir, 'stream-out.jsonl');
      await io.exportGraphWithCompression(graph, 'json', {
        redactPii: true,
        streaming: true,
        outputPath: outPath,
      });
      const written = await fs.readFile(outPath, 'utf-8');
      expect(written).not.toContain(PII_EMAIL);
      expect(written).toContain('<EMAIL>');
    });
  });

  describe('StreamingExporter', () => {
    it('streamJSONL with redactPii masks observations; without it, byte-identical', async () => {
      const graph = await storage.loadGraph();

      const redactedPath = join(dir, 'red.jsonl');
      await new StreamingExporter(redactedPath).streamJSONL(graph, { redactPii: true });
      const redacted = await fs.readFile(redactedPath, 'utf-8');
      expect(redacted).not.toContain(PII_EMAIL);
      expect(redacted).toContain('<EMAIL>');

      const plainPath = join(dir, 'plain.jsonl');
      await new StreamingExporter(plainPath).streamJSONL(graph);
      const plain = await fs.readFile(plainPath, 'utf-8');
      expect(plain).toContain(PII_EMAIL);

      // Graph passed in was not mutated by the redacting export.
      expect(graph.entities[0].observations[1]).toContain(PII_SSN);
    });

    it('streamCSV with redactPii masks observation cells', async () => {
      const graph = await storage.loadGraph();
      const csvPath = join(dir, 'red.csv');
      await new StreamingExporter(csvPath).streamCSV(graph, { redactPii: true });
      const csv = await fs.readFile(csvPath, 'utf-8');
      expect(csv).not.toContain(PII_EMAIL);
      expect(csv).not.toContain(PII_SSN);
      expect(csv).toContain('<EMAIL>');
    });
  });

  describe('IOManager.createBackup', () => {
    it('redactPii masks the backup content; live storage file is untouched', async () => {
      const result = await io.createBackup({ redactPii: true, compress: false });
      const backupContent = await fs.readFile(result.path, 'utf-8');
      expect(backupContent).not.toContain(PII_EMAIL);
      expect(backupContent).not.toContain(PII_SSN);
      expect(backupContent).toContain('<EMAIL>');
      // Structure survives (entity + relation lines parse).
      const lines = backupContent.split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(3);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

      const rawStorage = await fs.readFile(storagePath, 'utf-8');
      expect(rawStorage).toContain(PII_EMAIL);
    });

    it('default backup keeps raw content (byte-identical raw-file copy)', async () => {
      const result = await io.createBackup({ compress: false });
      const backupContent = await fs.readFile(result.path, 'utf-8');
      const rawStorage = await fs.readFile(storagePath, 'utf-8');
      expect(backupContent).toBe(rawStorage);
      expect(backupContent).toContain(PII_EMAIL);
    });
  });

  describe('GovernanceManager audit snapshot redaction', () => {
    it('redactAuditSnapshots masks before/after snapshots in the audit log', async () => {
      const auditPath = join(dir, 'audit.jsonl');
      const gov = new GovernanceManager(storage, new AuditLog(auditPath), {
        redactAuditSnapshots: true,
      });

      await gov.withTransaction(async (tx) => {
        await tx.updateEntity('Alice', { observations: [`new mail ${PII_EMAIL}`] });
        await tx.deleteEntity('Alice');
      });

      const raw = await fs.readFile(auditPath, 'utf-8');
      expect(raw).not.toContain(PII_EMAIL);
      expect(raw).not.toContain(PII_SSN);
      expect(raw).toContain('<EMAIL>');
      expect(raw).toContain('<SSN>');

      // Redaction happens on the audit copy only — the live entity kept
      // the raw text right up until deletion (check Bob is untouched).
      const graph = await storage.loadGraph();
      expect(graph.entities.find((e) => e.name === 'Bob')).toBeDefined();
    });

    it('appendAudit honors redaction; default manager does not redact', async () => {
      const redactedPath = join(dir, 'audit-red.jsonl');
      const redacting = new GovernanceManager(storage, new AuditLog(redactedPath), {
        redactAuditSnapshots: true,
      });
      await redacting.appendAudit({
        operation: 'update',
        entityName: 'Alice',
        before: { observations: [`ssn ${PII_SSN}`] },
        after: { observations: ['clean'] },
      });
      const redactedRaw = await fs.readFile(redactedPath, 'utf-8');
      expect(redactedRaw).not.toContain(PII_SSN);
      expect(redactedRaw).toContain('<SSN>');

      const plainPath = join(dir, 'audit-plain.jsonl');
      const plain = new GovernanceManager(storage, new AuditLog(plainPath));
      await plain.appendAudit({
        operation: 'update',
        entityName: 'Alice',
        before: { observations: [`ssn ${PII_SSN}`] },
      });
      const plainRaw = await fs.readFile(plainPath, 'utf-8');
      expect(plainRaw).toContain(PII_SSN);
    });
  });
});
