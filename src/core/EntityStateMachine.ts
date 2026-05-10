/**
 * Entity State Machine
 *
 * Lifecycle state transitions for `Entity.status`. Provides a runtime
 * guard so callers can validate `from → to` before mutating storage, and
 * a small helper API for the typical workflow (draft → published →
 * archived → published).
 *
 * The set of legal transitions lives in `ENTITY_STATUS_TRANSITIONS` in
 * `src/types/types.ts` so non-state-machine code can introspect it.
 *
 * @module core/EntityStateMachine
 */

import { ENTITY_STATUS_TRANSITIONS, type EntityStatus } from '../types/types.js';

/** Default status for entities that predate the state-machine field. */
export const DEFAULT_ENTITY_STATUS: EntityStatus = 'published';

/**
 * Coerce a possibly-undefined status (e.g. from a pre-Phase-1 entity) to
 * a concrete `EntityStatus`. Centralised so back-compat behaviour can be
 * changed in one place.
 */
export function effectiveStatus(status: EntityStatus | undefined): EntityStatus {
  return status ?? DEFAULT_ENTITY_STATUS;
}

/**
 * Whether `from → to` is a legal status transition.
 */
export function canTransition(from: EntityStatus, to: EntityStatus): boolean {
  if (from === to) return true; // No-op transitions are always legal.
  return ENTITY_STATUS_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * Thrown when `EntityStateMachine.transition` rejects an illegal transition.
 */
export class IllegalStatusTransitionError extends Error {
  constructor(public readonly from: EntityStatus, public readonly to: EntityStatus, public readonly entityName?: string) {
    super(
      entityName
        ? `Illegal status transition for entity "${entityName}": ${from} → ${to}`
        : `Illegal status transition: ${from} → ${to}`,
    );
    this.name = 'IllegalStatusTransitionError';
  }
}

/**
 * Stateless validator for entity status transitions. Stateless on purpose
 * — the source of truth for an entity's status lives in storage; this
 * class just enforces the rules around what `from → to` pairs are valid.
 *
 * @example
 * ```typescript
 * const machine = new EntityStateMachine();
 * if (machine.canTransition(entity.status, 'published')) {
 *   await entityManager.updateEntity(entity.name, { status: 'published' });
 * }
 * ```
 */
export class EntityStateMachine {
  /**
   * Transitions allowed by this machine. Mirrors `ENTITY_STATUS_TRANSITIONS`.
   */
  readonly transitions: ReadonlyArray<readonly [EntityStatus, EntityStatus]> = ENTITY_STATUS_TRANSITIONS;

  /**
   * Whether `from → to` is legal.
   */
  canTransition(from: EntityStatus | undefined, to: EntityStatus): boolean {
    return canTransition(effectiveStatus(from), to);
  }

  /**
   * Validate a transition. Throws `IllegalStatusTransitionError` on
   * rejection; returns the resolved `from` status on success (useful when
   * the caller passed `undefined` and wants the back-compat default).
   */
  transition(from: EntityStatus | undefined, to: EntityStatus, entityName?: string): EntityStatus {
    const resolved = effectiveStatus(from);
    if (!canTransition(resolved, to)) {
      throw new IllegalStatusTransitionError(resolved, to, entityName);
    }
    return resolved;
  }

  /**
   * Convenience: list of `to` states reachable from `from`.
   */
  nextStates(from: EntityStatus | undefined): EntityStatus[] {
    const resolved = effectiveStatus(from);
    const next = new Set<EntityStatus>([resolved]); // self-transition always legal
    for (const [f, t] of this.transitions) {
      if (f === resolved) next.add(t);
    }
    return [...next];
  }
}
