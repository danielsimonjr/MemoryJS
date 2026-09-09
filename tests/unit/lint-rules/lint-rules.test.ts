/**
 * Coverage for the two project lint rules.
 *
 * These rules used to live in an ESLint plugin with a RuleTester suite. ESLint cannot
 * run on TypeScript 7, so the plugin was replaced by scripts/lint-rules.mjs -- and this
 * file carries the SAME cases across, so the swap did not quietly delete the coverage
 * along with the implementation. Every valid/invalid case below came from the original
 * RuleTester suite.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error -- .mjs helper without type declarations; it is a build-time script,
// not part of the published surface.
import { findUnusedUpdateEntityReturns, findLeafLayerViolations } from "../../../scripts/lint-rules.mjs";

const unused = (code: string): unknown[] =>
  findUnusedUpdateEntityReturns("probe.ts", code) as unknown[];
const leaf = (code: string): unknown[] =>
  findLeafLayerViolations("src/types/probe.ts", code) as unknown[];

describe("no-unused-updateentity-return", () => {
  describe("does NOT flag a used result", () => {
    const valid = [
      ["captured in a variable", 'async function f(storage){ const ok = await storage.updateEntity("a", {}); return ok; }'],
      ["returned directly (awaited)", 'async function f(storage){ return await storage.updateEntity("a", {}); }'],
      ["returned directly (no await — still used)", 'function f(storage){ return storage.updateEntity("a", {}); }'],
      ["used in an if-condition", 'async function f(storage){ if (await storage.updateEntity("a", {})) { return 1; } }'],
      ["used in a logical expression", 'async function f(storage){ const x = (await storage.updateEntity("a", {})) || false; return x; }'],
      ["this.storage receiver, captured", 'async function f(){ const ok = await this.storage.updateEntity("a", {}); return ok; }'],
      ["this.deps.storage receiver, captured", 'async function f(){ const ok = await this.deps.storage.updateEntity("a", {}); return ok; }'],
      ["arrow with implicit return", 'const f = (storage) => storage.updateEntity("a", {});'],
    ] as const;

    for (const [label, code] of valid) {
      it(label, () => expect(unused(code)).toHaveLength(0));
    }
  });

  describe("does NOT flag a different receiver or method", () => {
    // entityManager.updateEntity returns an Entity (or throws) — a different contract.
    const valid = [
      ["entityManager parameter", 'async function f(entityManager){ await entityManager.updateEntity("a", {}); }'],
      ["this.entityManager", 'async function f(){ await this.entityManager.updateEntity("a", {}); }'],
      ["a different storage method", 'async function f(storage){ await storage.appendEntity({}); }'],
    ] as const;

    for (const [label, code] of valid) {
      it(label, () => expect(unused(code)).toHaveLength(0));
    }
  });

  describe("DOES flag a discarded result", () => {
    const invalid = [
      ["storage parameter, awaited", 'async function f(storage){ await storage.updateEntity("a", {}); }'],
      ["this.storage, awaited", 'async function f(){ await this.storage.updateEntity("a", {}); }'],
      ["this.deps.storage, awaited", 'async function f(){ await this.deps.storage.updateEntity("a", {}); }'],
      ["storage parameter, not awaited", 'function f(storage){ storage.updateEntity("a", {}); }'],
    ] as const;

    for (const [label, code] of invalid) {
      it(label, () => expect(unused(code)).toHaveLength(1));
    }
  });

  it("honours the escape-hatch comment on the line above", () => {
    const code = [
      "async function f(storage){",
      "  // no-unused-updateentity-return: fire-and-forget metadata write",
      '  await storage.updateEntity("a", {});',
      "}",
    ].join("\n");
    expect(unused(code)).toHaveLength(0);
  });
});

describe("src/types leaf layer (S10)", () => {
  it("flags a static import from an implementation directory", () => {
    expect(leaf('import type { E } from "../core/types.js";')).toHaveLength(1);
  });

  it("flags an INLINE import() type — the escape hatch that caused the cycles", () => {
    // This is the case an import-only check cannot see, because it sits in a type
    // position. It is the whole reason the original config carried a
    // no-restricted-syntax selector alongside no-restricted-imports.
    expect(leaf('export type Q = import("../agent/SessionManager.js").Session;')).toHaveLength(1);
  });

  it("flags a re-export from an implementation directory", () => {
    expect(leaf('export * from "../search/index.js";')).toHaveLength(1);
  });

  it("allows imports that stay inside the types layer", () => {
    expect(leaf('import type { A } from "./other.js";')).toHaveLength(0);
  });

  it("allows an external package", () => {
    expect(leaf('import type { z } from "zod";')).toHaveLength(0);
  });
});
