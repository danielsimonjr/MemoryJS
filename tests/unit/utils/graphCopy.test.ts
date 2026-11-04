/**
 * Direct unit tests for graphCopy helpers (CMP-5).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  deepCopyPlain,
  deepFreeze,
  borrowGraphView,
  isReadViewGuardEnabled,
} from '../../../src/utils/graphCopy.js';

const originalEnv = process.env.NODE_ENV;

function setEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
}

describe('graphCopy', () => {
  afterEach(() => setEnv(originalEnv));

  describe('deepCopyPlain', () => {
    it('returns primitives and null unchanged', () => {
      expect(deepCopyPlain(3)).toBe(3);
      expect(deepCopyPlain('s')).toBe('s');
      expect(deepCopyPlain(null)).toBeNull();
      expect(deepCopyPlain(undefined)).toBeUndefined();
    });

    it('produces a copy that shares no nested objects with the input', () => {
      const input = {
        name: 'Alice',
        observations: ['a', 'b'],
        metadata: { nested: { deep: [1, 2] } },
      };
      const copy = deepCopyPlain(input);
      expect(copy).toEqual(input);
      expect(copy).not.toBe(input);
      expect(copy.observations).not.toBe(input.observations);
      expect(copy.metadata.nested).not.toBe(input.metadata.nested);
      expect(copy.metadata.nested.deep).not.toBe(input.metadata.nested.deep);

      copy.metadata.nested.deep.push(3);
      copy.observations.push('c');
      expect(input.metadata.nested.deep).toEqual([1, 2]);
      expect(input.observations).toEqual(['a', 'b']);
    });

    it('copies Date values into new Date instances', () => {
      const d = new Date('2026-01-02T03:04:05.000Z');
      const copy = deepCopyPlain({ d });
      expect(copy.d).toBeInstanceOf(Date);
      expect(copy.d).not.toBe(d);
      expect(copy.d.getTime()).toBe(d.getTime());
    });

    it('copies class instances and Maps with structuredClone (not as plain objects)', () => {
      const map = new Map<string, number>([['k', 1]]);
      const copy = deepCopyPlain({ map });
      expect(copy.map).toBeInstanceOf(Map);
      expect(copy.map).not.toBe(map);
      expect(copy.map.get('k')).toBe(1);
    });
  });

  describe('deepFreeze', () => {
    it('freezes the value and every nested object, in place', () => {
      const value = { a: { b: { c: [1, { d: 2 }] } } };
      const frozen = deepFreeze(value);
      expect(frozen).toBe(value);
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.a)).toBe(true);
      expect(Object.isFrozen(value.a.b)).toBe(true);
      expect(Object.isFrozen(value.a.b.c)).toBe(true);
      expect(Object.isFrozen(value.a.b.c[1])).toBe(true);
    });

    it('makes mutation throw in strict mode', () => {
      const value = deepFreeze({ list: [1] });
      expect(() => {
        'use strict';
        (value.list as number[]).push(2);
      }).toThrow(TypeError);
    });

    it('leaves primitives alone and tolerates already-frozen subtrees', () => {
      expect(deepFreeze(5)).toBe(5);
      const inner = Object.freeze({ x: 1 });
      const outer = deepFreeze({ inner });
      expect(outer.inner).toBe(inner);
    });
  });

  describe('isReadViewGuardEnabled', () => {
    it('is true outside production and false in production', () => {
      setEnv('test');
      expect(isReadViewGuardEnabled()).toBe(true);
      setEnv('production');
      expect(isReadViewGuardEnabled()).toBe(false);
      setEnv(undefined);
      expect(isReadViewGuardEnabled()).toBe(true);
    });
  });

  describe('borrowGraphView', () => {
    it('returns the live object itself in production (O(1), no copy)', () => {
      setEnv('production');
      const live = { entities: [{ name: 'A' }], relations: [] };
      expect(borrowGraphView(live)).toBe(live);
      expect(Object.isFrozen(live)).toBe(false);
    });

    it('returns a deep-frozen copy outside production that does not alias the live graph', () => {
      setEnv('test');
      const live = { entities: [{ name: 'A', observations: ['x'] }], relations: [] };
      const view = borrowGraphView(live);
      expect(view).not.toBe(live);
      expect(view).toEqual(live);
      expect(Object.isFrozen(view)).toBe(true);
      expect(Object.isFrozen(view.entities[0])).toBe(true);
      expect(() => {
        'use strict';
        (view.entities[0] as { name: string }).name = 'B';
      }).toThrow(TypeError);
      expect(live.entities[0].name).toBe('A');
    });
  });
});
