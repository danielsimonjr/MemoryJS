# observations-to-columns

Migration tool that bulk-extracts observations from an existing JSONL
knowledge graph into a column sidecar (the wire format consumed by
`JsonlColumnStore`, Phase 8 task 65), leaving the inline
`entity.observations` array empty. Bidirectional — `reinline` reverses
the operation and is provided so the migration is non-destructive.

## Usage

```bash
# Extract observations into a column sidecar
node tools/observations-to-columns/observations-to-columns.ts extract \
  memory.jsonl memory.columnar.jsonl --column-sidecar=memory.observations.jsonl

# Reverse: re-inline observations from the sidecar
node tools/observations-to-columns/observations-to-columns.ts reinline \
  memory.columnar.jsonl memory.reinlined.jsonl --column-sidecar=memory.observations.jsonl

# Both subcommands support --dry-run (no filesystem mutation) and
# --force (allow overwriting an existing output / sidecar).
node tools/observations-to-columns/observations-to-columns.ts extract \
  memory.jsonl memory.columnar.jsonl --column-sidecar=memory.observations.jsonl --dry-run
```

## File formats

### Input / output graph file

Standard MemoryJS JSONL — one record per line, either `{ "type":
"entity", ... }` or `{ "type": "relation", ... }`. Matches the format
produced by `GraphStorage.saveGraphInternal()`.

### Column sidecar

One JSON object per line in the wire format used by `JsonlColumnStore`:

```jsonl
{"name":"alice","value":["likes coffee","works at TechCo"]}
{"name":"bob","value":["lives in Seattle"]}
```

Entities with zero observations are omitted from the sidecar to keep
it tight. `reinline` treats a missing sidecar entry as "leave the
inline value untouched" — so re-inlining onto an `extract` output
yields a graph entity-set-equivalent to the original.

## Programmatic API

```typescript
import {
  runExtract,
  runReinline,
} from './observations-to-columns.js';

const extract = await runExtract({
  inputPath: 'memory.jsonl',
  outputPath: 'memory.columnar.jsonl',
  columnSidecarPath: 'memory.observations.jsonl',
});

const reinline = await runReinline({
  inputPath: 'memory.columnar.jsonl',
  outputPath: 'memory.reinlined.jsonl',
  columnSidecarPath: 'memory.observations.jsonl',
});
```

Both functions return a result object describing the counts touched,
the resolved absolute output paths, and the `dryRun` flag.
`runReinline` also reports `orphanColumnCount` — the number of
sidecar entries whose `name` did not match any entity in the input
(useful as a data-drift signal).

## Constraints

- No new external dependencies — uses only `node:fs/promises` and
  `node:path`.
- TypeScript strict mode, no `as any`, no `@ts-ignore`.
- Sidecar format written directly via `fs.writeFile` — the tool does
  not depend on the `JsonlColumnStore` implementation (task 65) to
  keep the worktree coupling minimal.
- Refuses to overwrite existing output / sidecar files unless
  `--force` is set, matching the convention from `tools/segment-jsonl/`.
