# η.4.2 — REST API Generation Plan

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook (`docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md`). Promote via `superpowers:writing-plans` to a dated implementation plan when ready.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 4.2.

## Goal

Auto-generate a REST API from `ManagerContext` so memoryjs can be consumed over HTTP without writing per-method boilerplate. Read-only endpoints first; write endpoints second.

## Out of scope

- Authentication / authz (use `feature-dev:code-architect` to design that as a separate plan).
- WebSocket streaming (later η item).
- OpenAPI 3 schema generation (defer until the surface stabilizes).

## Architecture

Wrapper rather than rewrite — same shape as Phase β's `IMemoryBackend` adapters.

```
src/api/
├── server.ts           — Fastify app factory; takes a `ManagerContext`.
├── routes/
│   ├── entities.ts     — GET /entities, GET /entities/:name, POST /entities, ...
│   ├── relations.ts    — GET /relations, POST /relations, ...
│   ├── search.ts       — POST /search (auto), POST /search/ranked, ...
│   └── memory.ts       — POST /memory/turns (calls memoryEngine.addTurn).
├── middleware/
│   └── error-translator.ts  — Map FileOperationError → 400, EntityNotFound → 404, etc.
└── index.ts            — Barrel.
```

## Runtime deps

**Decision gate:** Fastify 5 (peer dep) + Pino for logging. ~150KB gzip. **Needs Daniel's call** — recommend Fastify over Express for built-in schema validation and TS-first ergonomics.

## Tasks (when promoted)

1. Add `fastify` peer dep + `pino` to `package.json`.
2. Server factory `createApp(ctx, opts) → FastifyInstance`.
3. Routes: entities (CRUD), relations (CRUD), search (auto + ranked + boolean + fuzzy), hierarchy (children/ancestors/descendants/roots), memory (addTurn / getSessionTurns / deleteSession / listSessions).
4. Error-translator middleware mapping memoryjs errors → HTTP codes.
5. Integration tests via `app.inject()` (fastify's in-process test pattern).
6. README example: starting the server in 5 lines.

## Risks

- **Storage path validation** is currently `confineToBase: false` for internal call sites; HTTP-supplied paths in `POST /import` would re-introduce the path-traversal attack surface. **Mitigation**: route-level `confineToBase: true` re-validation before passing to `IOManager.importGraph`.
- **better-sqlite3** is sync — don't deploy on a single-threaded HTTP server without a worker pool. Document in the README; use a worker for large-graph endpoints.

## Estimated effort

Plan + design ADR: 0.5d. Impl: 3–5d. Tests: 1–2d. Total: ~1 week.
