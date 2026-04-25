# η.4.6 — Graph Visualization Expansion Plan

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook. Builds on the existing `IOManager.visualizeGraph` (shipped v1.9.1).

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 4.6.

## Goal

Extend `IOManager.visualizeGraph` (which currently emits a single self-contained HTML file with D3.js force-directed layout) to support browser-based interactive exploration: filtering, search-as-you-type, multiple layout algorithms, and SVG/PNG export.

## What exists today (v1.9.1)

- `IOManager.visualizeGraph(options)` — produces a single HTML file embedding the entire graph + D3.js. Read-only static layout. ~700KB output for ~100-entity graphs.

## What this plan adds

1. **Multiple layouts** — force-directed (existing), hierarchical (top-down tree per `parentId`), circular, and timeline (by `createdAt`).
2. **Interactive filtering** — toolbar widget for entityType / projectId / tag chips. Filter applies client-side (no server round-trip).
3. **Search-as-you-type** — JS-side fuzzy match on entity name + observation snippets.
4. **Export buttons** — SVG (vector; full fidelity) and PNG (raster; via `dom-to-image-more`).
5. **Click-through detail panel** — show all observations + tags + parentId + last-modified for the focused node.

## Architecture

```
src/features/visualization/
├── VisualizeGraph.ts           — orchestrator (extends current visualizeGraph)
├── layouts/
│   ├── ForceDirected.ts        — existing logic moved here
│   ├── Hierarchical.ts         — d3-hierarchy tree
│   ├── Circular.ts             — radial fan
│   └── Timeline.ts             — chronological columns
├── exporters/
│   ├── svg.ts                  — current SVG export (already works)
│   └── png.ts                  — new; uses dom-to-image-more
└── templates/
    └── interactive.html        — full HTML template w/ filter UI
```

## Runtime deps

- `d3-hierarchy` (~5KB gzip) — for hierarchical layout.
- `dom-to-image-more` (~15KB gzip) — for PNG export. **Decision gate.**

## Tasks (when promoted)

1. Refactor existing `visualizeGraph` into `ForceDirected` layout module.
2. Implement `Hierarchical` / `Circular` / `Timeline` layouts (each ~150 LOC + Vitest).
3. Filter UI in template — vanilla JS + `<details>` chips, no framework.
4. Search input (already have `BasicSearch`-style fuzzy in src/search; reuse via inlining the relevant functions client-side).
5. PNG export route via `dom-to-image-more`.
6. Update `visualizeGraph(options)` signature to accept `layout: 'force' | 'tree' | 'circular' | 'timeline'`.
7. CHANGELOG + CLAUDE.md notes.

## Risks

- Bundle size: 4 layouts + filter UI + PNG export ~~ ~100KB additional in the HTML output. Acceptable for the use case; document in README.
- d3-hierarchy adds a transitive dep; check for any vulnerability advisories.

## Estimated effort

Plan: done. Impl: 4–6d. Tests: 1–2d. Total: ~1 week.
