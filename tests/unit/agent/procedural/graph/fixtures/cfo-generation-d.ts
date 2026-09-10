/**
 * CFO Appendix E.3 Generation D topology (feature-plan 5.1 path).
 *
 * Start → Month_Start → recall_notes → check_cash_in_bank →
 * cash_flow_forecast_calculation → save_note → check_market_data →
 * Decide_Capital → {fund_raising_request → End, book_closing → End}
 *
 * Guidance and pitfalls text below is SYNTHETIC (the paper lists the path,
 * not the attribute strings). Do not treat these strings as paper-attested.
 */

import { PG_BUILT_IN_RELATIONS } from '../../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGNode, PGSnapshot } from '../../../../../../src/types/proceduralGraph.js';
import { toolCatalogHash } from '../../../../../../src/agent/procedural/graph/canonical.js';

export const CFO_GENERATION_D_TOOLS = [
  'recall_notes',
  'check_cash_in_bank',
  'cash_flow_forecast_calculation',
  'save_note',
  'check_market_data',
  'fund_raising_request',
  'book_closing',
] as const;

export const CFO_GENERATION_D_NODES: PGNode[] = [
  { id: 'Start', type: 'STATE', description: 'Episode entry.' },
  { id: 'Month_Start', type: 'STATE', description: 'Begin the current simulation month.' },
  { id: 'recall_notes', type: 'ACTION', description: 'Recall notes saved in prior months.' },
  { id: 'check_cash_in_bank', type: 'ACTION', description: 'Audit the current cash balance.' },
  { id: 'cash_flow_forecast_calculation', type: 'ACTION', description: 'Project runway from current state.' },
  { id: 'save_note', type: 'ACTION', description: 'Persist forecast context for later months.' },
  { id: 'check_market_data', type: 'ACTION', description: 'Inspect market valuation before financing.' },
  { id: 'Decide_Capital', type: 'STATE', description: 'Choose a financing or month-advance action.' },
  { id: 'fund_raising_request', type: 'ACTION', description: 'Request debt or equity financing.' },
  { id: 'book_closing', type: 'ACTION', description: 'Advance the simulator to the next month.' },
  { id: 'End', type: 'STATE', description: 'End the current procedure.' },
];

function syntheticEdge(source: string, target: string): PGEdge {
  // Synthetic guidance/pitfalls — not copied from the paper.
  return {
    source,
    relation: 'LEADS_TO',
    target,
    condition: null,
    guidance: `Synthetic guidance: proceed from ${source} to ${target}.`,
    pitfalls: `Synthetic pitfalls: do not skip ${target} after ${source}.`,
  };
}

export const CFO_GENERATION_D_EDGES: PGEdge[] = [
  syntheticEdge('Start', 'Month_Start'),
  syntheticEdge('Month_Start', 'recall_notes'),
  syntheticEdge('recall_notes', 'check_cash_in_bank'),
  syntheticEdge('check_cash_in_bank', 'cash_flow_forecast_calculation'),
  syntheticEdge('cash_flow_forecast_calculation', 'save_note'),
  syntheticEdge('save_note', 'check_market_data'),
  syntheticEdge('check_market_data', 'Decide_Capital'),
  syntheticEdge('Decide_Capital', 'fund_raising_request'),
  syntheticEdge('Decide_Capital', 'book_closing'),
  syntheticEdge('fund_raising_request', 'End'),
  syntheticEdge('book_closing', 'End'),
];

export const CFO_GENERATION_D_SNAPSHOT: PGSnapshot = {
  schemaVersion: 1,
  graphId: 'cfo-generation-d',
  revisionId: 'generation-d',
  entryNodeId: 'Start',
  relationVocabulary: [...PG_BUILT_IN_RELATIONS],
  cyclePolicy: 'allow',
  toolCatalogHash: toolCatalogHash(CFO_GENERATION_D_TOOLS),
  nodes: CFO_GENERATION_D_NODES,
  edges: CFO_GENERATION_D_EDGES,
};
