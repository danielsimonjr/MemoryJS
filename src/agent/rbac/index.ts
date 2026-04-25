/**
 * RBAC Module — Barrel Export (η.6.1)
 *
 * @module agent/rbac
 */

export type {
  Role,
  Permission,
  ResourceType,
  RoleAssignment,
  RbacPolicy,
} from './RbacTypes.js';

export {
  DEFAULT_PERMISSION_MATRIX,
  permissionsForRole,
  type PermissionMatrix,
  type PermissionMatrixRow,
  type ResourcePermissionOverrides,
} from './PermissionMatrix.js';

export {
  RoleAssignmentStore,
  type RoleAssignmentStoreOptions,
} from './RoleAssignmentStore.js';

export {
  RbacMiddleware,
  type RbacMiddlewareOptions,
} from './RbacMiddleware.js';
