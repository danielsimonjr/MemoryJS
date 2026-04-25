/**
 * RBAC Types (η.6.1)
 *
 * Named roles with a reusable permission matrix, layered above the
 * five-tier visibility model (`VisibilityResolver`) and the policy hooks
 * on `GovernanceManager`. Role assignments are agent-scoped and optional
 * per resource type; the default matrix can be overridden per-grant.
 *
 * @module agent/rbac/RbacTypes
 */

/**
 * Built-in roles. Free-form strings are also accepted by
 * `RoleAssignmentStore` so callers can define domain-specific roles.
 */
export type Role = 'reader' | 'writer' | 'admin' | 'owner' | (string & {});

/** Operations that can be permission-checked. */
export type Permission = 'read' | 'write' | 'delete' | 'manage';

/** Resource types that can be permission-checked. */
export type ResourceType =
  | 'entity'
  | 'relation'
  | 'observation'
  | 'session'
  | 'artifact';

/**
 * Single role grant for one agent. Optional `resourceType` narrows the
 * grant to only that type (omit to apply to all resource types).
 * Optional `scope` narrows by entity name or namespace prefix.
 */
export interface RoleAssignment {
  /** ID of the agent this assignment applies to. */
  agentId: string;
  /** Granted role. */
  role: Role;
  /**
   * Resource type the role grants access to. When omitted, grant
   * applies across all resource types.
   */
  resourceType?: ResourceType;
  /**
   * Optional scope. When set, the grant only applies if the resource's
   * name starts with this prefix (e.g. `'project-x:'` or just an exact
   * entity name). Empty / omitted ⇒ no scope restriction.
   */
  scope?: string;
  /** ISO 8601 — when the assignment becomes active. Absent ⇒ active now. */
  validFrom?: string;
  /** ISO 8601 — when the assignment expires. Absent ⇒ no expiry. */
  validUntil?: string;
  /** Free-form notes (e.g. "granted by ticket #12345"). */
  notes?: string;
}

/**
 * RBAC policy contract. `RbacMiddleware` implements this; consumers can
 * also drop in their own policy if the default matrix is insufficient.
 */
export interface RbacPolicy {
  /**
   * Decide whether `agentId` can perform `action` against `resourceType`
   * for the named resource. Returns `true` to grant access.
   *
   * Implementations should fail-safe: when a question can't be answered
   * (no assignment, missing config), return `false`.
   */
  checkPermission(
    agentId: string,
    action: Permission,
    resourceType: ResourceType,
    resourceName?: string,
    now?: string,
  ): boolean;
}
