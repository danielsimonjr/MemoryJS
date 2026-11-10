/**
 * One-time recorder that froze Zod 4.6.7 behaviour for every schema MemoryJS
 * validates at runtime, plus `formatZodErrors`, `issuesOf` and
 * `z.toJSONSchema`.
 *
 * Zod is no longer a dependency. To re-record after an intentional schema
 * change, install `zod@4.6.7` into a scratch directory and point
 * `ZOD_PATH` at its `index.js`; the import stays dynamic so this file never
 * reintroduces a static `zod` import into the repository. It is a development
 * aid, not part of the build or the test run.
 *
 *   ZOD_PATH=/path/to/node_modules/zod/index.js \
 *     npx tsx tests/unit/utils/helpers/captureSchemaParity.ts \
 *       tests/unit/utils/fixtures/schemaParity.json
 *
 * `src/utils/schema.ts` must then reproduce the fixture; the replay test is
 * `tests/unit/utils/schema.parity.test.ts`.
 */
import { writeFileSync } from 'node:fs';
import { normalizeIssues } from './schemaParityFormat.js';
import { CASES, ERROR_SHAPE_CASES, JSON_SCHEMA_CASES, OPS, type SchemaName } from './schemaParityCases.js';

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
  };
}

const { z } = (await import(zodPath)) as ZodModule;

/**
 * Zod marks every schema with a `_zod` internals slot. Without it the imported
 * schema is the in-repo replacement, which `z.toJSONSchema` cannot read, so a
 * re-record would silently produce the wrong fixture.
 */
function assertZodSchema(name: string, schema: unknown): void {
  if (schema === null || typeof schema !== 'object' || !('_zod' in schema)) {
    throw new Error(
      `${name} is not a Zod schema. Temporarily route src/ imports back to 'zod' before re-recording (see the header of this file).`,
    );
  }
}

const utilsSchemas = await import('../../../../src/utils/schemas.js');
const recursaSchemas = await import('../../../../src/adapters/recursaToolSchemas.js');
const recursaSupport = await import('../../../../src/adapters/recursaToolSupport.js');
const pgSchemas = await import('../../../../src/agent/procedural/graph/ProceduralGraphSchemas.js');

/** Every schema under test, by the name used in the corpus. */
const SCHEMAS: Record<SchemaName, AnySchema> = {
  EntitySchema: utilsSchemas.EntitySchema,
  CreateEntitySchema: utilsSchemas.CreateEntitySchema,
  UpdateEntitySchema: utilsSchemas.UpdateEntitySchema,
  RelationSchema: utilsSchemas.RelationSchema,
  CreateRelationSchema: utilsSchemas.CreateRelationSchema,
  SearchQuerySchema: utilsSchemas.SearchQuerySchema,
  DateRangeSchema: utilsSchemas.DateRangeSchema,
  TagAliasSchema: utilsSchemas.TagAliasSchema,
  ExportFormatSchema: utilsSchemas.ExportFormatSchema,
  BatchCreateEntitiesSchema: utilsSchemas.BatchCreateEntitiesSchema,
  BatchCreateRelationsSchema: utilsSchemas.BatchCreateRelationsSchema,
  EntityNamesSchema: utilsSchemas.EntityNamesSchema,
  DeleteRelationsSchema: utilsSchemas.DeleteRelationsSchema,
  AddObservationInputSchema: utilsSchemas.AddObservationInputSchema,
  AddObservationsInputSchema: utilsSchemas.AddObservationsInputSchema,
  DeleteObservationInputSchema: utilsSchemas.DeleteObservationInputSchema,
  DeleteObservationsInputSchema: utilsSchemas.DeleteObservationsInputSchema,
  ArchiveCriteriaSchema: utilsSchemas.ArchiveCriteriaSchema,
  SavedSearchInputSchema: utilsSchemas.SavedSearchInputSchema,
  SavedSearchUpdateSchema: utilsSchemas.SavedSearchUpdateSchema,
  ImportFormatSchema: utilsSchemas.ImportFormatSchema,
  ExtendedExportFormatSchema: utilsSchemas.ExtendedExportFormatSchema,
  MergeStrategySchema: utilsSchemas.MergeStrategySchema,
  ExportFilterSchema: utilsSchemas.ExportFilterSchema,
  OptionalTagsSchema: utilsSchemas.OptionalTagsSchema,
  OptionalEntityNamesSchema: utilsSchemas.OptionalEntityNamesSchema,
  knowledgeLoadSchema: recursaSchemas.knowledgeLoadSchema,
  skillsPublishSchema: recursaSchemas.skillsPublishSchema,
  skillsImportSchema: recursaSchemas.skillsImportSchema,
  learnStartSchema: recursaSchemas.learnStartSchema,
  traceIdSchema: recursaSchemas.traceIdSchema,
  learnSubmitSchema: recursaSchemas.learnSubmitSchema,
  submitChildSchema: recursaSchemas.submitChildSchema,
  logAppendSchema: recursaSchemas.logAppendSchema,
  logSelectSchema: recursaSchemas.logSelectSchema,
  evalRunSchema: recursaSchemas.evalRunSchema,
  PGNodeSchema: pgSchemas.PGNodeSchema,
  PGEdgeSchema: pgSchemas.PGEdgeSchema,
  PGSnapshotSchema: pgSchemas.PGSnapshotSchema,
  PGEditSetSchema: pgSchemas.PGEditSetSchema,
};

for (const [name, schema] of Object.entries(SCHEMAS)) assertZodSchema(name, schema);

const parseResults = CASES.map((c) => {
  const schema = SCHEMAS[c.schema];
  if (!schema) throw new Error(`Unknown schema in corpus: ${c.schema}`);
  const result = schema.safeParse(c.input);
  return {
    label: c.label,
    schema: c.schema,
    ok: result.success,
    data: result.success ? result.data : undefined,
    issues: result.success ? undefined : normalizeIssues(result.error.issues),
    errorName: result.success ? undefined : result.error.name,
  };
});

const errorShapes = ERROR_SHAPE_CASES.map((c) => {
  const schema = SCHEMAS[c.schema];
  if (!schema) throw new Error(`Unknown schema in corpus: ${c.schema}`);
  const result = schema.safeParse(c.input);
  if (result.success) throw new Error(`Expected a failure for ${c.label}`);
  return {
    label: c.label,
    schema: c.schema,
    errorName: result.error.name,
    issues: normalizeIssues(result.error.issues),
  };
});

const opResults = OPS.map((c) => {
  const schema = SCHEMAS[c.schema];
  if (!schema) throw new Error(`Unknown schema in corpus: ${c.schema}`);
  const result = schema.safeParse(c.input);
  if (result.success) throw new Error(`Expected a failure for ${c.label}`);
  const error = result.error;
  const output =
    c.op === 'formatZodErrors' ? utilsSchemas.formatZodErrors(error as never) : recursaSupport.issuesOf(error as never);
  return { label: c.label, op: c.op, schema: c.schema, output };
});

const jsonSchemas = JSON_SCHEMA_CASES.map((name) => {
  const schema = SCHEMAS[name];
  if (!schema) throw new Error(`Unknown schema: ${name}`);
  const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete out.$schema;
  return { schema: name, jsonSchema: out };
});

const fixture = {
  zodVersion: '4.6.7',
  parseResults,
  errorShapes,
  opResults,
  jsonSchemas,
};

writeFileSync(process.argv[2] ?? '/dev/stdout', `${JSON.stringify(fixture, null, 2)}\n`);
