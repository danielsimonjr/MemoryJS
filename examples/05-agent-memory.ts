/**
 * 05 - Agent memory: sessions, working and episodic memory, turn dedup,
 * wake-up context, and decay.
 *
 * Run: bun run examples/05-agent-memory.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    const agent = ctx.agentMemory({
      decay: { halfLifeHours: 168, minImportance: 0.1 },
    });

    // Sessions scope working and episodic memory.
    const session = await agent.startSession({ agentId: 'support-bot', goalDescription: 'Answer billing questions' });
    const sessionId = session.name;

    const working = await agent.addWorkingMemory({
      sessionId,
      content: 'User prefers dark mode and short answers',
      importance: 7,
      ttlHours: 24,
    });
    const episode = await agent.createEpisode('Resolved a duplicate-charge ticket', {
      sessionId,
      importance: 8,
    });

    // Turn-aware conversation memory with four-tier dedup.
    const first = await ctx.memoryEngine.addTurn('How do I update my card?', {
      sessionId,
      role: 'user',
      importance: 6,
    });
    const repeat = await ctx.memoryEngine.addTurn('How do I update my card?', {
      sessionId,
      role: 'user',
    });
    const turns = await ctx.memoryEngine.getSessionTurns(sessionId, { role: 'user' });

    // A billing skill; the taskHint below selects it into the wake-up L1 layer.
    await ctx.skillManager.add({
      name: 'Billing dispute triage',
      description: 'Use for billing disputes and duplicate charges',
      kind: 'procedure',
      scope: { domains: ['billing'] },
      uncertainty: 0.1,
      body: 'Confirm the charge, then refund duplicates.',
    });

    // Token-budgeted wake-up block. Shared knowledge (instructions + matched skills)
    // is passed in with `knowledge`; `taskHint` selects skills for this task.
    const wakeUp = await agent.wakeUp({
      knowledge: ctx.knowledgeRepository,
      taskHint: 'billing dispute',
      maxL0Tokens: 300,
      maxL1Tokens: 400,
    });

    const context = await agent.retrieveForContext({ sessionId, maxTokens: 800, includeEpisodicRecent: true });

    // Decay: effective importance falls over time; a cycle reports what it saw.
    const cycle = await agent.runDecayCycle();
    await agent.confirmMemory(working.name, 0.1);
    const timeline = await agent.getTimeline(sessionId);

    await agent.endSession(sessionId);

    return {
      sessionIsSession: session.entityType === 'session',
      episodeType: episode.memoryType,
      workingType: working.memoryType,
      firstTurnDuplicate: first.duplicateDetected,
      repeatTurnDuplicate: repeat.duplicateDetected,
      repeatCount: ctx.memoryEngine.getRepeatedTurnCount(sessionId),
      userTurnCount: turns.length,
      wakeUpMentionsSkill: wakeUp.l1.includes('Billing dispute triage'),
      contextHasMemories: context.memories.length > 0,
      decayProcessed: cycle.decay.entitiesProcessed >= 0,
      timelineNonEmpty: timeline.length > 0,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-05-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
