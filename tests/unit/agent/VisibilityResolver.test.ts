/**
 * VisibilityResolver Unit Tests
 *
 * Tests for S8 — Shared Memory Visibility Hierarchies.
 */

import { describe, it, expect } from 'vitest';
import { VisibilityResolver } from '../../../src/agent/VisibilityResolver.js';
import type { AgentEntity, AgentMetadata } from '../../../src/types/agent-memory.js';

// ==================== Helpers ====================

function makeMemory(
  agentId: string,
  visibility: AgentEntity['visibility'],
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  return {
    name: `mem_${agentId}_${visibility}`,
    entityType: 'memory',
    observations: ['some observation'],
    memoryType: 'semantic',
    accessCount: 0,
    confidence: 0.8,
    confirmationCount: 0,
    visibility,
    agentId,
    ...overrides,
  } as AgentEntity;
}

function makeMeta(
  name: string,
  teams?: string[],
  org?: string,
  overrides: Partial<AgentMetadata> = {}
): AgentMetadata {
  return {
    name,
    type: 'llm',
    trustLevel: 0.8,
    capabilities: ['read', 'write'],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    groupMembership: { teams, org },
    ...overrides,
  };
}

// ==================== Tests ====================

describe('VisibilityResolver', () => {
  const resolver = new VisibilityResolver();

  // -------------------- Rule 1: Owner always has access --------------------

  describe('owner access', () => {
    it('owner can access their own private memory', () => {
      const memory = makeMemory('agent_a', 'private');
      expect(resolver.canAccess(memory, 'agent_a', makeMeta('A'), makeMeta('A'))).toBe(true);
    });

    it('owner can access their own team memory', () => {
      const memory = makeMemory('agent_a', 'team');
      expect(resolver.canAccess(memory, 'agent_a', makeMeta('A'), makeMeta('A'))).toBe(true);
    });

    it('owner can access their own org memory', () => {
      const memory = makeMemory('agent_a', 'org');
      expect(resolver.canAccess(memory, 'agent_a', makeMeta('A'), makeMeta('A'))).toBe(true);
    });

    it('owner can access their own shared memory', () => {
      const memory = makeMemory('agent_a', 'shared');
      expect(resolver.canAccess(memory, 'agent_a', makeMeta('A'), makeMeta('A'))).toBe(true);
    });

    it('owner can access their own public memory', () => {
      const memory = makeMemory('agent_a', 'public');
      expect(resolver.canAccess(memory, 'agent_a', makeMeta('A'), makeMeta('A'))).toBe(true);
    });
  });

  // -------------------- Rule 2: public --------------------

  describe('public visibility', () => {
    it('registered agent can access public memory', () => {
      const memory = makeMemory('agent_a', 'public');
      expect(resolver.canAccess(memory, 'agent_b', makeMeta('B'), makeMeta('A'))).toBe(true);
    });

    it('unregistered agent (undefined meta) can access public memory', () => {
      const memory = makeMemory('agent_a', 'public');
      expect(resolver.canAccess(memory, 'unknown_agent', undefined, makeMeta('A'))).toBe(true);
    });

    it('agent with no group membership can access public memory', () => {
      const memory = makeMemory('agent_a', 'public');
      const noGroupMeta: AgentMetadata = makeMeta('B');
      delete noGroupMeta.groupMembership;
      expect(resolver.canAccess(memory, 'agent_b', noGroupMeta, makeMeta('A'))).toBe(true);
    });
  });

  // -------------------- Rule 3: private --------------------

  describe('private visibility', () => {
    it('non-owner registered agent cannot access private memory', () => {
      const memory = makeMemory('agent_a', 'private');
      expect(resolver.canAccess(memory, 'agent_b', makeMeta('B'), makeMeta('A'))).toBe(false);
    });

    it('unregistered agent cannot access private memory', () => {
      const memory = makeMemory('agent_a', 'private');
      expect(resolver.canAccess(memory, 'stranger', undefined, makeMeta('A'))).toBe(false);
    });

    it('agent with no group membership cannot access private memory', () => {
      const memory = makeMemory('agent_a', 'private');
      const noGroupMeta = makeMeta('B');
      delete noGroupMeta.groupMembership;
      expect(resolver.canAccess(memory, 'agent_b', noGroupMeta, makeMeta('A'))).toBe(false);
    });
  });

  // -------------------- Rule 4: shared --------------------

  describe('shared visibility', () => {
    it('registered agent can access shared memory from another agent', () => {
      const memory = makeMemory('agent_a', 'shared');
      expect(resolver.canAccess(memory, 'agent_b', makeMeta('B'), makeMeta('A'))).toBe(true);
    });

    it('unregistered agent (no metadata) cannot access shared memory', () => {
      const memory = makeMemory('agent_a', 'shared');
      expect(resolver.canAccess(memory, 'stranger', undefined, makeMeta('A'))).toBe(false);
    });

    it('third agent with metadata can also access shared memory', () => {
      const memory = makeMemory('agent_a', 'shared');
      expect(resolver.canAccess(memory, 'agent_c', makeMeta('C'), makeMeta('A'))).toBe(true);
    });
  });

  // -------------------- Rule 5: org --------------------

  describe('org visibility', () => {
    it('same-org agent can access org memory', () => {
      const memory = makeMemory('agent_a', 'org');
      const requester = makeMeta('B', [], 'acme');
      const owner = makeMeta('A', [], 'acme');
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(true);
    });

    it('different-org agent cannot access org memory', () => {
      const memory = makeMemory('agent_a', 'org');
      const requester = makeMeta('B', [], 'beta-corp');
      const owner = makeMeta('A', [], 'acme');
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('agent with no org cannot access org memory', () => {
      const memory = makeMemory('agent_a', 'org');
      const requester = makeMeta('B'); // no org
      const owner = makeMeta('A', [], 'acme');
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('owner with no org means no org access for others', () => {
      const memory = makeMemory('agent_a', 'org');
      const requester = makeMeta('B', [], 'acme');
      const owner = makeMeta('A'); // no org
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('unregistered requester cannot access org memory', () => {
      const memory = makeMemory('agent_a', 'org');
      const owner = makeMeta('A', [], 'acme');
      expect(resolver.canAccess(memory, 'stranger', undefined, owner)).toBe(false);
    });

    it('org check is case-sensitive', () => {
      const memory = makeMemory('agent_a', 'org');
      const requester = makeMeta('B', [], 'ACME');
      const owner = makeMeta('A', [], 'acme');
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });
  });

  // -------------------- Rule 6: team --------------------

  describe('team visibility', () => {
    it('agent sharing a team can access team memory', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', ['engineering', 'product'], 'acme');
      const owner = makeMeta('A', ['engineering'], 'acme');
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(true);
    });

    it('agent not sharing any team cannot access team memory', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', ['marketing'], 'acme');
      const owner = makeMeta('A', ['engineering'], 'acme');
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('agent with no teams cannot access team memory', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B'); // no teams
      const owner = makeMeta('A', ['engineering']);
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('owner with no teams means no team access for others', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', ['engineering']);
      const owner = makeMeta('A'); // no teams
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('unregistered requester cannot access team memory', () => {
      const memory = makeMemory('agent_a', 'team');
      const owner = makeMeta('A', ['engineering']);
      expect(resolver.canAccess(memory, 'stranger', undefined, owner)).toBe(false);
    });

    it('team check handles empty teams array on owner', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', ['engineering']);
      const owner = makeMeta('A', []); // empty teams
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('team check handles empty teams array on requester', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', []); // empty teams
      const owner = makeMeta('A', ['engineering']);
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(false);
    });

    it('multiple team overlap — only one shared team is sufficient', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', ['alpha', 'beta', 'gamma']);
      const owner = makeMeta('A', ['gamma', 'delta']);
      expect(resolver.canAccess(memory, 'agent_b', requester, owner)).toBe(true);
    });
  });

  // -------------------- Edge cases --------------------

  describe('edge cases', () => {
    it('memory with no agentId (undefined owner) — owner check fails, rules still apply', () => {
      const memory: AgentEntity = {
        name: 'orphan',
        entityType: 'memory',
        observations: [],
        memoryType: 'semantic',
        accessCount: 0,
        confidence: 0.5,
        confirmationCount: 0,
        visibility: 'public',
        // agentId intentionally omitted
      };
      // public → anyone can access
      expect(resolver.canAccess(memory, 'agent_b', makeMeta('B'), undefined)).toBe(true);
    });

    it('memory with no agentId and private visibility → non-owner denied', () => {
      const memory: AgentEntity = {
        name: 'orphan_private',
        entityType: 'memory',
        observations: [],
        memoryType: 'semantic',
        accessCount: 0,
        confidence: 0.5,
        confirmationCount: 0,
        visibility: 'private',
        // agentId intentionally omitted
      };
      expect(resolver.canAccess(memory, 'agent_b', makeMeta('B'), undefined)).toBe(false);
    });

    it('owner undefined ownerMeta does not break org check', () => {
      const memory = makeMemory('agent_a', 'org');
      const requester = makeMeta('B', [], 'acme');
      // ownerMeta is undefined
      expect(resolver.canAccess(memory, 'agent_b', requester, undefined)).toBe(false);
    });

    it('owner undefined ownerMeta does not break team check', () => {
      const memory = makeMemory('agent_a', 'team');
      const requester = makeMeta('B', ['engineering']);
      expect(resolver.canAccess(memory, 'agent_b', requester, undefined)).toBe(false);
    });

    it('canAccess is not transitive — A can see B, B can see C, A need not see C', () => {
      // A owns a team memory on team 'alpha'; C is on team 'beta' only
      const memoryA = makeMemory('agent_a', 'team');
      const metaA = makeMeta('A', ['alpha']);
      const metaB = makeMeta('B', ['alpha', 'beta']);
      const metaC = makeMeta('C', ['beta']);

      // B can see A's team memory (shares 'alpha')
      expect(resolver.canAccess(memoryA, 'agent_b', metaB, metaA)).toBe(true);
      // C cannot see A's team memory (no shared team with A)
      expect(resolver.canAccess(memoryA, 'agent_c', metaC, metaA)).toBe(false);
    });
  });

  // ==================== η.5.5.b: Visibility Hierarchy Expansion ====================

  describe('η.5.5.b time-window gate', () => {
    const resolver = new VisibilityResolver();

    it('denies access before visibleFrom — even to the owner', () => {
      const memory = makeMemory('agent_a', 'public', {
        visibleFrom: '2026-06-01T00:00:00Z',
      });
      const ownerMeta = makeMeta('A');
      const allowed = resolver.canAccess(
        memory, 'agent_a', ownerMeta, ownerMeta, '2026-01-01T00:00:00Z',
      );
      expect(allowed).toBe(false);
    });

    it('allows access when current time is inside the window', () => {
      const memory = makeMemory('agent_a', 'public', {
        visibleFrom: '2024-01-01T00:00:00Z',
        visibleUntil: '2026-12-31T00:00:00Z',
      });
      const ownerMeta = makeMeta('A');
      const allowed = resolver.canAccess(
        memory, 'agent_b', undefined, ownerMeta, '2025-06-15T00:00:00Z',
      );
      expect(allowed).toBe(true);
    });

    it('denies access after visibleUntil — including to the owner', () => {
      const memory = makeMemory('agent_a', 'public', {
        visibleUntil: '2024-12-31T00:00:00Z',
      });
      const ownerMeta = makeMeta('A');
      const allowed = resolver.canAccess(
        memory, 'agent_a', ownerMeta, ownerMeta, '2025-06-15T00:00:00Z',
      );
      expect(allowed).toBe(false);
    });

    it('treats absent visibleFrom/visibleUntil as unbounded (current behaviour preserved)', () => {
      const memory = makeMemory('agent_a', 'public');
      const ownerMeta = makeMeta('A');
      const allowed = resolver.canAccess(
        memory, 'agent_b', undefined, ownerMeta, '2099-01-01T00:00:00Z',
      );
      expect(allowed).toBe(true);
    });
  });

  describe('η.5.5.b allowedRoles predicate', () => {
    const resolver = new VisibilityResolver();

    it('grants access when requesting agent role is in allowedRoles', () => {
      const memory = makeMemory('agent_a', 'shared', {
        allowedRoles: ['admin', 'reviewer'],
      });
      const ownerMeta = makeMeta('A');
      const reviewer = makeMeta('B', undefined, undefined, { role: 'reviewer' });
      expect(resolver.canAccess(memory, 'agent_b', reviewer, ownerMeta)).toBe(true);
    });

    it('denies access when requesting agent role is NOT in allowedRoles', () => {
      const memory = makeMemory('agent_a', 'shared', {
        allowedRoles: ['admin'],
      });
      const ownerMeta = makeMeta('A');
      const reader = makeMeta('B', undefined, undefined, { role: 'reader' });
      expect(resolver.canAccess(memory, 'agent_b', reader, ownerMeta)).toBe(false);
    });

    it('denies access when requesting agent has no role at all', () => {
      const memory = makeMemory('agent_a', 'shared', {
        allowedRoles: ['admin'],
      });
      const ownerMeta = makeMeta('A');
      const noRole = makeMeta('B'); // no role field
      expect(resolver.canAccess(memory, 'agent_b', noRole, ownerMeta)).toBe(false);
    });

    it('tightens, never widens — a private memory with allowedRoles is still private to others', () => {
      // INVARIANT: allowedRoles can only narrow access. A 'private' memory
      // remains inaccessible to non-owners even if their role matches.
      const memory = makeMemory('agent_a', 'private', {
        allowedRoles: ['admin'],
      });
      const ownerMeta = makeMeta('A');
      const admin = makeMeta('B', undefined, undefined, { role: 'admin' });
      expect(resolver.canAccess(memory, 'agent_b', admin, ownerMeta)).toBe(false);
    });

    it('does not gate the owner — owner access is independent of allowedRoles', () => {
      const memory = makeMemory('agent_a', 'shared', {
        allowedRoles: ['nobody'], // owner's role is not in the list
      });
      const ownerMeta = makeMeta('A', undefined, undefined, { role: 'creator' });
      // INVARIANT: an agent never locks itself out of its own data.
      expect(resolver.canAccess(memory, 'agent_a', ownerMeta, ownerMeta)).toBe(true);
    });

    it('an empty allowedRoles list is treated as no gate (matches absent field)', () => {
      const memory = makeMemory('agent_a', 'shared', { allowedRoles: [] });
      const ownerMeta = makeMeta('A');
      const reader = makeMeta('B', undefined, undefined, { role: 'reader' });
      expect(resolver.canAccess(memory, 'agent_b', reader, ownerMeta)).toBe(true);
    });
  });

  describe('η.5.5.b time-window AND role gate composition', () => {
    const resolver = new VisibilityResolver();

    it('denies when time-window passes but role gate fails', () => {
      const memory = makeMemory('agent_a', 'shared', {
        visibleFrom: '2024-01-01T00:00:00Z',
        visibleUntil: '2026-12-31T00:00:00Z',
        allowedRoles: ['admin'],
      });
      const ownerMeta = makeMeta('A');
      const reader = makeMeta('B', undefined, undefined, { role: 'reader' });
      const allowed = resolver.canAccess(
        memory, 'agent_b', reader, ownerMeta, '2025-06-15T00:00:00Z',
      );
      expect(allowed).toBe(false);
    });

    it('denies when role gate would pass but time-window fails', () => {
      const memory = makeMemory('agent_a', 'shared', {
        visibleUntil: '2024-12-31T00:00:00Z',
        allowedRoles: ['admin'],
      });
      const ownerMeta = makeMeta('A');
      const admin = makeMeta('B', undefined, undefined, { role: 'admin' });
      const allowed = resolver.canAccess(
        memory, 'agent_b', admin, ownerMeta, '2025-06-15T00:00:00Z',
      );
      expect(allowed).toBe(false);
    });

    it('grants when both gates pass', () => {
      const memory = makeMemory('agent_a', 'shared', {
        visibleFrom: '2024-01-01T00:00:00Z',
        visibleUntil: '2026-12-31T00:00:00Z',
        allowedRoles: ['admin'],
      });
      const ownerMeta = makeMeta('A');
      const admin = makeMeta('B', undefined, undefined, { role: 'admin' });
      const allowed = resolver.canAccess(
        memory, 'agent_b', admin, ownerMeta, '2025-06-15T00:00:00Z',
      );
      expect(allowed).toBe(true);
    });
  });
});
