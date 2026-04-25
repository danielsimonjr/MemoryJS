### Task 4.4: Add session-based fact extraction

**Files:**
- Modify: `src/agent/ProfileManager.ts`
- Test: `tests/unit/agent/profile-manager-extraction.test.ts` (create)

- [x] **Step 1: Write the failing test**

Create `tests/unit/agent/profile-manager-extraction.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import type { SessionManager } from '../../../src/agent/SessionManager.js';
import type { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProfileManager.extractFromSession', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pme-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies high-importance low-recency facts as static', async () => {
    const mockSession = {
      getSession: vi.fn(async () => ({
        id: 'sess-1',
        observations: ['User prefers TypeScript', 'Currently debugging auth'],
      })),
    } as unknown as SessionManager;

    const mockSalience = {
      calculateSalience: vi.fn(async (obs: string) => {
        if (obs === 'User prefers TypeScript') {
          return { components: { baseImportance: 0.8, recencyBoost: 0.1 } };
        }
        return { components: { baseImportance: 0.3, recencyBoost: 0.7 } };
      }),
    } as unknown as SalienceEngine;

    const pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      mockSession,
      mockSalience,
      { staticThreshold: 0.6, dynamicRecencyThreshold: 0.5 }
    );

    await pm.extractFromSession('sess-1');
    const profile = await pm.getProfile();
    expect(profile.static).toContain('User prefers TypeScript');
    expect(profile.dynamic).toContain('Currently debugging auth');
  });

  it('dedupes against existing profile facts', async () => {
    const mockSession = {
      getSession: vi.fn(async () => ({
        id: 'sess-1',
        observations: ['Fact A'],
      })),
    } as unknown as SessionManager;

    const mockSalience = {
      calculateSalience: vi.fn(async () => ({
        components: { baseImportance: 0.8, recencyBoost: 0.1 },
      })),
    } as unknown as SalienceEngine;

    const pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      mockSession,
      mockSalience
    );

    await pm.addFact('Fact A', 'static');
    await pm.extractFromSession('sess-1');

    const profile = await pm.getProfile();
    expect(profile.static.filter(f => f === 'Fact A')).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/profile-manager-extraction.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement extractFromSession**

Add to `src/agent/ProfileManager.ts`:

```typescript
  async extractFromSession(sessionId: string): Promise<string[]> {
    if (!this.sessionManager || !this.salienceEngine) {
      return [];
    }

    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return [];

    const observations = (session as any).observations ?? [];
    const staticThreshold = this.config.staticThreshold ?? 0.6;
    const dynamicRecencyThreshold = this.config.dynamicRecencyThreshold ?? 0.5;

    const existing = await this.getProfile();
    const existingSet = new Set([...existing.static, ...existing.dynamic]);

    const added: string[] = [];
    for (const obs of observations) {
      if (existingSet.has(obs)) continue;

      const salience = await this.salienceEngine.calculateSalience(obs, {
        temporalFocus: 'recent' as any,
      });
      const components = (salience as any).components ?? {};
      const baseImportance = components.baseImportance ?? 0;
      const recencyBoost = components.recencyBoost ?? 0;

      let type: 'static' | 'dynamic';
      if (baseImportance >= staticThreshold && recencyBoost < 0.2) {
        type = 'static';
      } else if (recencyBoost >= dynamicRecencyThreshold) {
        type = 'dynamic';
      } else {
        continue;
      }

      await this.addFact(obs, type);
      added.push(obs);
    }

    return added;
  }
```

- [x] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/agent/profile-manager-extraction.test.ts`
Expected: PASS (2 tests).

Message: `feat(agent): Add ProfileManager.extractFromSession`

---
