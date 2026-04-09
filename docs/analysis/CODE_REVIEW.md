# Code Review Report

**Generated**: 2026-02-11
**Scope**: Full codebase review of MemoryJS v1.5.0 (110 files, ~43K LOC)
**Methodology**: Parallel review agents covering core/, search/, agent/, features/, utils/, plus dedicated security review

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 5 |
| MEDIUM | 17 |
| LOW | 2 |
| **Total** | **24** |

---

## HIGH Severity Issues

### H1. AccessTracker never persists accessCount/lastAccessedAt to storage

**File**: `src/agent/AccessTracker.ts:377-393`

`recordAccess` updates the in-memory `AccessRecord` but `updateEntityAccessFields` only sets `lastModified` on the entity — it never writes `accessCount` or `lastAccessedAt` to storage. These fields are used by `DecayEngine.calculateStrengthMultiplier()` and `SalienceEngine.calculateNoveltyBoost()`, so decay and salience calculations always use stale initial values (0 access count, creation time).

**Fix**: Update `updateEntityAccessFields` to persist both fields:
```typescript
await this.storage.updateEntity(entityName, {
  accessCount: record.totalAccesses,
  lastAccessedAt: record.lastAccessedAt,
  lastModified: new Date().toISOString(),
});
```

---

### H2. SessionManager.endSession does N separate graph load/save cycles during cleanup

**File**: `src/agent/SessionManager.ts:328-338`

When `cleanupOnEnd` is true, each remaining working memory triggers a separate `getGraphForMutation()` + `saveGraph()` cycle. With 50 memories, that's 50 full disk round-trips. A failure mid-loop leaves a partially cleaned graph with no rollback.

**Fix**: Collect all names to delete, do a single `getGraphForMutation()`, filter all at once, then `saveGraph()` once.

---

### H3. JSON import lacks schema validation on parsed entities/relations

**File**: `src/features/IOManager.ts:543-570`

`parseJsonImport` casts `parsed.entities as Entity[]` and `parsed.relations as Relation[]` without field-level validation. Arbitrary properties (wrong types, NaN importance) propagate into storage. The `sanitizeObject` call is only applied in the `replace` merge strategy — `merge` and `skip` paths don't sanitize.

**Fix**: Validate imported entities/relations against Zod schemas (`EntitySchema`, `RelationSchema`) before accepting. Apply `sanitizeObject` unconditionally on all import paths.

---

### H4. GraphML edge regex requires specific attribute order not mandated by spec

**File**: `src/features/IOManager.ts:767`

The edge parsing regex `/<edge\s+[^>]*source="([^"]+)"\s+target="([^"]+)"[^>]*>/` requires `source` before `target`. The GraphML spec doesn't mandate attribute ordering. Files from other tools with `<edge target="B" source="A">` silently drop all edges.

**Fix**: Parse `source` and `target` attributes independently instead of requiring fixed order.

---

### H5. replaceTag can introduce duplicate tags

**File**: `src/core/EntityManager.ts:574-595`

When replacing `oldTag` with `newTag`, the code does in-place replacement at the index of `oldTag`. If the entity already has `newTag`, the result is duplicate entries (e.g., tags `["a", "b"]` + `replaceTag("a", "b")` → `["b", "b"]`).

**Fix**: Check if `newTag` already exists. If so, just remove `oldTag` instead of replacing:
```typescript
if (entity.tags.includes(normalizedNewTag)) {
  entity.tags = entity.tags.filter(tag => tag !== normalizedOldTag);
} else {
  const index = entity.tags.indexOf(normalizedOldTag);
  entity.tags[index] = normalizedNewTag;
}
```

---

## MEDIUM Severity Issues

### M1. TOCTOU race in createEntities/createRelations

**File**: `src/core/EntityManager.ts:131-184`, `src/core/RelationManager.ts:71-122`

Duplicate check uses `loadGraph()` (read-only), then mutation uses `getGraphForMutation()` (fresh copy). Concurrent operations can bypass duplicate checks or size limits.

**Fix**: Perform duplicate check on the mutable graph from `getGraphForMutation()`.

---

### M2. Composite key delimiter collision in deleteRelations

**File**: `src/core/RelationManager.ts:184-191`

Uses `|` as delimiter: `${r.from}|${r.to}|${r.relationType}`. Entity names containing `|` produce ambiguous keys (e.g., `"a|b" + "c"` === `"a" + "b|c"`).

**Fix**: Use `\0` as delimiter or match on individual fields.

---

### M3. getAncestors can infinite loop on corrupted hierarchy

**File**: `src/core/HierarchyManager.ts:145-162`

Follows `parentId` pointers without cycle detection. Data corrupted via import or direct manipulation can cause infinite loops.

**Fix**: Add a `visited` set to break cycles.

---

### M4. BatchTransaction.execute saves partial results when stopOnError is false

**File**: `src/core/TransactionManager.ts:464-476`

When `stopOnError: false` and some operations fail, the graph is still saved with partial/inconsistent state (e.g., dangling relation references).

**Fix**: Only save when all operations succeed, or validate graph consistency before saving.

---

### M5. DecayEngine.applyDecay never persists changes; dryRun is misleading

**File**: `src/agent/DecayEngine.ts:457-494`

`applyDecay` calculates decay but never updates storage, regardless of `dryRun`. The `DecayScheduler` calls it on every interval with no effect. Decay only manifests via `calculateEffectiveImportance` at read time.

**Fix**: Either implement persistence when `dryRun: false`, or remove `dryRun` and document that decay is always calculated on-the-fly.

---

### M6. strengthMultiplier unbounded — effective importance can exceed 0-10 range

**File**: `src/agent/DecayEngine.ts:209-218`

Multiplier `1 + (confirmationCount * 0.1) + (accessCount * 0.01)` has no upper bound. With 50 confirmations, multiplier = 7.0. This makes `decayAmount` in `applyDecay` go negative (importance appears to increase), producing misleading `DecayResult.averageDecay`.

**Fix**: Clamp `effectiveImportance` to `[minImportance, 10]`.

---

### M7. WorkingMemoryManager.maxPerSession bypassed after process restart

**File**: `src/agent/WorkingMemoryManager.ts:220-226`

The `sessionIndex` is in-memory only. After restart, it's empty, so `maxPerSession` limit always passes until `getSessionMemories` triggers a rebuild.

**Fix**: Call `rebuildSessionIndex(sessionId)` before checking the limit in `createWorkingMemory`.

---

### M8. SalienceEngine.calculateFrequencyBoost calls loadGraph per entity

**File**: `src/agent/SalienceEngine.ts:246-259`

`calculateFrequencyBoost` calls `getMaxAccessCount()` which does `storage.loadGraph()` for every entity. Scoring 1000 entities = 1000 graph loads.

**Fix**: Cache `maxAccessCount` or compute once before the scoring loop.

---

### M9. RankedSearch token cache only invalidates on entity count change

**File**: `src/search/RankedSearch.ts:219`

Fallback cache checks `entities.length !== this.cachedEntityCount`. Modified entity observations don't trigger invalidation, returning stale TF-IDF scores.

**Fix**: Also check content hashes, or clear via event system on entity updates.

---

### M10. QuantizedVectorStore division by zero when all values identical

**File**: `src/search/QuantizedVectorStore.ts:340`

When `max === min`, `scale = 0`, causing `NaN` in quantization. Quantized vectors become all zeros; similarity scores all become 1.0.

**Fix**: `const scale = max === min ? 1 : (max - min) / 255;`

---

### M11. ParallelSearchExecutor timeout promises leak

**File**: `src/search/ParallelSearchExecutor.ts:341-344`

`createTimeout` creates `setTimeout` that's never cleared when search completes first. Leaked timers accumulate; orphaned rejection becomes unhandled.

**Fix**: Return a cancel function and call it when the search completes.

---

### M12. HybridSearchManager gives all entities 0.5 symbolic score when no filters

**File**: `src/search/HybridSearchManager.ts:153-157`

With no symbolic filters, every entity gets score 0.5, preventing any entity from being filtered. Results include the entire graph before limiting.

**Fix**: Return empty map when no symbolic filters are specified.

---

### M13. OptimizedInvertedIndex doesn't clean old terms on re-index

**File**: `src/search/OptimizedInvertedIndex.ts:89-119`

Re-indexing an existing entity doesn't remove old terms from posting lists. Terms removed from an entity still return it in search results.

**Fix**: Call `removeDocument` before `addDocument` for existing entities.

---

### M14. Inconsistent similarity scoring between public/private methods

**File**: `src/features/CompressionManager.ts:103 vs 163`

`calculateEntitySimilarity` (public) requires both entities to have non-null tags. `calculatePreparedSimilarity` (private) only requires either. Same entity pair produces different scores depending on code path.

**Fix**: Align tag condition to `(e1.tags?.length ?? 0) > 0 || (e2.tags?.length ?? 0) > 0`.

---

### M15. StreamingExporter write errors silently lost

**File**: `src/features/StreamingExporter.ts:122-157`

`writeStream.write()` errors aren't handled; the `error` event handler is only registered after all writes in the final promise. Disk-full errors produce truncated files while reporting success.

**Fix**: Register error handler immediately after creating the stream.

---

### M16. compressionRatios array grows unboundedly

**File**: `src/utils/compressedCache.ts:398`

Array accumulates entries on every compression, never trimmed. Long-running processes leak memory proportional to compression operations.

**Fix**: Cap to a rolling window (e.g., last 1000 entries).

---

### M17. CSV/GraphML import lowercases tags; JSON import doesn't

**File**: `src/features/IOManager.ts:665`

CSV/GraphML imports lowercase tags, but JSON import preserves original case. Round-trip through CSV silently mutates tag casing.

**Fix**: Let Zod schema `tagSchema` handle normalization; remove manual lowercasing from import parsers.

---

## LOW Severity Issues

### L1. Mermaid export node ID collisions

**File**: `src/features/IOManager.ts:441,449`

`sanitizeId` replaces non-alphanumeric chars with `_`. Names like `"hello-world"` and `"hello world"` produce the same ID, silently dropping one entity.

### L2. parseFloat on CSV/GraphML importance returns NaN for non-numeric strings

**File**: `src/features/IOManager.ts:668,761`

NaN importance values propagate to storage, bypassing importance-range filters.

---

## Security Review

### Positive Findings

- **SQL injection mitigated**: All SQLite queries use parameterized statements
- **No command injection surface**: No `child_process`/`exec`/`spawn` usage
- **FTS5 sanitization thorough**: Strips all operators (`:{}()"^~*`, boolean keywords)
- **LIKE escaping correct**: Properly escapes `\`, `%`, `_` with `ESCAPE '\'`
- **Path traversal defense solid**: `validateFilePath` with `confineToBase` in storage constructors
- **Prototype pollution protected**: `sanitizeObject` strips `__proto__`, `constructor`, `prototype`
- **CSV formula injection prevented**: Dangerous prefixes (`=+- @\t\r`) quoted
- **XML export properly escaped**: All 5 XML entities handled
- **Worker errors wrapped**: Stack traces stripped via `new Error(message)`
- **Import size limits enforced**: 10MB and 100K item limits

### Security Gaps

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| S1 | HIGH | IOManager.ts:543-570 | JSON import no schema validation (see H3 above) |
| S2 | MEDIUM | GraphStorage.ts:258 | JSONL parsing trusts JSON.parse output without validation |
| S3 | MEDIUM | IOManager.ts:668,761 | NaN importance from CSV/GraphML (see L2 above) |
| S4 | LOW | IOManager.ts:1043 | Backup metadata path not independently validated with confineToBase |
| S5 | LOW | SQLiteStorage.ts:293-320 | JSON.parse on DB row fields without try/catch — corrupted rows crash process |

---

## Recommended Fix Priority

### Immediate (data correctness)
1. **H1** — AccessTracker not persisting access data (breaks decay/salience)
2. **H3** — JSON import without schema validation (security + data integrity)
3. **H5** — replaceTag duplicate tags (data corruption)
4. **M13** — Inverted index stale terms (incorrect search results)

### Soon (reliability)
5. **H2** — SessionManager N+1 cleanup (I/O amplification, partial failure risk)
6. **H4** — GraphML attribute order (silent data loss on import)
7. **M3** — getAncestors infinite loop (process hang on corrupted data)
8. **M10** — QuantizedVectorStore division by zero (corrupts all similarity scores)
9. **M15** — StreamingExporter silent write errors (truncated exports)

### Backlog (correctness improvements)
10. **M5** — DecayEngine.applyDecay never persists
11. **M6** — strengthMultiplier unbounded
12. **M7** — maxPerSession limit bypass after restart
13. **M9** — RankedSearch stale token cache
14. **M12** — HybridSearch 0.5 symbolic score inflation
15. Remaining MEDIUM issues

---

**Reviewed by**: Claude Opus 4.6
**Review type**: Automated static analysis with 5 parallel review agents
