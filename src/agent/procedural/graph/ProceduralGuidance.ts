/**
 * Online guidance generation: locate → neighborhood/full serialize → mode.
 *
 * Expected outcomes are returned as {@link PGGuidanceResult} unions.
 * Provider timeouts and failures are provider-errors unless the caller
 * opted into attributes-only degradation (feature plan 8.2–8.6).
 *
 * @module agent/procedural/graph/ProceduralGuidance
 * @experimental
 */

import type { PGCompletionProvider } from './CompletionProvider.js';
import { completeWithBudget } from './CompletionProvider.js';
import type { ProceduralGraph } from './ProceduralGraph.js';
import type { PGSerializerStyle } from './ProceduralGraphSerializer.js';
import { serializeFullGraph, serializeLocalContext } from './ProceduralGraphSerializer.js';
import type { PGSessionOptions } from './ProceduralGraphSession.js';
import {
  FULL_GRAPH_CONTEXT_DESC,
  FULL_GRAPH_SOURCE,
  GUIDANCE_PROMPT_TEMPLATE,
  LOCAL_GRAPH_CONTEXT_DESC,
  LOCAL_GRAPH_SOURCE,
  renderTemplate,
  withDataHandlingNote,
} from './prompts.js';
import type {
  PGGuidanceResult,
  PGLocalization,
  PGTraceStep,
} from '../../../types/proceduralGraph.js';

type GuidanceOptions = Required<
  Pick<
    PGSessionOptions,
    | 'taskDescription'
    | 'hopLimit'
    | 'trajectoryWindow'
    | 'guidanceMode'
    | 'serializerStyle'
    | 'maxContextBytes'
    | 'timeoutMs'
    | 'maxOutputChars'
  >
> & {
  paperCompatible: boolean;
  provider?: PGCompletionProvider;
  degradeToAttributesOnError: boolean;
};

/**
 * Locate the active node, serialize local or full context, then generate
 * or return attributes according to `options.guidanceMode`.
 */
export async function generateGuidance(args: {
  graph: ProceduralGraph;
  lastAction: string | undefined;
  query: string;
  recentSteps: readonly PGTraceStep[];
  options: GuidanceOptions;
}): Promise<PGGuidanceResult> {
  const { graph, lastAction, query, recentSteps, options } = args;
  const { localization, serialized, usedFullGraph } = localizeAndSerialize(
    graph,
    lastAction,
    options.hopLimit,
    options.paperCompatible,
    options.serializerStyle,
  );

  if (usedFullGraph) {
    const serializedBytes = Buffer.byteLength(serialized, 'utf8');
    if (serializedBytes > options.maxContextBytes) {
      return {
        status: 'context-budget-exceeded',
        localization,
        serializedBytes,
        budgetBytes: options.maxContextBytes,
      };
    }
  }

  if (options.guidanceMode === 'disabled') {
    return { status: 'disabled' };
  }

  if (options.guidanceMode === 'attributes-only') {
    return {
      status: 'ok',
      mode: 'attributes-only',
      guidance: serialized,
      localization,
    };
  }

  const provider = options.provider;
  if (provider === undefined) {
    return providerFailure(
      'no completion provider configured',
      localization,
      serialized,
      options.degradeToAttributesOnError,
    );
  }

  const recent = windowedSteps(recentSteps, options.trajectoryWindow);
  const prompt = withDataHandlingNote(
    renderTemplate(GUIDANCE_PROMPT_TEMPLATE, {
      task_description: options.taskDescription,
      graph_context_desc: usedFullGraph ? FULL_GRAPH_CONTEXT_DESC : LOCAL_GRAPH_CONTEXT_DESC,
      subgraph_summary: serialized,
      query,
      recent_context: formatRecentContext(recent),
      graph_source: usedFullGraph ? FULL_GRAPH_SOURCE : LOCAL_GRAPH_SOURCE,
    }),
    options.paperCompatible,
  );

  const completed = await completeWithBudget(provider, prompt, {
    timeoutMs: options.timeoutMs,
    maxOutputChars: options.maxOutputChars,
  });

  if (!completed.ok) {
    return providerFailure(
      completed.error,
      localization,
      serialized,
      options.degradeToAttributesOnError,
    );
  }

  return {
    status: 'ok',
    mode: 'generative',
    guidance: completed.text,
    localization,
    usage: completed.usage,
  };
}

function localizeAndSerialize(
  graph: ProceduralGraph,
  lastAction: string | undefined,
  hopLimit: number,
  paperCompatible: boolean,
  style: PGSerializerStyle,
): { localization: PGLocalization; serialized: string; usedFullGraph: boolean } {
  const loc = graph.locate(lastAction, { allowActionBinding: !paperCompatible });
  if (loc.matched && loc.nodeId !== undefined) {
    const hops = graph.neighborhood(loc.nodeId, hopLimit);
    const localization: PGLocalization = { ...loc, hops, usedFullGraph: false };
    return {
      localization,
      serialized: serializeLocalContext(graph, localization, style),
      usedFullGraph: false,
    };
  }

  const localization: PGLocalization = { ...loc, usedFullGraph: true };
  return {
    localization,
    serialized: serializeFullGraph(graph, style),
    usedFullGraph: true,
  };
}

function providerFailure(
  error: string,
  localization: PGLocalization,
  serialized: string,
  degrade: boolean,
): PGGuidanceResult {
  if (degrade) {
    return {
      status: 'ok',
      mode: 'attributes-only',
      guidance: serialized,
      localization,
      degraded: { from: 'generative', error },
    };
  }
  return { status: 'provider-error', error, localization };
}

function windowedSteps(
  steps: readonly PGTraceStep[],
  trajectoryWindow: number,
): readonly PGTraceStep[] {
  if (trajectoryWindow <= 0) {
    return [];
  }
  return steps.slice(-trajectoryWindow);
}

/** Same Action/Observation lines as `concatTrajectories` step formatting. */
function formatRecentContext(steps: readonly PGTraceStep[]): string {
  const lines: string[] = [];
  for (const step of steps) {
    lines.push(`Action: ${step.action}`);
    lines.push(`Observation: ${step.observation ?? ''}`);
  }
  return lines.join('\n');
}
