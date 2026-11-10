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

## Performance implementation workloads

```bash
NODE_ENV=production node --import tsx benchmarks/performance-plan-bench.ts 10000
```

Uses deterministic entities and verifies expected results before recording selective/broad
BM25 latency, uncached filtered fuzzy execution, 100 TF-IDF updates, persistence/reload
latency, snapshot size, semantic lookup latency, ANN recall@10/candidate count, and RSS.
First measured calls and repeated-call percentiles are separate; indexes are initialized
before measurement, so first-call times are not process-cold measurements. Run at
10,000 and 100,000 entities on the same machine and runtime; timings are observations,
not pass/fail thresholds. Temporary files are removed on completion. The script imports
source so it can be run both before and after a change without rebuilding; use the
existing baseline harness to measure the shipped build and event-loop delay.

The optional ANN workload uses seeded 64-dimensional random vectors and reports exact
and approximate retrieval times separately alongside recall and cosine-evaluation count.
This synthetic recall does not predict application recall. `resolverSupported` identifies
baseline revisions that ignore the optional resolver, so their `indexedResolver` timing
must not be interpreted as a resolver measurement. `sourceDirty` marks uncommitted runs.

A same-machine 10,000-entity before/after run is checked into `results/2026-11-10-performance-plan-{before,after}.json`.
The baseline is commit `5ceb972`; the after record is explicitly marked `sourceDirty`
because it measures the implementation branch before its commit. Warm p50 selective BM25
was 0.357→0.022 ms, broad BM25 0.640→0.578 ms, filtered fuzzy 10.550→0.540 ms.
100 TF-IDF insertions were 347.15→1.22 ms and incremental persistence 56.23→0.79 ms;
reload increased 53.59→88.69 ms, trading write cost for journal replay. The after snapshot
is 3,288,669 bytes plus a 37,929-byte journal; legacy formatted snapshot was 5,928,988 bytes.
These are individual synthetic measurements, not guaranteed application speedups.

ANN achieved recall@10=0.867 with a mean 3,658 cosine candidates out of 10,000, but took
309.44 ms for 100 queries versus 207.08 ms for exact search on this low-dimensional workload.
Keep the exact default; tune and benchmark ANN for the actual corpus rather than assuming
fewer comparisons imply lower latency. Within the after run, semantic retrieval with the
optional resolver had warm p50 0.805 ms versus 1.709 ms rebuilding the entity map.
