/**
 * EntityStateMachine Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  EntityStateMachine,
  IllegalStatusTransitionError,
  DEFAULT_ENTITY_STATUS,
  effectiveStatus,
  canTransition,
} from '../../../src/core/EntityStateMachine.js';

describe('EntityStateMachine', () => {
  const m = new EntityStateMachine();

  it('treats undefined status as the default (published)', () => {
    expect(DEFAULT_ENTITY_STATUS).toBe('published');
    expect(effectiveStatus(undefined)).toBe('published');
    expect(effectiveStatus('draft')).toBe('draft');
  });

  it('allows draft → published, published → archived, archived → published', () => {
    expect(m.canTransition('draft', 'published')).toBe(true);
    expect(m.canTransition('published', 'archived')).toBe(true);
    expect(m.canTransition('archived', 'published')).toBe(true);
    expect(m.canTransition('draft', 'archived')).toBe(true);
  });

  it('rejects archived → draft and published → draft', () => {
    expect(m.canTransition('archived', 'draft')).toBe(false);
    expect(m.canTransition('published', 'draft')).toBe(false);
  });

  it('treats self-transitions as legal no-ops', () => {
    expect(m.canTransition('draft', 'draft')).toBe(true);
    expect(m.canTransition('published', 'published')).toBe(true);
    expect(canTransition('archived', 'archived')).toBe(true);
  });

  it('transition() throws IllegalStatusTransitionError on illegal moves', () => {
    expect(() => m.transition('archived', 'draft', 'Foo')).toThrow(IllegalStatusTransitionError);
    try {
      m.transition('archived', 'draft', 'Foo');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalStatusTransitionError);
      expect((err as IllegalStatusTransitionError).from).toBe('archived');
      expect((err as IllegalStatusTransitionError).to).toBe('draft');
      expect((err as IllegalStatusTransitionError).entityName).toBe('Foo');
    }
  });

  it('transition() returns the resolved from-state on success (defaulting undefined)', () => {
    expect(m.transition(undefined, 'archived')).toBe('published');
    expect(m.transition('draft', 'published')).toBe('draft');
  });

  it('nextStates includes the current state plus all reachable states', () => {
    expect(new Set(m.nextStates('draft'))).toEqual(new Set(['draft', 'published', 'archived']));
    expect(new Set(m.nextStates('published'))).toEqual(new Set(['published', 'archived']));
    expect(new Set(m.nextStates('archived'))).toEqual(new Set(['archived', 'published']));
    expect(new Set(m.nextStates(undefined))).toEqual(new Set(['published', 'archived']));
  });
});
