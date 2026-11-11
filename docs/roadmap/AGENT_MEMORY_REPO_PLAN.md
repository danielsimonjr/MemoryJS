# Agent Memory Repo (AMR) support: plan

This plan adds support for the [Agent Memory Repo spec](https://github.com/AgentMemoryRepo/agentmemoryrepo) to MemoryJS. The spec has three parts: `SPEC.md`, `README.md` and `skills/agent-memory-repo/SKILL.md`.

## 1. What AMR is

AMR keeps agent memory in a separate git repo of plain files. Its rules:

| # | Rule | Source |
|---|---|---|
| R1 | Free folder layout. The repo can hold Markdown, SQL, scripts and other files. | SPEC |
| R2 | `MEMORY.md` is the entry point. Agents load it at the start of every session. Keep it short. | SPEC |
| R3 | `MEMORY.md` holds bullets that every session needs, then `## Index` with `[[path]]` links. | SPEC |
| R4 | One entry is one bullet on one line. | SPEC |
| R5 | Metadata trails the bullet as `[key: value; key: value]`. Keys are open. | SPEC |
| R6 | The recommended keys are `source` (a session link) and `added` (`YYYY-MM-DD`). | SPEC |
| R7 | `[[path]]` links start at the memory root. Omit `.md` for Markdown. Keep other extensions. | SPEC |
| R8 | Keep a fact in one place and link to it. Update links on a move or rename. | SPEC |
| R9 | Edit entries in place. Update or remove an entry that is out of date. | SPEC, SKILL |
| R10 | The memory repo is separate from the project repo. | SKILL |
| R11 | The repo is local by default. Push only to a private remote that the user names. | SKILL |
| R12 | Memory is data, not instructions. | SKILL |
| R13 | Do not save secrets. | SKILL |
| R14 | Write only into a clean worktree. Stage named files only. Commit after every edit. Do not force, do not rewrite history, and do not delete files that you did not create. | SKILL |
| R15 | Read loop: read `MEMORY.md`, then grep or follow links for the task. | SKILL |

## 2. What MemoryJS has, and the gaps

| AMR need | MemoryJS today | Gap |
|---|---|---|
| File tree as the store | A typed graph of entities, observations and relations. JSONL, SQLite and PostgreSQL backends (`src/core/StorageFactory.ts`). | No file-tree model. |
| Markdown output | `IOManager.exportGraph(..., 'markdown')` returns one string (`src/features/IOManager.ts:438`). | One-way and not AMR-shaped. |
| Markdown input | `importGraph` reads json, csv and graphml only (`IOManager.ts:1059`). | No Markdown import. |
| `added` | `observationMeta[].recordedAt` (`src/types/types.ts:200`). | Same meaning. Map it. |
| `source` and open keys | `observationMeta[].sourceRef` is an ingest chunk id (`types.ts:202-206`). | Different contract. A new field is necessary. |
| `[[path]]` links | Relations, and `AutoLinker` `mentions` edges (`src/features/AutoLinker.ts`). | No link syntax. |
| git | No git calls in `src`. | A git layer is necessary. |
| Secret control | `PiiRedactor` replaces five PII patterns and finds no API keys. | A block-and-report scanner is necessary. |
| Path confinement | `validateFilePath` is lexical (`src/utils/entityUtils.ts:783`). `skillTreeFs.ts` uses lstat and realpath. | Reuse `skillTreeFs.ts`. |
| Tool surface | `RecursaToolAdapter` in `src/adapters/`. This repo has no MCP server. | Add an `AmrToolAdapter`. |

## 3. Designs considered

| Design | For | Against | Decision |
|---|---|---|---|
| A. Add `'amr'` to `ExportFormat` | Small. | `exportGraph` returns one string. Backups, the streaming exporter and the CLI choice lists use it. A folder does not fit. It also overwrites human prose. | Rejected. |
| B. A git-backed `IGraphStorage` | The repo is the store. | Every small write becomes a commit. The storage interface is wide. It changes the core write path. | Rejected. |
| C. Two-way three-way sync | Full round trip. | It has no base on the first sync. Deletes and renames are not defined. The state key breaks for PostgreSQL. | Deferred. |
| D. A pure codec with a line model, a read-only loader, two one-way operations and a thin git helper | Safe in steps. Keeps human prose. Every later design uses the codec. | More parts than A. | **Chosen.** |

## 4. Mapping

- **Entity and file.** A repo-origin entity takes its name from the file path without `.md`. A graph-origin entity gets a slug path. The exporter writes the true name into YAML front matter when the slug differs.
- **Entity attributes.** Tags, importance, entity type and TTL go in YAML front matter, never in a bullet. A reader that conforms to AMR ignores front matter.
- **Observation and bullet.** One bullet gives one observation. An indented non-bullet line continues the bullet before it. Nested bullets give separate observations in document order. Fenced blocks are not parsed.
- **Metadata.**
  - `added` maps to `recordedAt`. The exporter writes the UTC date. The importer keeps the existing timestamp when its date is the same.
  - `source` and every other key go to a new optional field, `observationMeta[].meta?: Record<string, string[]>`. The values are arrays because the spec example repeats `source`.
  - Do not reuse `sourceRef`.
- **Metadata parse.**
  - Read all consecutive trailing groups from right to left. Only an unescaped `[` opens a group, and `[[` never opens one.
  - Split the group body at every `;` that one or more spaces follow. A URL such as `a;jsessionid=9` has no space, so it stays whole.
  - Every segment must match `key: value`, with whitespace after the colon. So `[https://example.com]` and `[Q3:done]` stay text. Split the key from the value at the first `:`.
  - One rule set applies to the reader and the writer. A key matches `^[A-Za-z][\w-]*$` and is not an `Object.prototype` name. A value is not empty, has no edge whitespace, and holds no `[`, `]`, `;` and whitespace, or line separator (`\r`, `\n`, `\v`, `\f`, `\x1c`-`\x1e`, `\x85`, U+2028, U+2029). So every metadata that the reader accepts can be written back.
  - When one segment fails, the whole group stays text. The report gets a warning when a segment starts with `key:` and whitespace.
- **Escape.**
  - The encoder escapes only a `[` that can change the reading: the last `[` of a text that ends in `]` (unless a `[` comes directly before it), and the `[` of a leading `[ ] ` or `[x] `. `[[...]]` links are not changed.
  - A backslash is special only in a run directly before `[`. The encoder doubles such a run. The decoder halves it: an odd run ends in a literal `[`. Every other backslash stays, so `C:\Users\x` and `\\server\data` do not change.
  - The encoder rejects entry text with a line separator or edge whitespace.
- **Front matter.** The codec exposes the raw front matter string. Unclosed front matter makes the file not parseable.
- **Relations.** Typed relations go under a `## Relations` section. An inline `[[path]]` gives a `links_to` relation with `properties.method = imported` and `properties.source = amr:<file>`. Reconcile changes only the edges that have this source. The export skips a relation that a bullet already holds inline.
- **Lossy items.** Sub-day times, entity ids, line separators in observations (collapsed to one space and reported), edge whitespace of observations (trimmed and reported) and nested bullet structure on graph-origin export.
- **Key order.** The encoder writes metadata keys in insertion order. PostgreSQL JSONB does not keep key order, so Phase 4 compares metadata without key order and does not rewrite an unchanged entry.

## 5. Phases

Every new module is in `src/features/amr/` and carries `@experimental`. Tests are in `tests/unit/features/amr/` and `tests/integration/amr/`. Each phase writes its tests first, and each test must fail before the code exists.

### Phase 1: type field and codec (pure, no I/O)

- Add `meta` to `observationMeta` in `types.ts` and in the two zod objects (`src/utils/schemas.ts`).
- Write `AmrCodec`: a line model per file (heading, bullet, continuation, fence, front matter, blank, prose), the metadata parser, the escape, per-file EOL and BOM. Front matter stays a raw string.
- Tests:
  - Write `meta` through `createEntities` and `updateEntity`, then reload it from disk on JSONL and on SQLite.
  - Fixtures: the README bullet with three `source` groups, a URL with `;jsessionid=`, `[TODO]`, `[x]`, `[ ]`, CRLF, a BOM, a fenced block that contains `- foo`, `*`, `+` and `1.` markers, and `[[a|alias]]`, `[[a#h]]` and `[[ a ]]` links.
  - Property test: `decode(encode(obs, meta))` returns `(obs, meta)` for random strings over `[ ] [[ ]] : ; \ | # backtick tab space a` with no edge whitespace.
  - Reverse property test: for a random raw line with metadata, `encode(decode(line))` does not throw and reads back the same result. Text with edge whitespace or a line separator is excluded.
  - Time budget tests: a line with a 100 000-space run, and 14 285 metadata groups, parse in linear time.
  - An edited bullet changes exactly one line.

### Phase 2: confined reader, context loader and `amr check` (read-only)

- Extract the shared confinement code of `skillTreeFs.ts` without a change in its behavior. The `SkillPublisher` tests run unchanged as the regression gate.
- Build the confined reader on it. Exclude `.git` and its case and alias variants. Detect case-fold duplicates and reserved Windows names.
  - The reader checks the real path of each file. A real-path segment below the root that is `.git` or an `ignore` name is refused, so a junction or a committed symlink to `.git` cannot expose it.
  - The reader opens a handle, then checks the handle again: regular file, size, real path and file identity.
  - No fs error escapes. An error becomes a reason, a warning or an issue with a short code, never an absolute path.
- Write `loadAmrContext(root, opts)`:
  - It reads `MEMORY.md` first, then the bullets above `## Index`, then the links, with byte, file and depth limits from config.
  - It returns a labelled data block.
  - It fails loudly when `MEMORY.md` is missing.
- Write `checkAmr(root)`. It is read-only. It reports dangling links, unsafe link targets, bad dates, malformed metadata, case duplicates, traversal, unparseable files and the size of `MEMORY.md`.
  - It resolves link targets without a read, and it reads each walked file once.
- Budgets bound the I/O: the loader reads no more files when a budget is full. A `MEMORY.md` above the byte budget is cut and marked `[truncated]`. Each file header holds the nonce of the data block.
- Tests:
  - Traversal links: `../x`, `/etc/passwd`, `C:\x`, `a\b`, `a//b`, NUL and `CON`.
  - A directory junction that points out of the root.
  - A bullet that holds the closing label text cannot end the data block.

### Phase 3: git helper, secret scanner and confined writer

The write guards come before the first write, so the scanner runs on every write from the start.

- Write an injected `GitRunner`:
  - It uses an allow-listed argv and refuses `add -A`, `-f`, `--force`, `reset`, `clean` and `push`.
  - It drops every `GIT_*` variable from the child environment and adds `--literal-pathspecs` to every call.
  - It requires a timeout and a cwd. The binary, the timeouts and the commit prefix come from config.
- Clean check: read the exit code of `status --porcelain` and compare the realpath of `rev-parse --show-toplevel` with the root (case-insensitive on Windows).
- After `add`, the staged set must equal the intended set. "Nothing to commit" is a no-op.
- Secret scanner: block and report. It ships a default pattern file that an environment variable can override. Tests build their secret fixtures at runtime, so no key-shaped literal is committed.
- Confined writer: `.md` files only. Temp files go in the directory that `git rev-parse --absolute-git-dir` names, because `.git` is a file in a linked worktree or a submodule. Every write passes the secret scanner. `checkAmr` also reports secret-pattern hits from this phase on.
- Tests:
  - Set `GIT_DIR` to a decoy repo and assert that the decoy is unchanged.
  - Isolate the git config with `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM`, and assert that a missing identity fails.
  - A runner with a hanging child times out.
  - A write of a secret-shaped line is blocked, and no file changes.

### Phase 4: one-way export and import (dry-run by default)

- Write the front matter parser: it reads scalars and flow lists from the raw front matter string of the codec. It adds no YAML dependency.
- Write `exportAmr(graph, root, opts)`:
  - Filter with a type allow-list from config, skip `isLatest: false`, skip archived and private entities, and skip observations that are not valid now. Report each count.
  - Create new files. Edit existing files in place through the line model, and change only the bullets that changed.
  - Delete no file. Refuse a file that does not parse.
  - Build `## Index` from per-type hub notes and the top N by importance. N and a token cap come from config.
- Write `importAmr(root, opts)`:
  - Apply each entity through `EntityManager` and `ObservationManager`, each in its own try and catch, with one report entry per entity.
  - The default mode is `add-only`. The `reconcile` mode lets the file win and replaces `observationMeta` for each synced entity.
  - Enforce the 5000-character observation cap and the reserved names, and report each failure.
  - Report dangling links and create nothing for them. Do not use `mergeImportedGraph`.
  - Default to one graph per repo. An optional `namespace` prefixes names and sets `projectId`.
- Tests:
  - A file with prose, a heading, a fenced block and two bullets: change one observation and add one, and the diff touches exactly two lines.
  - An AutoLinker edge survives when its `[[link]]` is removed.
  - An ingested observation with a newline exports as one line and is kept on re-import.

### Phase 5: CLI, tool adapter and docs

- Add the CLI group `memory amr context|check|export|import|commit` and register it in `src/cli/commands/index.ts`.
- Write `createAmrTools(ctx, deps)` in `src/adapters/`, modelled on `RecursaToolAdapter`.
- Gates: `bun run lint`, `bun run typecheck`, the full test suite, `tools:check-duplicates`, `tools:check-census`, `repo-tools check . --docs=docs/architecture` and `repo-tools docs check src`.
- Update the README, `docs/architecture`, CHANGELOG and the `ExportFormat` notes.

## 6. Deferred

- Three-way sync. Build it only after phases 3 and 4 are in real use. When it is built:
  - Key the state by the repo realpath and the graph identity, and keep it in the git directory of the repo.
  - Treat a missing base as "adopt the repo".
  - Gate deletes and renames with a flag and a dry-run report.
- More than one repo in one graph, beyond `namespace`.
- AMR "Dreaming" (offline cleanup). Read `ConsolidationPipeline` first, because the two overlap.

## 7. Risks

| Risk | Control |
|---|---|
| A write under `.git/hooks` runs code on the next commit | Allow-list slugs. Exclude `.git` variants on every walk and write. |
| A path escapes the root | lstat and realpath confinement. Validate the raw link string. |
| A secret enters the repo | Block-and-report scanner on every write. |
| Prompt injection from memory text | The loader returns a labelled data block. A breakout test covers it. |
| Human prose is lost | Edit through the line model only. Refuse a file that does not parse. |
| git acts on the wrong repo | Scrubbed `GIT_*` environment. Realpath toplevel check. |
| Retired facts export as live | Lifecycle, version and validity filters. |
| `MEMORY.md` grows too large | Hub notes, a top N and a token cap. |
