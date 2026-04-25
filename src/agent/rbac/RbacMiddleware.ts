/**
 * RBAC Middleware (η.6.1)
 *
 * `RbacPolicy` implementation that consults `RoleAssignmentStore` for the
 * requesting agent's active assignments, then applies `PermissionMatrix`
 * to decide grant/deny. Falls back to deny when no assignment matches.
 *
 * Designed to plug into `GovernanceManager.GovernancePolicy` so that
 * `canCreate`/`canUpdate`/`canDelete` are populated from RBAC by default.
 *
 * @module agent/rbac/RbacMiddleware
 */

import type {
  Permission,
  ResourceType,
  RbacPolicy,
  RoleAssignment,
} from './RbacTypes.js';
import {
  DEFAULT_PERMISSION_MATRIX,
  type PermissionMatrix,
  type ResourcePermissionOverrides,
  permissionsForRole,
} from './PermissionMatrix.js';
import type { RoleAssignmentStore } from './RoleAssignmentStore.js';

export interface RbacMiddlewareOptions {
  /** Custom matrix; defaults to `DEFAULT_PERMISSION_MATRIX`. */
  matrix?: PermissionMatrix;
  /** Per-resource-type overrides layered on top of `matrix`. */
  overrides?: ResourcePermissionOverrides;
  /**
   * Default role granted to agents with NO assignments. Defaults to
   * `'reader'` (read-only) — matches the
   * `MEMORY_RBAC_DEFAULT_ROLE` env var convention from CLAUDE.md.
   * Pass `undefined` to deny unregistered agents entirely.
   */
  defaultRole?: string;
}

export class RbacMiddleware implements RbacPolicy {
  private readonly matrix: PermissionMatrix;
  private readonly overrides?: ResourcePermissionOverrides;
  private readonly defaultRole: string | undefined;

  constructor(
    private readonly store: RoleAssignmentStore,
    options?: RbacMiddlewareOptions,
  ) {
    this.matrix = options?.matrix ?? DEFAULT_PERMISSION_MATRIX;
    this.overrides = options?.overrides;
    this.defaultRole = options?.defaultRole === undefined && options !== undefined
      ? options.defaultRole // explicit `undefined` ⇒ no default role (deny)
      : options?.defaultRole ?? 'reader';
  }

  checkPermission(
    agentId: string,
    action: Permission,
    resourceType: ResourceType,
    resourceName?: string,
    now?: string,
  ): boolean {
    const active = this.store.listActive(agentId, now);

    // Filter assignments to those matching this resourceType (exact match)
    // OR no resourceType (universal grant).
    const applicable = active.filter(a => this.matchesResource(a, resourceType, resourceName));

    if (applicable.length === 0) {
      // Apply default role if configured.
      if (!this.defaultRole) return false;
      const granted = permissionsForRole(this.defaultRole, resourceType, this.matrix, this.overrides);
      return granted.includes(action);
    }

    // Any matching assignment that grants `action` is sufficient.
    return applicable.some(a => {
      const granted = permissionsForRole(a.role, resourceType, this.matrix, this.overrides);
      return granted.includes(action);
    });
  }

  private matchesResource(
    assignment: RoleAssignment,
    resourceType: ResourceType,
    resourceName?: string,
  ): boolean {
    // Resource-type match: exact OR universal (undefined).
    if (assignment.resourceType !== undefined && assignment.resourceType !== resourceType) {
      return false;
    }
    // Scope match: prefix when set.
    if (assignment.scope) {
      if (!resourceName) return false;
      if (!resourceName.startsWith(assignment.scope)) return false;
    }
    return true;
  }
}
