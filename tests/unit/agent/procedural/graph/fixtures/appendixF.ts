/**
 * Appendix F behavioral fixtures (feature plan 12.2 / implementation plan 7.3).
 *
 * Use these only as fixtures, not universal guarantees:
 * - quote-only task guidance should discourage continuing into booking/payment;
 * - a dialogue task should preserve the user's response objective instead of
 *   answering an evaluator/meta question.
 *
 * Attribute text may be paraphrased except {@link MULTICHALLENGE_F2_PITFALLS},
 * which is verbatim from the paper via feature plan 12.2.
 */

import { PG_BUILT_IN_RELATIONS } from '../../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGNode, PGSnapshot } from '../../../../../../src/types/proceduralGraph.js';
import { toolCatalogHash } from '../../../../../../src/agent/procedural/graph/canonical.js';

/** Paraphrase-allowed quote-only stop guidance (plan 7.3 quoted phrase). */
export const BFCL_STOP_UNLESS_REQUESTED_GUIDANCE =
  'report the quoted price and stop unless booking was requested';

/** Paraphrase-allowed booking-path condition (plan 7.3 quoted phrase). */
export const BFCL_BOOKING_CONDITION = 'user explicitly requested booking';

/**
 * Verbatim pitfalls line from the paper via feature plan 12.2.
 * Do not paraphrase.
 */
export const MULTICHALLENGE_F2_PITFALLS =
  'Do NOT write a meta-evaluation or answer the target question directly.';

export const BFCL_QUOTE_ONLY_TOOLS = ['get_flight_cost', 'book_flight'] as const;

export const BFCL_QUOTE_ONLY_NODES: PGNode[] = [
  { id: 'Start', type: 'STATE', description: 'Quote-only flight-cost inquiry entry.' },
  {
    id: 'get_flight_cost',
    type: 'ACTION',
    description: 'Look up the quoted flight price for the requested itinerary.',
  },
  {
    id: 'book_flight',
    type: 'ACTION',
    description: 'Book the quoted itinerary when the user has asked to book.',
  },
  { id: 'Finish', type: 'STATE', description: 'Terminal: report the quote or complete booking.' },
];

export const BFCL_QUOTE_ONLY_EDGES: PGEdge[] = [
  {
    source: 'Start',
    relation: 'LEADS_TO',
    target: 'get_flight_cost',
    condition: null,
    guidance: 'Fetch the quoted flight cost before deciding whether to stop or book.',
    pitfalls: 'Do not invent a fare; call get_flight_cost first.',
  },
  {
    source: 'get_flight_cost',
    relation: 'LEADS_TO',
    target: 'Finish',
    condition: null,
    guidance: BFCL_STOP_UNLESS_REQUESTED_GUIDANCE,
    pitfalls: 'Do not continue into booking or payment after a quote-only request.',
  },
  {
    source: 'get_flight_cost',
    relation: 'LEADS_TO',
    target: 'book_flight',
    condition: BFCL_BOOKING_CONDITION,
    guidance: 'Proceed to booking only when the user explicitly requested it.',
    pitfalls: 'Do not book or take payment after a quote-only inquiry.',
  },
  {
    source: 'book_flight',
    relation: 'LEADS_TO',
    target: 'Finish',
    condition: null,
    guidance: 'Confirm the booking result and stop.',
    pitfalls: 'Do not re-quote or restart the itinerary after a completed booking.',
  },
];

export const BFCL_QUOTE_ONLY_SNAPSHOT: PGSnapshot = {
  schemaVersion: 1,
  graphId: 'appendix-f-bfcl-quote-only',
  revisionId: 'f-quote-only',
  entryNodeId: 'Start',
  relationVocabulary: [...PG_BUILT_IN_RELATIONS],
  cyclePolicy: 'allow',
  toolCatalogHash: toolCatalogHash(BFCL_QUOTE_ONLY_TOOLS),
  nodes: BFCL_QUOTE_ONLY_NODES,
  edges: BFCL_QUOTE_ONLY_EDGES,
};

export const MULTICHALLENGE_F2_TOOLS = [
  'ParseHistory',
  'AnalyzeTargetQuestion',
  'ExtractConstraints',
] as const;

export const MULTICHALLENGE_F2_NODES: PGNode[] = [
  { id: 'Start', type: 'STATE', description: 'Dialogue-task entry.' },
  {
    id: 'ParseHistory',
    type: 'REASONING',
    description: 'Parse the conversation history to recover the user objective.',
  },
  {
    id: 'AnalyzeTargetQuestion',
    type: 'REASONING',
    description: 'Identify the user-facing target question, not an evaluator prompt.',
  },
  {
    id: 'ExtractConstraints',
    type: 'REASONING',
    description: 'Extract constraints the reply must satisfy.',
  },
  { id: 'Finish', type: 'STATE', description: 'Produce the user-facing reply and stop.' },
];

export const MULTICHALLENGE_F2_EDGES: PGEdge[] = [
  {
    source: 'Start',
    relation: 'LEADS_TO',
    target: 'ParseHistory',
    condition: null,
    guidance: 'Read the dialogue history before analyzing the target question.',
    pitfalls: 'Do not answer from the latest evaluator turn alone.',
  },
  {
    source: 'ParseHistory',
    relation: 'LEADS_TO',
    target: 'AnalyzeTargetQuestion',
    condition: 'dialogue history has been parsed',
    guidance: 'Locate the user response objective in the parsed history.',
    pitfalls: 'Do not treat a meta-evaluation prompt as the user objective.',
  },
  {
    source: 'AnalyzeTargetQuestion',
    relation: 'LEADS_TO',
    target: 'ExtractConstraints',
    condition: 'target question identified',
    guidance: 'Extract reply constraints while keeping the user objective in focus.',
    pitfalls: MULTICHALLENGE_F2_PITFALLS,
  },
  {
    source: 'ExtractConstraints',
    relation: 'LEADS_TO',
    target: 'Finish',
    condition: null,
    guidance: 'Answer the user objective under the extracted constraints, then stop.',
    pitfalls: 'Do not replace the user-facing answer with commentary about the task.',
  },
];

export const MULTICHALLENGE_F2_SNAPSHOT: PGSnapshot = {
  schemaVersion: 1,
  graphId: 'appendix-f-multichallenge-f2',
  revisionId: 'f2',
  entryNodeId: 'Start',
  relationVocabulary: [...PG_BUILT_IN_RELATIONS],
  cyclePolicy: 'allow',
  toolCatalogHash: toolCatalogHash(MULTICHALLENGE_F2_TOOLS),
  nodes: MULTICHALLENGE_F2_NODES,
  edges: MULTICHALLENGE_F2_EDGES,
};
