import { describe, it, expect } from 'vitest';
import {
  GUIDANCE_PROMPT_TEMPLATE,
  REFINER_PROMPT_TEMPLATE,
  renderTemplate,
} from '../../../../../src/agent/procedural/graph/prompts.js';

describe('prompts', () => {
  it("guidance template contains the exact sentence 'You must include any specific command patterns, file paths, tools, or arguments defined in the graph context if they are relevant to the next steps.'", () => {
    expect(GUIDANCE_PROMPT_TEMPLATE).toContain(
      'You must include any specific command patterns, file paths, tools, or arguments defined in the graph context if they are relevant to the next steps.',
    );
  });

  it('refiner template contains rule 6 verbatim', () => {
    expect(REFINER_PROMPT_TEMPLATE).toContain(
      '6. Node ID Compatibility. If refining an existing graph (static modes), you MUST preserve the existing node IDs (such as Month_Start, Decide_Capital, and the tool names) so they remain compatible with the environment\'s state tracker. Do not rename them.',
    );
  });

  it('renderTemplate throws on unbound placeholder', () => {
    expect(() => renderTemplate('Hello {name}', {})).toThrow();
    expect(() =>
      renderTemplate(GUIDANCE_PROMPT_TEMPLATE, { task_description: 't' }),
    ).toThrow(/Unbound placeholder/);
  });

  it('renderTemplate leaves JSON braces inside the refiner template intact', () => {
    const rendered = renderTemplate(REFINER_PROMPT_TEMPLATE, {
      task_description: 'task',
      mode: 'static_onetime',
      available_tools_list: 'Search',
      attempts_block: 'attempts',
      current_graph_json: '{"nodes":[]}',
      rejected_block: 'none',
    });
    expect(rendered).toContain('"add_nodes":');
    expect(rendered).toContain('"delete_nodes":');
    expect(rendered).toContain('"add_edges":');
    expect(rendered).toContain('"delete_edges":');
    expect(rendered).toContain(
      '{\n"add_nodes": [{"id":..., "type": "ACTION", "description":...}],',
    );
    expect(rendered).toContain('"delete_edges": [{"source":..., "target":...}]\n}');
    expect(rendered).not.toContain('{task_description}');
    expect(rendered).toContain('Task context: task');
  });
});
