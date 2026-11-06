/**
 * 13 - Reconstructive memory: Cue-Tag-Content graph built from a dialogue, then reconstructed.
 *
 * Run: bun run examples/13-reconstructive-memory.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext, ReconstructiveMemory, type DialogueTurn } from '../src/index.js';

const dialogue: DialogueTurn[] = [
  { id: 'D1:1', speaker: 'Alice', text: 'I started learning rust in March.', timestamp: '2026-03-02T10:00:00Z' },
  { id: 'D1:2', speaker: 'Bob', text: 'Nice. Are you still using it for the parser project?', timestamp: '2026-03-02T10:01:00Z' },
  { id: 'D1:3', speaker: 'Alice', text: 'Yes, the parser is rewritten in rust now.', timestamp: '2026-04-10T09:30:00Z' },
];

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    // Backed by this context's entity manager, relation manager and semantic search by default,
    // so the distilled memories are durable and searchable. Without an LLM the deterministic
    // heuristics distil the turns.
    const memory = ctx.reconstructiveMemory();

    // Construction: rewrite, tag and cue extraction, semantic facts, topic abstraction.
    const distilled = await memory.ingest(dialogue);

    // Reconstruction: the loop picks traversal actions, accumulates evidence, and stops.
    const result = await memory.reconstruct('What language did Alice learn?', {
      maxSteps: 4,
      perStepBudget: 5,
      evidenceTarget: 3,
    });

    const stats = memory.stats();
    // A snapshot restores the graph without any storage backing.
    const restored = new ReconstructiveMemory({ snapshot: memory.toSnapshot() });

    return {
      sentencesDistilled: distilled.sentences.length,
      evidenceItems: result.evidence.length,
      trajectorySteps: result.trajectory.length,
      contentNodes: stats.contents,
      restoredContentNodes: restored.stats().contents,
      persisted: memory.lastPersistResult !== undefined,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-13-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
