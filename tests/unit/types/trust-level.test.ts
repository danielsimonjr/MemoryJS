/**
 * TrustLevel — Phase 2 Sprint 6 Unit Tests
 *
 * Covers the discriminated `TrustLevel` mixin on `MemorySource`:
 * - explicit `trustLevel` takes precedence over inference
 * - `inferTrustLevel` backfill mapping from `method` + `reliability`
 * - `compareTrustLevel` ordering (ground-truth > verified > inferred > unverified)
 */

import { describe, it, expect } from 'vitest';
import {
  compareTrustLevel,
  inferTrustLevel,
  TRUST_LEVEL_ORDER,
  type MemorySource,
  type TrustLevel,
} from '../../../src/types/agent-memory.js';

function source(overrides: Partial<MemorySource>): MemorySource {
  return {
    agentId: 'agent_test',
    timestamp: new Date().toISOString(),
    method: 'observed',
    reliability: 0.8,
    ...overrides,
  };
}

describe('TrustLevel — type + ordering', () => {
  it('TRUST_LEVEL_ORDER ranks ground-truth highest, unverified lowest', () => {
    expect(TRUST_LEVEL_ORDER['ground-truth']).toBeGreaterThan(TRUST_LEVEL_ORDER.verified);
    expect(TRUST_LEVEL_ORDER.verified).toBeGreaterThan(TRUST_LEVEL_ORDER.inferred);
    expect(TRUST_LEVEL_ORDER.inferred).toBeGreaterThan(TRUST_LEVEL_ORDER.unverified);
  });

  it('compareTrustLevel returns positive when a > b', () => {
    expect(compareTrustLevel('ground-truth', 'verified')).toBeGreaterThan(0);
    expect(compareTrustLevel('verified', 'inferred')).toBeGreaterThan(0);
    expect(compareTrustLevel('inferred', 'unverified')).toBeGreaterThan(0);
  });

  it('compareTrustLevel returns negative when a < b', () => {
    expect(compareTrustLevel('unverified', 'inferred')).toBeLessThan(0);
    expect(compareTrustLevel('verified', 'ground-truth')).toBeLessThan(0);
  });

  it('compareTrustLevel returns 0 when equal', () => {
    expect(compareTrustLevel('verified', 'verified')).toBe(0);
  });
});

describe('TrustLevel — inferTrustLevel backfill', () => {
  it('returns explicit `trustLevel` unchanged if set', () => {
    const explicit: TrustLevel = 'ground-truth';
    const s = source({ method: 'inferred', reliability: 0.1, trustLevel: explicit });
    expect(inferTrustLevel(s)).toBe('ground-truth');
  });

  it("maps method: 'told' + high reliability to 'ground-truth'", () => {
    expect(inferTrustLevel(source({ method: 'told', reliability: 0.95 }))).toBe('ground-truth');
    expect(inferTrustLevel(source({ method: 'told', reliability: 1.0 }))).toBe('ground-truth');
  });

  it("maps method: 'told' + lower reliability to 'verified'", () => {
    expect(inferTrustLevel(source({ method: 'told', reliability: 0.8 }))).toBe('verified');
  });

  it("maps method: 'observed' + high reliability to 'verified'", () => {
    expect(inferTrustLevel(source({ method: 'observed', reliability: 0.9 }))).toBe('verified');
    expect(inferTrustLevel(source({ method: 'observed', reliability: 0.8 }))).toBe('verified');
  });

  it("maps method: 'observed' + low reliability to 'inferred'", () => {
    expect(inferTrustLevel(source({ method: 'observed', reliability: 0.5 }))).toBe('inferred');
  });

  it("maps method: 'consolidated' + reliability >= 0.7 to 'verified'", () => {
    expect(inferTrustLevel(source({ method: 'consolidated', reliability: 0.75 }))).toBe('verified');
  });

  it("maps method: 'consolidated' + reliability < 0.7 to 'inferred'", () => {
    expect(inferTrustLevel(source({ method: 'consolidated', reliability: 0.6 }))).toBe('inferred');
  });

  it("maps method: 'inferred' to 'inferred' regardless of reliability", () => {
    expect(inferTrustLevel(source({ method: 'inferred', reliability: 0.9 }))).toBe('inferred');
    expect(inferTrustLevel(source({ method: 'inferred', reliability: 0.2 }))).toBe('inferred');
  });

  it('maps undefined source to `unverified`', () => {
    expect(inferTrustLevel(undefined)).toBe('unverified');
  });

  it('maps NaN / non-finite reliability to `unverified` regardless of method', () => {
    // Defensive: `NaN >= 0.9` silently evaluates to `false`, which without
    // the guard would coerce 'told' to 'verified' — actively misleading.
    expect(inferTrustLevel(source({ method: 'told', reliability: NaN }))).toBe('unverified');
    expect(inferTrustLevel(source({ method: 'observed', reliability: NaN }))).toBe('unverified');
    expect(
      inferTrustLevel(source({ method: 'observed', reliability: Number.POSITIVE_INFINITY }))
    ).toBe('unverified');
    // Cast through `unknown` to simulate JSONL-deserialized garbage.
    expect(
      inferTrustLevel(source({ method: 'told', reliability: undefined as unknown as number }))
    ).toBe('unverified');
  });
});
