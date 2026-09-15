# MemoryJS Benchmarks

## Step-1 Baseline

Records a reproducible baseline before optimization work. It is a record, not a CI gate. The default test run does not execute it.

### Run

```bash
bun run build
bun run bench:baseline -- --out benchmarks/results/<name>.json
```

### Inputs

- `baseline-bench.mjs`: the harness. It measures the built `dist` output.
- `baseline.config.json`: the workload sizes. Change a value only together with a new result file.

### Metrics

- **coldImport**: time to import `dist/index.js` in a fresh Node process (median of N runs).
- **rss**: resident memory after the workload, and peak.
- **eventLoopDelay**: p50, p99 and max during writes, search and lock contention.
- **search**: median `searchNodes` latency per query.
- **write**: `createEntities` throughput and bytes on disk.
- **lockWait**: latency of N concurrent `addObservations` calls on one entity, measured from enqueue.
- **reviewBench**: the CPU cases from `review-bench.ts`, embedded unchanged.

Each result file records the machine, OS, Node version, commit and date. Compare results only from the same machine.

## Synthetic Memory Benchmark

Measures recall accuracy (R@5, R@10) and search latency across different search strategies using generated conversation data.

### Run

```bash
bunx tsx benchmarks/synthetic-bench.ts        # 100 questions (default)
bunx tsx benchmarks/synthetic-bench.ts 500    # 500 questions
```

Or via npm:

```bash
bun run benchmark
bun run benchmark -- 500
```

### Modes

- **basic**: Substring search via BasicSearch
- **fuzzy**: Levenshtein distance via FuzzySearch
- **boolean**: AND/OR/NOT via BooleanSearch

### Metrics

- **R@5**: Recall at 5 — was the answer in the top 5 results?
- **R@10**: Recall at 10 — was the answer in the top 10 results?
- **Avg Latency**: Average search time per question in milliseconds

### Future

- LongMemEval benchmark runner (requires dataset download)
- LoCoMo benchmark runner
- Semantic search benchmarks (requires embedding provider)
