/**
 * One-time recorder for the synthetic schema parity fixture.
 *
 * Records real Zod 4.6.7 behaviour for `buildSynthetic(z)` — a schema tree that
 * combines constructs the production schemas do not currently reach — over
 * `SYNTHETIC_INPUTS`, plus each synthetic schema's
 * `toJSONSchema(..., { io: 'input', unrepresentable: 'any' })` output.
 *
 * Zod is no longer a dependency. To re-record, install `zod@4.6.7` in a scratch
 * directory and point `ZOD_PATH` at its `index.js`:
 *
 *   ZOD_PATH=/path/to/node_modules/zod/index.js \
 *     npx tsx tests/unit/utils/helpers/captureSchemaSynthetic.ts \
 *       tests/unit/utils/fixtures/schemaSynthetic.json
 *
 * The recorder refuses to run if `buildSynthetic` produced anything that is not
 * a real Zod schema, so it cannot capture the in-repo replacement by mistake.
 */
import { writeFileSync } from 'node:fs';
import { normalizeIssues } from './schemaParityFormat.js';
import { SYNTHETIC_INPUTS, buildSynthetic } from './schemaSyntheticCases.js';

const zodPath = process.env.ZOD_PATH;
if (!zodPath) {
  throw new Error('Set ZOD_PATH to a zod@4.6.7 index.js before recording (see the header of this file).');
}

interface AnySchema {
  safeParse(input: unknown): { success: true; data: unknown } | { success: false; error: { name: string; issues: unknown[] } };
}
interface ZodModule {
  z: {
    toJSONSchema(schema: unknown, params: { io: 'input'; unrepresentable: 'any' }): Record<string, unknown>;
  } & Parameters<typeof buildSynthetic>[0];
}

const { z } = (await import(zodPath)) as ZodModule;

const schemas = buildSynthetic(z) as Record<string, AnySchema>;
for (const [name, schema] of Object.entries(schemas)) {
  if (schema === null || typeof schema !== 'object' || !('_zod' in schema)) {
    throw new Error(`${name} is not a Zod schema. This recorder needs real Zod (see the header of this file).`);
  }
}

const fixture = {
  zodVersion: '4.6.7',
  schemas: Object.entries(schemas).map(([name, schema]) => ({
    schema: name,
    jsonSchema: (() => {
      const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
      delete out.$schema;
      return out;
    })(),
    results: SYNTHETIC_INPUTS.map((input) => {
      const result = schema.safeParse(input);
      return {
        ok: result.success,
        data: result.success ? result.data : undefined,
        issues: result.success ? undefined : normalizeIssues(result.error.issues),
      };
    }),
  })),
};

writeFileSync(process.argv[2] ?? '/dev/stdout', `${JSON.stringify(fixture, null, 2)}\n`);
