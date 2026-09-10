/**
 * ProceduralGraphRefiner unit tests (Wave 1 / Agent D).
 *
 * Sibling modules (`prompts`, `CompletionProvider`, `ProceduralGraphSchemas`)
 * are owned by other agents and may be absent in this worktree. Behavior
 * stubs live only here via `vi.mock`, matching Section 4 signatures.
 *
 * Vitest 5's native loader calls `nextResolve` before applying `vi.mock`,
 * so a missing sibling file throws before the factory can run. If the
 * files are not already on disk (Agents A/C), this file writes throwaway
 * resolve stubs and deletes only the files it created.
 */

import { afterAll, describe, it, expect, vi } from 'vitest';
import { unlinkSync } from 'node:fs';
import type {
  PGDiagnostic,
  PGEditSet,
  PGRejectionRecord,
} from '../../../../../src/types/proceduralGraph.js';
import {
  buildRefinerPrompt,
  proposeEdits,
  serializeRejections,
  type PGRefinerInput,
} from '../../../../../src/agent/procedural/graph/ProceduralGraphRefiner.js';

const createdSiblingStubs = vi.hoisted(() => {
  const fs = process.getBuiltinModule('fs');
  const path = process.getBuiltinModule('path');
  const dir = path.join(process.cwd(), 'src/agent/procedural/graph');
  fs.mkdirSync(dir, { recursive: true });
  const stubs: Array<[string, string]> = [
    ['CompletionProvider.ts', 'export async function completeWithBudget() { throw new Error("unmocked completeWithBudget"); }\n'],
    ['ProceduralGraphSchemas.ts', 'export function parseEditSet() { throw new Error("unmocked parseEditSet"); }\n'],
    ['prompts.ts', 'export const REFINER_PROMPT_TEMPLATE = "";\nexport function renderTemplate() { return ""; }\n'],
  ];
  const created: string[] = [];
  for (const [name, source] of stubs) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, source);
      created.push(file);
    }
  }
  return created;
});

afterAll(() => {
  for (const file of createdSiblingStubs) {
    try {
      unlinkSync(file);
    } catch {
      // already removed or replaced by the owning agent
    }
  }
});

vi.mock('../../../../../src/agent/procedural/graph/prompts.js', () => ({
  REFINER_PROMPT_TEMPLATE: [
    'Task context: {task_description}',
    'Refinement mode: {mode}',
    'Available Tool Actions (the agent can only execute these actions): {available_tools_list}',
    'Recent execution trajectories: {attempts_block}',
    'Current Procedural Graph representation: {current_graph_json}',
    'Previously rejected candidates: {rejected_block}',
    '• static_onetime / static_incremental: prune or add.',
    '• scratch_onetime / scratch_incremental: synthesize or prune.',
  ].join('\n'),
  renderTemplate(template: string, bindings: Record<string, string>): string {
    return template.replace(/\{([a-z_]+)\}/g, (match: string, name: string) =>
      Object.prototype.hasOwnProperty.call(bindings, name) ? bindings[name]! : match,
    );
  },
}));

vi.mock('../../../../../src/agent/procedural/graph/CompletionProvider.js', () => ({
  async completeWithBudget(
    provider: { complete: (prompt: string) => Promise<string> },
    prompt: string,
    opts: { timeoutMs: number; maxOutputChars: number },
  ) {
    const text = await provider.complete(prompt);
    const clipped = text.length > opts.maxOutputChars ? text.slice(0, opts.maxOutputChars) : text;
    return {
      ok: true as const,
      text: clipped,
      usage: {
        input: Math.ceil(prompt.length / 4),
        output: Math.ceil(clipped.length / 4),
        approximate: true,
      },
    };
  },
}));

vi.mock('../../../../../src/agent/procedural/graph/ProceduralGraphSchemas.js', () => ({
  parseEditSet(raw: string) {
    if (raw.includes('```')) {
      return {
        ok: false as const,
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'not-raw-json',
            message: 'Refiner output must be a single raw JSON object',
          },
        ],
      };
    }
    try {
      return { ok: true as const, value: JSON.parse(raw) as PGEditSet };
    } catch (error) {
      return {
        ok: false as const,
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'not-raw-json',
            message: error instanceof Error ? error.message : 'invalid JSON',
          },
        ],
      };
    }
  },
}));

const EMPTY_EDITS: PGEditSet = {
  add_nodes: [],
  delete_nodes: [],
  add_edges: [],
  delete_edges: [],
};

const BASE_INPUT: PGRefinerInput = {
  taskDescription: 'UNIQUE_TASK_DESCRIPTION',
  mode: 'static_incremental',
  toolCatalog: ['UNIQUE_TOOL_ALPHA', 'UNIQUE_TOOL_BETA'],
  attemptsBlock: 'UNIQUE_ATTEMPTS_BLOCK',
  currentGraphJson: '{"graph":"UNIQUE_CURRENT_GRAPH"}',
  rejectedBlock: 'UNIQUE_REJECTED_BLOCK',
};

function rawEditSet(edits: PGEditSet): string {
  return JSON.stringify(edits);
}

function fakeProvider(raw: string) {
  return {
    async complete(_prompt: string): Promise<string> {
      return raw;
    },
  };
}

function rejection(overrides: Partial<PGRejectionRecord> & Pick<PGRejectionRecord, 'reason' | 'recordedAt' | 'round'>): PGRejectionRecord {
  return {
    runId: 'run-1',
    proposalDigest: 'digest',
    edits: EMPTY_EDITS,
    diagnostics: [],
    retainedMean: 0.8,
    retainedRevisionId: 'rev-retained',
    trajectoryRefs: [],
    fingerprint: 'fp',
    ...overrides,
  };
}

describe('ProceduralGraphRefiner', () => {
  it('buildRefinerPrompt binds all six placeholders and contains the mode string', () => {
    const prompt = buildRefinerPrompt(BASE_INPUT);

    expect(prompt).toContain('UNIQUE_TASK_DESCRIPTION');
    expect(prompt).toContain('static_incremental');
    expect(prompt).toContain('UNIQUE_TOOL_ALPHA, UNIQUE_TOOL_BETA');
    expect(prompt).toContain('UNIQUE_ATTEMPTS_BLOCK');
    expect(prompt).toContain('UNIQUE_CURRENT_GRAPH');
    expect(prompt).toContain('UNIQUE_REJECTED_BLOCK');

    expect(prompt).not.toContain('{task_description}');
    expect(prompt).not.toContain('{mode}');
    expect(prompt).not.toContain('{available_tools_list}');
    expect(prompt).not.toContain('{attempts_block}');
    expect(prompt).not.toContain('{current_graph_json}');
    expect(prompt).not.toContain('{rejected_block}');
  });

  it('proposeEdits returns ok for a raw JSON object', async () => {
    const edits: PGEditSet = {
      add_nodes: [{ id: 'lookup', type: 'ACTION', description: 'Look up a fact' }],
      delete_nodes: [],
      add_edges: [
        {
          source: 'Start',
          target: 'lookup',
          relation: 'LEADS_TO',
          condition: null,
          guidance: 'Call lookup when the query is underspecified',
          pitfalls: 'Do not invent tool names',
        },
      ],
      delete_edges: [],
    };
    const raw = rawEditSet(edits);

    const result = await proposeEdits(fakeProvider(raw), BASE_INPUT, {
      timeoutMs: 5_000,
      maxOutputChars: 20_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected proposeEdits to succeed');
    }
    expect(result.raw).toBe(raw);
    expect(result.edits).toEqual(edits);
    expect(result.usage).toEqual(
      expect.objectContaining({
        input: expect.any(Number),
        output: expect.any(Number),
        approximate: true,
      }),
    );
  });

  it('proposeEdits returns parse diagnostics for fenced JSON', async () => {
    const fenced = '```json\n' + rawEditSet(EMPTY_EDITS) + '\n```';

    const result = await proposeEdits(fakeProvider(fenced), BASE_INPUT, {
      timeoutMs: 5_000,
      maxOutputChars: 20_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected proposeEdits to fail on fenced JSON');
    }
    expect(result.raw).toBe(fenced);
    expect(result.diagnostics.some((d: PGDiagnostic) => d.code === 'not-raw-json')).toBe(true);
  });

  it('serializeRejections lists newest first and reports omitted count when over maxRecords', () => {
    const older = rejection({
      reason: 'structural',
      recordedAt: '2026-01-01T00:00:00.000Z',
      round: 1,
      retainedMean: 0.5,
    });
    const middle = rejection({
      reason: 'validation',
      recordedAt: '2026-06-01T00:00:00.000Z',
      round: 2,
      candidateMean: 0.4,
      retainedMean: 0.7,
    });
    const newest = rejection({
      reason: 'parse',
      recordedAt: '2026-09-01T00:00:00.000Z',
      round: 3,
      retainedMean: 0.7,
    });

    const { text, omitted } = serializeRejections([older, newest, middle], {
      maxRecords: 2,
      maxChars: 10_000,
    });

    expect(omitted).toBe(1);
    expect(text.indexOf('reason: parse')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('reason: validation')).toBeGreaterThan(text.indexOf('reason: parse'));
    expect(text).not.toContain('reason: structural');
    expect(text).toContain('candidateMean: 0.4');
    expect(text).toContain('retainedMean: 0.7');
  });

  it('serializeRejections output is bounded by maxChars', () => {
    const long = rejection({
      reason: 'validation',
      recordedAt: '2026-09-01T00:00:00.000Z',
      round: 4,
      candidateMean: 0.1,
      retainedMean: 0.9,
      edits: {
        add_nodes: [{ id: 'n1', type: 'ACTION', description: 'x'.repeat(80) }],
        delete_nodes: ['old'],
        add_edges: [],
        delete_edges: [],
      },
      diagnostics: [
        { severity: 'error', code: 'missing-endpoint', message: 'x'.repeat(200) },
        { severity: 'error', code: 'unknown-relation', message: 'y'.repeat(200) },
        { severity: 'warning', code: 'missing-attribute', message: 'z'.repeat(200) },
        { severity: 'info', code: 'extra', message: 'should not appear' },
      ],
    });

    const maxChars = 80;
    const { text } = serializeRejections([long], { maxRecords: 10, maxChars });
    expect(text.length).toBeLessThanOrEqual(maxChars);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('should not appear');
  });

  it("an add_edges proposal that copies a task-specific literal from attemptsBlock is flagged with warning 'possible-trajectory-leak'", async () => {
    const leaked = 'TASK_SPECIFIC_LITERAL';
    const attemptsBlock = `### Task t1 (score 0)\nAction: search\nObservation: user mentioned ${leaked} in the query`;
    const edits: PGEditSet = {
      add_nodes: [],
      delete_nodes: [],
      add_edges: [
        {
          source: 'Start',
          target: 'End',
          relation: 'LEADS_TO',
          condition: null,
          guidance: `Always mention ${leaked} when summarizing the user request`,
          pitfalls: 'Keep guidance general and reusable',
        },
      ],
      delete_edges: [],
    };

    const result = await proposeEdits(
      fakeProvider(rawEditSet(edits)),
      { ...BASE_INPUT, attemptsBlock },
      { timeoutMs: 5_000, maxOutputChars: 20_000 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('leak heuristic must be warning-only, not fatal');
    }
    expect(result.edits).toEqual(edits);
    expect(result.diagnostics.some(
      (d: PGDiagnostic) => d.code === 'possible-trajectory-leak' && d.severity === 'warning',
    )).toBe(true);
  });
});
