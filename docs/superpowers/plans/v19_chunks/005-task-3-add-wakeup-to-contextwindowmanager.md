## Task 3: Add `wakeUp` to ContextWindowManager

**Files:**
- Modify: `src/agent/ContextWindowManager.ts`
- Modify: `src/agent/AgentMemoryConfig.ts` (add wakeUp config)
- Test: `tests/unit/agent/context-window-manager-wakeup.test.ts` (create)

- [x] **Step 1: Write the failing test**

Create `tests/unit/agent/context-window-manager-wakeup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ContextWindowManager.wakeUp', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));

    // Create some entities with observations
    await ctx.entityManager.createEntities([
      { name: 'proj-alpha', entityType: 'project', observations: ['Uses React', 'Deployed on AWS'], importance: 8 },
      { name: 'proj-beta', entityType: 'project', observations: ['Uses Vue'], importance: 5 },
    ]);

    // Create a profile with static facts
    const amm = ctx.agentMemory();
    await amm.profileManager.addFact('Senior developer', 'static');
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns L0 with profile static facts', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l0).toContain('Senior developer');
    expect(result.l0).toContain('Prefers TypeScript');
  });

  it('returns L1 with top entities by salience', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp();
    expect(result.l1).toBeTruthy();
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('respects maxL0Tokens budget', async () => {
    const amm = ctx.agentMemory();
    const result = await amm.contextWindowManager.wakeUp({ maxL0Tokens: 10 });
    // With only 10 tokens, L0 should be truncated
    expect(result.totalTokens).toBeLessThan(50);
  });

  it('returns empty L0 when no profile exists', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-wu2-'));
    const ctx2 = new ManagerContext(path.join(tmpDir2, 'memory.jsonl'));
    const amm2 = ctx2.agentMemory();
    const result = await amm2.contextWindowManager.wakeUp();
    expect(result.l0).toBe('');
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/context-window-manager-wakeup.test.ts`

- [x] **Step 3: Add wakeUp config to AgentMemoryConfig**

In `src/agent/AgentMemoryConfig.ts`, add to the `AgentMemoryConfig` interface:

```typescript
  /** Wake-up context configuration */
  wakeUp?: {
    defaultMaxL0Tokens?: number;  // default 100
    defaultMaxL1Tokens?: number;  // default 500
  };
```

- [x] **Step 4: Implement wakeUp**

Add to `src/agent/ContextWindowManager.ts`:

First add the types near the top of the file:

```typescript
export interface WakeUpOptions {
  projectId?: string;
  maxL0Tokens?: number;
  maxL1Tokens?: number;
  includeL1?: boolean;
}

export interface WakeUpResult {
  l0: string;
  l1: string;
  totalTokens: number;
  entityCount: number;
}
```

Then add the method to the class:

```typescript
  /**
   * Generate compact wake-up context for LLM system prompts.
   * L0 (~100 tokens): identity from ProfileManager static facts.
   * L1 (~500 tokens): top entities by salience, formatted compactly.
   */
  async wakeUp(options: WakeUpOptions = {}): Promise<WakeUpResult> {
    const maxL0 = options.maxL0Tokens ?? this.config.wakeUp?.defaultMaxL0Tokens ?? 100;
    const maxL1 = options.maxL1Tokens ?? this.config.wakeUp?.defaultMaxL1Tokens ?? 500;
    const includeL1 = options.includeL1 ?? true;

    // L0: Profile static facts
    let l0 = '';
    try {
      const profileManager = new (await import('./ProfileManager.js')).ProfileManager(
        this.storage as any,
        new (await import('../core/EntityManager.js')).EntityManager(this.storage as any),
        new (await import('../core/ObservationManager.js')).ObservationManager(this.storage as any),
      );
      const profile = await profileManager.getProfile({ projectId: options.projectId });
      if (profile.static.length > 0) {
        l0 = profile.static.join('. ') + '.';
        // Truncate to token budget
        while (this.estimateTokens(l0) > maxL0 && l0.length > 10) {
          const lastDot = l0.lastIndexOf('.', l0.length - 2);
          if (lastDot <= 0) break;
          l0 = l0.slice(0, lastDot + 1);
        }
      }
    } catch {
      // ProfileManager not available — L0 stays empty
    }

    // L1: Top entities by importance (simplified salience)
    let l1 = '';
    let entityCount = 0;
    if (includeL1) {
      try {
        const graph = await this.storage.loadGraph();
        let entities = graph.entities
          .filter((e: any) => e.isLatest !== false && e.entityType !== 'profile' && e.entityType !== 'diary');

        if (options.projectId) {
          entities = entities.filter((e: any) => e.projectId === options.projectId);
        }

        // Sort by importance descending, take top entities fitting in budget
        entities.sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0));

        const lines: string[] = [];
        let tokenCount = 0;
        for (const e of entities) {
          const obs = e.observations?.slice(0, 3).join('; ') ?? '';
          const line = `[${e.entityType}] ${e.name}: ${obs}`;
          const lineTokens = this.estimateTokens(line);
          if (tokenCount + lineTokens > maxL1) break;
          lines.push(line);
          tokenCount += lineTokens;
          entityCount++;
        }
        l1 = lines.join('\n');
      } catch {
        // Storage not available
      }
    }

    const totalTokens = this.estimateTokens(l0) + this.estimateTokens(l1);
    return { l0, l1, totalTokens, entityCount };
  }
```

**NOTE**: The dynamic imports are a pragmatic approach to avoid adding constructor dependencies. The ContextWindowManager already has `storage` — we create lightweight ProfileManager/EntityManager/ObservationManager instances from it. If the implementer finds a cleaner way to access ProfileManager (e.g. via a setter like ContradictionDetector uses), prefer that.

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent/context-window-manager-wakeup.test.ts`
Expected: 4 PASS.

- [x] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```
feat(agent): Add ContextWindowManager.wakeUp() for memory stack

4-layer memory stack inspired by mempalace. L0 loads profile
identity (~100 tokens), L1 loads top entities by importance
(~500 tokens). L2/L3 are on-demand search (existing methods).
Wake-up cost: ~600 tokens, leaving 95%+ of context free.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
