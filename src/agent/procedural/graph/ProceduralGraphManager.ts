/**
 * Public facade for Procedural Graph create / session / evolve / import.
 *
 * Policy checks run before every operation. Audit fires after every
 * successful mutation. Expected validation and policy denials return
 * result unions and never throw.
 *
 * @module agent/procedural/graph/ProceduralGraphManager
 * @experimental
 */

import { randomUUID } from 'node:crypto';
import { PG_BUILT_IN_RELATIONS } from '../../../types/proceduralGraph.js';
import type {
  PGCyclePolicy,
  PGDiagnostic,
  PGEditSet,
  PGEdge,
  PGHead,
  PGNode,
  PGRejectionRecord,
  PGRoundRecord,
  PGSnapshot,
} from '../../../types/proceduralGraph.js';
import type {
  IProceduralGraphBacking,
  PGCommitResult,
} from './backing/IProceduralGraphBacking.js';
import { canonicalJson, toolCatalogHash } from './canonical.js';
import type { PGCompletionProvider } from './CompletionProvider.js';
import {
  ProceduralGraphEvolution,
  type PGEvolutionDependencies,
  type PGEvolutionOptions,
  type PGEvolutionResult,
} from './ProceduralGraphEvolution.js';
import { parseSnapshot } from './ProceduralGraphSchemas.js';
import { ProceduralGraph } from './ProceduralGraph.js';
import {
  ProceduralGraphSession,
  type PGSessionOptions,
} from './ProceduralGraphSession.js';
import {
  applyCyclePolicy,
  prepareCandidate,
  validateSnapshot,
  type PGValidatorOptions,
} from './ProceduralGraphValidator.js';

const DEFAULT_PAGE_LIMIT = 100;

export interface ProceduralGraphManagerConfig {
  backing: IProceduralGraphBacking;
  ownsBacking: boolean;
  policy?: PGPolicy;
  guidanceProvider?: PGCompletionProvider;
  paperCompatible?: boolean;
}

export interface PGPolicy {
  canRead?(graphId: string): boolean | Promise<boolean>;
  canWrite?(graphId: string): boolean | Promise<boolean>;
  canEvolve?(graphId: string): boolean | Promise<boolean>;
  audit?(event: { op: string; graphId: string; revisionId?: string; at: string }): void | Promise<void>;
}

export class ProceduralGraphManager {
  private readonly backing: IProceduralGraphBacking;
  private readonly ownsBacking: boolean;
  private readonly policy: PGPolicy | undefined;
  private readonly guidanceProvider: PGCompletionProvider | undefined;
  private readonly paperCompatible: boolean;
  private disposed = false;

  constructor(config: ProceduralGraphManagerConfig) {
    this.backing = config.backing;
    this.ownsBacking = config.ownsBacking;
    this.policy = config.policy;
    this.guidanceProvider = config.guidanceProvider;
    this.paperCompatible = config.paperCompatible ?? false;
  }

  async createGraph(input: {
    graphId: string;
    nodes: PGNode[];
    edges: PGEdge[];
    entryNodeId?: string;
    relationVocabulary?: string[];
    cyclePolicy?: PGCyclePolicy;
    toolCatalog?: string[];
  }): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }> {
    const denied = await this.denyWrite(input.graphId);
    if (denied !== undefined) {
      return denied;
    }
    const cyclePolicy = input.cyclePolicy ?? this.defaultCyclePolicy();
    const snapshot = this.buildSnapshot({
      graphId: input.graphId,
      nodes: input.nodes,
      edges: input.edges,
      entryNodeId: input.entryNodeId ?? 'Start',
      relationVocabulary: input.relationVocabulary ?? [...PG_BUILT_IN_RELATIONS],
      cyclePolicy,
      toolCatalog: input.toolCatalog ?? [],
    });
    return this.persistNewGraph(snapshot, 'createGraph', {
      toolCatalog: input.toolCatalog,
      enforceToolCatalog: this.paperCompatible ? false : input.toolCatalog !== undefined,
      paperCompatible: this.paperCompatible,
    });
  }

  async createSkeleton(input: {
    graphId: string;
    toolCatalog?: string[];
    cyclePolicy?: PGCyclePolicy;
  }): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }> {
    return this.createGraph({
      graphId: input.graphId,
      toolCatalog: input.toolCatalog,
      cyclePolicy: input.cyclePolicy,
      entryNodeId: 'Start',
      nodes: [
        { id: 'Start', type: 'STATE', description: 'Start' },
        { id: 'End', type: 'STATE', description: 'End' },
      ],
      edges: [
        {
          source: 'Start',
          relation: 'LEADS_TO',
          target: 'End',
          condition: null,
          guidance: '',
          pitfalls: '',
        },
      ],
    });
  }

  async getGraph(graphId: string, revisionId?: string): Promise<ProceduralGraph | undefined> {
    if (!(await this.allows(this.policy?.canRead, graphId))) {
      return undefined;
    }
    return this.loadGraph(graphId, revisionId);
  }

  async openSession(
    graphId: string,
    options: PGSessionOptions & { revisionId?: string },
  ): Promise<ProceduralGraphSession | undefined> {
    if (!(await this.allows(this.policy?.canRead, graphId))) {
      return undefined;
    }
    const graph = await this.loadGraph(graphId, options.revisionId);
    if (graph === undefined) {
      return undefined;
    }
    const { revisionId: _pinned, ...sessionOptions } = options;
    return new ProceduralGraphSession(graph, {
      ...sessionOptions,
      provider: sessionOptions.provider ?? this.guidanceProvider,
      paperCompatible: sessionOptions.paperCompatible ?? this.paperCompatible,
    });
  }

  async prepareCandidate(
    graphId: string,
    edits: PGEditSet,
    options?: {
      cyclePolicy?: PGCyclePolicy;
      enforceToolCatalog?: boolean;
      toolCatalog?: string[];
      staticMode?: boolean;
    },
  ): Promise<ReturnType<typeof prepareCandidate>> {
    if (!(await this.allows(this.policy?.canRead, graphId))) {
      return policyDeniedPrepare();
    }
    const retained = await this.loadGraph(graphId);
    if (retained === undefined) {
      return {
        ok: false,
        diagnostics: [errorDiag('not-found', `Graph '${graphId}' was not found`)],
        repairs: [],
      };
    }
    const staticMode = options?.staticMode ?? false;
    return prepareCandidate(retained, edits, {
      toolCatalog: options?.toolCatalog,
      enforceToolCatalog: options?.enforceToolCatalog ?? !this.paperCompatible,
      paperCompatible: this.paperCompatible,
      staticMode,
      baselineNodeIds: staticMode ? retained.snapshot.nodes.map((n) => n.id) : undefined,
      cyclePolicy: options?.cyclePolicy ?? this.defaultCyclePolicy(),
      nextRevisionId: randomUUID(),
      parentRevisionId: retained.snapshot.revisionId,
    });
  }

  async evolve(options: PGEvolutionOptions, deps: PGEvolutionDependencies): Promise<PGEvolutionResult> {
    if (!(await this.allows(this.policy?.canEvolve, options.graphId))) {
      return {
        runId: '',
        manifest: {},
        retained: { revisionId: '', graphDigest: '', validationMean: null },
        rounds: [],
        stoppedBecause: 'aborted',
      };
    }
    const evolution = new ProceduralGraphEvolution(this.backing, deps);
    const result = await evolution.run(options);
    await this.audit({
      op: 'evolve',
      graphId: options.graphId,
      revisionId: result.retained.revisionId,
    });
    return result;
  }

  listRevisions(
    graphId: string,
    page?: { offset?: number; limit?: number },
  ): ReturnType<IProceduralGraphBacking['listRevisions']> {
    return this.listRevisionsAuthorized(graphId, page);
  }

  async listRejections(
    graphId: string,
    page?: { offset?: number; limit?: number },
  ): Promise<{
    items: Array<Omit<PGRejectionRecord, 'trajectoryRefs'> & { trajectoryRefs?: undefined }>;
    total: number;
  }> {
    if (!(await this.allows(this.policy?.canRead, graphId))) {
      return { items: [], total: 0 };
    }
    const result = await this.backing.listRejections(graphId, resolvePage(page));
    return {
      items: result.items.map((record) => {
        const { trajectoryRefs: _refs, ...rest } = record;
        return rest;
      }),
      total: result.total,
    };
  }

  async rollback(
    graphId: string,
    revisionId: string,
    expectedHeadVersion: number,
  ): Promise<PGCommitResult | { status: 'not-found' }> {
    if (!(await this.allows(this.policy?.canWrite, graphId))) {
      return { status: 'not-found' };
    }
    const revision = await this.backing.loadRevision(graphId, revisionId);
    if (revision === undefined) {
      return { status: 'not-found' };
    }
    const now = new Date().toISOString();
    const round: PGRoundRecord = {
      runId: `rollback:${randomUUID()}`,
      round: 0,
      retainedRevisionId: revisionId,
      outcome: 'accepted',
      baselineMean: null,
      candidateMean: null,
      diagnostics: [],
      repairs: [],
      startedAt: now,
      finishedAt: now,
    };
    const result = await this.backing.setHead(graphId, revisionId, expectedHeadVersion, round);
    if (result.status === 'committed') {
      await this.audit({ op: 'rollback', graphId, revisionId });
    }
    return result;
  }

  async exportGraph(graphId: string, revisionId?: string): Promise<string | undefined> {
    if (!(await this.allows(this.policy?.canRead, graphId))) {
      return undefined;
    }
    const graph = await this.loadGraph(graphId, revisionId);
    if (graph === undefined) {
      return undefined;
    }
    return canonicalJson(graph.snapshot);
  }

  async importGraph(
    document: string,
    options?: { graphId?: string; toolCatalog?: string[]; enforceToolCatalog?: boolean },
  ): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      return {
        ok: false,
        diagnostics: [errorDiag('not-raw-json', 'Import document is not valid JSON')],
      };
    }
    const snap = parseSnapshot(parsed);
    if (!snap.ok) {
      return snap;
    }
    const snapshot: PGSnapshot = options?.graphId === undefined
      ? snap.value
      : { ...snap.value, graphId: options.graphId };
    const denied = await this.denyWrite(snapshot.graphId);
    if (denied !== undefined) {
      return denied;
    }
    return this.persistNewGraph(snapshot, 'importGraph', {
      toolCatalog: options?.toolCatalog,
      enforceToolCatalog: options?.enforceToolCatalog ?? !this.paperCompatible,
      paperCompatible: this.paperCompatible,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.ownsBacking) {
      await this.backing.close();
    }
  }

  private defaultCyclePolicy(): PGCyclePolicy {
    return this.paperCompatible ? 'repair' : 'reject';
  }

  private buildSnapshot(input: {
    graphId: string;
    nodes: PGNode[];
    edges: PGEdge[];
    entryNodeId: string;
    relationVocabulary: readonly string[];
    cyclePolicy: PGCyclePolicy;
    toolCatalog: readonly string[];
  }): PGSnapshot {
    return {
      schemaVersion: 1,
      graphId: input.graphId,
      revisionId: randomUUID(),
      entryNodeId: input.entryNodeId,
      relationVocabulary: [...input.relationVocabulary],
      cyclePolicy: input.cyclePolicy,
      toolCatalogHash: toolCatalogHash(input.toolCatalog),
      nodes: input.nodes.map((n) => ({ ...n })),
      edges: input.edges.map((e) => ({ ...e })),
    };
  }

  private async persistNewGraph(
    snapshot: PGSnapshot,
    op: string,
    validateOpts: PGValidatorOptions,
  ): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }> {
    const cycled = applyCyclePolicy(ProceduralGraph.fromSnapshot(snapshot), snapshot.cyclePolicy);
    const candidate = ProceduralGraph.fromSnapshot({
      ...cycled.graph.snapshot,
      graphId: snapshot.graphId,
      revisionId: snapshot.revisionId,
      cyclePolicy: snapshot.cyclePolicy,
      toolCatalogHash: snapshot.toolCatalogHash,
    });
    const report = validateSnapshot(candidate.snapshot, validateOpts);
    const diagnostics = [...cycled.diagnostics, ...report.diagnostics];
    if (diagnostics.some((d) => d.severity === 'error')) {
      return { ok: false, diagnostics };
    }
    try {
      const head = await this.backing.createGraph(candidate.snapshot);
      await this.audit({ op, graphId: snapshot.graphId, revisionId: head.revisionId });
      return { ok: true, head };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        diagnostics: [errorDiag(
          message.includes('graph-exists') ? 'graph-exists' : 'persist-failed',
          message,
        )],
      };
    }
  }

  private async loadGraph(graphId: string, revisionId?: string): Promise<ProceduralGraph | undefined> {
    const id = revisionId ?? (await this.backing.loadHead(graphId))?.revisionId;
    if (id === undefined) {
      return undefined;
    }
    const snapshot = await this.backing.loadRevision(graphId, id);
    if (snapshot === undefined) {
      return undefined;
    }
    return ProceduralGraph.fromSnapshot(snapshot);
  }

  private async listRevisionsAuthorized(
    graphId: string,
    page?: { offset?: number; limit?: number },
  ): ReturnType<IProceduralGraphBacking['listRevisions']> {
    if (!(await this.allows(this.policy?.canRead, graphId))) {
      return { items: [], total: 0 };
    }
    return this.backing.listRevisions(graphId, resolvePage(page));
  }

  private async denyWrite(
    graphId: string,
  ): Promise<{ ok: false; diagnostics: PGDiagnostic[] } | undefined> {
    if (await this.allows(this.policy?.canWrite, graphId)) {
      return undefined;
    }
    return {
      ok: false,
      diagnostics: [errorDiag('policy-denied', `Write denied for graph '${graphId}'`)],
    };
  }

  private async allows(
    check: ((graphId: string) => boolean | Promise<boolean>) | undefined,
    graphId: string,
  ): Promise<boolean> {
    if (check === undefined) {
      return true;
    }
    return check(graphId);
  }

  private async audit(event: { op: string; graphId: string; revisionId?: string }): Promise<void> {
    const hook = this.policy?.audit;
    if (hook === undefined) {
      return;
    }
    await hook({ ...event, at: new Date().toISOString() });
  }
}

function resolvePage(page?: { offset?: number; limit?: number }): { offset: number; limit: number } {
  return {
    offset: page?.offset ?? 0,
    limit: page?.limit ?? DEFAULT_PAGE_LIMIT,
  };
}

function errorDiag(code: string, message: string): PGDiagnostic {
  return { severity: 'error', code, message };
}

function policyDeniedPrepare(): ReturnType<typeof prepareCandidate> {
  return {
    ok: false,
    diagnostics: [errorDiag('policy-denied', 'Read denied')],
    repairs: [],
  };
}
