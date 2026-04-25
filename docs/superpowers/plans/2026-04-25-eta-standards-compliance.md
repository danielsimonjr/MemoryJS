# η.5.4 — Standards Compliance Plan (SPARQL / RDF / Linked Data)

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 5.4.

## Goal

Make memoryjs's knowledge graph interoperable with the W3C Linked Data ecosystem — SPARQL queries in, RDF/Turtle export, JSON-LD support.

## Scope

Three sub-features, ordered by leverage:

1. **RDF / Turtle export** — extend `IOManager.exportGraph` with new format `'turtle'` / `'rdf-xml'`. **Highest leverage** — fast read-only path; lets memoryjs feed any SPARQL endpoint.
2. **JSON-LD context wrapper** — emit existing JSON export with a `@context` block, making the entity/relation shape valid Linked Data. Trivial change.
3. **SPARQL query interface** — accept SPARQL `SELECT` queries and translate to memoryjs's internal search. Hardest — need a SPARQL parser; recommend `sparqljs`.

## Architecture

```
src/features/standards/
├── rdf-exporter.ts        — entity → Turtle / RDF-XML
├── jsonld-context.ts      — emit JSON-LD @context for the memoryjs schema
└── sparql-translator.ts   — SPARQL SELECT → SearchManager calls
```

## Naming convention for RDF

Entity names become URIs under a configurable base (default `urn:memoryjs:entity:<name>`). Observations become `rdfs:comment`. `entityType` becomes `rdf:type`. `tags` become `dcterms:subject`. Relations become custom predicates under `urn:memoryjs:rel:<relationType>`.

Document the IRI scheme in CLAUDE.md so consumers can rely on stable mappings.

## Runtime deps

- `sparqljs` (~30KB) — SPARQL grammar parser. **Decision gate** — only needed for the SELECT interface (sub-feature 3); 1 + 2 can ship without any new deps.

## Tasks (when promoted)

### Sub-feature 1: Turtle/RDF export
1. Add `'turtle' | 'rdf-xml'` to `ExportFormat`.
2. `RdfExporter` class with `toTurtle(graph) → string` and `toRdfXml(graph) → string`.
3. Hook into `IOManager.exportGraph` switch.
4. Tests against W3C Turtle examples.

**Effort:** 2–3d.

### Sub-feature 2: JSON-LD context
1. Define the canonical `@context` object for memoryjs entities (entity/relation/observation/tag/etc. → DC, RDFS, Schema.org terms).
2. Add `'json-ld'` ExportFormat that wraps existing JSON export with the context.
3. Document the schema mapping.

**Effort:** 1d.

### Sub-feature 3: SPARQL SELECT
1. Add `sparqljs` peer dep.
2. `SparqlTranslator.execute(query, ctx) → ResultSet` — translates BGP triple patterns into `SearchManager` calls.
3. Limit to `SELECT` (no UPDATE; no FILTER beyond simple `==`/`!=`/`CONTAINS`).
4. Tests against a small reference graph.

**Effort:** 5–7d.

## Risks

- **IRI stability**: once consumers start using `urn:memoryjs:entity:<name>`, renaming entities breaks linked data. Recommend `RefIndex`-style stable IDs as the IRI base instead of mutable names. Worth a small ADR before sub-feature 1 ships.
- **SPARQL completeness**: full SPARQL 1.1 is huge; clearly document supported subset.

## Estimated effort

Plan: done. Sub-feature 1 + 2 (no new deps): ~3–4d. Sub-feature 3: ~1 week. Total: ~2 weeks.
