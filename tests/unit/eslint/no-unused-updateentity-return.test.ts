/**
 * RuleTester coverage for the project-local ESLint rule
 * `memoryjs/no-unused-updateentity-return`.
 *
 * The rule flags any `storage.updateEntity(...)` call whose `Promise<boolean>`
 * result is discarded — that boolean signals whether the entity still
 * existed (false = vanished mid-update). Ignoring it is the recurring
 * silent-failure pattern caught by silent-failure-hunter in Sprints 2/4/5/8.
 *
 * NOTE: ESLint 9's `RuleTester.run` registers its own `describe`/`it` blocks
 * with the detected test framework (vitest here), so it must be called at
 * the top level — not wrapped in an outer `it()`.
 */

import { RuleTester } from 'eslint';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- .mjs rule module has no .d.ts
import rule from '../../../eslint-rules/no-unused-updateentity-return.mjs';

const ruleTester = new RuleTester();

ruleTester.run(
  'no-unused-updateentity-return',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RuleModule type from untyped .mjs
  rule as any,
  {
    valid: [
      // result captured in a variable
      'async function f(storage){ const ok = await storage.updateEntity("a", {}); return ok; }',
      // result returned directly (awaited)
      'async function f(storage){ return await storage.updateEntity("a", {}); }',
      // result returned directly (no await — still "used")
      'function f(storage){ return storage.updateEntity("a", {}); }',
      // result used in an if-condition
      'async function f(storage){ if (await storage.updateEntity("a", {})) { return 1; } }',
      // result used in a logical expression
      'async function f(storage){ const x = (await storage.updateEntity("a", {})) || false; return x; }',
      // this.storage receiver, captured
      'async function f(){ const ok = await this.storage.updateEntity("a", {}); return ok; }',
      // this.deps.storage receiver, captured
      'async function f(){ const ok = await this.deps.storage.updateEntity("a", {}); return ok; }',
      // NOT the storage layer — entityManager.updateEntity returns an Entity, not a boolean
      'async function f(entityManager){ await entityManager.updateEntity("a", {}); }',
      'async function f(){ await this.entityManager.updateEntity("a", {}); }',
      // a different storage method — only updateEntity is in scope
      'async function f(storage){ await storage.appendEntity({}); }',
      // arrow with implicit return
      'const f = (storage) => storage.updateEntity("a", {});',
    ],
    invalid: [
      {
        code: 'async function f(storage){ await storage.updateEntity("a", {}); }',
        errors: [{ messageId: 'unusedReturn' }],
      },
      {
        code: 'async function f(){ await this.storage.updateEntity("a", {}); }',
        errors: [{ messageId: 'unusedReturn' }],
      },
      {
        code: 'async function f(){ await this.deps.storage.updateEntity("a", {}); }',
        errors: [{ messageId: 'unusedReturn' }],
      },
      {
        // not even awaited — both a floating promise and a discarded return
        code: 'function f(storage){ storage.updateEntity("a", {}); }',
        errors: [{ messageId: 'unusedReturn' }],
      },
    ],
  }
);
