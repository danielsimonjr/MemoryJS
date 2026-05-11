/**
 * ABACPolicy Unit Tests
 *
 * Covers Phase 5 step 54: attribute-based policy engine.
 */

import { describe, it, expect } from 'vitest';
import { ABACPolicy } from '../../../src/security/ABACPolicy.js';

describe('ABACPolicy', () => {
  it('returns not-applicable when no rule matches the action', () => {
    const p = new ABACPolicy([
      { id: 'r1', effect: 'permit', action: 'read' },
    ]);
    expect(
      p.evaluate({ subject: {}, resource: {}, action: 'write' }),
    ).toBe('not-applicable');
  });

  it('permit when a matching rule has effect=permit', () => {
    const p = new ABACPolicy([
      {
        id: 'admins',
        effect: 'permit',
        action: 'read',
        conditions: [{ attribute: 'subject.role', op: 'eq', value: 'admin' }],
      },
    ]);
    const d = p.evaluate({
      subject: { role: 'admin' },
      resource: {},
      action: 'read',
    });
    expect(d).toBe('permit');
  });

  it('deny when a matching rule has effect=deny', () => {
    const p = new ABACPolicy([
      {
        id: 'no-guests',
        effect: 'deny',
        action: 'write',
        conditions: [{ attribute: 'subject.role', op: 'eq', value: 'guest' }],
      },
    ]);
    expect(
      p.evaluate({
        subject: { role: 'guest' },
        resource: {},
        action: 'write',
      }),
    ).toBe('deny');
  });

  it('respects priority — higher priority wins', () => {
    const p = new ABACPolicy([
      { id: 'lo', effect: 'deny', action: 'read', priority: 1 },
      {
        id: 'hi',
        effect: 'permit',
        action: 'read',
        priority: 10,
        conditions: [{ attribute: 'subject.role', op: 'eq', value: 'admin' }],
      },
    ]);
    expect(
      p.evaluate({ subject: { role: 'admin' }, resource: {}, action: 'read' }),
    ).toBe('permit');
  });

  it("on equal priority, deny-overrides", () => {
    const p = new ABACPolicy([
      { id: 'p1', effect: 'permit', action: 'read' },
      { id: 'p2', effect: 'deny', action: 'read' },
    ]);
    expect(
      p.evaluate({ subject: {}, resource: {}, action: 'read' }),
    ).toBe('deny');
  });

  it("wildcard action '*' matches everything", () => {
    const p = new ABACPolicy([
      {
        id: 'admin-bypass',
        effect: 'permit',
        action: '*',
        conditions: [{ attribute: 'subject.role', op: 'eq', value: 'admin' }],
        priority: 100,
      },
    ]);
    for (const action of ['read', 'write', 'delete']) {
      expect(
        p.evaluate({ subject: { role: 'admin' }, resource: {}, action }),
      ).toBe('permit');
    }
  });

  it('supports nested attribute paths', () => {
    const p = new ABACPolicy([
      {
        id: 'team-x',
        effect: 'permit',
        action: 'read',
        conditions: [{ attribute: 'subject.team.name', op: 'eq', value: 'x' }],
      },
    ]);
    expect(
      p.evaluate({
        subject: { team: { name: 'x' } },
        resource: {},
        action: 'read',
      }),
    ).toBe('permit');
  });

  it('supports `in` / `not-in` operators', () => {
    const p = new ABACPolicy([
      {
        id: 'allowed-clearance',
        effect: 'permit',
        action: 'read',
        conditions: [
          { attribute: 'subject.clearance', op: 'in', value: ['secret', 'topsecret'] },
        ],
      },
    ]);
    expect(
      p.evaluate({
        subject: { clearance: 'secret' },
        resource: {},
        action: 'read',
      }),
    ).toBe('permit');
    expect(
      p.evaluate({
        subject: { clearance: 'confidential' },
        resource: {},
        action: 'read',
      }),
    ).toBe('not-applicable');
  });

  it('supports `contains` for arrays and strings', () => {
    const p = new ABACPolicy([
      {
        id: 'tagged',
        effect: 'permit',
        action: 'read',
        conditions: [{ attribute: 'resource.tags', op: 'contains', value: 'finance' }],
      },
    ]);
    expect(
      p.evaluate({
        subject: {},
        resource: { tags: ['finance', 'hr'] },
        action: 'read',
      }),
    ).toBe('permit');
    expect(
      p.evaluate({
        subject: {},
        resource: { tags: ['hr'] },
        action: 'read',
      }),
    ).toBe('not-applicable');
  });

  it('supports `present` / `absent`', () => {
    const p = new ABACPolicy([
      {
        id: 'must-have-classification',
        effect: 'deny',
        action: 'read',
        conditions: [{ attribute: 'resource.classification', op: 'absent' }],
      },
    ]);
    expect(
      p.evaluate({
        subject: {},
        resource: {},
        action: 'read',
      }),
    ).toBe('deny');
    expect(
      p.evaluate({
        subject: {},
        resource: { classification: 'public' },
        action: 'read',
      }),
    ).toBe('not-applicable');
  });

  it('numeric comparisons (lt/lte/gt/gte) honor type checks', () => {
    const p = new ABACPolicy([
      {
        id: 'over-18',
        effect: 'permit',
        action: 'read',
        conditions: [{ attribute: 'subject.age', op: 'gte', value: 18 }],
      },
    ]);
    expect(
      p.evaluate({ subject: { age: 21 }, resource: {}, action: 'read' }),
    ).toBe('permit');
    expect(
      p.evaluate({ subject: { age: 16 }, resource: {}, action: 'read' }),
    ).toBe('not-applicable');
    // String "21" doesn't auto-coerce — type-safe by design.
    expect(
      p.evaluate({ subject: { age: '21' }, resource: {}, action: 'read' }),
    ).toBe('not-applicable');
  });

  it('combines subject, resource, and environment conditions (AND)', () => {
    const p = new ABACPolicy([
      {
        id: 'business-hours-classified',
        effect: 'permit',
        action: 'read',
        conditions: [
          { attribute: 'subject.clearance', op: 'eq', value: 'secret' },
          { attribute: 'resource.classification', op: 'eq', value: 'classified' },
          { attribute: 'environment.hour', op: 'gte', value: 9 },
          { attribute: 'environment.hour', op: 'lt', value: 17 },
        ],
      },
    ]);
    expect(
      p.evaluate({
        subject: { clearance: 'secret' },
        resource: { classification: 'classified' },
        action: 'read',
        environment: { hour: 10 },
      }),
    ).toBe('permit');
    expect(
      p.evaluate({
        subject: { clearance: 'secret' },
        resource: { classification: 'classified' },
        action: 'read',
        environment: { hour: 19 },
      }),
    ).toBe('not-applicable');
  });

  it('addRule extends the policy at runtime', () => {
    const p = new ABACPolicy();
    p.addRule({ id: 'allow-all-reads', effect: 'permit', action: 'read' });
    expect(p.listRules()).toHaveLength(1);
    expect(
      p.evaluate({ subject: {}, resource: {}, action: 'read' }),
    ).toBe('permit');
  });
});
