/**
 * Parity with Zod 4.6.7 for the in-repo schema module.
 *
 * The fixture was recorded from the real package by
 * `tests/unit/utils/helpers/captureSchemaParity.ts` while `zod` was still
 * installed. It freezes, for every schema MemoryJS validates at runtime:
 *
 * - `safeParse` success and output (including key order and applied defaults),
 * - `safeParse` failure as issue list (code, path, message and the extra
 *   code-specific fields), in emission order,
 * - the `ZodError` shape (`name` and `issues`) for representative failures,
 * - `formatZodErrors` and the Recursa `issuesOf` message,
 * - `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })`.
 *
 * Nothing here imports Zod; the fixture is the oracle after removal.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from '../../../src/utils/schema.js';
import * as utilsSchemas from '../../../src/utils/schemas.js';
import * as recursaSchemas from '../../../src/adapters/recursaToolSchemas.js';
import * as recursaSupport from '../../../src/adapters/recursaToolSupport.js';
import * as pgSchemas from '../../../src/agent/procedural/graph/ProceduralGraphSchemas.js';
import { normalizeIssues } from './helpers/schemaParityFormat.js';
import { CASES, ERROR_SHAPE_CASES, JSON_SCHEMA_CASES, OPS, type SchemaName } from './helpers/schemaParityCases.js';

interface AnySchema {
  safeParse(input: unknown): { success: true; data: unknown } | { success: false; error: { name: string; issues: unknown[] } };
}

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

interface Fixture {
  zodVersion: string;
  parseResults: Array<{
    label: string;
    schema: SchemaName;
    ok: boolean;
    data?: unknown;
    issues?: unknown[];
    errorName?: string;
  }>;
  errorShapes: Array<{ label: string; schema: SchemaName; errorName: string; issues: unknown[] }>;
  opResults: Array<{ label: string; op: 'formatZodErrors' | 'issuesOf'; schema: SchemaName; output: string[] | string }>;
  jsonSchemas: Array<{ schema: SchemaName; jsonSchema: Record<string, unknown> }>;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'schemaParity.json'), 'utf8'),
) as Fixture;

describe('schema parity with zod 4.6.7', () => {
  it('was recorded from zod 4.6.7', () => {
    expect(fixture.zodVersion).toBe('4.6.7');
  });

  it('covers every schema in the corpus', () => {
    for (const c of CASES) expect(SCHEMAS[c.schema], c.label).toBeDefined();
  });

  it.each(fixture.parseResults.map((r) => [r.label, r] as const))('safeParse matches for %s', (_label, expected) => {
    const schema = SCHEMAS[expected.schema];
    const result = schema.safeParse(corpusInput(expected.label));
    if (expected.ok) {
      expect(result.success).toBe(true);
      expect(normalizeIssues([])).toEqual([]);
      if (result.success) expect(JSON.stringify(result.data)).toBe(JSON.stringify(expected.data));
      return;
    }
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(normalizeIssues(result.error.issues))).toBe(JSON.stringify(expected.issues));
      expect(result.error.name).toBe(expected.errorName);
    }
  });

  it.each(fixture.errorShapes.map((r) => [r.label, r] as const))('ZodError shape matches for %s', (_label, expected) => {
    const result = SCHEMAS[expected.schema].safeParse(corpusInput(expected.label));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.name).toBe(expected.errorName);
    expect(JSON.stringify(normalizeIssues(result.error.issues))).toBe(JSON.stringify(expected.issues));
  });

  it.each(fixture.opResults.map((r) => [r.label, r] as const))('helper output matches for %s', (_label, expected) => {
    const result = SCHEMAS[expected.schema].safeParse(corpusInput(expected.label));
    expect(result.success).toBe(false);
    if (result.success) return;
    const output =
      expected.op === 'formatZodErrors'
        ? utilsSchemas.formatZodErrors(result.error as never)
        : recursaSupport.issuesOf(result.error as never);
    expect(output).toEqual(expected.output);
  });

  it.each(fixture.jsonSchemas.map((r) => [r.schema, r] as const))('toJSONSchema matches for %s', (_name, expected) => {
    const out = z.toJSONSchema(SCHEMAS[expected.schema] as never, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    delete out.$schema;
    expect(JSON.stringify(out)).toBe(JSON.stringify(expected.jsonSchema));
  });

  it('freezes a JSON Schema for every schema the adapter publishes', () => {
    for (const name of JSON_SCHEMA_CASES) {
      expect(fixture.jsonSchemas.some((entry) => entry.schema === name), name).toBe(true);
    }
  });
});

/** Look up the corpus input for a recorded case label. */
function corpusInput(label: string): unknown {
  const fromCases = CASES.find((c) => c.label === label);
  if (fromCases) return fromCases.input;
  const fromErrors = ERROR_SHAPE_CASES.find((c) => c.label === label);
  if (fromErrors) return fromErrors.input;
  const fromOps = OPS.find((c) => c.label === label);
  if (fromOps) return fromOps.input;
  throw new Error(`No corpus input for ${label}`);
}
