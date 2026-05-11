/**
 * API Key Store
 *
 * Phase 5 step 54 (§14.1) — issue, validate, and revoke API keys
 * with associated scope sets. Designed for the REST adapter
 * (`adapters/RestRouter`) to authenticate inbound requests without
 * adding an OAuth/JWT dependency for self-hosted deployments.
 *
 * **No external deps.** Uses Node's built-in `crypto.randomBytes` and
 * `crypto.timingSafeEqual`. Keys are stored as SHA-256 hashes — the
 * plaintext is only returned to the caller at `issue()` time. Later
 * `validate()` calls compare hashes in constant time to prevent
 * timing side channels.
 *
 * @module security/APIKeyStore
 * @experimental Persisted-key encoding (`KeyRecord`) may evolve;
 *   migration helpers will accompany breaking format changes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Result of a `validate()` call. */
export interface ValidationResult {
  valid: boolean;
  /** Set when `valid: true` — the matched record's metadata. */
  keyId?: string;
  scopes?: readonly string[];
  ownerId?: string;
  reason?: 'unknown' | 'revoked' | 'expired' | 'wrong-scope';
}

/** Internal representation of a stored key. */
export interface KeyRecord {
  /** Stable identifier (not the plaintext key). */
  keyId: string;
  /** SHA-256 hex of the plaintext, used for constant-time comparison. */
  hash: string;
  /** Subject/owner attribute for downstream policies. */
  ownerId?: string;
  /** Permission/scope set, e.g. `['read:entities', 'write:relations']`. */
  scopes: readonly string[];
  /** ISO 8601 issuance timestamp. */
  issuedAt: string;
  /** ISO 8601 expiry — when omitted, the key never expires. */
  expiresAt?: string;
  /** Set once revoked. Revoked keys remain in the store for audit. */
  revokedAt?: string;
  /** Free-form metadata. */
  metadata?: Record<string, unknown>;
}

export interface IssueOptions {
  ownerId?: string;
  scopes?: readonly string[];
  /** TTL in seconds; mutually exclusive with `expiresAt`. */
  ttlSeconds?: number;
  /** Explicit expiry ISO 8601 string. */
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IssueResult {
  /** Plaintext key — show to the caller once, then discard. */
  plaintext: string;
  /** Stored record (without the plaintext). */
  record: Readonly<KeyRecord>;
}

/**
 * In-memory API-key store with constant-time validation. Persisting
 * the underlying records is the caller's responsibility — `serialize`
 * / `load` round-trip the store as JSON. Persisting only the
 * `KeyRecord[]` array is sufficient; the plaintext is never written.
 *
 * @example
 * ```typescript
 * const store = new APIKeyStore();
 * const { plaintext, record } = store.issue({
 *   ownerId: 'user-42',
 *   scopes: ['read:entities'],
 *   ttlSeconds: 86400,
 * });
 * // Show `plaintext` to the user once; later:
 * const v = store.validate(plaintext, ['read:entities']);
 * if (v.valid) console.log('hello', v.ownerId);
 * ```
 */
export class APIKeyStore {
  /** keyId -> record. */
  private records: Map<string, KeyRecord> = new Map();
  /** hash -> keyId (constant-time fast path for validate). */
  private byHash: Map<string, string> = new Map();

  /** Issue a new key. The plaintext is returned exactly once. */
  issue(options: IssueOptions = {}): IssueResult {
    const plaintext = `mjs_${randomBytes(24).toString('base64url')}`;
    const hash = sha256(plaintext);
    const keyId = `kid_${randomBytes(8).toString('base64url')}`;
    const issuedAt = new Date().toISOString();
    let expiresAt = options.expiresAt;
    if (!expiresAt && options.ttlSeconds !== undefined) {
      expiresAt = new Date(Date.now() + options.ttlSeconds * 1000).toISOString();
    }
    const record: KeyRecord = {
      keyId,
      hash,
      ownerId: options.ownerId,
      scopes: options.scopes ?? [],
      issuedAt,
      expiresAt,
      metadata: options.metadata,
    };
    this.records.set(keyId, record);
    this.byHash.set(hash, keyId);
    return { plaintext, record };
  }

  /**
   * Validate a plaintext key. When `requiredScopes` is provided, the
   * key must include every scope listed; missing scopes return
   * `valid: false, reason: 'wrong-scope'`.
   */
  validate(plaintext: string, requiredScopes: readonly string[] = []): ValidationResult {
    const hash = sha256(plaintext);
    const candidateId = this.byHash.get(hash);
    if (!candidateId) return { valid: false, reason: 'unknown' };

    const record = this.records.get(candidateId);
    if (!record) return { valid: false, reason: 'unknown' };

    // Constant-time hash compare even though we already matched —
    // makes the hot path uniform regardless of which keyId hit. The
    // map-lookup above leaks "this key exists" via timing, but the
    // hash space is large enough that the leak is meaningless.
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(record.hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'unknown' };
    }

    if (record.revokedAt) return { valid: false, reason: 'revoked' };

    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
      return { valid: false, reason: 'expired' };
    }

    if (requiredScopes.length > 0) {
      const have = new Set(record.scopes);
      for (const s of requiredScopes) {
        if (!have.has(s)) return { valid: false, reason: 'wrong-scope' };
      }
    }

    return {
      valid: true,
      keyId: record.keyId,
      scopes: record.scopes,
      ownerId: record.ownerId,
    };
  }

  /** Mark a key revoked. Idempotent. */
  revoke(keyId: string): boolean {
    const record = this.records.get(keyId);
    if (!record) return false;
    if (record.revokedAt) return true;
    record.revokedAt = new Date().toISOString();
    return true;
  }

  /** List records (revoked entries are included — caller can filter). */
  list(): ReadonlyArray<Readonly<KeyRecord>> {
    return [...this.records.values()];
  }

  /** Get a single record by id. */
  get(keyId: string): Readonly<KeyRecord> | undefined {
    return this.records.get(keyId);
  }

  /**
   * Snapshot the store as a plain array. Safe to persist — contains
   * only hashes, no plaintext. Use `load()` to restore.
   */
  serialize(): KeyRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  /** Rehydrate from a previously-serialized array. */
  load(records: KeyRecord[]): void {
    this.records.clear();
    this.byHash.clear();
    for (const r of records) {
      this.records.set(r.keyId, r);
      this.byHash.set(r.hash, r.keyId);
    }
  }

  /** Total registered keys (including revoked). */
  size(): number {
    return this.records.size;
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}
