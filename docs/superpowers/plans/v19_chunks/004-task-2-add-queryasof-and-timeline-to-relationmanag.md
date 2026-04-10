## Task 2: Add `queryAsOf` and `timeline` to RelationManager

**Files:**
- Modify: `src/core/RelationManager.ts`
- Modify: `tests/unit/core/relation-manager-temporal.test.ts` (add tests)

- [ ] **Step 1: Add tests to existing file**

Append to `tests/unit/core/relation-manager-temporal.test.ts`:

```typescript
describe('RelationManager.queryAsOf', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-qa-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
      { name: 'nova', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-01-01', validUntil: '2025-12-31' },
      },
      {
        from: 'kai',
        to: 'nova',
        relationType: 'works_on',
        properties: { validFrom: '2026-01-01' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only relations valid at the given date', async () => {
    const mid2025 = await ctx.relationManager.queryAsOf('kai', '2025-06-15');
    expect(mid2025.map(r => r.to)).toEqual(['orion']);

    const mid2026 = await ctx.relationManager.queryAsOf('kai', '2026-06-15');
    expect(mid2026.map(r => r.to)).toEqual(['nova']);
  });

  it('includes relations without validFrom (always valid start)', async () => {
    await ctx.relationManager.createRelations([
      { from: 'kai', to: 'kai', relationType: 'self', properties: {} },
    ]);
    const result = await ctx.relationManager.queryAsOf('kai', '2020-01-01');
    expect(result.some(r => r.relationType === 'self')).toBe(true);
  });

  it('supports direction filter', async () => {
    const outgoing = await ctx.relationManager.queryAsOf('kai', '2026-06-15', {
      direction: 'outgoing',
    });
    expect(outgoing.length).toBeGreaterThan(0);
    expect(outgoing.every(r => r.from === 'kai')).toBe(true);
  });
});

describe('RelationManager.timeline', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-tl-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
      { name: 'nova', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'nova',
        relationType: 'works_on',
        properties: { validFrom: '2026-01-01' },
      },
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-01-01', validUntil: '2025-12-31' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all relations sorted chronologically by validFrom', async () => {
    const tl = await ctx.relationManager.timeline('kai');
    expect(tl.length).toBe(2);
    expect(tl[0].to).toBe('orion'); // 2025 first
    expect(tl[1].to).toBe('nova');  // 2026 second
  });

  it('includes expired and current relations', async () => {
    const tl = await ctx.relationManager.timeline('kai');
    expect(tl.some(r => r.properties?.validUntil)).toBe(true); // expired
    expect(tl.some(r => !r.properties?.validUntil)).toBe(true); // current
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`

- [ ] **Step 3: Implement queryAsOf and timeline**

Add to `src/core/RelationManager.ts`:

```typescript
  /**
   * Query relations valid at a specific point in time.
   * Filters: validFrom <= asOf AND (validUntil is undefined OR validUntil >= asOf).
   */
  async queryAsOf(
    entityName: string,
    asOf: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' }
  ): Promise<Relation[]> {
    const direction = options?.direction ?? 'both';
    const graph = await this.storage.loadGraph();

    return graph.relations.filter(r => {
      // Direction check
      const matchesDirection =
        direction === 'both'
          ? r.from === entityName || r.to === entityName
          : direction === 'outgoing'
            ? r.from === entityName
            : r.to === entityName;
      if (!matchesDirection) return false;

      // Validity window check
      const vf = r.properties?.validFrom;
      const vu = r.properties?.validUntil;
      if (vf && vf > asOf) return false;     // hasn't started yet
      if (vu && vu < asOf) return false;     // already ended
      return true;
    });
  }

  /**
   * Chronological relation history for an entity.
   * Returns ALL relations (current + expired) sorted by validFrom ascending.
   */
  async timeline(
    entityName: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' }
  ): Promise<Relation[]> {
    const direction = options?.direction ?? 'both';
    const graph = await this.storage.loadGraph();

    const rels = graph.relations.filter(r => {
      if (direction === 'both') return r.from === entityName || r.to === entityName;
      if (direction === 'outgoing') return r.from === entityName;
      return r.to === entityName;
    });

    rels.sort((a, b) => {
      const aFrom = a.properties?.validFrom ?? '';
      const bFrom = b.properties?.validFrom ?? '';
      if (!aFrom && !bFrom) return 0;
      if (!aFrom) return 1;  // nulls last
      if (!bFrom) return -1;
      return aFrom.localeCompare(bFrom);
    });

    return rels;
  }
```

- [ ] **Step 4: Run all temporal tests**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`
Expected: 8 PASS (3 invalidate + 3 queryAsOf + 2 timeline).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```
feat(core): Add RelationManager.queryAsOf() and timeline()

queryAsOf filters relations by validity window at a point in time.
timeline returns all relations chronologically (current + expired).
Both support direction filtering (outgoing/incoming/both).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
