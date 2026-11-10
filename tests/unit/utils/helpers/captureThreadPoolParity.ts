/**
 * One-time recorder that froze `@danielsimonjr/workerpool` 10.2.0 behaviour for
 * the operations MemoryJS performs, before the package left `dependencies`.
 *
 * The package is not a repo dependency. To re-record after an intentional change,
 * install `@danielsimonjr/workerpool@10.2.0` outside the repository (for example
 * `npm install` in an empty temp directory) and point `WORKERPOOL_PATH` at that
 * copy's `src/js/index.js`. The import is dynamic via `WORKERPOOL_PATH` only, so
 * this file never reintroduces `@danielsimonjr/workerpool` as a dependency. It is
 * a development aid, not part of the build or the test run.
 *
 *   WORKERPOOL_PATH=/path/to/node_modules/@danielsimonjr/workerpool/src/js/index.js \
 *     npx tsx tests/unit/utils/helpers/captureThreadPoolParity.ts \
 *       tests/unit/utils/fixtures/threadPoolParity.json
 *
 * `src/utils/threadPool.ts` must then reproduce the fixture; the replay test is
 * `tests/unit/utils/threadPool.parity.test.ts`.
 *
 * @module tests/unit/utils/helpers/captureThreadPoolParity
 */

import { writeFileSync } from 'node:fs';
import { observeAll, type PoolFactory } from './threadPoolParityCases.js';

const workerpoolPath = process.env.WORKERPOOL_PATH;
if (!workerpoolPath) {
  throw new Error(
    'Set WORKERPOOL_PATH to a @danielsimonjr/workerpool@10.2.0 src/js/index.js before recording (see the header of this file).',
  );
}

interface WorkerpoolModule {
  default: { pool: PoolFactory };
  pool?: PoolFactory;
}

const imported = (await import(workerpoolPath)) as WorkerpoolModule;
const poolFactory = imported.default?.pool ?? imported.pool;
if (typeof poolFactory !== 'function') {
  throw new Error(`${workerpoolPath} did not export a pool() function.`);
}

const fixture = {
  workerpoolVersion: '10.2.0',
  observations: await observeAll(poolFactory),
};

writeFileSync(process.argv[2] ?? '/dev/stdout', `${JSON.stringify(fixture, null, 2)}\n`);
