# η.6 — Enterprise Features Plan

> **Status (2026-04-25):** Plan only. No code. Targets Phase η of the dispatch runbook (`docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md`). Five sub-sections, each with its own decision gate. Promote via `superpowers:writing-plans` to a dated implementation plan when ready.

**Source spec:** `docs/roadmap/ROADMAP.md` § Phase 6 (Enterprise).

## Goal

Harden memoryjs for multi-tenant, multi-node, and regulated-environment deployment. The five sub-sections are independent tracks that can be promoted individually. Dependency order: η.6.1 RBAC should ship before η.6.2 (distributed deployments assume an RBAC layer); η.6.4 cloud-native liveness endpoints depend on η.4.2 (REST API); η.6.5 GPU acceleration is purely additive.

## Out of scope

- Full ABAC (attribute-based access control beyond entity-level tags) — RBAC covers v1.x use cases.
- SPARQL-level row security (handled in η.5.4 Standards Compliance plan).
- PostgreSQL backend (tracked separately as MEM-05 in Phase γ).
- Billing, quota, or rate-limiting infrastructure (application-layer concern, not library-layer).

---

## η.6.1 — Role-Based Access Control (RBAC)

### What exists today

`VisibilityResolver` (v1.7.0) enforces a five-tier visibility model on `AgentEntity` reads. `GovernanceManager` enforces a `GovernancePolicy` interface (`canCreate | canUpdate | canDelete`). Neither concept includes named *roles* with a reusable permission matrix.

### Architecture

```
src/agent/rbac/
├── RbacTypes.ts             — Role union ('reader'|'writer'|'admin'|'owner'),
│                              Permission union ('read'|'write'|'delete'|'manage'),
│                              ResourceType union, RbacPolicy interface,
│                              RoleAssignment record.
├── PermissionMatrix.ts      — Immutable default matrix; overridable per resource type.
├── RbacMiddleware.ts        — checkPermission(agentId, action, resource): boolean.
│                              Falls back to VisibilityResolver for legacy entities.
├── RoleAssignmentStore.ts   — In-process Map<agentId, RoleAssignment[]> with
│                              optional JSONL sidecar.
└── index.ts                 — Barrel.
```

`ManagerContext` gains `ctx.rbac` lazy getter. `GovernancePolicy.canCreate/canUpdate/canDelete` auto-populated from `RbacMiddleware` when `MEMORY_RBAC_ENABLED=true`.

### Runtime deps

**None.** Pure TypeScript type system + Map.

### New env vars

| Variable | Values | Default |
|---|---|---|
| `MEMORY_RBAC_ENABLED` | `true`, `false` | `false` |
| `MEMORY_RBAC_DEFAULT_ROLE` | `reader`, `writer`, `admin` | `reader` |

**Effort:** 2–3d impl + 1d tests.

---

## η.6.2 — Distributed Deployments

Three independent layers, ship in order: shared-state cache → read replicas → CRDT.

### Architecture

```
src/distributed/
├── SharedStateAdapter.ts    — Redis-backed cache wrapper for hot-path reads.
├── ReadReplicaRouter.ts     — Routes reads vs writes to separate ManagerContexts.
├── WalReplicator.ts         — WAL JSONL sidecar; replicas tail-and-replay.
├── CrdtMerge.ts             — LWW + observation set-union for concurrent writes.
└── LeaderElection.ts        — Redis SETNX-based leader lock.
```

### Runtime deps (multiple gates)

- **Gate A:** `ioredis` (~60 KB) — required for `SharedStateAdapter`/`LeaderElection`. **Needs the user's call.** Recommend `ioredis` over `redis` for TS typings quality.
- **Gate B:** Field-level CRDTs would require `yjs` or `automerge` (~200KB). Defer; LWW covers 90% of cases.

### New env vars

| Variable | Values | Default |
|---|---|---|
| `MEMORY_DISTRIBUTED_ENABLED` | `true`, `false` | `false` |
| `MEMORY_REDIS_URL` | URL | — |
| `MEMORY_REPLICA_URLS` | comma-separated | — |
| `MEMORY_WAL_PATH` | path | — |

**Effort:** 6–10d impl + 2d tests. Highest-risk sub-section.

---

## η.6.3 — Security Hardening

### What exists today

- `validateFilePath` (`src/utils/entityUtils.ts:729`) — path traversal guard.
- `sanitizeObject` — strips prototype-polluting keys.
- `escapeCsvFormula` — CSV injection guard.
- SQLite FTS5/LIKE sanitizers in `SQLiteStorage`.
- `AuditLog` — immutable JSONL audit trail.
- `SemanticForget` — two-tier deletion with audit entries.

### Gaps to close

1. Inconsistent input validation depth across `ManagerContext` entry points.
2. `IOManager.exportGraph` emits raw observations with no PII masking.
3. SQLite encryption at rest unimplemented (would need optional SQLCipher addon).

### Architecture

```
src/security/
├── InputValidator.ts        — Zod (or regex) schemas for Entity/Relation/
│                              Observation. Strict/warn/off modes.
├── PiiRedactor.ts           — Pluggable pattern bank; applied on export only.
├── EncryptionAdapter.ts     — SQLCipher wrapper (gated).
└── index.ts
```

### Runtime deps

- **Gate C:** check if `zod` already in `package.json` before adding. Plain regex may suffice.
- **Gate D:** `better-sqlite3-sqlcipher` native addon for `EncryptionAdapter`. High install friction; strictly optional.

### New env vars

| Variable | Values | Default |
|---|---|---|
| `MEMORY_INPUT_VALIDATION` | `strict`, `warn`, `off` | `warn` |
| `MEMORY_PII_REDACTION` | `true`, `false` | `false` |
| `MEMORY_ENCRYPT_AT_REST` | `true`, `false` | `false` |
| `MEMORY_ENCRYPT_PASSPHRASE` | string | — |

**Effort:** 3–4d impl + 1–2d tests.

---

## η.6.4 — Cloud-Native Deployment

Devops artifacts only — no `src/` changes except a `/healthz` endpoint (depends on η.4.2 REST API). All container/orchestration files in new `deploy/` directory; excluded from npm package via `files`.

### Architecture

```
deploy/
├── docker/
│   ├── Dockerfile           — Multi-stage: node:22-bookworm-slim builder + slim runtime.
│   ├── docker-compose.yml   — Single-node dev: memoryjs + optional Redis.
│   └── .dockerignore
├── k8s/
│   ├── deployment.yaml      — 2 replicas; liveness + readiness on /healthz.
│   ├── service.yaml
│   ├── configmap.yaml
│   └── secret.yaml          — Template; values not committed.
└── helm/
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
        ├── deployment.yaml
        ├── service.yaml
        ├── configmap.yaml
        └── hpa.yaml         — HPA on CPU/memory.
```

`src/api/routes/health.ts` (η.4.2 dependency) adds `GET /healthz` returning `{ status, storageType, uptimeSeconds }`. Liveness: HTTP 200. Readiness: storage ping (SQLite `PRAGMA integrity_check(1)` or JSONL stat).

Serverless adapters (Lambda, Cloud Functions) deferred — `better-sqlite3` native addon is incompatible with Lambda read-only fs without EFS.

### Runtime deps

**None at the library level.** Docker/kubectl/Helm are operator-side.

**Effort:** 2–3d Dockerfile + compose; 1–2d k8s; 1d Helm. Total ~1 week.

---

## η.6.5 — GPU Acceleration

### Context

`LocalEmbeddingService` uses `@xenova/transformers` over `onnxruntime-node`. ONNX Runtime supports CUDA and WebGPU execution providers as a runtime config flag — enabling GPU does not require code rewrite, only a change to pipeline init.

GPU-accelerated graph algorithms (PageRank, betweenness at 1M+ nodes) would need `gpu.js` or WebGPU compute shaders. Speculative; deferred until benchmark justifies.

### Architecture

```
src/search/
└── GpuEmbeddingService.ts  — Extends LocalEmbeddingService. Overrides initPipeline()
                               to pass executionProviders: ['cuda'|'webgpu'].
                               Catches RuntimeError → CPU fallback with warn.
```

### Runtime deps (Gate E — speculative)

`onnxruntime-node` with CUDA build requires NVIDIA driver + CUDA toolkit on host. No new npm package; `@xenova/transformers` already pulls `onnxruntime-node`. CUDA execution provider is a runtime flag.

### New env vars

| Variable | Values | Default |
|---|---|---|
| `MEMORY_EMBEDDING_EXECUTION_PROVIDER` | `cpu`, `cuda`, `webgpu` | `cpu` |

**Effort:** 1–2d. Low priority — only relevant for >1M-entity workloads.

---

## Overall Effort Estimate

| Sub-section | Impl | Tests | Total |
|---|---|---|---|
| η.6.1 RBAC | 2–3d | 1d | ~3–4d |
| η.6.2 Distributed | 6–10d | 2d | ~2 weeks |
| η.6.3 Security hardening | 3–4d | 2d | ~1 week |
| η.6.4 Cloud-native | 4–5d | 0.5d | ~1 week |
| η.6.5 GPU | 1–2d | 0.5d | ~2–3d |
| **Total** | | | **~5–6 weeks** |

Recommended promotion order: η.6.3 → η.6.1 → η.6.4 → η.6.2 → η.6.5.

## Decision Gates

| Gate | Question | Recommendation |
|---|---|---|
| A | Redis client: `ioredis` vs `@redis/client`? | `ioredis` for TS quality |
| B | Field-level CRDTs: `yjs` vs `automerge`? | Defer; LWW first |
| C | Is `zod` already in `package.json`? | Check before adding |
| D | SQLCipher native addon acceptable? | Needs the user's call |
| E | GPU acceleration: real workload? | Don't promote until >1M-entity benchmark |

## Risks

- **η.6.2 leader election**: Redis SETNX unsafe under partitions; Redlock safer but more complex. Document single-writer/multi-reader as default.
- **η.6.3 strict validation**: switching `warn` → `strict` is breaking for partial-shape callers. Default stays `warn`.
- **η.6.4 better-sqlite3 in Docker**: native addon must match container libc. Use `node:22-bookworm-slim` for glibc; Alpine needs `apk add python3 make g++`.
- **η.6.5 ONNX CUDA pinning**: CUDA 11 hosts can't run CUDA 12 builds. Document version matrix.
