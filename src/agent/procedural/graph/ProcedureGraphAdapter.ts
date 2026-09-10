/**
 * One-way Procedure → Procedural Graph conversion (feature plan §10).
 *
 * Repeated action names stay distinct. Fallback resume matches
 * {@link StepSequencer.next}: after a fallback, flow continues at the
 * next main-track step (or End).
 *
 * @module agent/procedural/graph/ProcedureGraphAdapter
 * @experimental
 */

import type { Procedure, ProcedureStep } from '../../../types/procedure.js';
import type { PGEdge, PGNode } from '../../../types/proceduralGraph.js';

/**
 * Convert a stored procedure into graph nodes/edges plus conversion notes.
 *
 * Main-step ids are `${procedure.id}:step:${order}`. Nested fallbacks
 * append `:fallback` per level. Start/End and every fallback node are
 * listed in `notes`.
 */
export function procedureToGraphInput(procedure: Procedure): {
  nodes: PGNode[];
  edges: PGEdge[];
  notes: string[];
} {
  const nodes: PGNode[] = [];
  const edges: PGEdge[] = [];
  const notes: string[] = [];

  nodes.push({ id: 'Start', type: 'STATE', description: 'Start' });
  nodes.push({ id: 'End', type: 'STATE', description: 'End' });
  notes.push('Start', 'End');

  const steps = [...procedure.steps].sort((a, b) => a.order - b.order);
  const mainIds = steps.map((step) => `${procedure.id}:step:${step.order}`);

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    nodes.push({
      id: mainIds[i]!,
      type: 'ACTION',
      actionName: step.action,
      description: describeStep(step),
    });
  }

  if (mainIds.length === 0) {
    edges.push(leadsTo('Start', 'End'));
    return { nodes, edges, notes };
  }

  edges.push(leadsTo('Start', mainIds[0]!));
  for (let i = 0; i < mainIds.length - 1; i += 1) {
    edges.push(leadsTo(mainIds[i]!, mainIds[i + 1]!));
  }
  edges.push(leadsTo(mainIds[mainIds.length - 1]!, 'End'));

  for (let i = 0; i < steps.length; i += 1) {
    const fallback = steps[i]!.fallback;
    if (fallback === undefined) {
      continue;
    }
    const resumeTarget = i + 1 < mainIds.length ? mainIds[i + 1]! : 'End';
    addFallback(mainIds[i]!, fallback, resumeTarget, nodes, edges, notes);
  }

  return { nodes, edges, notes };
}

function describeStep(step: ProcedureStep): string {
  const base = `${step.action} ${JSON.stringify(step.parameters)}`;
  return step.timeout === undefined ? base : `${base} timeout=${step.timeout}`;
}

function leadsTo(source: string, target: string): PGEdge {
  return {
    source,
    relation: 'LEADS_TO',
    target,
    condition: null,
    guidance: '',
    pitfalls: '',
  };
}

function triggers(source: string, target: string): PGEdge {
  return {
    source,
    relation: 'TRIGGERS',
    target,
    condition: 'step failed',
    guidance: '',
    pitfalls: '',
  };
}

function addFallback(
  parentId: string,
  fallback: ProcedureStep,
  resumeTarget: string,
  nodes: PGNode[],
  edges: PGEdge[],
  notes: string[],
): void {
  const id = `${parentId}:fallback`;
  nodes.push({
    id,
    type: 'ACTION',
    actionName: fallback.action,
    description: describeStep(fallback),
  });
  notes.push(id);
  edges.push(triggers(parentId, id));
  edges.push(leadsTo(id, resumeTarget));
  if (fallback.fallback !== undefined) {
    addFallback(id, fallback.fallback, resumeTarget, nodes, edges, notes);
  }
}
