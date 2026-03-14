/**
 * TransitionLedger Unit Tests
 *
 * Phase 2B: Tests for the append-only audit trail system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TransitionLedger } from '../../../src/core/TransitionLedger.js';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import type { TransitionEvent } from '../../../src/core/TransitionLedger.js';

describe('TransitionLedger', () => {
  let ledger: TransitionLedger;
  let tempDir: string;
  let storagePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transition-ledger-test-'));
    storagePath = path.join(tempDir, 'memory.jsonl');
    ledger = new TransitionLedger(storagePath);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ==================== Append and Query ====================

  describe('append and query', () => {
    it('should append and query events', async () => {
      const event = await ledger.append({
        entityId: 'Alice',
        field: 'importance',
        from: 5,
        to: 8,
        reason: 'Promoted',
      });

      expect(event.id).toMatch(/^txn_\d+_[a-z0-9]+$/);
      expect(event.timestamp).toBeTruthy();
      expect(event.entityId).toBe('Alice');
      expect(event.field).toBe('importance');
      expect(event.from).toBe(5);
      expect(event.to).toBe(8);
      expect(event.reason).toBe('Promoted');

      const results = ledger.query({});
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(event);
    });

    it('should assign unique IDs to each event', async () => {
      const e1 = await ledger.append({ entityId: 'A', field: 'f', from: 1, to: 2 });
      const e2 = await ledger.append({ entityId: 'B', field: 'f', from: 3, to: 4 });
      expect(e1.id).not.toBe(e2.id);
    });

    it('should include optional fields', async () => {
      const event = await ledger.append({
        entityId: 'Alice',
        agentId: 'agent-1',
        field: 'importance',
        from: 5,
        to: 8,
        reason: 'Promoted',
        tokenCost: 150,
      });

      expect(event.agentId).toBe('agent-1');
      expect(event.tokenCost).toBe(150);
    });

    it('should return size correctly', async () => {
      expect(ledger.size).toBe(0);
      await ledger.append({ entityId: 'A', field: 'f', from: 1, to: 2 });
      expect(ledger.size).toBe(1);
      await ledger.append({ entityId: 'B', field: 'f', from: 3, to: 4 });
      expect(ledger.size).toBe(2);
    });
  });

  // ==================== Filtering ====================

  describe('filtering', () => {
    beforeEach(async () => {
      await ledger.append({ entityId: 'Alice', agentId: 'agent-1', field: 'importance', from: 5, to: 8 });
      await ledger.append({ entityId: 'Bob', agentId: 'agent-2', field: 'entityType', from: 'person', to: 'employee' });
      await ledger.append({ entityId: 'Alice', agentId: 'agent-2', field: 'tags', from: null, to: ['dev'] });
      await ledger.append({ entityId: 'Charlie', agentId: 'agent-1', field: 'importance', from: 3, to: 7 });
    });

    it('should filter by entityId', () => {
      const results = ledger.query({ entityId: 'Alice' });
      expect(results).toHaveLength(2);
      expect(results.every(e => e.entityId === 'Alice')).toBe(true);
    });

    it('should filter by agentId', () => {
      const results = ledger.query({ agentId: 'agent-1' });
      expect(results).toHaveLength(2);
      expect(results.every(e => e.agentId === 'agent-1')).toBe(true);
    });

    it('should filter by field', () => {
      const results = ledger.query({ field: 'importance' });
      expect(results).toHaveLength(2);
      expect(results.every(e => e.field === 'importance')).toBe(true);
    });

    it('should filter by time range', async () => {
      const beforeTime = new Date().toISOString();
      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      await ledger.append({ entityId: 'Diana', field: 'status', from: 'active', to: 'archived' });
      const afterTime = new Date().toISOString();

      const results = ledger.query({ fromTime: beforeTime, toTime: afterTime });
      expect(results.some(e => e.entityId === 'Diana')).toBe(true);
    });

    it('should apply limit', () => {
      const results = ledger.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should sort results by timestamp descending', () => {
      const results = ledger.query({});
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp >= results[i].timestamp).toBe(true);
      }
    });

    it('should combine multiple filters with AND', () => {
      const results = ledger.query({ entityId: 'Alice', agentId: 'agent-1' });
      expect(results).toHaveLength(1);
      expect(results[0].field).toBe('importance');
    });
  });

  // ==================== getHistory ====================

  describe('getHistory', () => {
    it('should return history for a specific entity', async () => {
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 5, to: 8 });
      await ledger.append({ entityId: 'Bob', field: 'importance', from: 3, to: 7 });
      await ledger.append({ entityId: 'Alice', field: 'tags', from: null, to: ['dev'] });

      const history = ledger.getHistory('Alice');
      expect(history).toHaveLength(2);
      expect(history.every(e => e.entityId === 'Alice')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      await ledger.append({ entityId: 'Alice', field: 'f1', from: 1, to: 2 });
      await ledger.append({ entityId: 'Alice', field: 'f2', from: 3, to: 4 });
      await ledger.append({ entityId: 'Alice', field: 'f3', from: 5, to: 6 });

      const history = ledger.getHistory('Alice', 2);
      expect(history).toHaveLength(2);
    });
  });

  // ==================== Regression Detection ====================

  describe('detectRegressions', () => {
    it('should detect A->B->A regression pattern', async () => {
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 5, to: 8 });
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 8, to: 5 });

      const regressions = ledger.detectRegressions('Alice');
      expect(regressions).toHaveLength(1);
      expect(regressions[0].from).toBe(8);
      expect(regressions[0].to).toBe(5);
    });

    it('should detect regression with string values', async () => {
      await ledger.append({ entityId: 'Alice', field: 'status', from: 'active', to: 'archived' });
      await ledger.append({ entityId: 'Alice', field: 'status', from: 'archived', to: 'active' });

      const regressions = ledger.detectRegressions('Alice');
      expect(regressions).toHaveLength(1);
      expect(regressions[0].to).toBe('active');
    });

    it('should not flag non-regression changes', async () => {
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 5, to: 8 });
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 8, to: 10 });

      const regressions = ledger.detectRegressions('Alice');
      expect(regressions).toHaveLength(0);
    });

    it('should handle multiple fields independently', async () => {
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 5, to: 8 });
      await ledger.append({ entityId: 'Alice', field: 'status', from: 'active', to: 'archived' });
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 8, to: 5 });

      const regressions = ledger.detectRegressions('Alice');
      expect(regressions).toHaveLength(1);
      expect(regressions[0].field).toBe('importance');
    });

    it('should return empty array for entity with no regressions', async () => {
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 5, to: 8 });

      const regressions = ledger.detectRegressions('Alice');
      expect(regressions).toHaveLength(0);
    });

    it('should return empty array for unknown entity', () => {
      const regressions = ledger.detectRegressions('Unknown');
      expect(regressions).toHaveLength(0);
    });
  });

  // ==================== Compaction ====================

  describe('compact', () => {
    it('should remove entries older than the given date', async () => {
      await ledger.append({ entityId: 'Alice', field: 'f1', from: 1, to: 2 });
      await new Promise(resolve => setTimeout(resolve, 10));

      const cutoff = new Date();
      await new Promise(resolve => setTimeout(resolve, 10));

      await ledger.append({ entityId: 'Bob', field: 'f2', from: 3, to: 4 });

      const removed = await ledger.compact(cutoff);
      expect(removed).toBe(1);
      expect(ledger.size).toBe(1);
      expect(ledger.query({})[0].entityId).toBe('Bob');
    });

    it('should persist compacted data to file', async () => {
      await ledger.append({ entityId: 'Alice', field: 'f1', from: 1, to: 2 });
      await new Promise(resolve => setTimeout(resolve, 10));

      const cutoff = new Date();
      await new Promise(resolve => setTimeout(resolve, 10));

      await ledger.append({ entityId: 'Bob', field: 'f2', from: 3, to: 4 });
      await ledger.compact(cutoff);

      // Reload and verify
      const ledger2 = new TransitionLedger(storagePath);
      await ledger2.load();
      expect(ledger2.size).toBe(1);
      expect(ledger2.query({})[0].entityId).toBe('Bob');
    });

    it('should return 0 when nothing to compact', async () => {
      await ledger.append({ entityId: 'Alice', field: 'f1', from: 1, to: 2 });
      const removed = await ledger.compact(new Date(0)); // Very old date
      expect(removed).toBe(0);
    });
  });

  // ==================== File Persistence ====================

  describe('file persistence', () => {
    it('should save and reload events', async () => {
      await ledger.append({ entityId: 'Alice', field: 'importance', from: 5, to: 8 });
      await ledger.append({ entityId: 'Bob', field: 'status', from: 'active', to: 'archived' });

      const ledger2 = new TransitionLedger(storagePath);
      await ledger2.load();
      expect(ledger2.size).toBe(2);

      const events = ledger2.query({});
      expect(events.some(e => e.entityId === 'Alice')).toBe(true);
      expect(events.some(e => e.entityId === 'Bob')).toBe(true);
    });

    it('should handle missing file gracefully', async () => {
      const ledger2 = new TransitionLedger(path.join(tempDir, 'nonexistent.jsonl'));
      await ledger2.load();
      expect(ledger2.size).toBe(0);
    });

    it('should handle empty file gracefully', async () => {
      const ledgerPath = path.join(tempDir, 'memory.ledger.jsonl');
      await fs.writeFile(ledgerPath, '', 'utf-8');

      const ledger2 = new TransitionLedger(storagePath);
      await ledger2.load();
      expect(ledger2.size).toBe(0);
    });

    it('should skip malformed JSON lines', async () => {
      const ledgerPath = path.join(tempDir, 'memory.ledger.jsonl');
      const validEvent = JSON.stringify({
        id: 'txn_1_abc',
        entityId: 'Alice',
        field: 'importance',
        from: 5,
        to: 8,
        timestamp: new Date().toISOString(),
      });
      await fs.writeFile(ledgerPath, validEvent + '\n{invalid json}\n', 'utf-8');

      const ledger2 = new TransitionLedger(storagePath);
      await ledger2.load();
      expect(ledger2.size).toBe(1);
    });
  });

  // ==================== Concurrent Appends ====================

  describe('concurrent appends', () => {
    it('should handle concurrent appends without corruption', async () => {
      const promises: Promise<TransitionEvent>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          ledger.append({
            entityId: `Entity-${i}`,
            field: 'importance',
            from: i,
            to: i + 1,
          })
        );
      }

      const events = await Promise.all(promises);
      expect(events).toHaveLength(20);
      expect(ledger.size).toBe(20);

      // Verify all events have unique IDs
      const ids = new Set(events.map(e => e.id));
      expect(ids.size).toBe(20);

      // Reload and verify file integrity
      const ledger2 = new TransitionLedger(storagePath);
      await ledger2.load();
      expect(ledger2.size).toBe(20);
    });
  });

  // ==================== attachToEmitter ====================

  describe('attachToEmitter', () => {
    let emitter: GraphEventEmitter;

    beforeEach(() => {
      emitter = new GraphEventEmitter();
      ledger.attachToEmitter(emitter);
    });

    it('should capture entity:created events', async () => {
      emitter.emitEntityCreated({
        name: 'Alice',
        entityType: 'person',
        observations: ['Works at TechCorp'],
        tags: ['employee'],
        importance: 8,
      });

      // Wait for async append
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events).toHaveLength(1);
      expect(events[0].field).toBe('entity');
      expect(events[0].from).toBeNull();
      expect(events[0].to).toEqual(expect.objectContaining({ entityType: 'person' }));
    });

    it('should capture entity:updated events', async () => {
      emitter.emitEntityUpdated(
        'Alice',
        { importance: 9 },
        { importance: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events).toHaveLength(1);
      expect(events[0].field).toBe('importance');
      expect(events[0].from).toBe(5);
      expect(events[0].to).toBe(9);
    });

    it('should skip lastModified field in entity:updated', async () => {
      emitter.emitEntityUpdated(
        'Alice',
        { importance: 9, lastModified: new Date().toISOString() },
        { importance: 5, lastModified: '2024-01-01T00:00:00Z' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should only have 1 event (importance), not 2
      expect(ledger.size).toBe(1);
      expect(ledger.query({})[0].field).toBe('importance');
    });

    it('should capture entity:deleted events', async () => {
      emitter.emitEntityDeleted('Alice', {
        name: 'Alice',
        entityType: 'person',
        observations: ['Works at TechCorp'],
        importance: 8,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events[0].field).toBe('entity');
      expect(events[0].from).toEqual(expect.objectContaining({ entityType: 'person' }));
      expect(events[0].to).toBeNull();
    });

    it('should capture relation:created events', async () => {
      emitter.emitRelationCreated({
        from: 'Alice',
        to: 'TechCorp',
        relationType: 'works_at',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events[0].field).toBe('relation');
      expect(events[0].from).toBeNull();
      expect(events[0].to).toEqual({ to: 'TechCorp', relationType: 'works_at' });
    });

    it('should capture relation:deleted events', async () => {
      emitter.emitRelationDeleted('Alice', 'TechCorp', 'works_at');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events[0].field).toBe('relation');
      expect(events[0].from).toEqual({ to: 'TechCorp', relationType: 'works_at' });
      expect(events[0].to).toBeNull();
    });

    it('should capture observation:added events', async () => {
      emitter.emitObservationAdded('Alice', ['Loves TypeScript', 'Plays piano']);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events[0].field).toBe('observations');
      expect(events[0].from).toBeNull();
      expect(events[0].to).toEqual(['Loves TypeScript', 'Plays piano']);
    });

    it('should capture observation:deleted events', async () => {
      emitter.emitObservationDeleted('Alice', ['Outdated info']);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ledger.size).toBe(1);
      const events = ledger.query({ entityId: 'Alice' });
      expect(events[0].field).toBe('observations');
      expect(events[0].from).toEqual(['Outdated info']);
      expect(events[0].to).toBeNull();
    });

    it('should allow detaching from emitter', async () => {
      const detach = ledger.attachToEmitter(emitter);
      detach();

      // Re-attach was done in beforeEach, plus we attached again and detached.
      // The beforeEach attachment is still active, so let's test with a fresh setup.
      const ledger2 = new TransitionLedger(path.join(tempDir, 'memory2.jsonl'));
      const emitter2 = new GraphEventEmitter();
      const unsub = ledger2.attachToEmitter(emitter2);

      emitter2.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(ledger2.size).toBe(1);

      unsub();

      emitter2.emitEntityCreated({ name: 'Test2', entityType: 'test', observations: [] });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(ledger2.size).toBe(1); // No new event captured
    });
  });

  // ==================== Derived File Path ====================

  describe('file path derivation', () => {
    it('should derive ledger path from storage path', async () => {
      await ledger.append({ entityId: 'A', field: 'f', from: 1, to: 2 });
      const ledgerPath = path.join(tempDir, 'memory.ledger.jsonl');
      const content = await fs.readFile(ledgerPath, 'utf-8');
      expect(content.trim()).toBeTruthy();
    });

    it('should handle different extensions', async () => {
      const sqlitePath = path.join(tempDir, 'data.db');
      const sqliteLedger = new TransitionLedger(sqlitePath);
      await sqliteLedger.append({ entityId: 'A', field: 'f', from: 1, to: 2 });
      const ledgerPath = path.join(tempDir, 'data.ledger.jsonl');
      const content = await fs.readFile(ledgerPath, 'utf-8');
      expect(content.trim()).toBeTruthy();
    });
  });
});
