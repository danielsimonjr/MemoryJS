/** BoundaryRecorder (RS-11): record/upsert, metadata counts, lookup, summary ordering and budget. */
import { describe, it, expect } from 'vitest';
import { BoundaryRecorder, summarizeCoverage } from '../../../../src/agent/bootstrap/BoundaryRecorder.js';
import { isCoverageEntity } from '../../../../src/types/agent-memory.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { syntheticCorpus } from './bootstrapFixtures.js';

withBothBackends('BoundaryRecorder', (backend) => {
  it('records a region and looks it up', async () => {
    const storage = backend.create();
    const rec = new BoundaryRecorder({ storage });
    const written = await rec.record({ region: 'invoices', status: 'present', note: 'all there' });
    expect(written.region).toBe('invoices');
    expect(rec.lookup('invoices')).toMatchObject({ region: 'invoices', status: 'present', note: 'all there' });
    expect(rec.lookup('missing')).toBeUndefined();
  });

  it('upserts by region: a second record replaces the first without duplicating the entity', async () => {
    const storage = backend.create();
    const rec = new BoundaryRecorder({ storage });
    await rec.record({ region: 'receipts', status: 'absent' });
    await rec.record({ region: 'receipts', status: 'present', note: 'found later' });
    const entities = (await storage.loadGraph()).entities.filter(isCoverageEntity);
    expect(entities.length).toBe(1);
    expect(rec.lookup('receipts')?.status).toBe('present');
    expect(rec.lookup('receipts')?.note).toBe('found later');
  });

  it('derives present, partial and absent from metadata counts', async () => {
    const storage = backend.create();
    const rec = new BoundaryRecorder({ storage });
    const sources = syntheticCorpus(10, 2); // g0 and g1, five sources each
    const records = await rec.recordFromMetadata(sources, 'group', [
      'g0',
      { region: 'g1', expected: 8 },
      'g9',
    ]);
    const byRegion = Object.fromEntries(records.map((r) => [r.region, r.status]));
    expect(byRegion).toEqual({ g0: 'present', g1: 'partial', g9: 'absent' });
    expect(rec.lookup('g0')?.evidence.length).toBe(5);
    expect(rec.lookup('g1')?.note).toContain('of 8 expected');
  });

  it('lists records sorted by region', async () => {
    const storage = backend.create();
    const rec = new BoundaryRecorder({ storage });
    await rec.record({ region: 'zeta', status: 'present' });
    await rec.record({ region: 'alpha', status: 'absent' });
    expect((await rec.list()).map((r) => r.region)).toEqual(['alpha', 'zeta']);
  });

  it('summaryForContext lists absent regions first, then partial, then present', async () => {
    const storage = backend.create();
    const rec = new BoundaryRecorder({ storage });
    await rec.record({ region: 'b-present', status: 'present' });
    await rec.record({ region: 'c-partial', status: 'partial' });
    await rec.record({ region: 'a-absent', status: 'absent' });
    const lines = (await rec.summaryForContext()).split('\n');
    expect(lines.map((l) => l.split(':')[0])).toEqual(['- a-absent', '- c-partial', '- b-present']);
  });

  it('summaryForContext stays within the token budget and says what it dropped', () => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      region: `region-${String(i).padStart(2, '0')}`,
      status: 'present' as const,
      evidence: [],
      note: 'some note text here',
      recordedAt: '2026-11-06T00:00:00.000Z' as never,
    }));
    const text = summarizeCoverage(records, 30);
    expect(text).toMatch(/more region\(s\) omitted for budget/);
    expect(text.split('\n').length).toBeLessThan(records.length);
  });

  it('summaryForContext is empty when nothing is recorded', async () => {
    const storage = backend.create();
    expect(await new BoundaryRecorder({ storage }).summaryForContext()).toBe('');
  });
});

describe('summarizeCoverage', () => {
  it('returns an empty string for no records', () => {
    expect(summarizeCoverage([])).toBe('');
  });
});
