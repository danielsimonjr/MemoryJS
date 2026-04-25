/**
 * η.6.1 — RBAC Tests
 *
 * Covers: PermissionMatrix lookup, RoleAssignmentStore CRUD + activity
 * windows + persistence, RbacMiddleware grant/deny under various
 * assignment shapes (universal vs. typed vs. scoped), default-role
 * fallback, and integration with the four built-in roles.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  DEFAULT_PERMISSION_MATRIX,
  permissionsForRole,
  RbacMiddleware,
  RoleAssignmentStore,
  type ResourcePermissionOverrides,
} from '../../../src/agent/rbac/index.js';

describe('η.6.1 RBAC', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `rbac-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // -------- PermissionMatrix --------
  describe('PermissionMatrix', () => {
    it('reader has only read permission', () => {
      expect(permissionsForRole('reader', 'entity')).toEqual(['read']);
    });

    it('writer has read+write', () => {
      const perms = permissionsForRole('writer', 'entity');
      expect(perms).toContain('read');
      expect(perms).toContain('write');
      expect(perms).not.toContain('manage');
    });

    it('admin has read+write+delete but not manage', () => {
      expect(permissionsForRole('admin', 'entity')).toEqual(['read', 'write', 'delete']);
    });

    it('owner has all four permissions', () => {
      expect(permissionsForRole('owner', 'entity')).toEqual(['read', 'write', 'delete', 'manage']);
    });

    it('unknown role returns empty permission set (fail-safe)', () => {
      expect(permissionsForRole('mystery-role', 'entity')).toEqual([]);
    });

    it('per-resource-type override takes precedence', () => {
      const override = new Map([
        ['entity', new Map([['reader', ['read', 'write']]])],
      ]) as ResourcePermissionOverrides;
      const perms = permissionsForRole('reader', 'entity', DEFAULT_PERMISSION_MATRIX, override);
      expect(perms).toEqual(['read', 'write']);
      // Non-overridden resource type still uses default
      expect(permissionsForRole('reader', 'relation', DEFAULT_PERMISSION_MATRIX, override))
        .toEqual(['read']);
    });
  });

  // -------- RoleAssignmentStore --------
  describe('RoleAssignmentStore', () => {
    it('assign + list returns the assigned role', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'writer' });
      const assignments = store.list('alice');
      expect(assignments).toHaveLength(1);
      expect(assignments[0].role).toBe('writer');
    });

    it('multiple assignments per agent are kept', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'reader', resourceType: 'entity' });
      await store.assign({ agentId: 'alice', role: 'writer', resourceType: 'relation' });
      expect(store.list('alice')).toHaveLength(2);
    });

    it('revoke removes only the matching assignment', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'reader', resourceType: 'entity' });
      await store.assign({ agentId: 'alice', role: 'writer', resourceType: 'relation' });
      await store.revoke('alice', 'reader', 'entity');
      const remaining = store.list('alice');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].role).toBe('writer');
    });

    it('listActive filters by validFrom / validUntil window', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({
        agentId: 'alice', role: 'admin',
        validFrom: '2024-01-01T00:00:00Z',
        validUntil: '2024-12-31T00:00:00Z',
      });
      // Within window
      expect(store.listActive('alice', '2024-06-15T00:00:00Z')).toHaveLength(1);
      // Before window
      expect(store.listActive('alice', '2023-06-15T00:00:00Z')).toHaveLength(0);
      // After window
      expect(store.listActive('alice', '2025-06-15T00:00:00Z')).toHaveLength(0);
    });

    it('persists to JSONL sidecar and rehydrates on construction', async () => {
      const path = join(testDir, 'assignments.jsonl');
      const a = new RoleAssignmentStore({ persistencePath: path });
      await a.assign({ agentId: 'alice', role: 'writer' });
      await a.assign({ agentId: 'bob', role: 'reader' });
      await a.revoke('bob', 'reader');

      // New store rehydrates from disk
      const b = new RoleAssignmentStore({ persistencePath: path });
      await b.hydrate();
      expect(b.list('alice')).toHaveLength(1);
      expect(b.list('alice')[0].role).toBe('writer');
      expect(b.list('bob')).toHaveLength(0);
    });

    it('hydrate is a no-op when persistence path is unset', async () => {
      const store = new RoleAssignmentStore();
      await store.hydrate(); // should not throw
      expect(store.list('alice')).toEqual([]);
    });

    it('hydrate is a no-op when the sidecar file does not exist', async () => {
      const path = join(testDir, 'nonexistent.jsonl');
      const store = new RoleAssignmentStore({ persistencePath: path });
      await store.hydrate(); // should not throw
      expect(store.list('alice')).toEqual([]);
    });
  });

  // -------- RbacMiddleware --------
  describe('RbacMiddleware', () => {
    it('grants when an assignment + matrix allow the action', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'writer', resourceType: 'entity' });
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      expect(mw.checkPermission('alice', 'write', 'entity')).toBe(true);
    });

    it('denies when assignment exists but matrix forbids the action', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'reader', resourceType: 'entity' });
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      expect(mw.checkPermission('alice', 'write', 'entity')).toBe(false);
    });

    it('universal-grant assignment (no resourceType) covers all types', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'admin' });
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      expect(mw.checkPermission('alice', 'delete', 'entity')).toBe(true);
      expect(mw.checkPermission('alice', 'delete', 'relation')).toBe(true);
      expect(mw.checkPermission('alice', 'delete', 'observation')).toBe(true);
    });

    it('typed assignment does NOT cover other resource types', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'admin', resourceType: 'entity' });
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      expect(mw.checkPermission('alice', 'delete', 'entity')).toBe(true);
      expect(mw.checkPermission('alice', 'delete', 'relation')).toBe(false);
    });

    it('scope prefix gates the grant by resourceName', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({
        agentId: 'alice', role: 'writer', resourceType: 'entity', scope: 'project-x:',
      });
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      expect(mw.checkPermission('alice', 'write', 'entity', 'project-x:Alice')).toBe(true);
      expect(mw.checkPermission('alice', 'write', 'entity', 'project-y:Alice')).toBe(false);
      // Empty resource name when scope is set ⇒ deny
      expect(mw.checkPermission('alice', 'write', 'entity')).toBe(false);
    });

    it('default-role fallback (reader) grants read but not write to unregistered agents', async () => {
      const store = new RoleAssignmentStore();
      const mw = new RbacMiddleware(store); // defaultRole defaults to 'reader'
      expect(mw.checkPermission('unknown-agent', 'read', 'entity')).toBe(true);
      expect(mw.checkPermission('unknown-agent', 'write', 'entity')).toBe(false);
    });

    it('explicit defaultRole=undefined denies unregistered agents entirely', async () => {
      const store = new RoleAssignmentStore();
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      expect(mw.checkPermission('unknown-agent', 'read', 'entity')).toBe(false);
    });

    it('expired assignment falls through to default role', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({
        agentId: 'alice', role: 'admin',
        validUntil: '2024-01-01T00:00:00Z',
      });
      const mw = new RbacMiddleware(store); // default 'reader'
      // After expiry: admin is gone, defaultRole reader applies
      expect(mw.checkPermission('alice', 'read', 'entity', undefined, '2025-06-15T00:00:00Z')).toBe(true);
      expect(mw.checkPermission('alice', 'delete', 'entity', undefined, '2025-06-15T00:00:00Z')).toBe(false);
    });

    it('multiple grants compose — any matching grant suffices', async () => {
      const store = new RoleAssignmentStore();
      await store.assign({ agentId: 'alice', role: 'reader', resourceType: 'entity' });
      await store.assign({ agentId: 'alice', role: 'writer', resourceType: 'entity', scope: 'admin:' });
      const mw = new RbacMiddleware(store, { defaultRole: undefined });
      // Reader grant gives read for any entity
      expect(mw.checkPermission('alice', 'read', 'entity', 'foo:bar')).toBe(true);
      // Writer grant only fires on 'admin:' prefix
      expect(mw.checkPermission('alice', 'write', 'entity', 'admin:bar')).toBe(true);
      expect(mw.checkPermission('alice', 'write', 'entity', 'foo:bar')).toBe(false);
    });
  });
});
