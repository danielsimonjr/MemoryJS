## Task 5: Add `writeDiary` and `readDiary` to AgentMemoryManager

**Files:**
- Modify: `src/agent/AgentMemoryManager.ts`
- Modify: `src/core/EntityManager.ts` (reserve diary-* namespace)
- Test: `tests/unit/agent/agent-memory-manager-diary.test.ts` (create)

- [x] **Step 1: Write the failing test**

Create `tests/unit/agent/agent-memory-manager-diary.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager diary', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-diary-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeDiary creates diary entity on first write', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Found auth bypass in PR#42');
    const entity = await ctx.entityManager.getEntity('diary-reviewer');
    expect(entity).toBeDefined();
    expect(entity!.entityType).toBe('diary');
    expect(entity!.importance).toBe(8);
  });

  it('writeDiary appends timestamped observations', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Entry one');
    await amm.writeDiary('reviewer', 'Entry two');
    const entity = await ctx.entityManager.getEntity('diary-reviewer');
    expect(entity!.observations).toHaveLength(2);
    expect(entity!.observations[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
  });

  it('readDiary returns entries in reverse chronological order', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'First');
    await amm.writeDiary('reviewer', 'Second');
    const entries = await amm.readDiary('reviewer');
    expect(entries[0]).toContain('Second');
    expect(entries[1]).toContain('First');
  });

  it('readDiary filters by topic', async () => {
    const amm = ctx.agentMemory();
    await amm.writeDiary('reviewer', 'Auth issue', { topic: 'security' });
    await amm.writeDiary('reviewer', 'Style issue', { topic: 'style' });
    const security = await amm.readDiary('reviewer', { topic: 'security' });
    expect(security).toHaveLength(1);
    expect(security[0]).toContain('Auth issue');
  });

  it('readDiary returns empty for nonexistent agent', async () => {
    const amm = ctx.agentMemory();
    const entries = await amm.readDiary('nonexistent');
    expect(entries).toEqual([]);
  });

  it('diary-* namespace is reserved for non-diary entities', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'diary-test', entityType: 'person', observations: [] },
      ])
    ).rejects.toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/agent-memory-manager-diary.test.ts`

- [x] **Step 3: Reserve diary-* namespace in EntityManager**

In `src/core/EntityManager.ts`, find the existing `profile-*` namespace check (added in v1.8.0) and extend it:

```typescript
    // Reserve the profile-* and diary-* namespaces
    for (const e of validation.data) {
      if (e.name.startsWith('profile-') && e.entityType !== 'profile') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the profile system. ` +
          `Use entityType='profile' or choose a different name.`,
          []
        );
      }
      if (e.name.startsWith('diary-') && e.entityType !== 'diary') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the diary system. ` +
          `Use entityType='diary' or choose a different name.`,
          []
        );
      }
    }
```

- [x] **Step 4: Implement writeDiary and readDiary**

Add to `src/agent/AgentMemoryManager.ts`:

```typescript
  /**
   * Write a timestamped diary entry for a specialist agent.
   * Stored as an observation on entity 'diary-{agentId}'.
   */
  async writeDiary(
    agentId: string,
    entry: string,
    options?: { topic?: string; tags?: string[] }
  ): Promise<void> {
    const entityName = `diary-${agentId}`;
    const timestamp = new Date().toISOString();
    const topicPrefix = options?.topic ? ` [${options.topic}]` : '';
    const formatted = `[${timestamp}]${topicPrefix} ${entry}`;

    const graph = await this.storage.loadGraph();
    const existing = graph.entities.find((e: any) => e.name === entityName);

    if (!existing) {
      const { EntityManager } = await import('../core/EntityManager.js');
      const em = new EntityManager(this.storage as any);
      await em.createEntities([{
        name: entityName,
        entityType: 'diary',
        observations: [formatted],
        importance: 8,
      }]);
    } else {
      const { ObservationManager } = await import('../core/ObservationManager.js');
      const om = new ObservationManager(this.storage as any);
      await om.addObservations([{ entityName, contents: [formatted] }]);
    }
  }

  /**
   * Read recent diary entries for a specialist agent.
   * Returns entries in reverse chronological order.
   */
  async readDiary(
    agentId: string,
    options?: { lastN?: number; topic?: string }
  ): Promise<string[]> {
    const entityName = `diary-${agentId}`;
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find((e: any) => e.name === entityName);

    if (!entity) return [];

    let entries = [...entity.observations];

    // Filter by topic
    if (options?.topic) {
      entries = entries.filter(e => e.includes(`[${options.topic}]`));
    }

    // Sort reverse-chronological (timestamps at start make lexicographic sort work)
    entries.sort((a, b) => b.localeCompare(a));

    // Limit
    const limit = options?.lastN ?? 10;
    return entries.slice(0, limit);
  }
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent/agent-memory-manager-diary.test.ts`
Expected: 6 PASS.

- [x] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```
feat(agent): Add AgentMemoryManager.writeDiary/readDiary

Specialist agent diary system. Each agent gets a diary-{agentId}
entity with timestamped, topic-tagged observations. Supports
reverse-chronological reading with topic filtering.
diary-* namespace reserved in EntityManager.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
