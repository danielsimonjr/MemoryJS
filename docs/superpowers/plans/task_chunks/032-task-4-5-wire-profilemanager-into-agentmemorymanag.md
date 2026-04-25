### Task 4.5: Wire ProfileManager into AgentMemoryManager

**Files:**
- Modify: `src/agent/AgentMemoryManager.ts`
- Modify: `src/agent/AgentMemoryConfig.ts`
- Modify: `src/index.ts` (add exports)
- Test: `tests/integration/agent/agent-memory-manager-profile.test.ts` (create)

- [x] **Step 1: Write the failing test**

Create `tests/integration/agent/agent-memory-manager-profile.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager exposes ProfileManager', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-amm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('profileManager getter returns a ProfileManager instance', () => {
    const amm = ctx.agentMemory();
    expect(amm.profileManager).toBeDefined();
    expect(typeof amm.profileManager.getProfile).toBe('function');
  });

  it('getProfile works via facade', async () => {
    const amm = ctx.agentMemory();
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
    const profile = await amm.profileManager.getProfile();
    expect(profile.static).toContain('Prefers TypeScript');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/agent/agent-memory-manager-profile.test.ts`
Expected: FAIL — `profileManager` getter does not exist.

- [x] **Step 3: Add config slice**

In `src/agent/AgentMemoryConfig.ts`:

```typescript
import type { ProfileManagerConfig } from './ProfileManager.js';

// In the AgentMemoryConfig interface:
profile?: ProfileManagerConfig;
```

- [x] **Step 4: Add ProfileManager getter in AgentMemoryManager**

In `src/agent/AgentMemoryManager.ts`:

```typescript
import { ProfileManager } from './ProfileManager.js';

// Alongside other private lazy fields (around line 145):
private _profileManager?: ProfileManager;

// Alongside other getters (around line 278):
get profileManager(): ProfileManager {
  return (this._profileManager ??= new ProfileManager(
    this.storage,
    this.entityManager,
    this.observationManager,
    this.sessionManager,
    this.salienceEngine,
    this.config.profile ?? {}
  ));
}
```

Note: `AgentMemoryManager` needs references to `entityManager` and `observationManager`. If these are not already accessible via `this.storage` context, add them as constructor parameters from `ManagerContext`.

- [x] **Step 5: Add session:ended auto-extract hook**

In `src/agent/AgentMemoryManager.ts`, in the constructor (after event emitter setup):

```typescript
  private wireProfileAutoExtract(): void {
    if (this.config.profile?.autoExtract === false) return;
    this.on('session:ended', async (session: any) => {
      try {
        await this.profileManager.extractFromSession(session.id);
      } catch (err) {
        console.error('ProfileManager auto-extract failed:', err);
      }
    });
  }
```

Call `this.wireProfileAutoExtract()` at the end of the constructor.

- [x] **Step 6: Export ProfileManager from index.ts**

In `src/index.ts`:

```typescript
export { ProfileManager } from './agent/ProfileManager.js';
export type { ProfileResponse, ProfileManagerConfig, ProfileOptions } from './agent/ProfileManager.js';
export { isProfileEntity } from './types/agent-memory.js';
export type { ProfileEntity } from './types/agent-memory.js';
```

- [x] **Step 7: Run test + typecheck**

Run: `npx vitest run tests/integration/agent/agent-memory-manager-profile.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 8: Commit**

Message: `feat(agent): Wire ProfileManager into AgentMemoryManager facade`

---
