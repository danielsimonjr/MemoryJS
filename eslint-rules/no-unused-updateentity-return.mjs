/**
 * ESLint rule: no-unused-updateentity-return
 *
 * Flags any `storage.updateEntity(...)` call whose `Promise<boolean>` result
 * is discarded. The boolean signals whether the entity still existed at
 * write time — `false` means it vanished mid-update (concurrent delete,
 * governance rollback, segment-mode flush). Silently dropping it is the
 * recurring "silent-failure" regression caught by review agents across
 * Phase 2 Sprints 2/4/5/8.
 *
 * **Name-based, not type-based.** The rule matches `updateEntity` calls
 * whose receiver resolves to a `storage`-named object (`storage`,
 * `this.storage`, `this.deps.storage`, `<anything>.storage`). It deliberately
 * does NOT flag `entityManager.updateEntity(...)` — that method returns the
 * updated `Entity` (or throws), a different contract. Every current call
 * site in `src/` uses one of the matched receiver patterns; a future site
 * with a differently-named storage handle would need the receiver list
 * extended here.
 *
 * A result is "used" when the call (or the `await` wrapping it) is NOT the
 * direct child of an `ExpressionStatement` — i.e. it is assigned, returned,
 * branched on, or composed into a larger expression.
 *
 * Intentional discards (fire-and-forget metadata writes where a vanished
 * entity is genuinely don't-care) must be marked with an inline
 * `// eslint-disable-next-line memoryjs/no-unused-updateentity-return`
 * plus a one-line reason — making every discard a conscious decision.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow discarding the boolean returned by storage.updateEntity()',
    },
    messages: {
      unusedReturn:
        "Unused 'storage.updateEntity()' return: the boolean signals whether the entity still existed (false = vanished mid-update). Branch on it, return it, or assign it. If the discard is intentional, add an eslint-disable comment with a reason.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'updateEntity'
        ) {
          return;
        }
        if (!isStorageReceiver(callee.object)) return;

        // Unwrap a single `await` so `await storage.updateEntity(...)` is
        // judged by what consumes the awaited value.
        let consumed = node;
        let parent = consumed.parent;
        if (parent && parent.type === 'AwaitExpression') {
          consumed = parent;
          parent = consumed.parent;
        }

        // The result is discarded iff the call/await is a bare statement.
        if (parent && parent.type === 'ExpressionStatement') {
          context.report({ node, messageId: 'unusedReturn' });
        }
      },
    };
  },
};

/**
 * True when `obj` is a `storage`-named receiver:
 * - bare identifier `storage`
 * - any member access ending in `.storage` (`this.storage`,
 *   `this.deps.storage`, `foo.storage`, ...)
 */
function isStorageReceiver(obj) {
  if (obj.type === 'Identifier') {
    return obj.name === 'storage';
  }
  if (obj.type === 'MemberExpression') {
    return (
      obj.property.type === 'Identifier' && obj.property.name === 'storage'
    );
  }
  return false;
}
