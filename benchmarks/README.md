# MemoryJS Benchmarks

## Synthetic Memory Benchmark

Measures recall accuracy (R@5, R@10) and search latency across different search strategies using generated conversation data.

### Run

```bash
npx tsx benchmarks/synthetic-bench.ts        # 100 questions (default)
npx tsx benchmarks/synthetic-bench.ts 500    # 500 questions
```

Or via npm:

```bash
npm run benchmark
npm run benchmark -- 500
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
