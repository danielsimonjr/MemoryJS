# Memorilla — implementation plan

**Status**: plan only. No code in this change.
**Source**: [`MEMORILLA_LATENT_MEMORY_PLAN.md`](./MEMORILLA_LATENT_MEMORY_PLAN.md), Section 4 (E1 to E5, gap review, mixing map, sequencing).

This plan turns E1 to E5 into work cards. Each card is one worker task and one commit. A card gives the exact files, the failing tests to write first and the implementation steps. A card also gives the gates, the commit message, the CHANGELOG text, the stop condition, a reviewer checklist and a rollback.

Line anchors refer to the `master` tip that this plan was written against (`22341f4`). A worker confirms each anchor before the edit (see the stop conditions).

Roles in this plan:

- **Integrator**: the lead session. The integrator creates branches and worktrees, dispatches workers, reviews, cherry-picks, pushes, opens the pull request (PR) and merges.
- **Worker**: one agent that runs one card in one worktree. A worker commits. A worker does not push, merge, tag or release.

---

## 1. Card index

| Card | Title | Goal | Depends on | Worker model | Wave |
|---|---|---|---|---|---|
| W0-DOC | Fix the baseline code-docs gate | `repo-tools docs check src` exits 0 before Wave 1 adds code | none | Haiku | 1 |
| E1a | Embeddings `contentHash` column | The `embeddings` table stores a nullable `contentHash`, and old tables migrate on open | none | Haiku | 1 |
| E1b | Hash-aware `SQLiteVectorStore` | The store loads rows, drops other-model rows, and tracks a hash per vector | E1a | Haiku | 1 |
| E1c | `SemanticSearch` uses the persisted store | Search initializes the store and re-embeds only stale entities | E1b | Haiku | 1 |
| E1d | Context wiring for SQLite | `ctx.semanticSearch` uses `SQLiteVectorStore` when storage is `SQLiteStorage` | E1b (start); revert before E1c | Haiku | 1 |
| W1-CLOSE | Wave 1 close task | Docs, CHANGELOG, generated reports, gates, PR | E1a to E1d, W0-DOC | Sonnet | 1 |
| E2a | Budget-cut report and slot cap | `ContextPackage` reports `sourceTokens` and `compressionRatio`; `maxSlots` caps the result | Wave 1 merged | Haiku | 2 |
| E2b | Query ranking through hybrid search | With `queryText` set, hybrid search orders the candidates; `composeHops` adds one hop | E2a | Sonnet | 2 |
| W2-CLOSE | Wave 2 close task | Docs, CHANGELOG, generated reports, gates, PR | E2a, E2b | Sonnet | 2 |
| E4 | Question-type profiles | `lookup` and `synthesis` profiles; a profile can set `retrieval.composeHops` | Wave 2 merged | Haiku | 3 |
| E5 | Repeat count per session | `MemoryEngine.getRepeatedTurnCount(sessionId)` counts duplicate turns | Wave 2 merged | Haiku | 3 |
| W3-CLOSE | Wave 3 close task | Docs, CHANGELOG, generated reports, gates, PR | E4, E5 | Sonnet | 3 |
| E3a | Query-aware LLM summarizer | **Only if a caller asks.** `SummarizationService` gets an `LLMProvider` path that takes the query | trigger C1 | Haiku | C1 |
| E3b | Summary of excluded memories | **Only if a caller asks.** `summarizeExcluded` adds one summary of the cut memories | E3a | Haiku | C1 |
| E2c | Default wiring of hybrid ranking | **Only after decision Q1.** The context wires hybrid ranking and a `composeHops` setting | trigger C2 | Haiku | C2 |

### 1.1 Why a card uses Sonnet

- **E2b**: the card changes the order of candidates before the salience cut. The worker must keep must-include entities, distillation and the budget loop correct in one path. The scoped graph and the hybrid limit interact with the 100-result semantic cap. Each of these points is a design judgment, not a mechanical edit.
- **Close tasks**: the worker reads gate output, decides which documents describe the changed behavior, and writes STE100 text. The worker also judges whether a regenerated report diff is real or is only a tool-version artifact.

All other cards have exact signatures and test values. Haiku runs them.

### 1.2 Conditional triggers

- **C1 (E3a, E3b)**: start only when an issue or a `todo.md` row names a caller that passes `summarizeExcluded: true` and supplies an `LLMProvider`. Without such a caller, do not start C1.
- **C2 (E2c)**: start only when decision Q1 (Section 11) has an answer. The answer sets the default and the switch name.

---

## 2. Wave schedule

Hard cap: three agents at one time, and at most two Haiku agents plus one Sonnet or Opus agent. The schedule below never runs more than two agents at one time.

Haiku workers run at effort `xhigh`. A Sonnet card or a close task takes the one non-Haiku slot of the cap. Opus can take that slot in place of Sonnet.

| Wave | Slot | Cards in the slot | Models | Agents at one time | Start condition |
|---|---|---|---|---|---|
| 1 | 1.1 | W0-DOC, E1a | Haiku, Haiku | 2 | Wave branch `feat/memorilla-w1` exists off `origin/master` |
| 1 | 1.2 | E1b | Haiku | 1 | E1a is on the wave branch |
| 1 | 1.3 | E1c, E1d | Haiku, Haiku | 2 | E1b is on the wave branch |
| 1 | 1.4 | W1-CLOSE | Sonnet | 1 | All Wave 1 cards are on the wave branch |
| 2 | 2.1 | E2a | Haiku | 1 | Wave 1 PR is merged; `feat/memorilla-w2` exists off the new `origin/master` |
| 2 | 2.2 | E2b | Sonnet | 1 | E2a is on the wave branch |
| 2 | 2.3 | W2-CLOSE | Sonnet | 1 | E2b is on the wave branch |
| 3 | 3.1 | E4, E5 | Haiku, Haiku | 2 | Wave 2 PR is merged; `feat/memorilla-w3` exists |
| 3 | 3.2 | W3-CLOSE | Sonnet | 1 | E4 and E5 are on the wave branch |
| C1 | C1.1 | E3a | Haiku | 1 | Trigger C1 holds; `feat/memorilla-c1` exists |
| C1 | C1.2 | E3b | Haiku | 1 | E3a is on the branch |
| C1 | C1.3 | C1-CLOSE | Sonnet | 1 | E3b is on the branch |
| C2 | C2.1 | E2c | Haiku | 1 | Trigger C2 holds; `feat/memorilla-c2` exists |
| C2 | C2.2 | C2-CLOSE | Sonnet | 1 | E2c is on the branch |

Waves run in strict sequence. The next wave starts only after the previous wave's PR is merged. C1 and C2 run after Wave 3, or later, and never at the same time as another wave.

---

## 3. File-assignment matrix

One file belongs to one card per slot. Two cards in the same slot never share a file. A file that more than one card changes is changed in different slots, in the order shown.

| File | Wave 1 | Wave 2 | Wave 3 | C1 | C2 |
|---|---|---|---|---|---|
| `src/search/SearchManager.ts` | W0-DOC | | | | |
| `src/core/SQLiteStorage.ts` | E1a | | | | |
| `tests/unit/core/sqlite-embeddings-content-hash.test.ts` (new) | E1a | | | | |
| `src/types/types.ts` | E1b | | | | |
| `src/search/VectorStore.ts` | E1b | | | | |
| `tests/unit/search/VectorStore.test.ts` | E1b | | | | |
| `src/search/SemanticSearch.ts` | E1c | | | | |
| `tests/unit/search/SemanticSearch.test.ts` | E1c | | | | |
| `src/core/ManagerContext.ts` | E1d | | | | E2c |
| `tests/unit/core/ManagerContext-vectorStore.test.ts` (new) | E1d | | | | |
| `src/types/agent-memory.ts` | | E2a, then E2b | E4 | E3b | |
| `src/agent/ContextWindowManager.ts` | | E2a, then E2b | E4 | E3b | |
| `tests/unit/agent/ContextWindowManager.test.ts` | | E2a, then E2b | | E3b | |
| `src/agent/index.ts` | | E2a | | E3a | |
| `src/agent/ContextProfileManager.ts` | | | E4 | E3b | |
| `tests/unit/agent/ContextProfileManager.test.ts` | | | E4 | | |
| `src/agent/MemoryEngine.ts` | | | E5 | | |
| `tests/unit/agent/MemoryEngine.test.ts` | | | E5 | | |
| `src/agent/SummarizationService.ts` | | | | E3a | |
| `tests/unit/agent/SummarizationService.test.ts` | | | | E3a | |
| `src/cli/commands/doctor.ts`, `src/cli/commands/diag.ts` | | | | | E2c |
| `tests/unit/core/ManagerContext-hybridContext.test.ts` (new) | | | | | E2c |
| `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `todo.md` | W1-CLOSE | W2-CLOSE | W3-CLOSE | C1-CLOSE | C2-CLOSE |
| `docs/architecture/**`, `docs/guides/**`, `docs/roadmap/ROADMAP.md`, `docs/roadmap/MEMORILLA_LATENT_MEMORY_PLAN.md` | W1-CLOSE | W2-CLOSE | W3-CLOSE | C1-CLOSE | C2-CLOSE |

Concurrent pairs and their file sets:

| Slot | Card | Files | Shared with the other card |
|---|---|---|---|
| 1.1 | W0-DOC | `src/search/SearchManager.ts` | none |
| 1.1 | E1a | `src/core/SQLiteStorage.ts`, new `tests/unit/core/sqlite-embeddings-content-hash.test.ts` | none |
| 1.3 | E1c | `src/search/SemanticSearch.ts`, `tests/unit/search/SemanticSearch.test.ts` | none |
| 1.3 | E1d | `src/core/ManagerContext.ts`, new `tests/unit/core/ManagerContext-vectorStore.test.ts` | none |
| 3.1 | E4 | `src/types/agent-memory.ts`, `src/agent/ContextProfileManager.ts`, `src/agent/ContextWindowManager.ts`, `tests/unit/agent/ContextProfileManager.test.ts` | none |
| 3.1 | E5 | `src/agent/MemoryEngine.ts`, `tests/unit/agent/MemoryEngine.test.ts` | none |

Why the close task owns `CHANGELOG.md` and `docs/architecture/**`: concurrent cards would conflict on both files. Also, `docs/architecture/file-inventory.json` records the line count of every source and test file. Every card changes a line count, so CI's census check fails until the close task regenerates the reports.

---

## 4. Rules for every card

### 4.1 Branches, worktrees and commits

1. The integrator creates the wave branch: `git fetch origin` and `git switch -c feat/memorilla-w<N> origin/master`.
2. For each card, the integrator creates a worktree from the wave tip: `git worktree add ../memoryjs-wt/<card-id> -b memorilla/<card-id> feat/memorilla-w<N>`.
3. The integrator runs `bun install --frozen-lockfile` in the new worktree before dispatch.
4. The worker makes exactly one commit on `memorilla/<card-id>`.
5. The integrator cherry-picks the commit onto `feat/memorilla-w<N>` after review.
6. After the close task, the integrator pushes the wave branch and opens one PR for the wave.
7. The integrator merges with `gh pr merge --rebase` after CI passes. A rebase merge keeps one commit per card on `master`, so one card can be reverted alone.

### 4.2 Commit messages and PR text

- Use conventional commits, as in the repository history (`feat(agent):`, `fix(search):`, `docs(roadmap):`).
- The repository is public. Commit messages and PR bodies contain **no** session trailer, **no** session URL and **no** tool attribution lines.
- Each card gives its exact subject line. The body has two to five lines that state what changed and why.

### 4.3 Gates for a card

Run the gates in this order, in the card's worktree. Each gate must pass before the next gate runs.

1. The card's new test file: `bunx vitest run <test file>`. Expected: every test passes.
2. The card's regression files: `bunx vitest run <file> <file>`. Expected: every test passes.
3. `bun run typecheck`. Expected: exit 0.
4. `bun run lint`. Expected: exit 0.
5. Scoped code-docs check for changed source files: `git add -A` first (the check reads tracked files only), then `repo-tools docs check . --paths <changed src files>`. Expected: `PASS`.

`tsconfig.json` excludes `tests/`, so `typecheck` does not check test files. Vitest removes types without a check. No gate finds a type error in a test file, so the reviewer reads the test diff.

### 4.4 Source rules

- Every touched file uses CRLF line endings in the working copy (`core.autocrlf=true`). Edit with the Edit tool. Do not rewrite a file through a shell command.
- Write the failing tests first. Run them and keep the failing output for the report. Then write the implementation.
- Document every new exported or public symbol with TSDoc. Each `@param` name must match the signature, or the code-docs gate fails.
- Add no dependency. Read no new environment variable, except in E2c.
- Keep default behavior unchanged. Every new option is off or absent by default.

### 4.5 Do-not-touch list for every card

A card changes only the files in its **Files** list. In particular, a card never changes:

- `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `todo.md`, `docs/**`
- `package.json`, `bun.lock`, `tsconfig.json`, `vitest.config.*`, `.github/**`, `tools/**`, `scripts/**`
- `dist-*/` or any build output
- any file that another card in the same slot owns

### 4.6 Stop condition for every card

Stop, report `BLOCKED` with the reason, and do not commit when one of these occurs:

- An anchor in the card does not match the file (the line moved more than 15 lines, or the quoted text differs).
- A regression file fails, and the failure is not caused by an expected value that the card itself changes.
- A gate fails two times after a fix attempt.
- The work needs a file that is not in the card's **Files** list.

---

## 5. Dispatch contract

The integrator puts this contract, word for word, at the top of every worker brief.

1. **Assignment.** You own this card IN FULL. No other agent covers it. Your working directory does not limit your scope. Work only in the worktree `<worktree path>`.
2. **Scratch.** Put all transient files in `%TEMP%\memorilla\<card-id>\`. Put nothing elsewhere.
3. **Report file.** Write findings to `%TEMP%\memorilla\<card-id>-report.md`. The report file is next to the scratch folder, not inside it.
4. **First action.** Create the report file with one line, `STARTED`, before you read any file.
5. **Append as you go.** Append to the report after each step: failing test output, implementation, each gate result. Do not hold results for one write at the end.
6. **Partial protocol.** If your context runs low, stop. Append `PARTIAL - remaining: <list>`, then return status `PARTIAL`.
7. **Large files.** Do not read a file of more than 400 lines in full. Read the slice at the card's anchors.
8. **No detached processes.** Run only foreground commands that exit (`bunx vitest run`, never watch mode). Start no server and no background task.
9. **Enumerate.** In the final report, list every file and process that you created.
10. **Merge boundary.** Commit on your card branch only. Do not push, merge, tag, release or rebase.
11. **Line endings.** Edit with the Edit tool. Keep CRLF. Do not rewrite a file through a shell command.
12. **Correct this brief.** If the card is wrong, say so with evidence. The card is a hypothesis, not a constraint.

The integrator also does these steps for every dispatch:

- Dispatch each Haiku worker with effort `xhigh`.
- Before dispatch, take a baseline: `pwsh -File "<spawning-agents skill base>\scripts\sweep.ps1" -Snapshot -Out "$env:USERPROFILE\.claude\spawn-sweeps\memorilla-<card-id>.json" -Scratch "$env:TEMP\memorilla\<card-id>"`.
- After the worker's final return, run the sweep with `-Sweep -Baseline <same file> -Scratch <same folder>`. The card is not done until the sweep reports `Clean=True`, or until each flag has a stated reason.
- In a two-card slot, sweep at the join point, after both workers return.
- A report file still missing five minutes after dispatch means the worker did not start. Stop the worker and dispatch again.
- Re-run the card's gates in the worktree. The worker's report is a hint, not proof.

---

## 6. Wave 1 cards

### W0-DOC — Fix the baseline code-docs gate

- **Goal**: `repo-tools docs check src` exits 0 on the wave branch, so later cards can use the gate.
- **Depends on**: none. **Model**: Haiku.
- **Files**: `src/search/SearchManager.ts`.

**Failing check first.** Run `repo-tools docs check src`. Expected on the base commit: exit 1 with one MUST issue:

```text
search/SearchManager.ts:295 searchNodesRanked: M3 documents parameter 'tags' which is not in the signature
```

The cause: the overload implementation at `src/search/SearchManager.ts:295` has no doc comment of its own. The gate compares the first overload's comment (`@param tags`) with the implementation's `tagsOrOptions`.

**Implementation.**

1. Find the second overload at `:291-294` (`searchNodesRanked(query: string, options: SearchOptionsWithTracking): Promise<KnowledgeGraph>;`).
2. Insert this comment between `:294` and the implementation signature at `:295` (`async searchNodesRanked(` with `tagsOrOptions`):

```ts
  /**
   * Shared implementation of the two `searchNodesRanked` overloads.
   *
   * @param query - Search query text
   * @param tagsOrOptions - Tag filter (positional form) or a `SearchOptionsWithTracking` object
   * @param minImportance - Minimum importance (0-10), positional form only
   * @param maxImportance - Maximum importance (0-10), positional form only
   * @param limit - Maximum number of results, positional form only
   * @returns Ranked results (positional form) or a knowledge graph (options form)
   */
```

3. Change nothing else in the file.

**Gates.** (1) `repo-tools docs check src`: `PASS`. (2) `bun run typecheck`: exit 0. (3) `bun run lint`: exit 0. No test file runs, because the change is a comment.

**Commit**: `docs(search): document the searchNodesRanked implementation signature`

**CHANGELOG** (`### Fixed`): `` `repo-tools docs check src` passes again: the `searchNodesRanked` implementation signature now has its own doc comment. ``

**Reviewer checklist.**

- [ ] The diff adds comment lines only (`git show --stat` shows insertions only in `SearchManager.ts`).
- [ ] `repo-tools docs check src` prints `PASS` on the wave branch.

**Rollback.** `git revert <sha>`. The gate then fails again with the M3 issue.

---

### E1a — Embeddings `contentHash` column

- **Goal**: the `embeddings` table stores a nullable `contentHash`. An old table gets the column when the database opens.
- **Depends on**: none. **Model**: Haiku.
- **Files**: `src/core/SQLiteStorage.ts`; new `tests/unit/core/sqlite-embeddings-content-hash.test.ts`.
- **Regression files**: `tests/unit/core/SQLiteStorage.test.ts`, `tests/unit/core/sqlite-content-hash-migration.test.ts`.

**Failing tests first.** Create `tests/unit/core/sqlite-embeddings-content-hash.test.ts`. Follow the pattern of `tests/unit/core/sqlite-content-hash-migration.test.ts` (raw `db` access through `(storage as unknown as { db: ... }).db`). Use a new folder from `mkdtempSync(path.join(os.tmpdir(), 'memoryjs-emb-hash-'))` per test, and remove the folder in `afterEach` with `rmSync(dir, { recursive: true, force: true })` after `storage.close()`.

Entities must exist before `storeEmbedding`, because `embeddings.entityName` references `entities(name)`. Seed with `await storage.saveGraph({ entities: [entity('a')], relations: [] })`, where `entity(name)` returns `{ name, entityType: 'note', observations: ['x'], createdAt: <iso>, lastModified: <iso> }`. Use the vector `[0.5, 0.25, -1]`; Float32 stores each value exactly.

`describe('SQLiteStorage embeddings contentHash')`:

| Test name | Input | Expected |
|---|---|---|
| `creates the embeddings table with a contentHash column` | new DB, seed `a`, `storeEmbedding('a', v, 'm')` | `db.pragma('table_info(embeddings)')` names contain `'contentHash'` |
| `stores and loads the contentHash` | `storeEmbedding('a', v, 'm', 'h1')` | `await loadEmbeddingMetadata()` equals `[{ entityName: 'a', embeddingModel: 'm', contentHash: 'h1' }]` |
| `stores null when the contentHash is omitted` | `storeEmbedding('a', v, 'm')` | metadata `contentHash` is `null` |
| `replaces the contentHash on a second store` | store with `'h1'`, then with `'h2'` | metadata has one row, `contentHash: 'h2'` |
| `returns an empty list when no embedding exists` | new DB, `await storage.loadGraph()` | `await loadEmbeddingMetadata()` equals `[]` |
| `adds the column to an old embeddings table on open` | see the steps below | column exists, `contentHash` is `null`, `getEmbedding('a')` equals `[0.5, 0.25, -1]` |
| `deleteEntities removes the embedding row` | seed `a` and `b`, store both, `await storage.deleteEntities(['a'])` | `hasEmbedding('a')` is `false`, `hasEmbedding('b')` is `true`, metadata length is 1 |

Steps for the old-table test:

1. Open `storage1` on the path, seed `a`.
2. Run `DROP TABLE IF EXISTS embeddings` on the raw `db`.
3. Create the old schema: `CREATE TABLE embeddings (entityName TEXT PRIMARY KEY REFERENCES entities(name) ON DELETE CASCADE, embedding BLOB NOT NULL, embeddingModel TEXT NOT NULL, embeddingUpdatedAt TEXT NOT NULL, dimensions INTEGER NOT NULL)`.
4. Insert one row: `('a', Buffer.from(new Float32Array([0.5, 0.25, -1]).buffer), 'm', new Date().toISOString(), 3)`.
5. Close `storage1`. Open `storage2` on the same path and call `await storage2.loadGraph()`.
6. Assert the three expected values.

Run the file. Expected before the implementation: six tests fail. `deleteEntities removes the embedding row` passes, because the test pins existing behavior.

**Implementation** (`src/core/SQLiteStorage.ts`).

1. In `ensureEmbeddingsTable()` (`:2289`), add `contentHash TEXT` as the last column of the `CREATE TABLE IF NOT EXISTS embeddings` statement (`:2293-2300`).
2. Add `private migrateEmbeddingsTable(): void` after `migrateEntitiesTable()` (definition starts at `:578`). Follow the same pattern:
   - Return when `!this.db`.
   - Read `this.db.pragma('table_info(embeddings)')`. The result is `[]` when the table does not exist; then return.
   - When the column set does not contain `contentHash`, run `ALTER TABLE embeddings ADD COLUMN contentHash TEXT`.
3. Call `this.migrateEmbeddingsTable();` directly after the `this.migrateEntitiesTable();` call at `:477`.
4. Change `storeEmbedding` (`:2313`) to `storeEmbedding(entityName: string, vector: number[], model: string, contentHash?: string): void`. Add `@param contentHash - Optional hash of the content the vector was made from; stored as NULL when absent`. Add `contentHash` to the `INSERT OR REPLACE` column list and values (`:2323-2328`), and pass `contentHash ?? null`.
5. Add after `loadAllEmbeddings` (`:2361`):

```ts
  async loadEmbeddingMetadata(): Promise<Array<{ entityName: string; embeddingModel: string; contentHash: string | null }>>
```

   - Return `[]` when `!this.db || !this.initialized`.
   - In a `try`, call `this.ensureEmbeddingsTable()`, then `SELECT entityName, embeddingModel, contentHash FROM embeddings`. Return the rows.
   - In the `catch`, return `[]` (same pattern as `loadAllEmbeddings`).
   - Write TSDoc with `@returns`.

**Gates.** New test file passes (7 tests). Regression files pass. `typecheck`, `lint` exit 0. Scoped docs check on `src/core/SQLiteStorage.ts` passes.

**Commit**: `feat(sqlite): add a nullable contentHash column to the embeddings table`

**CHANGELOG** (`### Added`): `` SQLite `embeddings` table: nullable `contentHash` column, written by `storeEmbedding(name, vector, model, contentHash?)` and read by `loadEmbeddingMetadata()`. Existing databases get the column when they open. ``

**Card do-not-touch**: `ensureEmbeddingsTable`'s index statement, `saveGraph`, `deleteEntities`. The test only observes `deleteEntities`; the method already deletes embedding rows explicitly (`:1488-1495`).

**Reviewer checklist.**

- [ ] The migration runs once per open and does nothing when the table is absent.
- [ ] `storeEmbedding` with three arguments still works (existing callers: `MemoryEngine.ts:302`, `VectorStore.ts:258`).
- [ ] The old-table test closes the first connection before it opens the second.
- [ ] The test removes its temporary folder, including WAL files.

**Rollback.** `git revert <sha>`. Databases that already have the column keep the column. Old code ignores the column, and its five-column `INSERT OR REPLACE` writes `NULL` into the column. No down-migration is necessary.

---

### E1b — Hash-aware `SQLiteVectorStore`

- **Goal**: `SQLiteVectorStore` loads persisted vectors, drops rows of another model, and tracks one content hash per vector.
- **Depends on**: E1a. **Model**: Haiku.
- **Files**: `src/types/types.ts`; `src/search/VectorStore.ts`; `tests/unit/search/VectorStore.test.ts`.
- **Regression files**: `tests/unit/search/SemanticSearch.test.ts`, `tests/unit/search/IncrementalIndexer.test.ts`.

**Failing tests first.** In `tests/unit/search/VectorStore.test.ts`, add `describe('SQLiteVectorStore with SQLiteStorage')`. The existing `SQLiteVectorStore` describe at `:210` uses no storage; leave it as it is. Use a real `SQLiteStorage` in a `mkdtempSync` folder, seeded with entities `a` and `b` through `saveGraph`. Use model `'mock-model'` and vectors `[1, 0, 0]` and `[0, 1, 0]`.

| Test name | Input | Expected |
|---|---|---|
| `persists a content hash and reloads it in a new store` | `store1.initialize()`, `store1.add('a', [1,0,0], 'h1')`; new `store2` on the same storage, `store2.initialize()` | `store2.has('a')` is `true`; `store2.getContentHash('a')` is `'h1'` |
| `drops rows of another model on initialize` | `storage.storeEmbedding('a', [1,0,0], 'unknown')`; new store with `'mock-model'`, `initialize()` | `has('a')` is `false`; `size()` is `0`; `storage.hasEmbedding('a')` is still `true` |
| `add without a hash clears an earlier hash` | `add('a', v, 'h1')`, then `add('a', v)` | `getContentHash('a')` is `undefined`; metadata `contentHash` is `null` |
| `remove clears the hash and the row` | `add('a', v, 'h1')`, `remove('a')` | `getContentHash('a')` is `undefined`; `storage.hasEmbedding('a')` is `false` |
| `remove deletes the row before initialize` | `storage.storeEmbedding('a', v, 'mock-model')`; new store, no `initialize()`, `remove('a')` | `storage.hasEmbedding('a')` is `false` |
| `clear removes every hash` | add `a` and `b` with hashes, `clear()` | `getContentHash('a')` is `undefined`; `size()` is `0` |
| `initialize loads storage that is not loaded yet` | `storage.storeEmbedding('a', v, 'mock-model')`, close the storage; open a new `SQLiteStorage` on the path and do not call `loadGraph`; new store, `initialize()` | `has('a')` is `true` |
| `isEmbeddingStorage accepts SQLiteStorage` | `isEmbeddingStorage(storage)` | `true` |
| `isEmbeddingStorage rejects other values` | `{}`, `null`, `{ storeEmbedding() {} }` | `false` for each |
| `InMemoryVectorStore does not track content hashes` | `new InMemoryVectorStore()` | `'getContentHash' in store` is `false` |

Import `isEmbeddingStorage` from `'../../../src/search/VectorStore.js'` (not from the barrel).

Run the file. Expected before the implementation: nine new tests fail. `InMemoryVectorStore does not track content hashes` passes, because the test pins existing behavior.

**Implementation.**

1. `src/types/types.ts`, `IVectorStore` (`:1642`):
   - Change `add` (`:1649`) to `add(entityName: string, vector: number[], contentHash?: string): void;`. Add `@param contentHash - Optional hash of the source content; stores that track hashes keep it with the vector`.
   - Add `initialize?(): Promise<void>;` with TSDoc: loads persisted vectors; callers await it before the first read.
   - Add `getContentHash?(entityName: string): string | undefined;` with TSDoc: returns the hash stored with the vector, or `undefined`.
2. `src/search/VectorStore.ts`, `SQLiteStorageWithEmbeddings` (`:355`):
   - Change `storeEmbedding` (`:363`) to `storeEmbedding(entityName: string, vector: number[], model: string, contentHash?: string): void;`.
   - Add optional `loadEmbeddingMetadata?(): Promise<Array<{ entityName: string; embeddingModel: string; contentHash: string | null }>>;`.
   - Add optional `ensureLoaded?(): Promise<void>;`.
3. `SQLiteVectorStore` (`:206`):
   - Add `private contentHashes = new Map<string, string>();`.
   - `initialize()` (`:233`): keep the `initialized` guard. When `this.storage` is set: `await this.storage.ensureLoaded?.()`; read `loadAllEmbeddings()`; read `loadEmbeddingMetadata?.()` into a map by name. For each `[name, vector]`: skip the row when its metadata exists and `embeddingModel !== this.embeddingModel`. Otherwise call `this.memoryStore.add(name, vector)`, and store a non-null hash in `contentHashes`. Do not delete skipped rows from SQLite.
   - `add` (`:252`): add the `contentHash?: string` parameter. Set or delete the hash in `contentHashes`. Pass `contentHash` to `storeEmbedding`.
   - `remove` (`:279`): delete the hash. Call `this.storage.removeEmbedding(entityName)` whenever `this.storage` is set, also when the in-memory map has no entry (the store may not be initialized yet). Keep the return value: the in-memory result.
   - `clear` (`:302`): also clear `contentHashes`.
   - Add `getContentHash(entityName: string): string | undefined` with TSDoc.
4. Add an exported type guard after `SQLiteStorageWithEmbeddings` (before `createVectorStore` at `:393`):

```ts
/**
 * Check whether a storage object exposes the embedding methods that
 * SQLiteVectorStore needs.
 *
 * @param storage - Any storage object
 * @returns True when the four embedding methods exist
 * @internal
 */
export function isEmbeddingStorage(storage: unknown): storage is SQLiteStorageWithEmbeddings
```

   Return `true` only when `storage` is a non-null object with `storeEmbedding`, `loadAllEmbeddings`, `removeEmbedding` and `clearAllEmbeddings` as functions. Do not add the guard to `src/search/index.ts`.

**Gates.** `VectorStore.test.ts` passes. Regression files pass. `typecheck`, `lint` exit 0. Scoped docs check on `src/types/types.ts` and `src/search/VectorStore.ts` passes.

**Commit**: `feat(search): load, filter and track content hashes in SQLiteVectorStore`

**CHANGELOG** (`### Added`): `` `SQLiteVectorStore` loads persisted vectors on `initialize()`, skips rows of another embedding model, and keeps a content hash per vector (`add(name, vector, contentHash?)`, `getContentHash(name)`). `IVectorStore` gains optional `initialize()` and `getContentHash()`. ``

**Card do-not-touch**: `InMemoryVectorStore` (no hash tracking), `createVectorStore` behavior, `src/search/index.ts`.

**Reviewer checklist.**

- [ ] `InMemoryVectorStore` has no new member.
- [ ] `initialize()` never deletes rows from SQLite.
- [ ] `isEmbeddingStorage` checks all four methods.
- [ ] `IncrementalIndexer.ts:313` still compiles with the two-argument `add`.

**Rollback.** Revert E1d and E1c first (both depend on E1b), then `git revert <sha>`.

---

### E1c — `SemanticSearch` uses the persisted store

- **Goal**: `SemanticSearch` initializes its store before the first read. `indexAll` re-embeds an entity only when the entity is new or its `contentHash` changed.
- **Depends on**: E1b. **Model**: Haiku.
- **Files**: `src/search/SemanticSearch.ts`; `tests/unit/search/SemanticSearch.test.ts`.
- **Regression files**: `tests/unit/search/HybridSearchManager.test.ts`, `tests/unit/search/IncrementalIndexer.test.ts`.

**Failing tests first.** In `tests/unit/search/SemanticSearch.test.ts`, add `describe('SemanticSearch with SQLiteVectorStore')`. Use a real `SQLiteStorage` in a `mkdtempSync` folder and `new MockEmbeddingService(8)`. A "second process" is a new `SQLiteStorage`, a new `SQLiteVectorStore(storage2, 'mock-model')` and a new `SemanticSearch` on the same file, opened after `storage1.close()`. Spy with `vi.spyOn(embedding2, 'embedBatch')`.

| Test name | Input | Expected |
|---|---|---|
| `skips unchanged entities in a second process` | entity `a` with `contentHash: 'h1'`; first `indexAll`; second process `indexAll` | first: `{ indexed: 1, skipped: 0, errors: 0 }`; second: `{ indexed: 0, skipped: 1, errors: 0 }`; `embedBatch` spy not called |
| `re-embeds once when the contentHash changes` | after the first index, save `a` with `contentHash: 'h2'`; `indexAll` two times | first call `indexed: 1`; second call `skipped: 1` |
| `re-embeds a row that has no stored hash once` | `store.add('a', vector)` with no hash; entity `a` has `contentHash: 'h1'`; `indexAll` two times | first call `indexed: 1`; second call `skipped: 1` |
| `skips by name when the entity has no contentHash` | entity `a` with no `contentHash`; index, then a second process | second process `{ indexed: 0, skipped: 1, errors: 0 }` |
| `search before indexAll finds persisted vectors` | index `a` in process one; in process two call `search(graph, 'x', 10, -1)` with no `indexAll` | result names contain `'a'` |
| `keeps the old behavior with InMemoryVectorStore` | `new SemanticSearch(embedding, new InMemoryVectorStore())`; entity with `contentHash: 'h1'`; `indexAll` two times | second call `skipped: 1` |

Load each graph with `await storage.loadGraph()` after `saveGraph`, so the entities carry the stored `contentHash`.

Run the file. Expected before the implementation: five new tests fail. `keeps the old behavior with InMemoryVectorStore` passes, because the test pins existing behavior.

**Implementation** (`src/search/SemanticSearch.ts`).

1. Add `private storeReady?: Promise<void>;` near the fields (`:82-90`).
2. Add a private method:

```ts
  private ensureStoreReady(): Promise<void>
```

   - When `storeReady` is unset, set it to `this.vectorStore.initialize?.() ?? Promise.resolve()`.
   - When the promise rejects, reset `storeReady` to `undefined` and rethrow, so a later call can try again.
3. Add a private method `isStale(entity: Entity): boolean`:
   - Return `false` when `typeof this.vectorStore.getContentHash !== 'function'`.
   - Return `false` when `typeof entity.contentHash !== 'string'`.
   - Otherwise return `this.vectorStore.getContentHash(entity.name) !== entity.contentHash`.
4. `indexAll` (`:179`): `await this.ensureStoreReady()` after the first `checkCancellation` (`:191`). Change the condition at `:203` to `forceReindex || !this.vectorStore.has(entity.name) || this.isStale(entity)`.
5. Pass `entity.contentHash` as the third argument at each `add` call: `:220` (`batch[j].contentHash`), `:235` and `:265`.
6. `indexEntity` (`:261`), `search` (`:314`) and `findSimilar` (`:363`): `await this.ensureStoreReady()` as the first statement.
7. Update the `indexAll` TSDoc (`:166-178`): it also re-indexes an entity whose `contentHash` differs from the stored hash.

**Gates.** `SemanticSearch.test.ts` passes. Regression files pass. `typecheck`, `lint` exit 0. Scoped docs check on `src/search/SemanticSearch.ts` passes.

**Commit**: `fix(search): initialize the vector store and re-embed stale entities in SemanticSearch`

**CHANGELOG** (`### Fixed`): `` `SemanticSearch` now initializes its vector store before the first read, so a persisted `SQLiteVectorStore` is searchable without a full re-index. `indexAll` re-embeds an entity when its `contentHash` differs from the stored hash. ``

**Card do-not-touch**: `removeEntity` (stays synchronous; E1b's `remove` already deletes the row before `initialize`), `embedEntityBatch`, `entityToText`.

**Reviewer checklist.**

- [ ] All four public read or write paths await `ensureStoreReady()`.
- [ ] A rejected `initialize()` does not stay cached.
- [ ] `isStale` never calls `getContentHash` unbound.
- [ ] The test spies prove zero embedding calls in the skip case.

**Rollback.** Revert E1d first, then `git revert <sha>`.

---

### E1d — Context wiring for SQLite

- **Goal**: `ctx.semanticSearch` uses `SQLiteVectorStore` when the storage is `SQLiteStorage`. JSONL storage keeps `InMemoryVectorStore`.
- **Depends on**: E1b (to start). E1c must be on the branch before the wave PR merges. Revert E1d before E1c.
- **Model**: Haiku.
- **Files**: `src/core/ManagerContext.ts`; new `tests/unit/core/ManagerContext-vectorStore.test.ts`.
- **Regression files**: `tests/unit/core/ManagerContext.test.ts`.

**Failing tests first.** Create `tests/unit/core/ManagerContext-vectorStore.test.ts`. In `beforeEach`, save `MEMORY_STORAGE_TYPE` and `MEMORY_EMBEDDING_PROVIDER`, delete `MEMORY_STORAGE_TYPE`, and set `MEMORY_EMBEDDING_PROVIDER='local'`. Restore both in `afterEach`, then call `ctx.close()` and remove the `mkdtempSync` folder. `LocalEmbeddingService` loads no model at construction, so the tests stay offline.

| Test name | Input | Expected |
|---|---|---|
| `uses SQLiteVectorStore for SQLite storage` | `new ManagerContext({ storagePath: join(dir, 'm.db'), storageType: 'sqlite' })` | `ctx.semanticSearch!.getVectorStore()` is an instance of `SQLiteVectorStore` |
| `uses InMemoryVectorStore for JSONL storage` | `new ManagerContext(join(dir, 'm.jsonl'))` | `getVectorStore()` is an instance of `InMemoryVectorStore` |
| `returns null semantic search when the provider is none` | `MEMORY_EMBEDDING_PROVIDER='none'`, SQLite context | `ctx.semanticSearch` is `null` |

Run the file. Expected before the implementation: `uses SQLiteVectorStore for SQLite storage` fails. The other two tests pass, because they pin existing behavior.

**Implementation** (`src/core/ManagerContext.ts`).

1. Change the import at `:54` to `import { createVectorStore, isEmbeddingStorage } from '../search/VectorStore.js';`.
2. In the `semanticSearch` getter (`:855`), replace `createVectorStore('jsonl')` at `:861` with:

```ts
        const vectorStore = isEmbeddingStorage(this.storage)
          ? createVectorStore('sqlite', this.storage, embeddingService.model)
          : createVectorStore('jsonl');
```

3. Keep the duck-type check. Do not import `SQLiteStorage` statically; `ManagerContext` loads it lazily through `./sqlite-register.js` (`:28`).

**Gates.** New test file passes (3 tests). `ManagerContext.test.ts` passes. `typecheck`, `lint` exit 0. Scoped docs check on `src/core/ManagerContext.ts` passes.

**Commit**: `feat(core): use SQLiteVectorStore for semantic search on SQLite storage`

**CHANGELOG** (`### Changed`): `` With `SQLiteStorage`, `ctx.semanticSearch` (and so `ctx.hybridSearchManager`) now keeps vectors in the `embeddings` table and reuses them across restarts. JSONL storage is unchanged. ``

**Card do-not-touch**: every other getter, `close()` (`:1741`), the embedding-cache wiring at `:862-870`.

**Reviewer checklist.**

- [ ] The change is the import plus the store selection.
- [ ] The tests restore both environment variables, also when an assertion fails.
- [ ] No test needs network access.

**Rollback.** `git revert <sha>`. SQLite contexts return to the in-memory store. Rows in `embeddings` stay and do no harm.

---

## 7. Wave 2 cards

### E2a — Budget-cut report and slot cap

- **Goal**: `ContextPackage` reports how many candidate tokens reached the budget cut, and the ratio to the tokens kept. `maxSlots` caps the number of memories.
- **Depends on**: Wave 1 merged. **Model**: Haiku.
- **Files**: `src/types/agent-memory.ts`; `src/agent/ContextWindowManager.ts`; `src/agent/index.ts`; `tests/unit/agent/ContextWindowManager.test.ts`.
- **Regression files**: `tests/unit/agent/MemoryFormatter.test.ts`, `tests/unit/agent/AgentMemoryManager.test.ts`, `tests/unit/agent/ContextProfileManager.test.ts`.

Token arithmetic for the tests: `estimateTokens` (`ContextWindowManager.ts:197`) counts the words of name, `entityType`, observations, `memoryType`, `sessionId` and `taskId`, multiplies by 1.3 and rounds up. `createTestEntity` (`ContextWindowManager.test.ts:33`) sets `entityType: 'memory'` and `memoryType: 'working'`. An entity named `e1` with observations `['alpha beta gamma']` has 6 words, so it costs `ceil(7.8) = 8` tokens. Names `e01` to `e16` also cost 8 tokens each. Construct the manager with `new ContextWindowManager(storage, salienceEngine, { reserveBuffer: 0 })`, so the budget equals `maxTokens`.

**Failing tests first.** In `ContextWindowManager.test.ts`, add `describe('budget-cut report')` and `describe('maxSlots')`. Build `storage` with `createMockStorage(entities)` (`:18`).

| Test name | Input | Expected |
|---|---|---|
| `reports sourceTokens and compressionRatio when the budget cuts entities` | `e1`..`e4`, `maxTokens: 20` | `totalTokens` 16, `sourceTokens` 32, `compressionRatio` 2, `excluded` length 2, each reason `'budget_exceeded'` |
| `reports a ratio of 1 when every candidate fits` | `e1`..`e4`, `maxTokens: 1000` | `totalTokens` 32, `sourceTokens` 32, `compressionRatio` 1, `excluded` `[]` |
| `reports a ratio of 1 for an empty store` | no entities, `maxTokens: 1000` | `totalTokens` 0, `sourceTokens` 0, `compressionRatio` 1 |
| `counts low-salience exclusions in sourceTokens` | `e1`..`e4`, `maxTokens: 1000`, `minSalience: 2` | `totalTokens` 0, `sourceTokens` 32, `compressionRatio` 32 |
| `sets both fields in retrieveWithBudgetAllocation` | `e1`..`e4`, `retrieveWithBudgetAllocation({ maxTokens: 1000 })` | `sourceTokens` equals `totalTokens` plus the sum of `excluded[i].tokens`; `compressionRatio` follows the rule below |
| `caps the number of memories` | `e01`..`e16`, `maxTokens: 1000`, `maxSlots` 1, 2, 4, 8, 16 | `memories.length` equals the `maxSlots` value |
| `returns nested selections as maxSlots grows` | same five runs | each name set has the `maxSlots` length and is a subset of the next one |
| `marks slot-cut entities with reason slot_limit` | `e01`..`e16`, `maxSlots: 4` | `excluded` length 12, each reason `'slot_limit'` |
| `returns only must-include entities when maxSlots is 0` | `e01`..`e16`, `maxSlots: 0`, `mustInclude: ['e05']` | memory names `['e05']` |
| `keeps every must-include entity when maxSlots is smaller` | `e01`..`e16`, `maxSlots: 1`, `mustInclude: ['e01', 'e02']` | memory names contain `e01` and `e02`; length 2 |
| `ignores maxSlots when unset` | `e01`..`e16`, `maxTokens: 1000` | length 16 |
| `prioritize accepts maxSlots` | `prioritize(entities, 1000, {}, [], { maxSlots: 3 })` | `selected` length 3 |

Salience is in the range 0 to 1, so `minSalience: 2` excludes every entity.

Run the file. Expected before the implementation: every new test fails, except `ignores maxSlots when unset`, which pins existing behavior.

**Implementation.**

1. `src/types/agent-memory.ts`:
   - `ContextRetrievalOptions` (`:2230`): after `profile?` (`:2246`), add `maxSlots?: number;`. TSDoc: maximum number of memories, or no cap when unset. Must-include entities count against the cap but are never cut.
   - `ContextPackage` (`:2279`): after `totalTokens` (`:2283`) add `sourceTokens: number;` (TSDoc: `totalTokens` plus the tokens of every excluded entity) and `compressionRatio: number;` (TSDoc: `sourceTokens / totalTokens`; 1 when nothing is excluded).
   - Update the example at `:2270-2276`: add `sourceTokens: 4300` and `compressionRatio: 1.23`.
   - `ExcludedEntity.reason` (`:2299`): add `| 'slot_limit'`.
2. `src/agent/ContextWindowManager.ts`:
   - Before the class (`:133`), export:

```ts
/** Options for {@link ContextWindowManager.prioritize}. */
export interface PrioritizeOptions {
  /** Maximum number of selected entities, must-include entities included. Unset = no cap. */
  maxSlots?: number;
}
```

   - `prioritize` (`:239`): add a fifth parameter `options: PrioritizeOptions = {}` and its `@param`. Compute `const slotCap = options.maxSlots !== undefined && Number.isFinite(options.maxSlots) && options.maxSlots >= 0 ? Math.floor(options.maxSlots) : Infinity;`. In the greedy loop (`:286`), first check `selected.length >= slotCap`; when true, push the candidate to `excluded` with reason `'slot_limit'`. Keep the budget branch (`:287-301`) as the second check.
   - `retrieveForContext` (`:315`): destructure `maxSlots` (`:321-329`) and pass `{ maxSlots }` to `prioritize` (`:371`).
   - Add a private helper:

```ts
  private withBudgetReport(
    pkg: Omit<ContextPackage, 'sourceTokens' | 'compressionRatio'>
  ): ContextPackage
```

     `sourceTokens = pkg.totalTokens + Σ pkg.excluded[i].tokens`. `compressionRatio = sourceTokens === pkg.totalTokens ? 1 : sourceTokens / Math.max(pkg.totalTokens, 1)`.
   - Return `this.withBudgetReport({...})` at `:395-401` and at `:719-725`.
3. `src/agent/index.ts`: add `type PrioritizeOptions,` to the `ContextWindowManager` export block (`:134-140`).

The ratio rule deviates from the source plan's "1 when the source fits `maxTokens`". The budget is `maxTokens - reserveBuffer`, and `minSalience` can also exclude entities. The rule "1 when nothing is excluded" is exact in both cases.

`retrieveWithBudgetAllocation` tracks only low-salience exclusions (`:700-708`). Its per-type retrievals do not report their budget cuts, so its `sourceTokens` is a lower bound. The TSDoc of the method states this.

**Gates.** `ContextWindowManager.test.ts` passes. Regression files pass. `typecheck`, `lint` exit 0. Scoped docs check on the three source files passes.

**Commit**: `feat(agent): report source tokens, compression ratio and an optional slot cap in context retrieval`

**CHANGELOG** (`### Added`): `` `ContextPackage.sourceTokens` and `ContextPackage.compressionRatio` report the candidate tokens that reached the budget cut and their ratio to the tokens kept. `ContextRetrievalOptions.maxSlots` and `prioritize(..., { maxSlots })` cap the number of memories; cut entities carry reason `'slot_limit'`. ``

**Card do-not-touch**: `prefilterCandidates`, `enforceDiversity` (`:962`), `generateSuggestions` (`:765`), `applyProfile` (`:1103`).

**Reviewer checklist.**

- [ ] Both `ContextPackage` return sites use `withBudgetReport`.
- [ ] Without `maxSlots`, the greedy loop gives the same result as before (existing tests pass unchanged).
- [ ] `PrioritizeOptions` is exported from the barrel.
- [ ] The tests use `reserveBuffer: 0` and the token values in this card.

**Rollback.** Revert E2b first, then `git revert <sha>`.

---

### E2b — Query ranking through hybrid search

- **Goal**: when `context.queryText` is set and a hybrid search is attached, `HybridSearchManager` orders the candidates before the salience cut. `composeHops: 1` adds the one-hop neighbors of the top results.
- **Depends on**: E2a. **Model**: Sonnet (see Section 1.1).
- **Files**: `src/types/agent-memory.ts`; `src/agent/ContextWindowManager.ts`; `tests/unit/agent/ContextWindowManager.test.ts`.
- **Regression files**: `tests/unit/agent/ContextProfileManager.test.ts`, `tests/unit/agent/AgentMemoryManager.test.ts`, `tests/unit/search/HybridSearchManagerGraph.test.ts`.

Facts the design depends on:

- `HybridSearchManager.search(graph, query, options)` (`src/search/HybridSearchManager.ts:157`) merges only names in the passed graph (`:216-227`).
- The lexical channel calls `rankedSearch.searchNodesRanked` over all storage (`:414-440`); the merge then drops names outside the passed graph.
- The semantic channel is capped at `SEMANTIC_SEARCH_LIMITS.MAX_LIMIT` = 100 (`src/utils/constants.ts:249-256`, `SemanticSearch.ts:321`).
- Neighbor expansion runs only when the manager has a `GraphRankPrior` (`:235`). `ctx.hybridSearchManager` attaches the prior only when `MEMORY_HYBRID_GRAPH_WEIGHT > 0` (`ManagerContext.ts:641-652`).

**Failing tests first.** In `ContextWindowManager.test.ts`, add `describe('query ranking')`. Entities `e1`..`e4` use `createTestEntity`. The stub is `const search = vi.fn().mockResolvedValue([hit(e3), hit(e1)])`, where `hit(e)` returns `{ entity: e, scores: { semantic: 0, lexical: 1, symbolic: 0, combined: 1 }, matchedLayers: ['lexical'] }`. Attach it with `cwm.setHybridSearch({ search })`.

| Test name | Input | Expected |
|---|---|---|
| `orders candidates by hybrid rank when queryText is set` | `maxTokens: 1000`, `queryText: 'alpha'` | memory names `['e3', 'e1']` |
| `passes the scoped graph and limit to hybrid search` | relations `e1→e2` and `e1→outside`; same call | `search` called once; `args[0].entities` names `['e1','e2','e3','e4']`; `args[0].relations` length 1; `args[1]` is `'alpha'`; `args[2]` equals `{ limit: 1000 }` |
| `keeps the salience path when queryText is absent` | no `queryText` | `search` not called; memories length 4 |
| `keeps the salience path when no hybrid search is set` | new manager, `queryText: 'alpha'` | memories length 4 |
| `treats whitespace-only queryText as absent` | `queryText: '   '` | `search` not called |
| `puts must-include entities first in query mode` | `mustInclude: ['e4']` | memory names `['e4', 'e3', 'e1']` |
| `passes expandNeighbors and lookFor when composeHops is 1` | `composeHops: 1` | `args[2]` equals `{ limit: 1000, expandNeighbors: { hops: 1 }, lookFor: 'alpha' }` |
| `adds one-hop neighbors through HybridSearchManager` | see below | `composeHops: 1` gives `['A', 'B']`; unset gives `['A']`; `C` is absent in both |

For the last test, build a real `new HybridSearchManager(null, mockRankedSearch as never, prior)`. Copy `makeFakePrior` from `tests/unit/search/HybridSearchManagerGraph.test.ts:35-50`. Use neighbors `{ A: ['B'], B: ['A', 'C'], C: ['B'] }`. Let `mockRankedSearch.searchNodesRanked` resolve `[{ entity: A, score: 5 }]`. Storage holds agent entities `A`, `B` and `C`.

Run the file. Expected before the implementation: every new test fails, because `setHybridSearch` does not exist. `keeps the salience path when no hybrid search is set` passes, because the test pins existing behavior.

**Implementation.**

1. `src/types/agent-memory.ts`, `ContextRetrievalOptions`: add `composeHops?: 0 | 1;`. TSDoc: 1 adds the one-hop neighbors of the top hybrid results; needs `queryText` and a `GraphRankPrior`.
2. `src/agent/ContextWindowManager.ts`:
   - Add `import type { HybridSearchManager } from '../search/HybridSearchManager.js';`.
   - Add `private hybridSearch?: Pick<HybridSearchManager, 'search'>;` and a public method `setHybridSearch(search: Pick<HybridSearchManager, 'search'> | undefined): void` with TSDoc, next to `setDistillationPolicy` (`:175`).
   - Add `preserveOrder?: boolean` to `PrioritizeOptions`, with TSDoc: keep the input order of optional entities instead of the efficiency order.
   - In `prioritize`, when `preserveOrder` is true, sort the optional list by input index instead of by efficiency (`:267`). Build the index as a `Map` of name to position in `entities`.
   - Add a private method:

```ts
  private async rankByQuery(
    candidates: AgentEntity[],
    graph: ReadonlyKnowledgeGraph,
    queryText: string,
    mustInclude: string[],
    composeHops: 0 | 1 | undefined
  ): Promise<AgentEntity[]>
```

     - Build `byName` from `candidates`.
     - Build the scoped graph: `entities: candidates`; `relations`: the relations of `graph` with both ends in `byName`.
     - Call `this.hybridSearch!.search(scoped, queryText, { limit: this.config.maxEntitiesToConsider, ...(composeHops === 1 ? { expandNeighbors: { hops: 1 }, lookFor: queryText } : {}) })`.
     - Return the must-include candidates first (in candidate order), then each hit's candidate object in hit order. Skip names already returned.
   - In `retrieveForContext`, destructure `composeHops` from the resolved options.
   - Replace the prefilter block (`:363-368`) with a branch. Query mode: `context.queryText?.trim()` is non-empty and `this.hybridSearch` is set. In query mode, call `rankByQuery` with the trimmed text and set `preserveOrder = true`. In all other cases, keep the prefilter block as it is.
   - Pass `{ maxSlots, preserveOrder }` to `prioritize`.
   - Distillation (`:348-361`) still runs first. `retrieveWithBudgetAllocation` does not change.
3. Do not wire `setHybridSearch` anywhere in `src/`. Default wiring is decision Q1 and card E2c.

Query mode returns only entities that hybrid search ranks, plus must-include entities. Without a semantic channel, an entity with no lexical match drops out. The TSDoc of `setHybridSearch` states this.

**Gates.** `ContextWindowManager.test.ts` passes. Regression files pass. `typecheck`, `lint` exit 0. Scoped docs check on the two source files passes.

**Commit**: `feat(agent): rank context candidates with hybrid search when queryText is set`

**CHANGELOG** (`### Added`): `` `ContextWindowManager.setHybridSearch()`: when `context.queryText` is set, `retrieveForContext` orders candidates with hybrid search before the salience cut. `ContextRetrievalOptions.composeHops: 1` adds one-hop neighbors (needs a `GraphRankPrior`). Off unless a hybrid search is attached. ``

**Card do-not-touch**: `HybridSearchManager.ts`, `ManagerContext.ts`, `AgentMemoryManager.ts`, `retrieveWithBudgetAllocation`.

**Reviewer checklist.**

- [ ] With no hybrid search or no `queryText`, the code path is byte-for-byte the old path (the prefilter still runs).
- [ ] An empty candidate list still calls `prioritize` (no early return).
- [ ] Must-include entities appear first, also when hybrid search does not return them.
- [ ] Hits outside the candidate set never enter the result.
- [ ] No production code calls `setHybridSearch`.

**Rollback.** `git revert <sha>`. Callers that call `setHybridSearch` fail to compile; within `src/` there are none.

---

## 8. Wave 3 cards

### E4 — Question-type profiles

- **Goal**: `inferProfile` returns `lookup` for who, which, when and where questions, and `synthesis` for why and how questions. A profile can set `retrieval.composeHops`.
- **Depends on**: Wave 2 merged. **Model**: Haiku.
- **Files**: `src/types/agent-memory.ts`; `src/agent/ContextProfileManager.ts`; `src/agent/ContextWindowManager.ts`; `tests/unit/agent/ContextProfileManager.test.ts`.
- **Regression files**: `tests/unit/agent/ContextWindowManager.test.ts`, `tests/unit/agent/AgentMemoryManager.test.ts`.

**Failing tests first.** In `ContextProfileManager.test.ts`, extend the `inferProfile` tests (`:135-178`) and the `ContextWindowManager integration` describe (`:323`). Use the mock storage at `:23` with agent entities.

| Test name | Input | Expected |
|---|---|---|
| `infers synthesis for why and how questions` | `'why did the build fail'`, `'How does the cache evict entries?'` | `'synthesis'` |
| `infers lookup for who, which, when and where questions` | `'who owns the build'`, `'Which module parses dates?'`, `'When was the release tagged?'`, `'where is the config file'` | `'lookup'` |
| `keeps task profiles ahead of question types` | `'why is the site down'`, `'how should we plan the migration'` | `'incident'`, `'planning'` |
| `does not match a question word inside another word` | `'somehow it works'` | `'default'` |
| `ships lookup and synthesis presets with no retrieval settings` | `getProfile('lookup')`, `getProfile('synthesis')` | `retrieval` is `undefined`; `salienceWeights` equal the default profile's |
| `lists the new profiles` | `getAvailableProfiles()` | contains `'lookup'` and `'synthesis'` |
| `applies retrieval.composeHops from a registered profile` | `registerProfile('synthesis', { ...getProfile('default'), retrieval: { composeHops: 1 } })`; hybrid stub; `retrieveForContext({ maxTokens: 1000, profile: 'synthesis', context: { queryText: 'why does it fail' } })` | stub `args[2].expandNeighbors` equals `{ hops: 1 }` |
| `lets an explicit composeHops override the profile` | same, plus `composeHops: 0` | stub `args[2]` has no `expandNeighbors` |
| `uses the shipped synthesis preset without expansion` | `profile: 'auto'`, `queryText: 'why does it fail'`, no registration | `getContextProfileManager().inferProfile('why does it fail')` is `'synthesis'`; stub `args[2]` equals `{ limit: 1000 }` |

Register through `cwm.getContextProfileManager()` (`ContextWindowManager.ts:1139`). Use the hybrid stub pattern from card E2b.

Run the file. Expected before the implementation: every new test fails, except three tests that pin existing behavior: `keeps task profiles ahead of question types`, `does not match a question word inside another word` and `lets an explicit composeHops override the profile`.

**Implementation.**

1. `src/types/agent-memory.ts`, `ContextProfile` (`:29`): add `'lookup' | 'synthesis'` before `'auto'`. Add two lines to the list above (`:22-28`): lookup for short factual questions, synthesis for why and how questions.
2. `src/agent/ContextProfileManager.ts`:
   - `ProfileConfig` (`:42`): add `retrieval?: { composeHops?: 0 | 1 };` with TSDoc: retrieval settings that the context window manager applies when the caller does not set them.
   - After `REVIEW_PATTERN` (`:66`), add `const LOOKUP_PATTERN = /^\s*(who|which|when|where)\b/i;` and `const SYNTHESIS_PATTERN = /^\s*(why|how)\b/i;`.
   - `createPresetProfiles` (`:70`): add `lookup` and `synthesis`, each with a copy of the default profile's `salienceWeights`, `temporalFocus` and `budgetAllocation`, and no `retrieval`.
   - `inferProfile` (`:216`): after the `REVIEW_PATTERN` line (`:222`), test `LOOKUP_PATTERN`, then `SYNTHESIS_PATTERN`. Update the priority list in the TSDoc (`:206-211`).
3. `src/agent/ContextWindowManager.ts`, `applyProfile` (`:1103`): in the result object (`:1125-1129`), add `composeHops: options.composeHops ?? profileConfig.retrieval?.composeHops`.

The shipped presets keep `retrieval` empty. The source plan says the question type is confounded with other factors, so a non-zero default needs a measurement first (Section 11, R10).

**Gates.** `ContextProfileManager.test.ts` passes. Regression files pass. `typecheck`, `lint` exit 0. Scoped docs check on the three source files passes.

**Commit**: `feat(agent): add lookup and synthesis question-type profiles`

**CHANGELOG** (`### Added`): `` Context profiles `lookup` (who / which / when / where questions) and `synthesis` (why / how questions), inferred after the four task profiles. `ProfileConfig.retrieval.composeHops` lets a profile turn on one-hop expansion; the shipped presets leave it unset. ``

**Card do-not-touch**: the four existing patterns and presets, `buildSalienceContext`, `MemoryEngine.ts`.

**Reviewer checklist.**

- [ ] The new patterns run after the four existing patterns.
- [ ] Both patterns anchor at the start of the text.
- [ ] Shipped presets have no `retrieval` key.
- [ ] An explicit `composeHops` always wins over the profile.

**Rollback.** `git revert <sha>`. Callers that pass `profile: 'lookup'` or `'synthesis'` fail to compile.

---

### E5 — Repeat count per session

- **Goal**: `MemoryEngine.getRepeatedTurnCount(sessionId)` returns how many turns the dedup chain rejected in the session.
- **Depends on**: Wave 2 merged. **Model**: Haiku.
- **Files**: `src/agent/MemoryEngine.ts`; `tests/unit/agent/MemoryEngine.test.ts`.
- **Regression files**: none beyond the card's test file.

**Failing tests first.** In `MemoryEngine.test.ts`, add `describe('MemoryEngine — repeated turn count')`. Use `mkCtx()` (`:14`) and the constructor call of the existing tests (`:162-165`). Use role `'user'` for every turn.

| Test name | Input (session `sess-A` unless stated) | Expected |
|---|---|---|
| `counts exact and Jaccard repeats` | `T1 = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda extra'`; add `T1`, add `T1`, add `'lambda kappa iota theta eta zeta epsilon delta gamma beta alpha other'` | second result `duplicateTier` `'exact'`; third `'jaccard'`; `getRepeatedTurnCount('sess-A')` is 2 |
| `returns 0 for distinct turns` | add `'alpha beta gamma'`, add `'delta epsilon zeta'` | 0 |
| `returns 0 for an unknown session` | no turns | `getRepeatedTurnCount('nope')` is 0 |
| `keeps counts per session` | repeat `T1` once in `sess-A`; add `T1` once in `sess-B` | `sess-A` 1, `sess-B` 0 |
| `resets the count on deleteSession` | two repeats, then `deleteSession('sess-A')` | 0 |

The Jaccard pair comes from the existing test at `:166-171`.

Run the file. Expected before the implementation: every new test fails, because `getRepeatedTurnCount` does not exist.

**Implementation** (`src/agent/MemoryEngine.ts`).

1. After `sessionWriteQueues` (`:148`), add `private readonly repeatedTurnCounts = new Map<string, number>();`.
2. In the duplicate branch of `addTurnForSession` (`:245-259`), before the `return`, increment the count for `options.sessionId`.
3. Add a public method after `getSessionTurns` (`:325` block):

```ts
  /**
   * Number of turns the dedup chain rejected for a session in this process.
   * The count is not persisted and resets on deleteSession.
   *
   * @param sessionId - Session identifier
   * @returns Number of rejected repeat turns (0 when none)
   */
  getRepeatedTurnCount(sessionId: string): number
```

4. Make `this.repeatedTurnCounts.delete(sessionId);` the first statement of `deleteSession` (`:554`).

**Gates.** `MemoryEngine.test.ts` passes. `typecheck`, `lint` exit 0. Scoped docs check on `src/agent/MemoryEngine.ts` passes.

**Commit**: `feat(agent): count repeated turns per session in MemoryEngine`

**CHANGELOG** (`### Added`): `` `MemoryEngine.getRepeatedTurnCount(sessionId)`: number of turns the dedup chain rejected in the session, kept in process memory and reset by `deleteSession`. ``

**Card do-not-touch**: the dedup tiers, `checkDuplicate` (`:416`), the event payloads.

**Reviewer checklist.**

- [ ] The count changes only in the duplicate branch.
- [ ] `deleteSession` clears the count also when the session has no stored turns.
- [ ] The TSDoc says the count is per process.

**Rollback.** `git revert <sha>`.

---

## 9. Conditional cards

Re-verify every anchor in this section when the trigger fires. The anchors were checked against the same `master` tip as the rest of the plan, but later waves move lines in `ContextWindowManager.ts` and `agent-memory.ts`.

### E3a — Query-aware LLM summarizer (only if a caller asks; trigger C1)

- **Goal**: `SummarizationService` can summarize through an `LLMProvider` and pass the query into the prompt.
- **Depends on**: trigger C1. **Model**: Haiku.
- **Files**: `src/agent/SummarizationService.ts`; `src/agent/index.ts`; `tests/unit/agent/SummarizationService.test.ts`.

**Failing tests first.** Add `describe('LLMSummarizationProvider')` near `provider management` (`:299`). The LLM stub is `{ complete: vi.fn() }` (shape of `LLMProvider`, `src/search/LLMQueryPlanner.ts:29`).

| Test name | Input | Expected |
|---|---|---|
| `passes the query and the texts to the LLM` | `summarize(['first text', 'second text'], 'why x')` | the prompt string contains `'why x'`, `'first text'` and `'second text'` |
| `clips the LLM output to maxTokens` | stub returns `'w1 w2 … w30'` (30 words); `maxTokens: 14` | result is `'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10'` |
| `falls back when the LLM throws` | stub rejects | result equals `await new SummarizationService().summarize(texts)` |
| `uses the provider for one text when a query is set` | `summarize(['only'], 'q')` | stub called once |
| `returns one text unchanged without a query` | `summarize(['only'])` | `'only'`; stub not called |
| `registers the provider from the constructor option` | `new SummarizationService({}, { llmProvider: stub })` | `isLLMAvailable()` is `true` |

The word limit is `Math.max(1, Math.floor(maxTokens / 1.3))`; for 14 the limit is 10.

**Implementation.**

1. `ISummarizationProvider.summarize` (`:19`): change to `summarize(texts: string[], query?: string): Promise<string>;`.
2. Export `interface SummarizationServiceOptions { llmProvider?: LLMProvider }` (type import from `../search/LLMQueryPlanner.js`). Do not add the provider to `SummarizationConfig`; `getConfig()` returns `Required<SummarizationConfig>`.
3. Export `class LLMSummarizationProvider implements ISummarizationProvider` with `constructor(llm: LLMProvider, maxTokens: number)`. `isAvailable()` returns `true`. `summarize(texts, query?)` builds one prompt, calls `llm.complete(prompt)`, and clips the reply to the word limit.
4. Constructor (`:89`): `constructor(config: SummarizationConfig = {}, options: SummarizationServiceOptions = {})`. When `options.llmProvider` is set, register `new LLMSummarizationProvider(options.llmProvider, this.config.maxTokens)`.
5. `summarize` (`:127`): add `query?: string`. Return the single text early (`:129`) only when `query` is undefined. Pass `query` to the provider.
6. `src/agent/index.ts` (`:114-119`): add `LLMSummarizationProvider` and `type SummarizationServiceOptions`.

**Gates**: as in Section 4.3. Test file: `SummarizationService.test.ts`. Regression files: `tests/unit/agent/ContextWindowManager.test.ts`.

**Commit**: `feat(agent): add a query-aware LLM summarization provider`

**CHANGELOG** (`### Added`): `` `LLMSummarizationProvider` and `SummarizationService(config, { llmProvider })`: summaries through any `LLMProvider`, with an optional query (`summarize(texts, query?)`); falls back to the algorithmic summary on error. ``

**Reviewer checklist**: fallback path unchanged; no network call in tests; `getConfig()` shape unchanged.

**Rollback**: revert E3b first, then `git revert <sha>`.

### E3b — Summary of excluded memories (only if a caller asks; trigger C1)

- **Goal**: with `summarizeExcluded: true`, `retrieveForContext` adds one summary of the cut memories to the package.
- **Depends on**: E3a. **Model**: Haiku.
- **Files**: `src/types/agent-memory.ts`; `src/agent/ContextWindowManager.ts`; `src/agent/ContextProfileManager.ts`; `tests/unit/agent/ContextWindowManager.test.ts`.

**Failing tests first** (`describe('excluded summary')`, stub `{ summarize: vi.fn().mockResolvedValue('S') }` attached with `setSummarizer`):

| Test name | Input | Expected |
|---|---|---|
| `summarizes excluded memories with the query` | E2a fixture with `maxTokens: 20`, `summarizeExcluded: true`, `queryText: 'q'` | `excludedSummary` is `'S'`; stub called once with the two excluded observation texts and `'q'` |
| `does not summarize by default` | same, no flag | stub not called; `excludedSummary` is `undefined` |
| `does not summarize when nothing is excluded` | `maxTokens: 1000`, flag set | stub not called |
| `takes summarizeExcluded from the profile` | registered profile with `retrieval: { summarizeExcluded: true }` | stub called |

**Implementation.**

1. `ContextRetrievalOptions`: add `summarizeExcluded?: boolean`. `ContextPackage`: add `excludedSummary?: string` (TSDoc: not counted in `totalTokens`).
2. `ContextWindowManager`: add `setSummarizer(summarizer: Pick<SummarizationService, 'summarize'> | undefined): void`.
3. In `retrieveForContext`, check three conditions after the exclusions are known. The flag is set. A summarizer is set. One or more entities are excluded. When all three hold, call `summarize(excluded.map((e) => e.entity.observations.join(' ')), context.queryText)`.
4. `ProfileConfig.retrieval`: add `summarizeExcluded?: boolean`. `applyProfile`: `summarizeExcluded: options.summarizeExcluded ?? profileConfig.retrieval?.summarizeExcluded`.

**Gates**: as in Section 4.3. Test file: `ContextWindowManager.test.ts`. Regression files: `tests/unit/agent/ContextProfileManager.test.ts`, `tests/unit/agent/AgentMemoryManager.test.ts`.

**Commit**: `feat(agent): summarize excluded memories in context retrieval`

**CHANGELOG** (`### Added`): `` `ContextRetrievalOptions.summarizeExcluded` and `ContextWindowManager.setSummarizer()`: one summary of the memories the budget cut, returned as `ContextPackage.excludedSummary`. Off by default. ``

**Reviewer checklist**: summary not added to `totalTokens`; no summarizer call when the flag is unset; profile default applies only when the option is unset.

**Rollback**: `git revert <sha>`.

### E2c — Default wiring of hybrid ranking (only after decision Q1; trigger C2)

- **Goal**: the context wires `ctx.hybridSearchManager` into `ctx.contextWindowManager`, behind the switch that decision Q1 names.
- **Depends on**: trigger C2. **Model**: Haiku.
- **Files**: `src/core/ManagerContext.ts`; `src/cli/commands/doctor.ts`; `src/cli/commands/diag.ts`; new `tests/unit/core/ManagerContext-hybridContext.test.ts`.

Shape, if Q1 chooses an opt-in switch:

1. In the `contextWindowManager` getter (`ManagerContext.ts:1605-1620`), after construction, call `setHybridSearch(this.hybridSearchManager)` when `this.getEnvBool('MEMORY_CONTEXT_HYBRID_RANKING', false)` is true.
2. Add `MEMORY_CONTEXT_COMPOSE_HOPS` (0 or 1, default 0) only if Q1 also asks for a context-wide default. That needs a `composeHops` field on `ContextWindowManagerConfig` (`src/types/agent-memory.ts:80`); add that file to the card in that case.
3. Add each new variable to `ENV_VAR_CATALOG` (`src/cli/commands/diag.ts:44`). Add numeric variables to `EXTRA_NUMERIC_VARS` (`src/cli/commands/doctor.ts:321-323` block).
4. Test the switch unset: a stub `search` on `ctx.hybridSearchManager` is not called.
5. Test the switch set: the stub is called once per retrieval with `queryText`.

`AgentMemoryManager` builds its own `ContextWindowManager` (`AgentMemoryManager.ts:195`) and does not see `ctx.hybridSearchManager`. Q1 decides whether E2c also covers that instance.

**Gates**: as in Section 4.3. Test file: `ManagerContext-hybridContext.test.ts`. Regression files: `tests/unit/core/ManagerContext.test.ts`, `tests/unit/cli/doctor.test.ts`, `tests/unit/cli/diag.test.ts`.

**Commit**: `feat(core): wire hybrid ranking into the context window manager`

**Rollback**: `git revert <sha>`; the environment variable then has no effect.

---

## 10. Wave close task

Each wave ends with one close task. A Sonnet worker runs it on the wave branch (in a worktree) after all cards of the wave are cherry-picked. The integrator pushes, opens the PR and merges.

**Files**: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `todo.md`, `docs/architecture/**`, `docs/guides/**`, `docs/roadmap/ROADMAP.md`, `docs/roadmap/MEMORILLA_LATENT_MEMORY_PLAN.md` (the **Status** line only). No `src/` or `tests/` file.

**Steps.**

1. Sync the generator's own dependencies: `npm ci --prefix tools/create-dependency-graph --ignore-scripts --no-audit --no-fund`. A stale tool `node_modules` changes the quote style in `dependency-graph.yaml`, which is not a content change.
2. Run `bun run tools:deps`. Then run `bun run tools:check-census` and `bun run tools:check-duplicates`. Expected: both pass.
3. Compare each regenerated file with CR removed (`core.autocrlf=true` marks equal files as modified). Keep only real changes.
4. Write the CHANGELOG entries of the wave's cards under `## [Unreleased]`, in `### Added`, `### Changed` and `### Fixed` above the existing `### Security`. Never append at the end of the file.
5. Update the documents that the wave changes (list below). Write in ASD-STE100. Run `repo-tools ste <file>` on each changed Markdown file and fix each finding.
6. Run both doc gates:
   - `repo-tools check . --docs=docs/architecture`. Expected: exit 0.
   - `repo-tools docs check src`. Expected: `PASS`.
7. Run the full suite: `SKIP_BENCHMARKS=true bun run test:ci`. Then `bun run build` and `node scripts/node-runtime-smoke.mjs`. Expected: all pass.
8. Make one commit: `docs: sync architecture docs and CHANGELOG for Memorilla wave <N>`.
9. Write the PR body (template below). Return to the integrator.

**Documents per wave.**

| Wave | Documents and anchors |
|---|---|
| 1 | `docs/architecture/ARCHITECTURE.md:441` (`SQLiteVectorStore`: now wired by `ctx.semanticSearch` on SQLite, re-embeds on `contentHash` change); `docs/guides/CONFIGURATION.md:359-368` (fix `createVectorStore('memory', storage)`: valid types are `'jsonl'` and `'sqlite'`); `docs/architecture/COMPONENTS.md:1269-1270`; `README.md` semantic-search rows; `CLAUDE.md` search-system bullets; `docs/roadmap/ROADMAP.md:253-268` (mark E1 done) |
| 2 | `docs/architecture/API.md:334`, `docs/architecture/AGENT_MEMORY.md:693`, `docs/architecture/COMPONENTS.md:1918`: each `ContextPackage` block is already stale (`breakdown` field names, `excluded: string[]`); replace each with the real interface plus `sourceTokens` and `compressionRatio`; document `maxSlots`, `composeHops`, `setHybridSearch`; `ROADMAP.md` (mark E2 done) |
| 3 | `docs/architecture/AGENT_MEMORY.md` profile list (add `lookup`, `synthesis`, `retrieval`); `docs/architecture/API.md:1775-1813` (`getRepeatedTurnCount`); `README.md:91` (MemoryEngine row); `CLAUDE.md:153` (MemoryEngine public API line); `ROADMAP.md` (E4, E5 done); `MEMORILLA_LATENT_MEMORY_PLAN.md` **Status** line |
| C1, C2 | Summarization and environment-variable tables in `CLAUDE.md`, `docs/guides/CONFIGURATION.md`, `docs/architecture/AGENT_MEMORY.md` |

**PR body template.**

```text
## Summary
<two or three lines: what the wave adds, default behavior unchanged>

## Cards
- <card-id>: <commit subject> (<short sha>)

## Tests
- New tests: <count>, all passing
- Full suite: SKIP_BENCHMARKS=true bun run test:ci, <result>

## Gates
- repo-tools check . --docs=docs/architecture: <result>
- repo-tools docs check src: <result>
- tools:check-census, tools:check-duplicates: <result>

junior chain run: yes, N of M accepted
```

`M` is the number of junior outputs in the wave: Haiku card commits plus local-model drafts. `N` is the number accepted without rework. When no junior helper ran, write `junior chain run: no` and the reason.

**Integrator merge steps.**

1. Run `gh repo view --json isPrivate -q .isPrivate`. A `false` result confirms the no-attribution rule for the PR body.
2. Push the wave branch and open the PR.
3. Wait for CI. All six legs (ubuntu, windows, macos × Node 22, 24) must pass.
4. Merge with `gh pr merge --rebase`. Sync local `master` to `origin/master`.
5. Remove each card worktree with `git worktree remove`.

**Close-task stop condition**: a doc gate or the full suite fails, and the fix needs a source or test change. Report `BLOCKED`. The integrator sends the fix back to the owning card.

**Close-task rollback**: `git revert <sha>` of the close commit restores the documents. Revert the card commits first when the whole wave is withdrawn.

### 10.1 Rollback of a merged card

1. Create a branch from `origin/master`.
2. Revert dependents first: E1d before E1c before E1b before E1a; E2b before E2a; E3b before E3a.
3. Run `git revert <card sha>`.
4. Remove the card's CHANGELOG line from `## [Unreleased]`. If the version is already released, add a `### Removed` or `### Fixed` line instead.
5. Run `bun run tools:deps` and commit the regenerated `docs/architecture` files.
6. Open a PR. Merge after CI passes.

---

## 11. Risks and open questions

The items below need a decision before the named card, or a measurement. This plan does not decide them.

### Decisions (ADR level)

- **Q1 — Default wiring of hybrid ranking.** E2b adds the mechanism but wires nothing. Wiring `ctx.hybridSearchManager` into `ctx.contextWindowManager` changes the result order for every caller that passes `queryText`. `AgentMemoryManager.retrieveForContext` (`AgentMemoryManager.ts:365-379`) maps `keywords` to `queryText`, so its callers are affected too, through a separate manager instance. Decide: default on, opt-in switch, or no wiring; and the switch name. Card E2c waits for this answer.
- **Q2 — E5 schedule.** The source plan marks E5 as optional and caller-driven. This plan schedules E5 in Wave 3. Decide whether E5 moves to a conditional wave with a caller trigger, as E3 does.
- **Q3 — What `contentHash` covers.** E1 re-embeds only when `Entity.contentHash` changes. `MemoryEngine` sets that hash from the raw turn content. Most entities have no `contentHash`, and an observation edit does not change it, so their vectors can go stale. The alternative is a hash of `entityToText(entity)`, computed at index time. That choice changes what the column means.
- **Q4 — Required or optional report fields.** E2a adds `sourceTokens` and `compressionRatio` as required fields of the exported `ContextPackage`. External code that builds a `ContextPackage` literal stops compiling. Optional fields avoid that break but weaken the guarantee.
- **Q5 — Merge method.** This plan merges with rebase to keep one commit per card. The repository history uses squash merges. Squash gives one commit per wave and needs a manual partial revert for one card.
- **Q6 — Budget for the excluded summary.** E3b returns `excludedSummary` outside `totalTokens`. Decide whether the summary must fit inside `reserveBuffer`, or whether the caller budgets for the summary.

### Risks to measure or watch

- **R1 — Shared `embeddings` table.** `MemoryEngine.ts:295-305` writes raw-content vectors into the same table under the entity name, with model `'unknown'`. No code in `src/` reads those rows today; only `SQLiteVectorStore.initialize` calls `loadAllEmbeddings`. After E1, `initialize` skips the rows (other model), and `indexAll` overwrites each row with an `entityToText` vector of the real model. The raw-content vectors are then lost. A follow-up can give `MemoryEngine` its own table or write through the vector store.
- **R2 — Model change.** Rows of another model stay in SQLite and stay out of memory. After a model change, the first `indexAll` re-embeds every entity once.
- **R3 — Writers without a hash.** `IncrementalIndexer.ts:313` calls `add` without a hash. The next `indexAll` re-embeds those entities once.
- **R4 — Orphan rows.** `saveGraph` (`SQLiteStorage.ts:881`) deletes entity rows with foreign keys off, and the embedding rows stay. The roadmap's "ON DELETE CASCADE" path is not the real path: `deleteEntities` deletes embedding rows explicitly (`:1488-1495`).
- **R5 — In-memory copy after delete.** A storage delete does not update `SQLiteVectorStore`'s in-memory map. Search drops such names only because the entity lookup fails.
- **R6 — Foreign key on write.** `storeEmbedding` needs the entity row. `indexEntity` on an unsaved entity fails and returns `false`.
- **R7 — Scoped ranking limits.** The semantic channel returns at most 100 names over the whole store before the scope filter. The lexical channel ranks the whole storage, so out-of-scope hits can take places in its top list. With more than 100 candidates, some relevant candidates can drop out.
- **R8 — Query mode drops entities.** In query mode, a candidate that no channel ranks is not considered. Without a semantic channel, an entity with no lexical match drops out.
- **R9 — Question-word heuristic.** "How many" questions are classified as `synthesis`, although they are lookups.
- **R10 — Cost before defaults.** Measure `retrieveForContext` with hybrid ranking on a 10,000-entity store before any non-zero default (Q1, E4 presets).
- **R11 — Inert expansion.** `composeHops` does nothing unless the hybrid search has a `GraphRankPrior`. `ctx.hybridSearchManager` attaches the prior only when `MEMORY_HYBRID_GRAPH_WEIGHT > 0`.
- **R12 — Local hooks.** `.git/config` sets `core.hooksPath` to a folder that does not exist, so no local Git hook runs. CI is the only gate. The `CLAUDE.md` note about a Dropbox-synced clone may be stale.
- **R13 — Diversity.** `enforceDiversity` (`ContextWindowManager.ts:962`) is public but `retrieveForContext` does not call it. The new ranking does not change that.
