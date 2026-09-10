/**
 * HotpotQA Mode 2 excerpt (feature plan 8.4 / paper Appendix B.5).
 *
 * Chain: Start → First_Hop_Retrieve → Scan_Index → Bridge_Extract → End.
 * Hop-1/hop-2 attributes are copied from the paper's serialized local context.
 */

import { PG_BUILT_IN_RELATIONS } from '../../../../../../src/types/proceduralGraph.js';
import type { PGEdge, PGNode, PGSnapshot } from '../../../../../../src/types/proceduralGraph.js';
import { toolCatalogHash } from '../../../../../../src/agent/procedural/graph/canonical.js';

export const HOTPOTQA_MODE2_TOOLS = [
  'First_Hop_Retrieve',
  'Scan_Index',
  'Bridge_Extract',
] as const;

export const HOTPOTQA_MODE2_NODES: PGNode[] = [
  { id: 'Start', type: 'STATE', description: 'Task entry.' },
  {
    id: 'First_Hop_Retrieve',
    type: 'ACTION',
    description: 'Execute first_hop_retrieve to fetch primary evidence passages.',
  },
  {
    id: 'Scan_Index',
    type: 'ACTION',
    description: 'Review retrieved primary passages to locate bridge terms.',
  },
  {
    id: 'Bridge_Extract',
    type: 'ACTION',
    description: 'Extract the connecting entity or bridge term.',
  },
  { id: 'End', type: 'STATE', description: 'Task terminal.' },
];

export const HOTPOTQA_MODE2_EDGES: PGEdge[] = [
  {
    source: 'Start',
    relation: 'LEADS_TO',
    target: 'First_Hop_Retrieve',
    condition: null,
    guidance: null,
    pitfalls: null,
  },
  {
    source: 'First_Hop_Retrieve',
    relation: 'LEADS_TO',
    target: 'Scan_Index',
    condition: 'first_hop_retrieve',
    guidance: 'Review the retrieved primary passages via Scan_Index to locate specific bridge terms (such as birth dates, locations, or associated entities).',
    pitfalls: 'Do not skip reading evidence details; missing the exact bridge entity name causes second-hop search failure.',
  },
  {
    source: 'Scan_Index',
    relation: 'LEADS_TO',
    target: 'Bridge_Extract',
    condition: 'scan_index',
    guidance: 'Extract the explicit connecting entity or bridge term linking the first passage to the target question.',
    pitfalls: 'Ensure the extracted bridge term matches exact Wikipedia capitalization conventions.',
  },
  {
    source: 'Bridge_Extract',
    relation: 'LEADS_TO',
    target: 'End',
    condition: null,
    guidance: null,
    pitfalls: null,
  },
];

export const HOTPOTQA_MODE2_SNAPSHOT: PGSnapshot = {
  schemaVersion: 1,
  graphId: 'hotpotqa-mode2',
  revisionId: 'excerpt',
  entryNodeId: 'Start',
  relationVocabulary: [...PG_BUILT_IN_RELATIONS],
  cyclePolicy: 'allow',
  toolCatalogHash: toolCatalogHash(HOTPOTQA_MODE2_TOOLS),
  nodes: HOTPOTQA_MODE2_NODES,
  edges: HOTPOTQA_MODE2_EDGES,
};

/**
 * Feature-plan 8.4 local serializer shape filled with the excerpt's text.
 * Localized at First_Hop_Retrieve with hopLimit 2.
 */
export const EXPECTED_LOCAL_SERIALIZATION = [
  'Active Cognitive Node: [First_Hop_Retrieve] (Type: ACTION)',
  'Description: Execute first_hop_retrieve to fetch primary evidence passages.',
  '',
  'Immediate Transition Options (Hop 1):',
  '- Transition: [First_Hop_Retrieve] → [Scan_Index] (Condition: first_hop_retrieve)',
  '  * Guidance: Review the retrieved primary passages via Scan_Index to locate specific bridge terms (such as birth dates, locations, or associated entities).',
  '  * Pitfalls to Avoid: Do not skip reading evidence details; missing the exact bridge entity name causes second-hop search failure.',
  '',
  'Subsequent Horizon (Hop 2):',
  '- Transition: [Scan_Index] → [Bridge_Extract] (Condition: scan_index)',
  '  * Guidance: Extract the explicit connecting entity or bridge term linking the first passage to the target question.',
  '  * Pitfalls to Avoid: Ensure the extracted bridge term matches exact Wikipedia capitalization conventions.',
].join('\n');
