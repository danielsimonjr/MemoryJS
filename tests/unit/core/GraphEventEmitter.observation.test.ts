/**
 * GraphEventEmitter observation events (CL-22 emitObservationEvent)
 */

import { describe, it, expect, vi } from 'vitest';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';

describe('GraphEventEmitter observation events', () => {
  it('emits observation:added with the exact payload keys', () => {
    const emitter = new GraphEventEmitter();
    const listener = vi.fn();
    emitter.on('observation:added', listener);

    emitter.emitObservationAdded('alice', ['likes tea', 'lives in Oslo']);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0];
    expect(Object.keys(event)).toEqual(['type', 'timestamp', 'entityName', 'observations']);
    expect(event.type).toBe('observation:added');
    expect(event.entityName).toBe('alice');
    expect(event.observations).toEqual(['likes tea', 'lives in Oslo']);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('emits observation:deleted with the exact payload keys', () => {
    const emitter = new GraphEventEmitter();
    const listener = vi.fn();
    emitter.on('observation:deleted', listener);

    emitter.emitObservationDeleted('bob', ['old fact']);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0];
    expect(Object.keys(event)).toEqual(['type', 'timestamp', 'entityName', 'observations']);
    expect(event.type).toBe('observation:deleted');
    expect(event.entityName).toBe('bob');
    expect(event.observations).toEqual(['old fact']);
  });

  it('emits nothing for an empty observation list', () => {
    const emitter = new GraphEventEmitter();
    const added = vi.fn();
    const deleted = vi.fn();
    emitter.on('observation:added', added);
    emitter.on('observation:deleted', deleted);

    emitter.emitObservationAdded('alice', []);
    emitter.emitObservationDeleted('alice', []);

    expect(added).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  });

  it('does not cross-fire between added and deleted listeners', () => {
    const emitter = new GraphEventEmitter();
    const added = vi.fn();
    const deleted = vi.fn();
    emitter.on('observation:added', added);
    emitter.on('observation:deleted', deleted);

    emitter.emitObservationDeleted('carol', ['x']);

    expect(added).not.toHaveBeenCalled();
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it('delivers to onAny listeners with the correct type', () => {
    const emitter = new GraphEventEmitter();
    const seen: string[] = [];
    emitter.onAny((e) => seen.push(e.type));

    emitter.emitObservationAdded('dave', ['a']);
    emitter.emitObservationDeleted('dave', ['a']);

    expect(seen).toEqual(['observation:added', 'observation:deleted']);
  });
});
