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
    const applicable = this.rules.filter(
      (r) => r.action === '*' || r.action === context.action,
    );
    if (applicable.length === 0) return 'not-applicable';

    let matched: ABACRule[] = [];
    for (const rule of applicable) {
      if (this.matches(rule, context)) matched.push(rule);
    }
    if (matched.length === 0) return 'not-applicable';

    // Sort by priority descending, then deny before permit.
    matched.sort((a, b) => {
      const ap = a.priority ?? 0;
      const bp = b.priority ?? 0;
      if (ap !== bp) return bp - ap;
      if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1;
      return 0;
    });
    return matched[0]!.effect;
  }

  private matches(rule: ABACRule, context: ABACContext): boolean {
    if (!rule.conditions || rule.conditions.length === 0) return true;
    for (const cond of rule.conditions) {
      if (!evalCondition(cond, context)) return false;
    }
    return true;
  }
}

// ==================== Condition evaluation ====================

function evalCondition(cond: ABACCondition, context: ABACContext): boolean {
  const flat = flatten(context);
  const left = flat[cond.attribute];

  switch (cond.op) {
    case 'eq':
      return left === cond.value;
    case 'neq':
      return left !== cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(left);
    case 'not-in':
      return Array.isArray(cond.value) && !cond.value.includes(left);
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

function flatten(ctx: ABACContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out['action'] = ctx.action;
  flattenInto(ctx.subject, 'subject', out);
  flattenInto(ctx.resource, 'resource', out);
  if (ctx.environment) flattenInto(ctx.environment, 'environment', out);
  return out;
}

function flattenInto(obj: Record<string, unknown>, prefix: string, out: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}.${k}`;
    out[key] = v;
    // Recurse one level into nested objects so policies can reference
    // `subject.team.name` etc. Stop at arrays / primitives to keep
    // operator semantics (`contains`, `in`) on arrays intact.
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenInto(v as Record<string, unknown>, key, out);
    }
  }
}
