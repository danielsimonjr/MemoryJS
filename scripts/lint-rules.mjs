// The two project lint rules, as pure functions over (filename, source).
//
// Split out from check-lint-rules.mjs so they are DIRECTLY TESTABLE. The rules
// previously lived in an ESLint plugin with its own RuleTester suite; when the plugin
// went, that coverage would have gone with it. tests/unit/lint-rules/ now drives these
// functions with the same cases.
//
// WHY A PARSER LIBRARY, given the standing rule to prefer what TypeScript or Bun
// already provide: neither can do this, measured rather than assumed --
//   Bun.Transpiler.scanImports('import { a } from "../core/x.js"; a();')
//     -> [{ kind: 'import-statement', path: '../core/x.js' }]   (the scanner works)
//   ... on `import type { X } from "../core/x.js"`               -> []
//   ... on `type A = import("../agent/y.js").Y`                  -> []
// Bun erases both TYPE forms before it looks, and those are exactly what rule 1
// exists to catch. Bun exposes no AST either (scan / scanImports / transform only), so
// rule 2 -- "is this call's return value used?" -- is unanswerable there. TypeScript 7
// does not ship its programmatic Compiler API. oxc-parser is the SAME engine oxlint
// already runs in this repo, so it is not a new ecosystem.
import { parseSync } from "oxc-parser";

/** Implementation directories that src/types must never reach into (S10). */
export const IMPLEMENTATION_DIRS = [
  "agent", "core", "utils", "search", "features",
  "adapters", "security", "cli", "workers",
];

/** Depth-first walk of an oxc AST, calling visit on every node object. */
function visitAll(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) visitAll(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type") continue;
    visitAll(node[key], visit);
  }
}

/** True when a module specifier reaches into an implementation directory. */
function reachesImplementation(spec) {
  return IMPLEMENTATION_DIRS.some((d) =>
    spec.includes(`/${d}/`) || spec.startsWith(`${d}/`) || spec.includes(`../${d}`),
  );
}

/**
 * S10: `src/types` must stay a LEAF layer.
 *
 * Covers both halves of the old ESLint config: `no-restricted-imports` (static
 * imports) and `no-restricted-syntax` (inline `import('...')` type annotations). The
 * second was the historical escape hatch behind every type-only cycle, and an
 * import-only check cannot see it because it sits in a TYPE position.
 *
 * @returns {string[]} one message per offending specifier
 */
export function findLeafLayerViolations(filename, source) {
  const { program, errors } = parseSync(filename, source);
  if (errors.length > 0) return [`parse error — ${errors[0].message}`];

  const found = [];
  visitAll(program, (node) => {
    let spec = null;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      spec = node.source?.value ?? null;
    } else if (node.type === "TSImportType") {
      // oxc puts the specifier on `source`. I guessed `argument`/`parameter` first and
      // the rule silently caught nothing — which is why the tests assert BOTH forms.
      spec = node.source?.value ?? null;
    }
    if (typeof spec === "string" && reachesImplementation(spec)) {
      found.push(
        `src/types must remain a leaf layer — it imports '${spec}'. Move the shared ` +
          `type INTO src/types and re-export it from the implementation module (S10).`,
      );
    }
  });
  return found;
}

/**
 * Disallow discarding the boolean returned by `storage.updateEntity()`.
 *
 * The boolean says whether the entity still existed at write time; `false` means it
 * vanished mid-update (concurrent delete, governance rollback, segment flush).
 *
 * Name-based on purpose, exactly as the original rule was: only a receiver that is
 * `storage` or ends in `.storage` counts. `entityManager.updateEntity()` returns an
 * Entity and is a different contract, so it must NOT be flagged.
 *
 * A result counts as USED whenever the call is not the entire statement — assigned,
 * returned, branched on, or composed. So the test is precisely: is this call (or the
 * `await` wrapping it) the direct expression of an ExpressionStatement?
 *
 * @returns {{line: number, message: string}[]}
 */
export function findUnusedUpdateEntityReturns(filename, source) {
  const { program, errors } = parseSync(filename, source);
  if (errors.length > 0) return [{ line: 0, message: `parse error — ${errors[0].message}` }];

  const lines = source.split("\n");
  const found = [];

  visitAll(program, (node) => {
    if (node.type !== "ExpressionStatement") return;
    const inner =
      node.expression?.type === "AwaitExpression" ? node.expression.argument : node.expression;
    if (!inner || inner.type !== "CallExpression") return;

    const callee = inner.callee;
    if (callee?.type !== "StaticMemberExpression" && callee?.type !== "MemberExpression") return;
    if (callee.property?.name !== "updateEntity") return;

    const obj = callee.object;
    const receiverIsStorage = obj?.name === "storage" || obj?.property?.name === "storage";
    if (!receiverIsStorage) return;

    const line = source.slice(0, node.start).split("\n").length;
    // Escape hatch, same as the original rule: a marker comment on the line above makes
    // an intentional discard a conscious, reviewable decision rather than an oversight.
    if ((lines[line - 2] ?? "").includes("no-unused-updateentity-return")) return;

    found.push({
      line,
      message:
        `unused 'storage.updateEntity()' return — the boolean signals whether the ` +
        `entity still existed (false = vanished mid-update). Branch on it, return it, ` +
        `or assign it. If the discard is intentional, add a ` +
        `'no-unused-updateentity-return' comment on the line above with a reason.`,
    });
  });
  return found;
}
