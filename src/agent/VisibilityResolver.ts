/**
 * Visibility Resolver
 *
 * Centralises access-control logic for the five memory-visibility tiers:
 * private | team | org | shared | public
 *
 * Rules (evaluated in order; first match wins):
 * 0. **Time-window gate (η.5.5.b)** — if `visibleFrom` is in the future
 *    or `visibleUntil` is in the past, deny everyone (including owner).
 * 1. Owner always has access (subject to gate 0).
 * 2. public  → any agent (including unregistered / no metadata) has access.
 * 3. shared  → any registered agent has access.
 * 4. org     → agents that share the same org have access.
 * 5. team    → agents that share at least one team have access.
 * 6. private → no other agent has access.
 *
 * **Role gate (η.5.5.b)** — when `allowedRoles` is set on the memory, an
 * additional AND check applies AFTER any `true` result from rules 1-5
 * (except gate 0): the requesting agent's `role` must appear in the list.
 * Tightens, never widens. The owner is exempt (an agent should never lock
 * itself out of its own data).
 *
 * @module agent/VisibilityResolver
 */

import type { AgentEntity, AgentMetadata } from '../types/agent-memory.js';

/**
 * Determines whether a requesting agent may access a given memory.
 *
 * @example
 * ```typescript
 * const resolver = new VisibilityResolver();
 * const allowed = resolver.canAccess(memory, 'agent_b', agentBMeta, ownerMeta);
 * ```
 */
export class VisibilityResolver {
  /**
   * Evaluate whether `requestingAgentId` can access `memory`.
   *
   * @param memory            - The memory being accessed
   * @param requestingAgentId - ID of the agent requesting access
   * @param requestingMeta    - Metadata for the requesting agent (undefined = unregistered)
   * @param ownerMeta         - Metadata for the owning agent (undefined = unknown owner)
   * @param now               - Override for the current time (ISO 8601). Defaults
   *                            to `new Date().toISOString()`. Useful for tests
   *                            and for evaluating access at a hypothetical time.
   * @returns True if access is permitted
   */
  canAccess(
    memory: AgentEntity,
    requestingAgentId: string,
    requestingMeta: AgentMetadata | undefined,
    ownerMeta: AgentMetadata | undefined,
    now?: string,
  ): boolean {
    // Gate 0: time-window check. Applied unconditionally — denies even
    // the owner when the memory is outside its visibility window.
    const currentTime = now ?? new Date().toISOString();
    if (memory.visibleFrom && memory.visibleFrom > currentTime) return false;
    if (memory.visibleUntil && memory.visibleUntil < currentTime) return false;

    // Rule 1: Owner always has access (subject to gate 0)
    if (memory.agentId === requestingAgentId) {
      return true;
    }

    // Default undefined/empty visibility to 'private' to fail-safe
    const visibility: string = memory.visibility ?? 'private';

    // Determine baseline level grant
    let levelGrant = false;
    if (visibility === 'public') {
      levelGrant = true;
    } else if (!requestingMeta) {
      // Rules 3-5 require registered metadata
      return false;
    } else if (visibility === 'shared') {
      levelGrant = true;
    } else if (visibility === 'org') {
      const requesterOrg = requestingMeta.groupMembership?.org;
      const ownerOrg = ownerMeta?.groupMembership?.org;
      levelGrant = !!requesterOrg && !!ownerOrg && requesterOrg === ownerOrg;
    } else if (visibility === 'team') {
      const requesterTeams = requestingMeta.groupMembership?.teams ?? [];
      const ownerTeams = ownerMeta?.groupMembership?.teams ?? [];
      levelGrant = requesterTeams.length > 0
        && ownerTeams.length > 0
        && requesterTeams.some((t) => ownerTeams.includes(t));
    }
    // visibility === 'private' (or unknown) leaves levelGrant = false

    if (!levelGrant) return false;

    // η.5.5.b role gate — tightens, never widens. Empty/missing list ⇒ no gate.
    if (memory.allowedRoles && memory.allowedRoles.length > 0) {
      const role = requestingMeta?.role;
      if (!role || !memory.allowedRoles.includes(role)) return false;
    }

    return true;
  }
}
