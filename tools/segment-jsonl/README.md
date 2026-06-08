# segment-jsonl

Convert between a single-file JSONL knowledge graph and the
N-segment on-disk layout consumed by `FileSegmentStorage`
(Phase 7, task 60). The tool is a pure file shuffler — it reuses the
`FnvSegmentRouter` and `splitGraphIntoSegments` /
`mergeSegmentsIntoGraph` helpers from
`src/core/segments/ISegmentStorage.ts` so the routing it produces is
bit-identical to what the runtime backend writes.

## Usage

```bash
# Split a single-file graph into N segments
node tools/segment-jsonl/segment-jsonl.ts split memory.jsonl ./out --segments=4

# Merge an N-segment directory back into a single file
node tools/segment-jsonl/segment-jsonl.ts merge ./out memory.merged.jsonl

# Both subcommands support --dry-run
node tools/segment-jsonl/segment-jsonl.ts split memory.jsonl ./out --segments=4 --dry-run
```

## On-disk layout

After `split` the layout is:

```
<output-dir>/
  segments/
    0.jsonl
    1.jsonl
    ...
    N-1.jsonl
```

Each segment file contains the same JSONL line format as
`GraphStorage` (one `{ "type": "entity", ... }` or
`{ "type": "relation", ... }` per line).

## Routing rule

- An entity is owned by `fnv1a32(entity.name) % segmentCount`.
- A relation is owned by the segment of its `from` endpoint
  (matches the contract in `ISegmentStorage.Segment.relations`).

`merge` is a strict inverse modulo within-segment ordering — the
round-trip is bit-identical after a stable per-record sort.

## Programmatic API

The tool exports `runSplit`, `runMerge`, and `parseArgs` for
callers (and tests) that prefer not to spawn a subprocess.

```typescript
import { runSplit, runMerge } from './segment-jsonl.js';

const split = await runSplit({
  inputPath: 'memory.jsonl',
  outputDir: './out',
  segmentCount: 4,
});

const merge = await runMerge({
  inputDir: './out',
  outputPath: 'memory.merged.jsonl',
});
```

## Constraints

- No new external dependencies — uses only `node:fs/promises` and `node:path`.
- TypeScript strict mode, no `as any`, no `@ts-ignore`.
- Runs under `node` directly via `tsx` / `ts-node`; no build step required.
