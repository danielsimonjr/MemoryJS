# Security

This document describes MemoryJS's threat model, the controls in place, and how to report vulnerabilities. The codebase aims for defense-in-depth around the most common attack surfaces in a knowledge-graph library that ingests user data, persists it across processes, and runs queries from untrusted input.

If you have not yet read [`CLAUDE.md`](./CLAUDE.md), the "Gotchas" section there documents the same controls from an implementer's angle.

## Reporting a vulnerability

Open a private security advisory via [GitHub](https://github.com/danielsimonjr/memoryjs/security/advisories/new). Do **not** file public issues for security-sensitive problems. We aim to acknowledge within 7 days.

## Threat model

The library is exposed to two classes of attacker-controlled input:

1. **Stored content.** Entity names, observations, relation labels, tags, and free-text fields are written by the calling application and may originate from end-user input, LLM output, or imported third-party data.
2. **Query input.** Search terms, structured filters, file paths for import/export, and CLI arguments are passed at query time. The same CLI is exposed as a library binary and can be piped from untrusted sources.

Out of scope:

- **Sandboxing untrusted task functions.** `TaskQueue` (`src/utils/taskScheduler.ts`) and `parallelUtils` use `new Function(...)` to deserialise functions across worker boundaries; `validateFunction` rejects strings, but a caller that supplies a malicious **function object** can execute arbitrary code in the worker. The library is **not** a sandbox — callers are responsible for the trust boundary on functions they enqueue.
- **Process isolation across consumer applications.** A consumer running MemoryJS in-process inherits the process's privileges. The library does not enforce capabilities or namespaces.
- **Side-channel resistance.** Timing attacks against entity-existence checks, embedding similarity, or query latency are not mitigated.

## Controls

### Path confinement (`src/utils/entityUtils.ts`)

`validateFilePath(filePath, baseDir, confineToBase)` is the single entry point for resolving caller-supplied paths.

- **Eager `..` rejection** — any input containing a `..` segment is rejected before normalisation, so `path.resolve` cannot silently collapse traversal sequences. Triggers a `FileOperationError` with a "Path traversal detected" message.
- **Post-resolution traversal check** — after `path.resolve`, the result is split on `path.sep` and any `..` again triggers the same error (defence-in-depth).
- **Confinement** — when `confineToBase` is `true` (the default), the resolved path must start with `path.resolve(baseDir) + path.sep`, or equal `baseDir` itself. Anything outside throws "Path is outside the allowed directory".
- **Opt-out** — three callers legitimately escape cwd: the storage layer (`MEMORY_FILE_PATH`), the import/export CLI (`src/cli/commands/io.ts:35,68`), and analytics export targets. Each passes `confineToBase=false` explicitly. Verified during the Phase 1 step 8 audit: every `readFileSync`/`writeFileSync` in `src/cli/commands/io.ts` flows through `validateFilePath` first.

### FTS5 query sanitisation (`src/core/SQLiteStorage.ts:fullTextSearch`)

User queries to the SQLite FTS5 virtual table are sanitised before being passed to `MATCH`:

```ts
query
  .replace(/["{}()^~:]/g, ' ')  // FTS5 operators + column filter syntax
  .replace(/\bNEAR\b/gi, '')
  .replace(/\bAND\b/gi, '')
  .replace(/\bOR\b/gi, '')
  .replace(/\bNOT\b/gi, '')
  .replace(/\*/g, '')           // wildcard prefix operator
  .replace(/\s+/g, ' ')
  .trim();
```

This blocks query injection (turning a search into a column filter) and resource exhaustion via expensive boolean queries. Bare-keyword search remains supported.

**Cross-link:** `src/search/QueryParser.ts` strips the same set of characters before passing queries to non-SQLite backends, so the sanitisation contract is uniform across storage drivers.

### LIKE pattern escaping (`src/core/SQLiteStorage.ts:simpleSearch`)

The `simpleSearch` LIKE query escapes wildcards in user input:

```ts
const escaped = searchTerm
  .replace(/\\/g, '\\\\')
  .replace(/%/g, '\\%')
  .replace(/_/g, '\\_');
const pattern = `%${escaped}%`;
// SQL: WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE
```

The matching `ESCAPE '\\'` clause in the prepared statement is mandatory — without it, the driver would treat the escaped backslashes as literal characters and the wildcards in user input would still match.

### XML entity handling (`src/features/IOManager.ts`)

XML / GraphML / GEXF / DOT export and import all go through paired encode/decode helpers:

- **Encode** (lines 264, 529, 584): `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`. The `&` substitution **must run first** so the other replacements don't double-escape it.
- **Decode** (lines 1035, 1091): inverse of the above plus `&apos;` → `'`. The `&amp;` → `&` substitution **must run last** for the same reason.

**Critical gotcha (per `CLAUDE.md`):** never strip XML entities — decode them. Stripping silently corrupts data like `AT&T`, `O'Brien`, `Smith & Wesson`. This is enforced by code review; there are no automated tests asserting "stripping never happens" yet (target for Phase 2 step 23).

### Prototype-pollution guard (`src/utils/index.ts:sanitizeObject`)

Before merging caller-supplied updates into entities, `EntityManager.updateEntity` and friends pass them through `sanitizeObject`, which strips `__proto__`, `constructor`, and `prototype` keys at any depth. This blocks JSON-injection chains like `{ "__proto__": { "isAdmin": true } }` from polluting the global Object prototype.

Used in:

- `src/core/SQLiteStorage.ts:796` (entity update path)
- `src/core/EntityManager.ts` (the sister GraphStorage-backed update path)
- import pipelines that accept JSON

### PII redaction (`src/security/PiiRedactor.ts`)

A pluggable regex-based redactor for personally identifiable information. Applied **on export only** — does not mutate storage. Default patterns cover email, U.S. SSN, credit card (13–19 digits), North American phone, and IPv4. `redactWithStats(text)` returns per-pattern counts, suitable for compliance audit trails (proves N PII items were stripped without surfacing values).

False-positive bias is preferred over false-negative for PII; callers can override `patterns` (replace the bank) or layer on `additionalPatterns` (add to defaults).

### Process-level safety nets (`src/cli/index.ts`)

The CLI registers `unhandledRejection` and `uncaughtException` handlers at module load. Both route through the shared logger (`src/utils/logger.ts`) and **do not** call `process.exit(1)` — that lets `WorkerPoolManager`'s lazy-registered handler run and clean up worker threads on its own schedule. Node's default exit semantics still apply when no other handler intervenes.

## CLI input flow

```
argv / piped stdin
   │
   ▼
Commander parser  ──►  global flags (--storage, --output-format, etc.)
   │                   stored on `program.opts()`
   ▼
subcommand action(file, options)
   │
   ▼
validateFilePath(file, baseDir, confineToBase)   ◄── path confinement
   │
   ▼
readFileSync / writeFileSync
   │
   ▼
ManagerContext  ──►  EntityManager.createEntities (sanitizeObject)
                ──►  SearchManager.fullTextSearch (FTS5 sanitiser)
                ──►  SearchManager.simpleSearch (LIKE escape)
```

Pipe mode (added in Phase 0 step 7) tokenises each line with a quote-aware parser **before** Commander sees it; the same global flags from the outer invocation persist for every line.

## Known limitations

- **`AgentMemoryManager.recordAccess` / `registerAgent`** — both are sync wrappers around async work that emit success events synchronously. A rejection from the underlying async call is logged but the event has already fired. Documented at the call sites; tightening requires an API change scheduled for Phase 2 step 24 (API tiering).
- **`ProfileManager.extractFromSession`** — passes raw observation strings to `SalienceEngine.calculateSalience` which expects an `AgentEntity`. Cast as `unknown as AgentEntity`; runtime relies on the engine's nullish-default handling for missing fields. Tracked under the agent-memory test-coverage gap (Phase 2 step 23).
- **No rate limiting** — search and write endpoints carry no built-in throttling. Document a per-process cap in your application layer if exposing to untrusted callers.
- **No encryption at rest** — entities are stored as plain JSONL or unencrypted SQLite. The `SQLCipher` adapter (η.6.3) is gated; consumers that need at-rest encryption should run on an encrypted filesystem until that ships.

## Maintainer checklist

When adding a new code path that touches caller-supplied input, verify:

- [ ] File paths flow through `validateFilePath`. Pick `confineToBase=false` only if the path is from a trusted operator (env var, CLI flag).
- [ ] Search queries flow through the appropriate sanitiser (FTS5 for SQLite, LIKE-escape for `simpleSearch`, `QueryParser` strip for in-memory).
- [ ] XML / GraphML / GEXF output uses the paired encode helper.
- [ ] JSON input that becomes part of an entity flows through `sanitizeObject`.
- [ ] New env vars are documented in `CLAUDE.md`'s env-var matrix and have a sane default.
- [ ] If the new path can fail under attacker control, errors flow through `logger.error` rather than `console.*`.

---

*Generated as part of Phase 1 step 8 (`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`).*
