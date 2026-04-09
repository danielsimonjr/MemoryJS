### Task 4.3: Create ProfileManager (getProfile + addFact + promoteFact)

**Files:**
- Create: `src/agent/ProfileManager.ts`
- Test: `tests/unit/agent/profile-manager-basics.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent/profile-manager-basics.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProfileManager basics', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      undefined,
      undefined,
      {}
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty profile when entity does not exist', async () => {
    const result = await pm.getProfile();
    expect(result.static).toEqual([]);
    expect(result.dynamic).toEqual([]);
    expect(result.entityName).toBe('profile-global');
  });

  it('addFact creates profile entity if missing', async () => {
    await pm.addFact('Prefers TypeScript', 'static');
    const entity = await ctx.entityManager.getEntity('profile-global');
    expect(entity).toBeDefined();
    expect(entity!.entityType).toBe('profile');
    expect(entity!.observations).toContain('[static] Prefers TypeScript');
  });

  it('getProfile parses static/dynamic prefixes', async () => {
    await pm.addFact('Stable fact', 'static');
    await pm.addFact('Recent fact', 'dynamic');
    const result = await pm.getProfile();
    expect(result.static).toEqual(['Stable fact']);
    expect(result.dynamic).toEqual(['Recent fact']);
  });

  it('uses sanitized projectId in entity name', async () => {
    await pm.addFact('Fact', 'static', { projectId: 'My Project!' });
    const entity = await ctx.entityManager.getEntity('profile-my-project-');
    expect(entity).toBeDefined();
  });

  it('isolates profiles by project', async () => {
    await pm.addFact('Global fact', 'static');
    await pm.addFact('Project fact', 'static', { projectId: 'p1' });

    const global = await pm.getProfile();
    const scoped = await pm.getProfile({ projectId: 'p1' });

    expect(global.static).toEqual(['Global fact']);
    expect(scoped.static).toEqual(['Project fact']);
  });

  it('promoteFact moves dynamic to static', async () => {
    await pm.addFact('Growing fact', 'dynamic');
    await pm.promoteFact('Growing fact');
    const result = await pm.getProfile();
    expect(result.dynamic).not.toContain('Growing fact');
    expect(result.static).toContain('Growing fact');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/profile-manager-basics.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create ProfileManager**

Create `src/agent/ProfileManager.ts`:

```typescript
/**
 * Profile Manager
 *
 * Manages user profiles stored as Entity instances with entityType 'profile'.
 * Observations are tagged [static] or [dynamic] to classify facts.
 *
 * @module agent/ProfileManager
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { SessionManager } from './SessionManager.js';
import type { SalienceEngine } from './SalienceEngine.js';

const STATIC_PREFIX = '[static] ';
const DYNAMIC_PREFIX = '[dynamic] ';

export interface ProfileResponse {
  static: string[];
  dynamic: string[];
  entityName: string;
}

export interface ProfileManagerConfig {
  staticThreshold?: number;
  dynamicRecencyThreshold?: number;
  maxDynamicFacts?: number;
  autoExtract?: boolean;
}

export interface ProfileOptions {
  projectId?: string;
  agentId?: string;
}

export class ProfileManager {
  constructor(
    private storage: GraphStorage,
    private entityManager: EntityManager,
    private observationManager: ObservationManager,
    private sessionManager?: SessionManager,
    private salienceEngine?: SalienceEngine,
    private config: ProfileManagerConfig = {}
  ) {}

  getProfileEntityName(projectId?: string): string {
    if (!projectId) return 'profile-global';
    const sanitized = projectId.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `profile-${sanitized}`;
  }

  async getProfile(options: ProfileOptions = {}): Promise<ProfileResponse> {
    const entityName = this.getProfileEntityName(options.projectId);
    const entity = await this.entityManager.getEntity(entityName);

    if (!entity) {
      return { static: [], dynamic: [], entityName };
    }

    const staticFacts: string[] = [];
    const dynamicFacts: string[] = [];

    for (const obs of entity.observations) {
      if (obs.startsWith(STATIC_PREFIX)) {
        staticFacts.push(obs.slice(STATIC_PREFIX.length));
      } else if (obs.startsWith(DYNAMIC_PREFIX)) {
        dynamicFacts.push(obs.slice(DYNAMIC_PREFIX.length));
      }
    }

    return { static: staticFacts, dynamic: dynamicFacts, entityName };
  }

  async addFact(
    content: string,
    type: 'static' | 'dynamic',
    options: ProfileOptions = {}
  ): Promise<void> {
    const entityName = this.getProfileEntityName(options.projectId);
    const prefix = type === 'static' ? STATIC_PREFIX : DYNAMIC_PREFIX;
    const prefixed = prefix + content;

    const existing = await this.entityManager.getEntity(entityName);
    if (!existing) {
      await this.entityManager.createEntities([
        {
          name: entityName,
          entityType: 'profile',
          observations: [prefixed],
          importance: 10,
          projectId: options.projectId,
        },
      ]);
      return;
    }

    if (existing.observations.includes(prefixed)) return;

    await this.observationManager.addObservations([
      { entityName, contents: [prefixed] },
    ]);

    if (type === 'dynamic') {
      await this.trimDynamicFacts(entityName);
    }
  }

  async promoteFact(content: string, options: ProfileOptions = {}): Promise<void> {
    const entityName = this.getProfileEntityName(options.projectId);
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return;

    const dynamicTagged = DYNAMIC_PREFIX + content;
    if (!entity.observations.includes(dynamicTagged)) return;

    await this.observationManager.deleteObservations([
      { entityName, observations: [dynamicTagged] },
    ]);
    await this.observationManager.addObservations([
      { entityName, contents: [STATIC_PREFIX + content] },
    ]);
  }

  private async trimDynamicFacts(entityName: string): Promise<void> {
    const max = this.config.maxDynamicFacts ?? 20;
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return;

    const dynamicFacts = entity.observations.filter(o => o.startsWith(DYNAMIC_PREFIX));
    if (dynamicFacts.length <= max) return;

    const toRemove = dynamicFacts.slice(0, dynamicFacts.length - max);
    await this.observationManager.deleteObservations([
      { entityName, observations: toRemove },
    ]);
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/agent/profile-manager-basics.test.ts && npm run typecheck`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

Message: `feat(agent): Add ProfileManager with getProfile/addFact/promoteFact`

---
