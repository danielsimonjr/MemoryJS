/** Bootstrap input validation and conflict bookkeeping (spec §3.7 S8, S9, N1, N2). */
import { describe, it, expect } from 'vitest';
import { CorpusMapper, MAX_REF_CHARS, navigationLeafName, type CorpusSource } from '../../../../src/agent/bootstrap/CorpusMapper.js';
import { BoundaryRecorder } from '../../../../src/agent/bootstrap/BoundaryRecorder.js';
import { ValidationError } from '../../../../src/utils/errors.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';

describe('bootstrap validation', () => {
  withBothBackends('CorpusMapper and BoundaryRecorder', (backend) => {
    it('S8: a loader resolving to a non-string is a ValidationError', async () => {
      for (const bad of [undefined, 42, { text: 'x' }, null]) {
        const sources = [{ ref: 'doc-1', loader: async () => bad as unknown as string }];
        await expect(new CorpusMapper({ storage: backend.create() }).map(sources)).rejects.toThrow(ValidationError);
      }
      await expect(new CorpusMapper({ storage: backend.create() }).map([{ ref: 'd', loader: async () => 7 as unknown as string }])).rejects.toThrow(/loader must resolve to a string/);
    });

    it('N2: empty refs and refs over 512 characters are rejected', async () => {
      await expect(new CorpusMapper({ storage: backend.create() }).map([{ ref: '', text: 'x' }])).rejects.toThrow(/non-empty/);
      await expect(new CorpusMapper({ storage: backend.create() }).map([{ ref: '  ', text: 'x' }])).rejects.toThrow(ValidationError);
      expect(MAX_REF_CHARS).toBeLessThanOrEqual(512);
      await expect(new CorpusMapper({ storage: backend.create() }).map([{ ref: 'r'.repeat(513), text: 'x' }])).rejects.toThrow(/longer than/);
      await expect(new CorpusMapper({ storage: backend.create() }).map([{ ref: 'r'.repeat(MAX_REF_CHARS + 1), text: 'x' }])).rejects.toThrow(ValidationError);
      const ok = await new CorpusMapper({ storage: backend.create() }).map([{ ref: 'r'.repeat(MAX_REF_CHARS), text: 'x' }]);
      expect(ok.nodeCount).toBeGreaterThan(0);
    });

    it('N1: conflicts and [conflict] observations are deduplicated for a fresh node (A, B, B)', async () => {
      const storage = backend.create();
      const sources: CorpusSource[] = [
        { ref: 'same', text: 'alpha text' },
        { ref: 'same', text: 'beta text' },
        { ref: 'same', text: 'beta text' },
      ];
      const map = await new CorpusMapper({ storage }).map(sources);
      expect(map.conflicts).toHaveLength(1);
      const node = (await storage.loadGraph()).entities.find((e) => e.name === navigationLeafName('same'))!;
      expect(node.observations.filter((o) => o.startsWith('[conflict]'))).toHaveLength(1);
    });

    it('S9: the original region name is kept and a slug collision names both regions', async () => {
      const boundaries = new BoundaryRecorder({ storage: backend.create() });
      const rec = await boundaries.record({ region: 'Invoices 2024', status: 'present' });
      expect(rec.region).toBe('Invoices 2024');
      expect(boundaries.lookup('Invoices 2024')?.region).toBe('Invoices 2024');
      await boundaries.record({ region: 'Invoices 2024', status: 'partial' });
      const err = await boundaries.record({ region: 'invoices-2024', status: 'absent' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(String((err as Error).message)).toContain('Invoices 2024');
      expect(String((err as Error).message)).toContain('invoices-2024');
    });
  });
});
