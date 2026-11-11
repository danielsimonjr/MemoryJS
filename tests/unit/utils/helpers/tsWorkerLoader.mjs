/**
 * Worker-thread TypeScript loader for the tests.
 *
 * The worker-parity tests run `src/workers/levenshteinWorker.ts` (and, for the
 * scripted-worker case, `src/utils/threadPool.ts`) as real ESM worker threads, so
 * they need a TypeScript loader inside the worker. `--import tsx` does that on
 * Node >= 22.22.3 and on the main thread, but tsx 4.23.1 registers its ESM hooks
 * through `module.registerHooks` only from that version and skips registration on
 * a non-main thread otherwise. On the Node 22.16 leg (the floor `engines.node`
 * gives Sprint 9) a worker loaded with `--import tsx` therefore fails with
 * `Unknown file extension ".ts"`.
 *
 * This loader does the two things the source needs and nothing else, using Node's
 * own type stripping (stable on the Node versions this repository supports) plus
 * a resolve hook for the `.js` specifiers the source writes:
 *
 *   execArgv: ['--experimental-strip-types', '--no-warnings', '--import', <this file>]
 *
 * Node 24 strips types by default; the flag is harmless there. This is test
 * infrastructure only — nothing in `dist/` loads it.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = fileURLToPath(new URL(specifier, context.parentURL)).replace(/\.js$/, '.ts');
      if (existsSync(candidate)) {
        return {
          url: new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL).href,
          shortCircuit: true,
        };
      }
    }
    return next(specifier, context);
  },
});
