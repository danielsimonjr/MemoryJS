/**
 * APIKeyStore Unit Tests
 *
 * Covers Phase 5 step 54: API-key issue/validate/revoke.
 */

import { describe, it, expect } from 'vitest';
import { APIKeyStore } from '../../../src/security/APIKeyStore.js';

describe('APIKeyStore.issue', () => {
  it('returns a plaintext key with the mjs_ prefix', () => {
    const store = new APIKeyStore();
    const { plaintext, record } = store.issue();
    expect(plaintext.startsWith('mjs_')).toBe(true);
    expect(record.keyId.startsWith('kid_')).toBe(true);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not store plaintext in the record', () => {
    const store = new APIKeyStore();
    const { plaintext, record } = store.issue();
    expect(JSON.stringify(record)).not.toContain(plaintext);
  });

  it('keys are unique', () => {
    const store = new APIKeyStore();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(store.issue().plaintext);
    expect(seen.size).toBe(50);
  });
});

describe('APIKeyStore.validate', () => {
  it('valid:true for an issued key', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({ ownerId: 'u1', scopes: ['read'] });
    const v = store.validate(plaintext);
    expect(v.valid).toBe(true);
    expect(v.ownerId).toBe('u1');
    expect(v.scopes).toEqual(['read']);
  });

  it('valid:false reason=unknown for a never-issued key', () => {
    const store = new APIKeyStore();
    store.issue();
    const v = store.validate('mjs_garbage');
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('unknown');
  });

  it('valid:false reason=revoked after revoke', () => {
    const store = new APIKeyStore();
    const { plaintext, record } = store.issue();
    store.revoke(record.keyId);
    const v = store.validate(plaintext);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('revoked');
  });

  it('valid:false reason=expired past expiry', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const v = store.validate(plaintext);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('ttlSeconds sets a future expiry', () => {
    const store = new APIKeyStore();
    const { record } = store.issue({ ttlSeconds: 60 });
    expect(record.expiresAt).toBeDefined();
    expect(new Date(record.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('requiredScopes — missing scope returns wrong-scope', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({ scopes: ['read'] });
    const v = store.validate(plaintext, ['write']);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('wrong-scope');
  });

  it('requiredScopes — all scopes present returns valid', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({ scopes: ['read', 'write'] });
    const v = store.validate(plaintext, ['read']);
    expect(v.valid).toBe(true);
  });
});

describe('APIKeyStore.revoke', () => {
  it('revoking an unknown key returns false', () => {
    const store = new APIKeyStore();
    expect(store.revoke('kid_nope')).toBe(false);
  });

  it('revoking is idempotent', () => {
    const store = new APIKeyStore();
    const { record } = store.issue();
    expect(store.revoke(record.keyId)).toBe(true);
    expect(store.revoke(record.keyId)).toBe(true);
  });

  it('revoked record retains revokedAt timestamp', () => {
    const store = new APIKeyStore();
    const { record } = store.issue();
    store.revoke(record.keyId);
    const r = store.get(record.keyId);
    expect(r?.revokedAt).toBeDefined();
  });
});

describe('APIKeyStore.serialize / load', () => {
  it('survives round-trip through serialize+load', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({ ownerId: 'u1', scopes: ['read'] });
    const records = store.serialize();

    const restored = new APIKeyStore();
    restored.load(records);
    const v = restored.validate(plaintext);
    expect(v.valid).toBe(true);
    expect(v.ownerId).toBe('u1');
  });

  it('serialize contains no plaintext', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue();
    const json = JSON.stringify(store.serialize());
    expect(json).not.toContain(plaintext);
  });
});

describe('APIKeyStore boundary cases', () => {
  it('expiresAt at exactly now is treated as expired', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({
      expiresAt: new Date(Date.now()).toISOString(),
    });
    const v = store.validate(plaintext);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('serialize/load round-trip across two store instances', () => {
    const a = new APIKeyStore();
    const { plaintext } = a.issue({ ownerId: 'u', scopes: ['x'] });
    const records = a.serialize();

    const b = new APIKeyStore();
    b.load(records);
    expect(b.validate(plaintext).valid).toBe(true);
    expect(b.size()).toBe(1);
  });
});

describe('APIKeyStore.size / list', () => {
  it('size reflects issued count, including revoked', () => {
    const store = new APIKeyStore();
    store.issue();
    const { record } = store.issue();
    store.revoke(record.keyId);
    expect(store.size()).toBe(2);
    expect(store.list()).toHaveLength(2);
  });
});


describe('APIKeyStore authorization isolation', () => {
  it('detaches all public authorization records and supplied scopes', () => {
    const store = new APIKeyStore();
    const scopes = ['read'];
    const { plaintext, record } = store.issue({ scopes });
    scopes.push('admin');
    const snapshots = [record, store.get(record.keyId)!, store.list()[0], store.serialize()[0]];
    for (const snapshot of snapshots) (snapshot.scopes as string[]).push('admin');
    (store.validate(plaintext).scopes as string[]).push('admin');
    expect(store.validate(plaintext, ['admin']).valid).toBe(false);
    store.revoke(record.keyId);
    (store.get(record.keyId)! as { revokedAt?: string }).revokedAt = undefined;
    expect(store.validate(plaintext).reason).toBe('revoked');
  });

  it('detaches loaded records, and rejects invalid replacements atomically', () => {
    const store = new APIKeyStore();
    const { plaintext } = store.issue({ scopes: ['read'] });
    const records = store.serialize();
    store.load(records);
    (records[0].scopes as string[]).push('admin');
    expect(store.validate(plaintext, ['admin']).valid).toBe(false);
    expect(() => store.load([{ ...records[0], expiresAt: 'invalid' }])).toThrow();
    expect(store.validate(plaintext).valid).toBe(true);
    expect(() => store.load([records[0], records[0]])).toThrow(/Duplicate/);
    expect(store.validate(plaintext).valid).toBe(true);
  });

  it.each(['', 'not-a-date'])('rejects invalid expiry %j', expiresAt => {
    expect(() => new APIKeyStore().issue({ expiresAt })).toThrow();
  });
  it.each([NaN, Infinity, -1])('rejects invalid TTL %s', ttlSeconds => {
    expect(() => new APIKeyStore().issue({ ttlSeconds })).toThrow();
  });
  it('rejects conflicting TTL and expiry', () => {
    expect(() => new APIKeyStore().issue({ ttlSeconds: 1, expiresAt: new Date().toISOString() })).toThrow();
  });
});
