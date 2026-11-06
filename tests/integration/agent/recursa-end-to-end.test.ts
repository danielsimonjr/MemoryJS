/**
 * Recursa end to end (Phase 5): bootstrap a synthetic corpus, run the recursive learner over the
 * practice tasks with a knowledge-dependent scripted solver, publish SKILL.md files, read the trace
 * tree back and render it, then close the context and remove the temp directory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { LearningTrace } from '../../../src/agent/learning/LearningTrace.js';
import { skillNameFor } from '../../../src/agent/bootstrap/ExplorationNotes.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import type { LearningSolver } from '../../../src/agent/learning/types.js';
import type { TaskRecord } from '../../../src/types/learning.js';
import { syntheticCorpus } from '../../unit/agent/bootstrap/bootstrapFixtures.js';

let root: string | undefined;
let context: ManagerContext | undefined;

/**
 * Collect every file named `SKILL.md` under a directory.
 *
 * @param dir - Directory to scan.
 * @returns Absolute paths of the files found.
 */
function skillFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...skillFiles(path));
    else if (name === 'SKILL.md') out.push(path);
  }
  return out;
}

afterEach(async () => {
  if (context) await context.close();
  context = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('Recursa end to end', () => {
  it('bootstraps, learns recursively, publishes skills, reads the trace tree and removes its temp dir', async () => {
    const previousType = process.env.MEMORY_STORAGE_TYPE;
    process.env.MEMORY_STORAGE_TYPE = 'jsonl';
    try {
      root = mkdtempSync(join(tmpdir(), 'recursa-e2e-'));
      const publishDir = join(root, 'skills');
      context = new ManagerContext({ storagePath: join(root, 'memory.jsonl'), skillPublishRoot: root });
      const ctx = context;

      const boot = await ctx.bootstrapper({ learning: { publishDir } }).run({
        sources: syntheticCorpus(12, 5),
        budget: { maxRounds: 2 },
        corpusLabel: 'corpus',
      });
      expect(boot.taskIds).toHaveLength(12);
      expect(ctx.skillManager.get(boot.notesSkillId)?.name).toBe(skillNameFor('corpus'));

      const graph = await ctx.storage.loadGraph();
      const tasks = boot.taskIds
        .map((id) => graph.entities.find((e) => e.name === id)?.taskRecord)
        .filter((t): t is TaskRecord => t !== undefined)
        // Lexical skill matching needs the hint to share tokens with the learned skill's name.
        .map((t) => ({ ...t, input: `Learned ${t.id}` }));
      expect(tasks).toHaveLength(12);

      // Knowledge-dependent solver: a task passes when its learned skill (or the exploration notes) is loaded.
      const notes = skillNameFor('corpus');
      const solver: LearningSolver = {
        async solve(task, knowledge) {
          const known = knowledge.markdown.includes(`Learned: ${task.id}`) || knowledge.markdown.includes(notes);
          return { answer: known ? String(task.rubric[0]?.expected ?? '') : 'unknown', traceAddrs: [] };
        },
      };
      const loop = ctx.learningLoop({ solver, judge: new DeterministicJudge(), publishDir });
      const result = await loop.learn({
        taskIds: boot.taskIds,
        tasks,
        budget: { maxRounds: 3 },
        validationSampleSize: 4,
        split: 'auto',
      });
      expect(result.traceId).toBeTruthy();

      const published = skillFiles(publishDir);
      expect(published.length).toBeGreaterThanOrEqual(1);

      const traces = new LearningTrace(ctx.storage, { entityManager: ctx.entityManager, relationManager: ctx.relationManager });
      const tree = await traces.load(result.traceId);
      expect(tree.record.learnerKind).toBe('recursive');
      expect(tree.children.length).toBeGreaterThan(0);
      const mermaid = traces.toMermaid(tree);
      expect(mermaid.length).toBeGreaterThan(0);
      expect(mermaid).toContain('recursive');

      await ctx.close();
      context = undefined;
      rmSync(root, { recursive: true, force: true });
      expect(existsSync(root)).toBe(false);
      root = undefined;
    } finally {
      if (previousType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
      else process.env.MEMORY_STORAGE_TYPE = previousType;
    }
  });
});
