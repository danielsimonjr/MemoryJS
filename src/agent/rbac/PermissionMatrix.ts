/**
 * Permission Matrix (η.6.1)
 *
 * Default permission grants per role. Tightens monotonically with the
 * role hierarchy: `reader` < `writer` < `admin` < `owner`. Consumers
 * can supply a fully-overridden matrix for domain-specific role models;
 * the defaults are designed to be safe out of the box.
 *
 * @module agent/rbac/PermissionMatrix
 */

import type { Permission, ResourceType, Role } from './RbacTypes.js';

/** Permission set granted to a role per resource type. */
export type PermissionMatrixRow = ReadonlyArray<Permission>;

/** Mapping from role to permissions. Keys are roles; values are sets. */
export type PermissionMatrix = ReadonlyMap<Role, PermissionMatrixRow>;

/** Per-resource-type override layered on top of the base matrix. */
export type ResourcePermissionOverrides = ReadonlyMap<
  ResourceType,
  PermissionMatrix
>;

/**
 * Default permission grants. Owner has every permission; admin can
 * read/write/delete but not manage (manage = grant other agents the
 * same role); writer can read+write; reader is read-only.
 */
export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = new Map<
  Role,
  PermissionMatrixRow
>([
  ['reader', ['read']],
  ['writer', ['read', 'write']],
  ['admin', ['read', 'write', 'delete']],
  ['owner', ['read', 'write', 'delete', 'manage']],
]);

/**
 * Look up granted permissions for a role, applying any per-resource
 * overrides. Returns the empty set when the role is unknown — fail-safe
 * default for free-form caller-defined roles that have no matrix entry.
 */
export function permissionsForRole(
  role: Role,
  resourceType: ResourceType,
  matrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX,
  overrides?: ResourcePermissionOverrides,
): PermissionMatrixRow {
  const overrideMatrix = overrides?.get(resourceType);
  if (overrideMatrix?.has(role)) {
    return overrideMatrix.get(role)!;
  }
  return matrix.get(role) ?? [];
}
