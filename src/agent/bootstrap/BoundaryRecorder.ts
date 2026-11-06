/**
 * Coverage boundaries of a corpus (Recursa RS-11): which regions of the material are present,
 * absent or only partly present. Each region is one `coverage` entity keyed by its slug, so a
 * later recording of the same region updates it. Solvers read `summaryForContext` so they can
 * skip regions known to be absent.
 *
 * @module agent/bootstrap/BoundaryRecorder
 * @experimental Spec RS-11. The status rules may gain more inputs.
 */

import type { Entity, IGraphStorage } from '../../types/types.js';
import type { CoverageRecord, SkillSource } from '../../types/skills.js';
import { isCoverageEntity, toIsoDateTime } from '../../types/agent-memory.js';
import { EntityManager } from '../../core/EntityManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import { slugify } from '../knowledge/knowledgeDigest.js';
import { ValidationError } from '../../utils/errors.js';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import { buildMemoryEntity, scalarText } from './bootstrapShared.js';

/** Default token budget of {@link summarizeCoverage}. */
export const DEFAULT_COVERAGE_BUDGET_TOKENS = 400;

/** Input of {@link BoundaryRecorder.record}. */
export interface RecordCoverageInput {
  /** Region name (upsert key, through its slug). */
  region: string;
  /** Status of the region. */
  status: CoverageRecord['status'];
  /** Sources supporting the status. */
  evidence?: SkillSource[];
  /** Free-form note. */
  note?: string;
}

/**
 * A region expected in the corpus: a bare name (present when any source exists) or a name with
 * the number of sources it should contain (partial below that count).
 */
export type ExpectedRegion = string | { region: string; expected: number };

/** Dependencies of {@link BoundaryRecorder}. */
export interface BoundaryRecorderDeps {
  /** Storage that holds the coverage entities. */
  storage: IGraphStorage;
  /** Write path (pass `ctx.entityManager` for governance). */
  entityManager?: EntityManager;
  /** Clock used for `recordedAt` (default: now). */
  now?: () => Date;
}

/**
 * Entity name of a region's coverage record (`coverage-<region-slug>`). Two distinct regions
 * with the same slug are rejected by {@link BoundaryRecorder.record}.
 *
 * @param region - Region name.
 * @returns Entity name.
 */
export function coverageEntityName(region: string): string {
  return `coverage-${slugify(region)}`;
}

/**
 * One line per region, absent regions first, then partial, then present (alphabetical within a
 * status). Lines beyond the token budget are dropped and counted in a final line.
 *
 * @param records - Coverage records.
 * @param budgetTokens - Token budget of the whole text.
 * @returns Markdown lines joined by newlines (empty when there are no records).
 */
export function summarizeCoverage(records: readonly CoverageRecord[], budgetTokens = DEFAULT_COVERAGE_BUDGET_TOKENS): string {
  const rank: Record<CoverageRecord['status'], number> = { absent: 0, partial: 1, present: 2 };
  const ordered = [...records].sort((a, b) => rank[a.status] - rank[b.status] || a.region.localeCompare(b.region));
  const lines: string[] = [];
  let used = 0;
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i]!;
    const line = `- ${r.region}: ${r.status}${r.note ? ` (${r.note})` : ''}`;
    const cost = estimateTokensFromText(line, 1.3);
    if (used + cost > budgetTokens) {
      lines.push(`- ${ordered.length - i} more region(s) omitted for budget`);
      break;
    }
    used += cost;
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Records and reads coverage of corpus regions.
 *
 * @example
 * ```ts
 * const boundaries = new BoundaryRecorder({ storage });
 * await boundaries.recordFromMetadata(sources, 'group', ['invoices', { region: 'receipts', expected: 3 }]);
 * const text = await boundaries.summaryForContext();
 * ```
 */
export class BoundaryRecorder {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly now: () => Date;

  /**
   * Create the recorder.
   *
   * @param deps - Storage, optional write path and clock.
   */
  constructor(deps: BoundaryRecorderDeps) {
    this.storage = deps.storage;
    this.entityManager = deps.entityManager ?? new EntityManager(deps.storage as GraphStorage);
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Record (or update) the coverage of one region.
   *
   * @param input - Region, status, evidence and note.
   * @returns The stored record (it keeps the original region name).
   * @throws ValidationError when another region with the same slug is already recorded.
   */
  async record(input: RecordCoverageInput): Promise<CoverageRecord> {
    const record: CoverageRecord = {
      region: input.region,
      status: input.status,
      evidence: input.evidence ?? [],
      note: input.note ?? '',
      recordedAt: toIsoDateTime(this.now()),
    };
    const name = coverageEntityName(input.region);
    const stored = this.storage.getEntityByName(name);
    if (stored && isCoverageEntity(stored) && stored.coverageRecord.region !== input.region) {
      throw new ValidationError(
        `BoundaryRecorder: regions "${stored.coverageRecord.region}" and "${input.region}" share the slug of ${name}`,
        [stored.coverageRecord.region, input.region],
      );
    }
    if (stored && isCoverageEntity(stored)) {
      await this.entityManager.updateEntity(
        name,
        { coverageRecord: record, observations: [describe(record)], lastModified: record.recordedAt } as unknown as Partial<Entity>,
        { expectedVersion: stored.version ?? 1 },
      );
    } else {
      await this.entityManager.createEntities([
        buildMemoryEntity({
          name,
          memoryType: 'coverage',
          field: 'coverageRecord',
          value: record,
          observations: [describe(record)],
          now: record.recordedAt,
        }),
      ]);
    }
    return record;
  }

  /**
   * Record one coverage entry per region from `metadata[groupKey]` counts.
   *
   * Status by count: no sources is `absent`; with an expected count, fewer than expected is
   * `partial`; otherwise `present`. Regions named in `expectedRegions` but missing from the
   * sources are recorded as `absent`.
   *
   * @param sources - Sources with optional metadata.
   * @param groupKey - Metadata key that names the region (default `group`).
   * @param expectedRegions - Regions expected in the corpus.
   * @returns Records written, in region order.
   */
  async recordFromMetadata(
    sources: ReadonlyArray<{ ref: string; metadata?: Record<string, unknown> }>,
    groupKey = 'group',
    expectedRegions: ExpectedRegion[] = [],
  ): Promise<CoverageRecord[]> {
    const byRegion = new Map<string, Array<{ ref: string; metadata?: Record<string, unknown> }>>();
    for (const s of sources) {
      const value = s.metadata?.[groupKey];
      if (value === undefined) continue;
      const bucket = byRegion.get(scalarText(value)) ?? [];
      bucket.push(s);
      byRegion.set(scalarText(value), bucket);
    }
    const expected = new Map<string, number | undefined>();
    for (const e of expectedRegions) {
      if (typeof e === 'string') expected.set(e, expected.get(e));
      else expected.set(e.region, e.expected);
    }
    for (const region of byRegion.keys()) if (!expected.has(region)) expected.set(region, undefined);

    const out: CoverageRecord[] = [];
    for (const region of [...expected.keys()].sort()) {
      const members = byRegion.get(region) ?? [];
      const want = expected.get(region);
      const status: CoverageRecord['status'] =
        members.length === 0 ? 'absent' : want !== undefined && members.length < want ? 'partial' : 'present';
      const note = `${members.length} source(s)${want !== undefined ? ` of ${want} expected` : ''}`;
      const evidence: SkillSource[] = members.map((m) => ({ ref: m.ref, kind: 'document' }));
      out.push(await this.record({ region, status, evidence, note }));
    }
    return out;
  }

  /**
   * Coverage record of a region.
   *
   * @param region - Region name.
   * @returns The record, or `undefined` when none is stored.
   */
  lookup(region: string): CoverageRecord | undefined {
    const entity = this.storage.getEntityByName(coverageEntityName(region));
    return entity && isCoverageEntity(entity) ? entity.coverageRecord : undefined;
  }

  /**
   * All coverage records, sorted by region.
   *
   * @returns Records.
   */
  async list(): Promise<CoverageRecord[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities
      .filter(isCoverageEntity)
      .map((e) => e.coverageRecord)
      .sort((a, b) => a.region.localeCompare(b.region));
  }

  /**
   * Context text for solvers: one line per region, absent regions first.
   *
   * @param budgetTokens - Token budget (default 400).
   * @returns Lines joined by newlines; empty when nothing is recorded.
   */
  async summaryForContext(budgetTokens = DEFAULT_COVERAGE_BUDGET_TOKENS): Promise<string> {
    return summarizeCoverage(await this.list(), budgetTokens);
  }
}

/**
 * Observation line for a coverage record.
 *
 * @param record - Coverage record.
 * @returns One-line description.
 */
function describe(record: CoverageRecord): string {
  return `[coverage] ${record.region}: ${record.status}`;
}
