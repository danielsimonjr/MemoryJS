/**
 * Procedural Graph prompt templates (paper Appendix B.5) and binding helpers.
 *
 * Template text outside `{...}` placeholders is copied character-for-character
 * from docs/PROCEDURAL_GRAPH_FEATURE_PLAN.md Section 8.5.
 *
 * @module agent/procedural/graph/prompts
 * @experimental
 */

/** Placeholder tokens that `renderTemplate` may replace: `{` + [a-z_]+ + `}`. */
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/** Paper guidance-generation prompt (local subgraph; default). */
export const GUIDANCE_PROMPT_TEMPLATE = `You are an expert cognitive architect and execution guide for an AI agent solving the task: {task_description}
Here is {graph_context_desc}: {subgraph_summary}
Here is the current active query / observation: {query}
Here is the agent's recent execution trajectory: {recent_context}
Analyze this {graph_source} in the context of the agent's current progress. Using the condition, guidance, and pitfalls attributes carried by the edges in the graph context, generate clear, detailed, and actionable guidance advising the agent on exactly what step or strategy to pursue next, what pitfalls to avoid, and how to recover from recent failures if any. You must include any specific command patterns, file paths, tools, or arguments defined in the graph context if they are relevant to the next steps.
`;

/** Paper refiner prompt (self-evolution). */
export const REFINER_PROMPT_TEMPLATE = `You are an expert cognitive architect optimizing a Procedural Graph for an intelligent agent. The Procedural Graph encodes structured procedural guidance.
Task context: {task_description}
Refinement mode: {mode}
Available Tool Actions (the agent can only execute these actions): {available_tools_list}
Recent execution trajectories: {attempts_block}
Current Procedural Graph representation: {current_graph_json}
Previously rejected candidates: {rejected_block}
Your job is to refine the Procedural Graph. Follow these guidelines based on the mode:
• static_onetime / static_incremental: Prune edges/nodes that lead to loops, deadlocks, or failures. Add missing nodes and edges that could fix the failures and improve performance for future tasks.
• scratch_onetime / scratch_incremental: If starting from scratch (the graph contains only Start → End), synthesize a brand new, complete Procedural Graph using the Available Tool Actions list, Status, and successful patterns in the trajectories. Otherwise, prune edges/nodes that lead to loops, deadlocks, or failures, and add missing nodes and edges based on the given graph.
Rules for nodes and edges.
1. Action Nodes. Any node of type ACTION must match one of the action/tool names in the "Available Tool Actions" list above.
2. Transition Conditions. If an edge has a condition, provide a natural-language semantic precondition under which this transition should fire (e.g., "When dialogue history has been parsed but target constraints are unknown"). Use null if the transition is unconditional.
3. Execution Guidance. For every edge added in add_edges, you MUST provide a guidance string detailing exactly what action to take next and the strategic rationale behind it.
4. Pitfalls. Provide a pitfalls string warning about premature actions, forbidden words, or common formatting pitfalls to avoid during this step.
5. Generality & Leak Prevention. The updated Procedural Graph must guide the agent effectively without overfitting to specific details of a single trajectory. Use high-level conceptual descriptions.
6. Node ID Compatibility. If refining an existing graph (static modes), you MUST preserve the existing node IDs (such as Month_Start, Decide_Capital, and the tool names) so they remain compatible with the environment's state tracker. Do not rename them.
7. Graph Structure. Follow the task's configured cycle policy. Every edge must reference existing nodes, and every node must have a directed path to a terminal node. The environment loop handles repetition across simulation cycles.
Please propose the exact set of edits to perform. You must output your edits as a single valid JSON block containing four arrays: add_nodes, delete_nodes, add_edges, and delete_edges. Output format must be exactly:
{
"add_nodes": [{"id":..., "type": "ACTION", "description":...}],
"delete_nodes": ["node_id"],
"add_edges": [{"source":..., "target":..., "relation":..., "condition":..., "guidance":..., "pitfalls":...}],
"delete_edges": [{"source":..., "target":...}]
}
Make sure to output ONLY the raw JSON block. Each entry in delete_edges removes all edges with the specified source and target, regardless of relation. To retain selected transitions between the same endpoints, include them in add_edges, which is applied after deletion.
`;

/** Full-graph `{graph_context_desc}` binding (paper text). */
export const FULL_GRAPH_CONTEXT_DESC =
  'the complete Procedural Graph governing the task structure and strategic guidance';

/** Full-graph `{graph_source}` binding (paper text). */
export const FULL_GRAPH_SOURCE = 'complete Procedural Graph';

/** Local-subgraph `{graph_context_desc}` binding (MemoryJS wording). */
export const LOCAL_GRAPH_CONTEXT_DESC =
  "the localized Procedural Graph neighborhood around the agent's active node";

/** Local-subgraph `{graph_source}` binding. */
export const LOCAL_GRAPH_SOURCE = 'local subgraph';

/**
 * Replace `{identifier}` tokens whose names appear in `bindings`.
 * Literal JSON braces in the refiner output-format block are left intact
 * because they do not match `/\{([a-z_]+)\}/g`.
 *
 * @throws when a matched placeholder is not present in `bindings` (programmer error)
 */
export function renderTemplate(template: string, bindings: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (_match: string, name: string): string => {
    if (!(name in bindings)) {
      throw new Error(`Unbound placeholder: ${name}`);
    }
    return bindings[name];
  });
}
