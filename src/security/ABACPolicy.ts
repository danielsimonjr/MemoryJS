/**
 * ABAC Policy
 *
 * Phase 5 step 54 (§14.1) — Attribute-Based Access Control. Extends
 * the existing RBAC layer (`src/agent/rbac/`) with attribute-driven
 * rules: a decision considers subject attrs, resource attrs, action,
 * and environment attrs simultaneously rather than a flat role
 * matrix.
 *
 * **No external deps.** Pure TS rule engine. Rule conditions are
 * boolean expressions over a flat `Record<string, unknown>` of
 * attribute paths.
 *
 * **When to use:** when the access policy needs to consider request
 * context (time of day, IP range, owning team, classification level)
 * beyond what a role-name lookup can express. For coarse `read /
 * write / admin` matrices, `RbacMiddleware` remains the simpler
 * option.
 *
 * @module security/ABACPolicy
 * @experimental Rule shape (`ABACRule`) may grow new condition
 *   operators in non-breaking ways; existing rules keep evaluating.
 */

/**
 * Thrown for malformed rule conditions encountered at evaluation
 * time (e.g. `op: 'in'` with a non-array value). Raises loudly
 * rather than silently denying because a misconfigured policy is a
 * security risk and the caller should fix the policy, not paper
 * over it.
 */
export class ABACPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ABACPolicyError';
  }
}

/** Outcome of a policy evaluation. */
export type ABACDecision = 'permit' | 'deny' | 'not-applicable';

/** Effect a rule produces when its conditions match. */
export type ABACEffect = 'permit' | 'deny';

/** All evaluation context flattened into one object. */
export interface ABACContext {
  subject: Record<string, unknown>;
  resource: Record<string, unknown>;
  action: string;
  environment?: Record<string, unknown>;
}

/** Comparison operators understood by rule conditions. */
export type ABACOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not-in'
  | 'contains'
  | 'starts-with'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'present'
  | 'absent';

/**
 * A single rule condition. `attribute` is a dotted path (e.g.
 * `subject.clearance` or `resource.tags`) into the `ABACContext`.
 */
export interface ABACCondition {
  attribute: string;
  op: ABACOp;
  /** Right-hand side. Required for most ops; ignored for `present`/`absent`. */
  value?: unknown;
}

export interface ABACRule {
  id: string;
  description?: string;
  effect: ABACEffect;
  /** Action this rule applies to (`*` matches everything). */
  action: string;
  /** All conditions must match (logical AND). */
  conditions?: ABACCondition[];
  /**
   * Optional priority. Higher wins on conflict; default 0. Equal
   * priority falls back to "deny beats permit" — the standard XACML
   * combining algorithm.
   */
  priority?: number;
}

/**
 * Attribute-based policy engine. Evaluates rules against an
 * `ABACContext` and returns `permit` / `deny` / `not-applicable`.
 *
 * **Combining algorithm:** highest-priority matching rule wins;
 * ties resolve to `deny` (deny-overrides). When no rule matches the
 * action, returns `not-applicable` — the caller decides whether the
 * default is allow-or-deny.
 *
 * @example
 * ```typescript
 * const policy = new ABACPolicy([
 *   {
 *     id: 'admins-can-do-anything',
 *     effect: 'permit',
 *     action: '*',
 *     conditions: [{ attribute: 'subject.role', op: 'eq', value: 'admin' }],
 *     priority: 100,
 *   },
 *   {
 *     id: 'block-classified-during-business-hours',
 *     effect: 'deny',
 *     action: 'read',
 *     conditions: [
 *       { attribute: 'resource.classification', op: 'eq', value: 'classified' },
 *       { attribute: 'environment.hour', op: 'lt', value: 9 },
 *     ],
 *   },
 * ]);
 * policy.evaluate({
 *   subject: { role: 'analyst' },
 *   resource: { classification: 'classified' },
 *   action: 'read',
 *   environment: { hour: 8 },
 * }); // 'deny'
 * ```
 */
export class ABACPolicy {
  constructor(private readonly rules: ABACRule[] = []) {}

  /** Register an additional rule at runtime. */
  addRule(rule: ABACRule): void {
    this.rules.push(rule);
  }

  /** Read-only view of the registered rules (for diagnostics). */
  listRules(): ReadonlyArray<Readonly<ABACRule>> {
    return this.rules;
  }

  evaluate(context: ABACContext): ABACDecision {
    let flat: Record<string, unknown> | undefined;
    let winner: ABACRule | undefined;
    for (const rule of this.rules) {
      if (rule.action !== '*' && rule.action !== context.action) continue;
      if (rule.conditions?.length) {
        // Flatten once per evaluation, only when a condition needs attributes.
        flat ??= flatten(context);
        if (!this.matches(rule, flat)) continue;
      }
      const priority = rule.priority ?? 0;
      const winningPriority = winner?.priority ?? 0;
      if (!winner || priority > winningPriority ||
          (priority === winningPriority && rule.effect === 'deny')) {
        winner = rule;
      }
    }
    return winner?.effect ?? 'not-applicable';
  }

  private matches(rule: ABACRule, flat: Record<string, unknown>): boolean {
    if (!rule.conditions || rule.conditions.length === 0) return true;
    for (const cond of rule.conditions) {
      if (!evalCondition(cond, flat)) return false;
    }
    return true;
  }
}

// ==================== Condition evaluation ====================

function evalCondition(cond: ABACCondition, flat: Record<string, unknown>): boolean {
  const left = flat[cond.attribute];

  switch (cond.op) {
    case 'eq':
      return left === cond.value;
    case 'neq':
      return left !== cond.value;
    case 'in':
      if (!Array.isArray(cond.value)) {
        throw new ABACPolicyError(
          `Rule condition op 'in' requires an array value, got ${typeof cond.value} for attribute '${cond.attribute}'`,
        );
      }
      return cond.value.includes(left);
    case 'not-in':
      if (!Array.isArray(cond.value)) {
        throw new ABACPolicyError(
          `Rule condition op 'not-in' requires an array value, got ${typeof cond.value} for attribute '${cond.attribute}'`,
        );
      }
      return !cond.value.includes(left);
    case 'contains':
      if (Array.isArray(left)) return left.includes(cond.value);
      if (typeof left === 'string' && typeof cond.value === 'string') {
        return left.includes(cond.value);
      }
      return false;
    case 'starts-with':
      return typeof left === 'string' && typeof cond.value === 'string' && left.startsWith(cond.value);
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      if (typeof left !== 'number' || typeof cond.value !== 'number') return false;
      if (cond.op === 'lt') return left < cond.value;
      if (cond.op === 'lte') return left <= cond.value;
      if (cond.op === 'gt') return left > cond.value;
      return left >= cond.value;
    case 'present':
      return left !== undefined && left !== null;
    case 'absent':
      return left === undefined || left === null;
  }
}

/**
 * Maximum recursion depth for `flatten`. Caps the cost of
 * pathologically deep subject/resource trees and stops cycles dead
 * in their tracks (paired with the `visited` set below). Four levels
 * is enough to support real-world policies like
 * `subject.org.team.name`.
 */
const FLATTEN_MAX_DEPTH = 4;

function flatten(ctx: ABACContext): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  out['action'] = ctx.action;
  const visited = new WeakSet<object>();
  flattenInto(ctx.subject, 'subject', out, visited, 0);
  flattenInto(ctx.resource, 'resource', out, visited, 0);
  if (ctx.environment) flattenInto(ctx.environment, 'environment', out, visited, 0);
  return out;
}

function flattenInto(
  obj: Record<string, unknown>,
  prefix: string,
  out: Record<string, unknown>,
  visited: WeakSet<object>,
  depth: number,
): void {
  if (depth > FLATTEN_MAX_DEPTH) return;
  if (visited.has(obj)) return;
  visited.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}.${k}`;
    out[key] = v;
    // Recurse into nested non-array objects so policies can reference
    // `subject.team.name` etc. Stop at arrays so operator semantics
    // (`contains`, `in`) on arrays remain intact, and bail on depth /
    // cycle to keep evaluation O(unique-attributes).
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenInto(v as Record<string, unknown>, key, out, visited, depth + 1);
    }
  }
  // Track ancestors, not every object ever seen: shared references have a
  // distinct valid path under each subject/resource attribute.
  visited.delete(obj);
}
