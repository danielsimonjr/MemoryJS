/** LearningFacade routing and wiring (spec §3.7 S4, S5, N4). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const captured = vi.hoisted(() => ({ merger: [] as unknown[], reflector: [] as unknown[] }));
vi.mock('../../../src/agent/learning/RevisionMerger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/agent/learning/RevisionMerger.js')>();
  class SpyMerger extends mod.RevisionMerger {
    constructor(deps: ConstructorParameters<typeof mod.RevisionMerger>[0] = {}) {
      super(deps);
      captured.merger.push(deps);
    }
  }
  return { ...mod, RevisionMerger: SpyMerger };
});
vi.mock('../../../src/agent/learning/LearningReflector.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/agent/learning/LearningReflector.js')>();
  class SpyReflector extends mod.LearningReflector {
    constructor(...args: ConstructorParameters<typeof mod.LearningReflector>) {
      super(...args);
      captured.reflector.push(args[2]);
    }
  }
  return { ...mod, LearningReflector: SpyReflector };
});

import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { leafThresholdOf, usesRecursiveLearner } from '../../../src/core/context/LearningFacade.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import { taskFor } from '../agent/learning/leafFixtures.js';

const dirs: string[] = [];
const saved = process.env.MEMORY_LEARNING_LEAF_THRESHOLD;
afterEach(() => {
  if (saved === undefined) delete process.env.MEMORY_LEARNING_LEAF_THRESHOLD;
  else process.env.MEMORY_LEARNING_LEAF_THRESHOLD = saved;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tasks = (n: number) => Array.from({ length: n }, (_, i) => taskFor(`t-${i}`, `v${i}`));

describe('LearningFacade', () => {
  it('S5: MEMORY_LEARNING_LEAF_THRESHOLD is read strictly, default 20, opts override', () => {
    delete process.env.MEMORY_LEARNING_LEAF_THRESHOLD;
    expect(leafThresholdOf({})).toBe(20);
    expect(usesRecursiveLearner({ tasks: tasks(20) })).toBe(false);
    expect(usesRecursiveLearner({ tasks: tasks(21) })).toBe(true);
    process.env.MEMORY_LEARNING_LEAF_THRESHOLD = '3';
    expect(leafThresholdOf({})).toBe(3);
    expect(usesRecursiveLearner({ tasks: tasks(4) })).toBe(true);
    expect(usesRecursiveLearner({ tasks: tasks(4), leafThreshold: 10 })).toBe(false);
    process.env.MEMORY_LEARNING_LEAF_THRESHOLD = '3.5';
    expect(leafThresholdOf({})).toBe(20);
    expect(usesRecursiveLearner({ tasks: tasks(2), split: 'byCategory' })).toBe(true);
    expect(usesRecursiveLearner({ tasks: tasks(1), split: 'byCategory' })).toBe(false);
  });

  it('S4 + N4: the merger and reflector get the llmProvider; next/submit reject a recursive trace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'recursa-facade-'));
    dirs.push(dir);
    const ctx = new ManagerContext(join(dir, 'memory.jsonl'));
    const llmProvider = { complete: vi.fn(async () => 'not json') };
    const loop = ctx.learningLoop({ solver: { async solve() { return { answer: '', traceAddrs: [] }; } }, judge: new DeterministicJudge(), llmProvider });
    expect(captured.merger.at(-1)).toEqual({ llmProvider });
    expect(captured.reflector.at(-1)).toEqual({ llmProvider });
    const ts = tasks(3);
    const state = await loop.start({ taskIds: ts.map((t) => t.id), tasks: ts, budget: { maxRounds: 1 }, split: 'byCategory' });
    await expect(loop.next(state.traceId)).rejects.toThrow(/recursive run; drive it with plan \/ submitChild \/ merge \/ reflect/);
    await expect(loop.submit(state.traceId, 'solve', {})).rejects.toThrow(/learningLoop.submit/);
  });
});
