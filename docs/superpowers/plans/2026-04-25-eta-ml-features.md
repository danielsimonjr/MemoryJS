# η.5.3 — ML-Powered Features Plan

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 5.3 — "Auto-tagging based on observations / Anomaly detection in relationships / Entity clustering by similarity / Knowledge graph completion (predict missing relations)".

## Strategy

Each ML feature is a separate, opt-in module. **No required ML model dependency** — all features either reuse the existing optional embedding service (`EmbeddingService`, `LocalEmbeddingService` via `@xenova/transformers`) or operate on top of token-Jaccard / TF-IDF primitives already shipped.

## Sub-plans

### 5.3.a — Auto-tagging

**Approach:** k-nearest-neighbor over existing `tags`. New entity gets the union of tags from its top-3 most-similar (by content embedding or BM25) entities.

**Surface:**
```typescript
class AutoTagger {
  async suggestTags(entity: Entity, k?: number): Promise<string[]>;
  async applyTags(entityName: string, suggested: string[], minVotes?: number): Promise<void>;
}
```

**Deps:** none (reuses `SemanticSearch` or `BM25Search` if no embedding provider).

**Effort:** 2–3d.

### 5.3.b — Anomaly detection in relationships

**Approach:** Score each relation by inverse-frequency: relation types that appear once or twice in a graph dominated by `mentions`/`relates-to` are flagged as anomalies for review.

**Surface:**
```typescript
class RelationAnomalyDetector {
  async detect(graph: KnowledgeGraph, opts?: { minSupport?: number }): Promise<AnomalyReport[]>;
}
```

**Deps:** none.

**Effort:** 1d.

### 5.3.c — Entity clustering

**Approach:** Already shipped in `ExperienceExtractor.clusterTrajectories(method)` for trajectories; lift to entities. Method options: `semantic` / `tag-based` / `outcome` (where applicable).

**Surface:**
```typescript
class EntityClusterer {
  async cluster(entities: Entity[], method: 'semantic' | 'tag-based'): Promise<EntityCluster[]>;
}
```

**Deps:** none.

**Effort:** 1d (reuses ExperienceExtractor's Jaccard clustering primitives).

### 5.3.d — Knowledge graph completion (predict missing relations)

**Approach:** Pattern-based — find entity pairs (A, B) where most similar entities to A have a relation to most similar entities to B but A → B itself doesn't exist. Suggest the missing relation.

**Surface:**
```typescript
class RelationPredictor {
  async predictMissing(graph: KnowledgeGraph, opts?: { topK?: number; minConfidence?: number }): Promise<RelationSuggestion[]>;
}
```

**Deps:** none.

**Effort:** 3–4d (most complex — proper NN search over entity embeddings).

## Wiring

Each module exposed via `ctx.<module>` lazy getter, all under a new `src/agent/ml/` subdirectory. Behind a feature flag `MEMORY_ML_FEATURES_ENABLED=true` — opt-in.

## Risks

- **Embedding-dependence**: 5.3.d works much better with embeddings than token overlap. Document gracefully degraded behavior when no provider is configured.
- **Compute cost**: 5.3.d's pairwise-similarity scan is O(n²). Recommend hard cap at 10K entities; throw with a clear message above that.

## Estimated effort

Plan: done. Impl: 7–10d total across the 4 modules. Tests: 3–4d. Total: ~3 weeks.
