## Self-Review

- [x] **Spec coverage**: All 7 features have tasks. Feature 7 (Benchmarks) deferred to separate effort — it's an L-effort standalone tool, not a library change.
- [x] **No placeholders**: All code steps have actual code blocks.
- [x] **Type consistency**: `IngestInput`, `IngestOptions`, `IngestResult` used consistently. `WakeUpOptions`, `WakeUpResult` stable. `invalidateRelation`, `queryAsOf`, `timeline` signatures match between test and implementation.
- [x] **TDD**: Every task has Test → Fail → Implement → Pass → Commit.
- [x] **Frequent commits**: 7 commits across 8 tasks (hooks and release are non-TDD).
