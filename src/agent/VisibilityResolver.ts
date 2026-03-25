/**
 * Visibility Resolver
 *
 * Centralises access-control logic for the five memory-visibility tiers:
 * private | team | org | shared | public
 *
 * Rules (evaluated in order; first match wins):
 * 1. Owner always has access.
 * 2. public  → any agent (including unregistered / no metadata) has access.
 * 3. shared  → any registered agent has access.
 * 4. org     → agents that share the same org have access.
 * 5. team    → agents that share at least one team have access.
 * 6. private → no other agent has access.
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
   * @returns True if access is permitted
   */
  canAccess(
    memory: AgentEntity,
    requestingAgentId: string,
    requestingMeta: AgentMetadata | undefined,
    ownerMeta: AgentMetadata | undefined
  ): boolean {
    // Rule 1: Owner always has access
    if (memory.agentId === requestingAgentId) {
      return true;
    }

    // Default undefined/empty visibility to 'private' to fail-safe
    const visibility: string = memory.visibility ?? 'private';

    // Rule 2: public — anyone can access
    if (visibility === 'public') {
      return true;
    }

    // Rules 3-5 require the requesting agent to be registered (has metadata)
    if (!requestingMeta) {
      return false;
    }

    // Rule 3: shared — any registered agent
    if (visibility === 'shared') {
      return true;
    }

    // Rule 4: org — same organisation
    if (visibility === 'org') {
      const requesterOrg = requestingMeta.groupMembership?.org;
      const ownerOrg = ownerMeta?.groupMembership?.org;
      if (!requesterOrg || !ownerOrg) return false;
      return requesterOrg === ownerOrg;
    }

    // Rule 5: team — at least one shared team
    if (visibility === 'team') {
      const requesterTeams = requestingMeta.groupMembership?.teams ?? [];
      const ownerTeams = ownerMeta?.groupMembership?.teams ?? [];
      if (requesterTeams.length === 0 || ownerTeams.length === 0) return false;
      return requesterTeams.some((t) => ownerTeams.includes(t));
    }

    // Rule 6: private — no access for others
    return false;
  }
}
