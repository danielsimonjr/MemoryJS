# CLI Update Plan

**Date**: 2026-02-10
**Scope**: Expand CLI to expose major library capabilities missing from the current implementation.

## Current State

The CLI (`src/cli/`) has 5 files:
- `index.ts` — Program setup with commander
- `commands/index.ts` — All command definitions (415 lines)
- `options.ts` — Global options (storage path, format, quiet/verbose)
- `formatters.ts` — JSON/table/CSV output formatting
- `interactive.ts` — REPL mode
- Dependencies: `commander`, `cli-table3`, `chalk`

**Current commands**: entity CRUD, relation CRUD, basic search, import, export, stats, interactive mode.

## Problems to Fix

### P1: Bugs / Code Quality
1. **Fake search scoring** (`commands/index.ts:284`): `1.0 - idx * 0.01` instead of real relevance scores. Must use `rankedSearch` or `autoSearch`.
2. **Direct storage access** (`commands/index.ts:109,229`): `entity list` and `relation list` call `ctx.storage.loadGraph()` directly, bypassing managers. Should use `entityManager` and `relationManager`.
3. **Missing export formats**: CLI only supports `json|csv|graphml|markdown|mermaid`. Library also supports `gexf` and `dot`.

### P2: Missing Commands (High Value)

These expose core library features that users expect from a CLI:

#### 2a. Observation Commands
```
memory observation add <entity> <text>      # Add observation
memory observation remove <entity> <text>   # Remove observation
memory observation list <entity>            # List observations for entity
```
Uses: `observationManager.addObservations()`, `observationManager.deleteObservations()`

#### 2b. Tag Commands
```
memory tag add <entity> <tags...>           # Add tags
memory tag remove <entity> <tags...>        # Remove tags
memory tag alias <alias> <canonical>        # Create tag alias
memory tag aliases                          # List all aliases
```
Uses: `entityManager.addTags()`, `entityManager.removeTags()`, `tagManager.addAlias()`, `tagManager.listAliases()`

#### 2c. Hierarchy Commands
```
memory hierarchy set-parent <entity> <parent>   # Set parent
memory hierarchy children <entity>               # List children
memory hierarchy ancestors <entity>              # List ancestors
memory hierarchy descendants <entity>            # List descendants
memory hierarchy roots                           # List root entities
```
Uses: `hierarchyManager.setParent()`, `.getChildren()`, `.getAncestors()`, `.getDescendants()`, `.getRootEntities()`

#### 2d. Graph Algorithm Commands
```
memory graph shortest-path <from> <to>           # Find shortest path
memory graph centrality [--algo degree|betweenness|pagerank] [--top N]
memory graph components                           # Find connected components
```
Uses: `graphTraversal.findShortestPath()`, `.calculateDegreeCentrality()`, `.calculateBetweennessCentrality()`, `.calculatePageRank()`, `.findConnectedComponents()`

#### 2e. Advanced Search Commands
```
memory search <query>                             # Fix: use autoSearch with real scores
memory search --ranked <query>                    # TF-IDF/BM25 ranked search
memory search --boolean <query>                   # Boolean search (AND/OR/NOT)
memory search --fuzzy <query> [--threshold 0.6]   # Fuzzy search
memory search --suggest <query>                   # Get search suggestions
```
Uses: `searchManager.autoSearch()`, `.searchNodesRanked()`, `.booleanSearch()`, `.fuzzySearch()`, `.getSearchSuggestions()`

#### 2f. Archive & Compression Commands
```
memory archive [--older-than 30d] [--importance-lt 2] [--dry-run]
memory compress [--threshold 0.8] [--dry-run]     # Find & merge duplicates
memory validate                                    # Validate graph integrity
```
Uses: `archiveManager.archiveEntities()`, `compressionManager.compressGraph()`, `analyticsManager.validateGraph()`

### P3: Interactive Mode Enhancements

The REPL currently supports: entities/ls, get, search, relations, stats, history, clear, help, exit.

**Add to interactive mode**:
- `tags <entity>` — Show tags
- `path <from> <to>` — Shortest path
- `observe <entity> <text>` — Quick-add observation
- `delete <entity>` — Delete entity (with confirmation)
- `export <format>` — Quick export to stdout

## Implementation Plan

### Step 1: Fix bugs (P1) — `commands/index.ts`

1. Replace fake search scoring with `searchManager.autoSearch()`:
   ```typescript
   // Before (line 279-284):
   const result = await ctx.searchManager.searchNodes(query);
   let entities = result.entities.map((entity, idx) => ({
     entity,
     score: 1.0 - idx * 0.01,
   }));

   // After:
   const result = await ctx.searchManager.autoSearch(query, opts.limit as number || 10);
   let entities = result.results.map(r => ({
     entity: r.entity,
     score: r.score,
   }));
   ```

2. Replace direct `storage.loadGraph()` in entity list (line 109) with manager method:
   ```typescript
   // Before:
   const graph = await ctx.storage.loadGraph();
   let entities = [...graph.entities];

   // After:
   const graph = await ctx.storage.loadGraph();
   let entities = [...graph.entities];
   // Note: entityManager doesn't have a listAll() method.
   // Keep loadGraph() but add a TODO comment, or add getAllEntities() to entityManager.
   ```

   **Decision**: `entityManager` has no `listAll()`. Two options:
   - (a) Add `entityManager.getAllEntities(filter?)` to the library
   - (b) Keep `loadGraph()` in the CLI only for listing (pragmatic)

   **Recommendation**: Option (b) for now — the CLI already depends on storage access for listing. The filtering logic is CLI-specific anyway. Add a comment noting the direct access.

3. Same for relation list (line 229) — keep `loadGraph()` with comment.

4. Add `gexf` and `dot` to export format options.

### Step 2: Extract command files — Restructure

The single `commands/index.ts` file (415 lines) will grow to ~800+ lines. Split into separate files:

```
src/cli/commands/
├── index.ts           # registerCommands() - imports and registers all
├── entity.ts          # entity create/get/list/update/delete
├── relation.ts        # relation create/list/delete
├── observation.ts     # observation add/remove/list (NEW)
├── tag.ts             # tag add/remove/alias/aliases (NEW)
├── hierarchy.ts       # hierarchy set-parent/children/ancestors/descendants/roots (NEW)
├── graph.ts           # graph shortest-path/centrality/components (NEW)
├── search.ts          # search (fixed) with --ranked/--boolean/--fuzzy/--suggest (NEW flags)
├── io.ts              # import/export (existing, extracted)
├── maintenance.ts     # archive/compress/validate/stats (NEW + existing stats)
└── helpers.ts         # Shared getOptions/createContext/error handling
```

Each file exports a `register(program: Command)` function. `index.ts` just calls them all.

### Step 3: Add new commands (P2)

Implement in this order (dependencies first):

1. **observation.ts** — Simple CRUD, no new formatters needed
2. **tag.ts** — Simple CRUD + alias management
3. **hierarchy.ts** — Uses hierarchyManager, needs tree formatter
4. **search.ts** — Fix existing + add mode flags
5. **graph.ts** — Algorithms, needs path/centrality formatters
6. **maintenance.ts** — Archive, compress, validate

### Step 4: Add formatters

New formatters needed in `formatters.ts`:

```typescript
formatPath(path: PathResult, format: OutputFormat): string       // For shortest-path
formatCentrality(scores: CentralityResult, format: OutputFormat): string
formatComponents(components: ComponentResult, format: OutputFormat): string
formatTree(hierarchy: Entity[], format: OutputFormat): string    // For hierarchy
formatValidation(result: ValidationResult, format: OutputFormat): string
```

### Step 5: Update interactive mode

Add the 5 new commands listed in P3 to `interactive.ts`. Update `showHelp()` and tab completion.

### Step 6: Update formatters for new export formats

Add `gexf` and `dot` to the export command's format option.

## File Change Summary

| File | Action | Lines (est.) |
|------|--------|-------------|
| `commands/index.ts` | Split into 10 files | -415 (deleted) |
| `commands/helpers.ts` | New — shared utilities | ~40 |
| `commands/entity.ts` | Extracted from index.ts | ~100 |
| `commands/relation.ts` | Extracted from index.ts | ~80 |
| `commands/observation.ts` | **New** | ~80 |
| `commands/tag.ts` | **New** | ~100 |
| `commands/hierarchy.ts` | **New** | ~120 |
| `commands/graph.ts` | **New** | ~130 |
| `commands/search.ts` | Extracted + fixed + expanded | ~120 |
| `commands/io.ts` | Extracted from index.ts | ~70 |
| `commands/maintenance.ts` | **New** + stats moved here | ~100 |
| `formatters.ts` | Add 5 new formatters | +100 |
| `interactive.ts` | Add 5 commands + help | +60 |
| **Total new code** | | **~600 lines** |

## Testing Plan

- Unit tests for each new command (mock ManagerContext)
- Test all 3 output formats (json/table/csv) for new formatters
- Test search with real scoring (no more fake scores)
- Test export with gexf and dot formats
- Manual smoke test: `npm run build && memory entity list -f table`

## Risks

1. **`autoSearch` return type** — Verified: returns `AutoSearchResult.results: SearchResult[]` where `SearchResult` has `entity: Entity` and `score: number`. The plan's code example is correct.
2. **`chalk` in piped output** — chalk auto-detects TTY but verify `--format json` doesn't include ANSI codes when piped.
3. **Command name collisions** — `memory graph` could conflict with future subcommands. Use `memory graph:algo` namespace if needed.
4. **Bundle size** — CLI is built separately by tsup. Adding more imports from the library shouldn't affect the main library bundle.

## Not In Scope

- Pipe support for stdin (tracked in future_features.md 10.1)
- Semantic/hybrid search (requires embedding provider config — complex for CLI)
- Agent memory commands (too complex for CLI v1)
- Saved searches (nice-to-have, defer)
