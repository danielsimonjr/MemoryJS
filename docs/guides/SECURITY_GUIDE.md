# MemoryJS Security Guide

**Version**: 2.9.0
**Last Updated**: 2026-07-24

> **Security-relevant additions since v1.1:**
>
> - **Path-traversal validation** — `validateFilePath` (utils) with
>   `confineToBase` flag; CLAUDE.md gotchas section documents call-site
>   audit.
> - **CSV injection guard** — `escapeCsvFormula` for export.
> - **FTS5 / LIKE sanitization** — strips `:{}()"^~*` and boolean keywords
>   from FTS5 queries; LIKE queries escape `\%_` with `ESCAPE '\'`.
> - **XML import sanitization** — decodes XML entities via parser; never
>   strips characters (so "AT&T" / "O'Brien" are preserved).
> - **Audit log** (v1.6) — `AuditLog` JSONL immutable trail wired into
>   `GovernanceManager`. Every create/update/delete operation logged.
> - **Governance policies** (v1.6) — `canCreate` / `canUpdate` /
>   `canDelete` enforcement at mutation boundaries.
> - **Two-tier deletion** (v1.8) — `SemanticForget` exact match → 0.85
>   semantic fallback with audit logging.
> - **Visibility hierarchies** (v1.7+) — five-level model
>   (`private`/`team`/`org`/`shared`/`public`); η.5.5.b extension adds
>   `allowedRoles[]` predicate + `visibleFrom`/`visibleUntil` time-window
>   gate.
> - **RBAC** (η.6.1) — `RbacMiddleware.checkPermission()`; construct it and
>   plug it into `GovernancePolicy` yourself (there is no
>   `MEMORY_RBAC_ENABLED` env var — see
>   [Governance is now enforced](#governance-is-now-enforced-unreleased-sec1)
>   below for the real wiring).
> - **Audit attribution enforcer** (η.5.5.d) — `CollaborationAuditEnforcer`
>   strict mode requires `agentId` on every mutation; throws
>   `AttributionRequiredError` otherwise.
> - **Optimistic concurrency** (η.5.5.c) — `EntityManager.updateEntity`
>   accepts `expectedVersion`; throws `VersionConflictError` on stale
>   writes (HTTP 409 mapping when behind REST API).
> - **PII redactor** (η.6.3) — `PiiRedactor` with bundled patterns (email
>   / SSN / CC / phone / IP) for export-time scrubbing; `redactWithStats`
>   returns counts for compliance audit trails. **Now actually wired**
>   (Unreleased, Sec6) — see below.
>
> Encryption-at-rest (SQLCipher) and full input-validation (Zod schema)
> are **gated** pending dep approval — see η.6.3 plan.
>
> **Security hardening pass (Unreleased):** governance enforcement is now a
> real chokepoint (was documentation-only), the audit log is hash-chained
> and tamper-evident, PII redaction is wired into exports/backups and audit
> snapshots, `UpdateEntitySchema` closed a mass-assignment gap, the REST
> adapter gained an auth middleware, and Brotli/zlib decompression is
> capped against decompression bombs. See
> [Governance is now enforced](#governance-is-now-enforced-unreleased-sec1)
> for the full rundown.

Production security hardening and best practices for MemoryJS deployments.

---

## Table of Contents

1. [Security Overview](#security-overview)
2. [Input Validation](#input-validation)
3. [Path Traversal Protection](#path-traversal-protection)
4. [SQL Injection Prevention](#sql-injection-prevention)
5. [Data Sanitization](#data-sanitization)
6. [Access Control Patterns](#access-control-patterns)
7. [Secrets Management](#secrets-management)
8. [File System Security](#file-system-security)
9. [Network Security](#network-security)
10. [Audit Logging](#audit-logging)
11. [Security Hardening Pass (Unreleased)](#security-hardening-pass-unreleased)
12. [Security Checklist](#security-checklist)
13. [Vulnerability Reporting](#vulnerability-reporting)

---

## Security Overview

### Built-in Security Features

| Feature | Protection | Location |
|---------|------------|----------|
| Zod validation | Input validation | `src/utils/schemas.ts` |
| Path validation | Path traversal | `src/utils/entityUtils.ts` |
| Parameterized queries | SQL injection | `src/core/SQLiteStorage.ts` |
| Object sanitization | XSS/injection | `src/utils/entityUtils.ts` |
| Type safety | Type confusion | TypeScript throughout |

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Input Layer                                                 │
│  ├── Zod Schema Validation                                   │
│  ├── Type Checking (TypeScript)                              │
│  └── Sanitization (sanitizeObject)                           │
├─────────────────────────────────────────────────────────────┤
│  Processing Layer                                            │
│  ├── Path Validation (validateFilePath)                      │
│  ├── Importance Range Checks                                 │
│  └── Entity/Relation Integrity                               │
├─────────────────────────────────────────────────────────────┤
│  Storage Layer                                               │
│  ├── Parameterized SQL (SQLite)                              │
│  ├── Atomic Writes (JSONL)                                   │
│  └── File Permissions                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Input Validation

### Zod Schema Validation

All inputs are validated using Zod schemas:

```typescript
import { validateWithSchema, EntitySchema, CreateEntitySchema } from '@danielsimonjr/memoryjs';

// Validate entity input
const result = validateWithSchema(CreateEntitySchema, userInput);

if (!result.success) {
  // Handle validation error
  throw new Error(`Validation failed: ${formatZodErrors(result.error)}`);
}

// Use validated data
const entity = result.data;
```

### Schema Definitions

```typescript
// Entity constraints
const EntitySchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(500, 'Name too long')
    .trim(),

  entityType: z.string()
    .min(1, 'Entity type is required')
    .max(100, 'Entity type too long')
    .trim(),

  observations: z.array(
    z.string()
      .min(1, 'Observation cannot be empty')
      .max(5000, 'Observation too long')
  ).max(1000, 'Too many observations'),

  tags: z.array(
    z.string()
      .min(1)
      .max(100)
  ).max(50, 'Too many tags')
    .optional()
    .transform(tags => tags?.map(t => t.toLowerCase())),

  importance: z.number()
    .int()
    .min(0, 'Importance must be >= 0')
    .max(10, 'Importance must be <= 10')
    .optional()
});
```

### Custom Validation

```typescript
import { validateEntity, validateRelation, validateImportance } from '@danielsimonjr/memoryjs';

// Validate individual fields
try {
  validateImportance(userImportance);
  validateTags(userTags);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid input:', error.message);
  }
}
```

### Safe Parsing

```typescript
import { validateSafe } from '@danielsimonjr/memoryjs';

// Returns result object instead of throwing
const result = validateSafe(EntitySchema, untrustedInput);

if (result.success) {
  // Safe to use
  await ctx.entityManager.createEntities([result.data]);
} else {
  // Handle errors
  console.error('Validation errors:', result.errors);
}
```

---

## Path Traversal Protection

### Path Validation Function

```typescript
import { validateFilePath } from '@danielsimonjr/memoryjs';

// Validate path is within allowed directory
const allowedDir = '/var/data/memory';
const userPath = userInput.path;

try {
  validateFilePath(userPath, allowedDir);
  // Path is safe to use
} catch (error) {
  // Path traversal attempt detected
  console.error('Security: Path traversal blocked');
  throw new Error('Invalid path');
}
```

### How Path Validation Works

```typescript
export function validateFilePath(filePath: string, baseDir: string): void {
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  // Check if resolved path starts with base directory
  if (!resolvedPath.startsWith(resolvedBase + path.sep) &&
      resolvedPath !== resolvedBase) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }

  // Check for null bytes
  if (filePath.includes('\0')) {
    throw new SecurityError('Null byte in path');
  }
}
```

### Examples

```typescript
// ✅ Valid paths
validateFilePath('./memory.jsonl', './data');
validateFilePath('/var/data/memory/user1.jsonl', '/var/data/memory');

// ❌ Blocked paths (throws SecurityError)
validateFilePath('../etc/passwd', './data');
validateFilePath('/etc/passwd', './data');
validateFilePath('./data/../../../etc/passwd', './data');
validateFilePath('file.txt\0.jsonl', './data');
```

---

## SQL Injection Prevention

### Parameterized Queries

All SQL queries use parameterized statements:

```typescript
// ✅ SAFE: Parameterized query
const stmt = db.prepare('SELECT * FROM entities WHERE name = ?');
const entity = stmt.get(entityName);

// ❌ NEVER DONE: String concatenation
// const entity = db.exec(`SELECT * FROM entities WHERE name = '${entityName}'`);
```

### SQLite Storage Implementation

```typescript
class SQLiteStorage {
  // All queries are parameterized
  private getEntityByName(name: string): Entity | null {
    const stmt = this.db.prepare(`
      SELECT * FROM entities WHERE name = ?
    `);
    return stmt.get(name);
  }

  private searchEntities(query: string): Entity[] {
    // FTS5 query is also parameterized
    const stmt = this.db.prepare(`
      SELECT * FROM entities_fts WHERE entities_fts MATCH ?
    `);
    return stmt.all(query);
  }

  private insertEntity(entity: Entity): void {
    const stmt = this.db.prepare(`
      INSERT INTO entities (name, entity_type, observations, tags, importance)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      entity.name,
      entity.entityType,
      JSON.stringify(entity.observations),
      JSON.stringify(entity.tags || []),
      entity.importance
    );
  }
}
```

### Boolean Search Sanitization

Boolean search queries are parsed and validated:

```typescript
class BooleanSearch {
  async search(query: string): Promise<KnowledgeGraph> {
    // Validate query structure
    if (query.length > QUERY_LIMITS.MAX_QUERY_LENGTH) {
      throw new ValidationError('Query too long');
    }

    // Parse to AST (validates syntax)
    const ast = this.parseQuery(query);

    // Validate AST depth
    if (this.getAstDepth(ast) > QUERY_LIMITS.MAX_BOOLEAN_DEPTH) {
      throw new ValidationError('Query too complex');
    }

    // Execute against in-memory data (not SQL)
    return this.evaluateAst(ast, graph);
  }
}
```

---

## Data Sanitization

### Object Sanitization

```typescript
import { sanitizeObject } from '@danielsimonjr/memoryjs';

// Sanitize user input
const sanitized = sanitizeObject(userInput);

// Removes:
// - Prototype pollution attempts
// - __proto__, constructor, prototype properties
// - Non-serializable values
// - Circular references
```

### Implementation

```typescript
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const seen = new WeakSet();

  function sanitize(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'object') {
      // Circular reference check
      if (seen.has(value as object)) {
        return '[Circular]';
      }
      seen.add(value as object);

      if (Array.isArray(value)) {
        return value.map(sanitize);
      }

      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        // Skip dangerous properties
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          continue;
        }
        result[key] = sanitize(val);
      }
      return result;
    }

    return value;
  }

  return sanitize(obj) as T;
}
```

### CSV Formula Injection Prevention

```typescript
import { escapeCsvFormula } from '@danielsimonjr/memoryjs';

// Escape CSV formula injection
const safeCsv = escapeCsvFormula(userContent);

// Prefixes dangerous characters: = + - @ | { }
```

### Implementation

```typescript
export function escapeCsvFormula(value: string): string {
  const dangerousChars = ['=', '+', '-', '@', '|', '{'];

  if (dangerousChars.some(char => value.startsWith(char))) {
    return `'${value}`;  // Prefix with single quote
  }

  return value;
}
```

---

## Access Control Patterns

### User Isolation Pattern

```typescript
class IsolatedMemory {
  private getStoragePath(userId: string): string {
    // Validate userId (alphanumeric only)
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
      throw new Error('Invalid user ID');
    }

    const path = `/var/data/memory/users/${userId}/memory.jsonl`;

    // Validate path stays within user directory
    validateFilePath(path, '/var/data/memory/users');

    return path;
  }

  async getUserContext(userId: string): Promise<ManagerContext> {
    const path = this.getStoragePath(userId);
    return new ManagerContext(path);
  }
}

// Usage
const userMemory = new IsolatedMemory();
const ctx = await userMemory.getUserContext(authenticatedUserId);
```

### Role-Based Access

```typescript
interface AccessPolicy {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canExport: boolean;
}

const ROLES: Record<string, AccessPolicy> = {
  admin: { canRead: true, canWrite: true, canDelete: true, canExport: true },
  editor: { canRead: true, canWrite: true, canDelete: false, canExport: true },
  viewer: { canRead: true, canWrite: false, canDelete: false, canExport: false }
};

class SecureMemory {
  constructor(
    private ctx: ManagerContext,
    private role: string
  ) {}

  private checkPermission(action: keyof AccessPolicy): void {
    const policy = ROLES[this.role];
    if (!policy || !policy[action]) {
      throw new Error(`Permission denied: ${action}`);
    }
  }

  async getEntity(name: string): Promise<Entity | null> {
    this.checkPermission('canRead');
    return this.ctx.entityManager.getEntityByName(name);
  }

  async createEntity(entity: Entity): Promise<Entity[]> {
    this.checkPermission('canWrite');
    return this.ctx.entityManager.createEntities([entity]);
  }

  async deleteEntity(name: string): Promise<void> {
    this.checkPermission('canDelete');
    return this.ctx.entityManager.deleteEntities([name]);
  }

  async exportGraph(format: string): Promise<string> {
    this.checkPermission('canExport');
    return this.ctx.ioManager.exportGraph(format as any);
  }
}
```

### Entity-Level Access Control

```typescript
class EntityAccessControl {
  constructor(private userId: string) {}

  canAccess(entity: Entity): boolean {
    // Check entity ownership via tags or observations
    if (entity.tags?.includes(`owner:${this.userId}`)) {
      return true;
    }

    // Check if entity is public
    if (entity.tags?.includes('public')) {
      return true;
    }

    // Check shared access
    if (entity.tags?.includes(`shared:${this.userId}`)) {
      return true;
    }

    return false;
  }

  filterAccessible(entities: Entity[]): Entity[] {
    return entities.filter(e => this.canAccess(e));
  }
}
```

---

## Secrets Management

### API Key Handling

```typescript
// ❌ BAD: Hardcoded secrets
const apiKey = 'sk-xxxxxxxxxxxx';

// ❌ BAD: In code with fallback
const apiKey = process.env.OPENAI_API_KEY || 'sk-default-key';

// ✅ GOOD: Required from environment
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY environment variable required');
}

// ✅ GOOD: Using secrets manager
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

async function getApiKey(): Promise<string> {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: 'projects/my-project/secrets/openai-key/versions/latest'
  });
  return version.payload?.data?.toString() || '';
}
```

### Environment Variables

```bash
# .env (never commit!)
OPENAI_API_KEY=sk-xxxxxxxxxxxx

# .gitignore
.env
.env.*
*.env
```

```typescript
// Load environment with validation
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  MEMORY_STORAGE_TYPE: z.enum(['jsonl', 'sqlite']).optional(),
  OPENAI_API_KEY: z.string().startsWith('sk-').optional(),
});

const env = EnvSchema.parse(process.env);
```

### Sensitive Data in Memory

```typescript
// Avoid logging sensitive data
class SecureLogger {
  log(message: string, data?: unknown) {
    const sanitized = this.redact(data);
    console.log(message, sanitized);
  }

  private redact(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) return data;

    const sensitiveKeys = ['apiKey', 'password', 'token', 'secret', 'key'];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = this.redact(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
```

---

## File System Security

### Directory Permissions

```bash
# Secure directory setup
mkdir -p /var/data/memory
chmod 700 /var/data/memory
chown appuser:appuser /var/data/memory

# Secure file permissions
chmod 600 /var/data/memory/*.jsonl
chmod 600 /var/data/memory/*.db
```

### Atomic Writes

JSONL storage uses atomic writes:

```typescript
async saveGraph(graph: KnowledgeGraph): Promise<void> {
  const tempPath = `${this.path}.tmp.${Date.now()}`;

  try {
    // Write to temp file
    await fs.writeFile(tempPath, this.serialize(graph));

    // Atomic rename
    await fs.rename(tempPath, this.path);
  } catch (error) {
    // Cleanup temp file on error
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
```

### Backup Security

```typescript
// Secure backup creation
const backup = await ctx.ioManager.createBackup({
  compress: true,
  encrypt: process.env.BACKUP_ENCRYPTION_KEY  // If supported
});

// Secure backup storage
const backupPath = `/var/backups/memory/${backup.id}`;
await fs.chmod(backupPath, 0o600);
```

---

## Network Security

### HTTPS for API Keys

```typescript
// Always use HTTPS for API calls
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1'  // HTTPS only
});
```

### Rate Limiting

```typescript
import { throttle } from '@danielsimonjr/memoryjs';

// Rate limit API calls
const throttledEmbed = throttle(
  async (text: string) => embeddingService.embed(text),
  { interval: 100 }  // Max 10 calls per second
);
```

### Request Validation

```typescript
// Validate incoming requests
function validateRequest(req: Request): void {
  // Check content type
  const contentType = req.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    throw new Error('Invalid content type');
  }

  // Check content length
  const contentLength = parseInt(req.headers.get('content-length') || '0');
  if (contentLength > 10 * 1024 * 1024) {  // 10MB limit
    throw new Error('Request too large');
  }
}
```

---

## Audit Logging

### Audit Log Implementation

```typescript
interface AuditEvent {
  timestamp: string;
  userId: string;
  action: string;
  resource: string;
  details?: Record<string, unknown>;
  success: boolean;
  ip?: string;
}

class AuditLogger {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async log(event: AuditEvent): Promise<void> {
    const entry = JSON.stringify({
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    });

    await fs.appendFile(this.logPath, entry + '\n');
  }
}

// Usage
const audit = new AuditLogger('/var/log/memory/audit.log');

await audit.log({
  userId: 'user123',
  action: 'CREATE_ENTITIES',
  resource: 'entities',
  details: { count: 10 },
  success: true,
  timestamp: new Date().toISOString()
});
```

### Wrapper with Audit Logging

```typescript
class AuditedMemory {
  constructor(
    private ctx: ManagerContext,
    private audit: AuditLogger,
    private userId: string
  ) {}

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    try {
      const result = await this.ctx.entityManager.createEntities(entities);

      await this.audit.log({
        userId: this.userId,
        action: 'CREATE_ENTITIES',
        resource: 'entities',
        details: { names: entities.map(e => e.name) },
        success: true,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      await this.audit.log({
        userId: this.userId,
        action: 'CREATE_ENTITIES',
        resource: 'entities',
        details: { error: (error as Error).message },
        success: false,
        timestamp: new Date().toISOString()
      });

      throw error;
    }
  }

  async deleteEntities(names: string[]): Promise<void> {
    await this.audit.log({
      userId: this.userId,
      action: 'DELETE_ENTITIES',
      resource: 'entities',
      details: { names },
      success: true,
      timestamp: new Date().toISOString()
    });

    return this.ctx.entityManager.deleteEntities(names);
  }
}
```

---

## Security Hardening Pass (Unreleased)

Findings and fixes from a defensive review of the library itself
(`docs/development/OPTIMIZATION_OPPORTUNITIES.md`, "Security" section).
Every item below is verified against source, not aspirational.

### Governance is now enforced (Unreleased, Sec1)

**Before this pass:** `MEMORY_GOVERNANCE_ENABLED` was documented in
CLAUDE.md but read nowhere in `src/`. There was no `ctx.governanceManager`
enforcement wiring — policy checks lived only inside
`GovernanceTransaction`, reachable only if a caller manually built a
`GovernanceManager` and routed writes through `withTransaction`. Every real
mutation path (`EntityManager`, including `renameEntity`, and the
reconstructive-memory backing) wrote with zero policy or audit. An operator
who set the env var and a policy, believing deletes were blocked/audited,
got nothing.

**Now:** setting `MEMORY_GOVERNANCE_ENABLED='true'` (strict literal match —
`'1'`/`'yes'`/`'TRUE'` are silently ignored) wires `ctx.governanceManager`'s
policy + audit log into every `EntityManager` mutation:

```typescript
process.env.MEMORY_GOVERNANCE_ENABLED = 'true';
const ctx = new ManagerContext('./memory.jsonl');

ctx.governanceManager.setPolicy({
  canCreate: (entity) => true,
  canUpdate: (entity, updates) => updates.entityType === undefined, // block type changes
  canDelete: (entity) => (entity.importance ?? 0) < 8,               // protect high-importance
});

// createEntities / updateEntity / batchUpdate / deleteEntities / renameEntity
// are now all policy-checked (throw GovernanceError on denial) and audited
// (fire-and-forget append — an audit failure never fails the write).
await ctx.entityManager.deleteEntities(['low-value-note']);  // OK
await ctx.entityManager.deleteEntities(['critical-decision']); // throws GovernanceError
```

With the flag unset, `ctx.governanceManager` is still constructible and
usable manually (`withTransaction`/`rollback`), but ordinary
`EntityManager` writes bypass it entirely — zero overhead, unchanged from
pre-Unreleased behavior. A related bug is also fixed: `rollback()` used to
spread the raw audit snapshot **before** the field whitelist, so any field
present in the (writable) audit file could land back on a restored entity;
it now builds exclusively from the whitelisted fields.

### Audit log tamper-evidence: hash chaining + `verifyChain()` (Unreleased, Sec5)

**Before:** `AuditLog.append()` was a plain `fs.appendFile` with no file
mode, no hash chain, no sequence numbers — any writer with file access
could rewrite, truncate, or reorder entries undetectably, and malformed
lines were skipped silently on read.

**Now:** every entry carries a monotonic `seq` and a SHA-256 `prevHash`
chaining it to the previous line's exact serialized text; the file is
written with `{ mode: 0o600 }`. `AuditLog.verifyChain()` replays the file
and reports the first break:

```typescript
import { AuditLog } from '@danielsimonjr/memoryjs';

const log = new AuditLog('./memory-audit.jsonl');
const result = await log.verifyChain();
// { valid: boolean, brokenAt?: number, totalChecked: number,
//   legacyLines: number, malformedLines: number }
if (!result.valid) {
  console.error(`Audit chain broken at line ${result.brokenAt} — investigate immediately`);
}
```

```bash
# Same check from the CLI — exits 1 when the chain is broken (scriptable)
memory audit verify
memory audit log --entity Alice --since 24h   # queryable provenance
memory audit stats                            # counts by operation, oldest/newest
```

Leading entries written before this change (no `seq`/`prevHash`) are
"legacy" — reported separately, not treated as a break. This makes the
audit log **tamper-evident** (you can detect rewrites), not
**tamper-proof** (an attacker with write access can still truncate the
whole file or start a new fork from any point) — ship it to write-once
storage or a separate host if you need the stronger guarantee.

### PII redaction wired into exports, backups, and audit snapshots (Unreleased, Sec6)

**Before:** `PiiRedactor` self-described as "applied on export only" but had
zero call sites — `IOManager` export/backup and `GovernanceManager` audit
snapshots all emitted raw observation text.

**Now:** both are opt-in:

```typescript
// Export/backup: redact PII in observation strings
const json = await ctx.ioManager.exportGraph('json', { redactPii: true });
const backup = await ctx.ioManager.createBackup({ redactPii: true, compress: true });

// Audit snapshots (before/after entity state written to the audit log)
const gov = new GovernanceManager(storage, auditLog, {
  redactAuditSnapshots: true,       // default false — opt in explicitly
  redactor: new PiiRedactor({ additionalPatterns: [...] }), // optional custom bank
});
```

Both default to `false`/off — existing behavior (raw text) is unchanged
unless you opt in. `MemoryEngine.addTurn`'s write-side `ExclusionManager`
filter is unrelated and unaffected — it was already wired before this pass.

### Mass assignment closed: `UpdateEntitySchema` strips unknown keys (Unreleased, Sec7)

**Before:** `UpdateEntitySchema` ended in `.passthrough()`, so
`updateEntity(name, updates)` admitted arbitrary extra keys past the known
fields. Combined with `sanitizeObject` (which only strips
`__proto__`/`constructor`/`prototype`), a caller could inject or spoof
internal-looking fields (`isLatest`, `supersededBy`, `version`) that
`GovernancePolicy.canUpdate` — which checks the *pre-merge* entity — could
not veto.

**Now:** the schema ends in `.strip()` — an explicit allow-list. Unknown
keys are silently dropped before validation succeeds; only fields in the
schema ever reach `Object.assign`. See
[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md#behavioral-changes-unreleased--post-v290)
if your integration relied on the old passthrough behavior. A parity fix
also wraps `GovernanceManager.updateEntity`/`createEntity` with
`sanitizeObject` — previously the "hardened" governance path skipped the
same prototype-pollution guard every other write path uses.

### REST API-key auth middleware (Unreleased, Sec9)

**Before:** `src/adapters/RestRouter.ts` had zero auth wiring. Mounting
`RestRouter.withDefaults(ctx)` exposed an unauthenticated read/write HTTP
surface to anyone who could reach the listener, despite `APIKeyStore`
already existing (and being cryptographically sound — SHA-256 of a
192-bit key, `crypto.timingSafeEqual` comparison).

**Now:** `ApiKeyAuthMiddleware` wires `APIKeyStore.validate()` into the
router:

```typescript
import { APIKeyStore } from '@danielsimonjr/memoryjs/security';
import { ApiKeyAuthMiddleware, RestRouter } from '@danielsimonjr/memoryjs/adapters';

const store = new APIKeyStore();
const { plaintext } = store.issue({ scopes: ['entities:write'] }); // show plaintext to the caller once
// persist store.serialize() somewhere durable — issue()/revoke() do not auto-persist

const auth = new ApiKeyAuthMiddleware({ store });
const router = RestRouter.withDefaults(ctx, { auth });
// GET routes: any valid key. Mutating routes (POST/PUT/PATCH/DELETE):
// require the 'entities:write' scope by default (customize via requiredScopes).
```

Requests authenticate via `Authorization: Bearer <key>` (preferred) or
`X-Api-Key`. Failures are `401 { error: 'unauthorized' }` (missing/
unknown/revoked/expired — the specific reason is deliberately NOT sent to
the client, only to your `onReject` callback for server-side logging) or
`403 { error: 'forbidden', requiredScopes }` for a valid key lacking scope.
**Still your responsibility:** persist `store.serialize()` after
`issue()`/`revoke()` — a crash between the call and your persistence step
can resurrect a revoked key on the next `load()`.

### Decompression-bomb caps (Unreleased, Sec8)

**Before:** `decompress()`/`decompressFile()` (Brotli) and the zlib
adapter called into Node's decompression with no output-size cap — a
crafted small `.jsonl.br` payload could expand to exhaust memory.

**Now:** every decompression path enforces `maxOutputLength` — explicit
option, else `MEMORY_MAX_DECOMPRESSED_BYTES` env var, else 256MB default.
Exceeding the cap throws instead of silently truncating. See
[CONFIGURATION.md](./CONFIGURATION.md) for the env var and
[PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md) if you need to raise it
for known-large trusted payloads (e.g. bulk restore of an intentionally
large backup).

### RBAC fixes: default-role semantics + sidecar file mode (Unreleased, Sec2)

**Before:** `RbacMiddleware`'s `defaultRole` ternary flipped on an
unrelated condition — passing `{ matrix }` without `defaultRole` and
passing `{ defaultRole: undefined }` explicitly were indistinguishable, so
omission silently granted unregistered agents the documented `'reader'`
default in both cases (no way to actually deny-by-default via the
documented pattern). `RoleAssignmentStore` also wrote its sidecar file
world-readable (no explicit `mode`) and silently dropped corrupt lines —
meaning a corrupted **revoke** line failed open.

**Now:** the constructor checks `'defaultRole' in options` — key presence,
not value — so `{ defaultRole: undefined }` reliably denies unregistered
agents while omitting the key keeps the `'reader'` default. The sidecar
file is written with `{ mode: 0o600 }`, and corrupt lines are surfaced as a
count instead of disappearing. There is still no `MEMORY_RBAC_ENABLED` /
`MEMORY_RBAC_DEFAULT_ROLE` env var — configure `RbacMiddleware` in code and
route it through `GovernancePolicy` yourself (see
[Governance is now enforced](#governance-is-now-enforced-unreleased-sec1)
above, and the RBAC section of [CONFIGURATION.md](./CONFIGURATION.md) for
the corrected reference).

### `memory env` now masks secrets (Unreleased, Sec3)

**Before:** the `memory env` diagnostic command printed
`MEMORY_OPENAI_API_KEY` in plaintext — exactly the output users paste into
support tickets/issues.

**Now:** secret-classified vars are masked (`***set***` / `null`) instead
of printed verbatim. Elsewhere, secrets hygiene was already clean:
`EmbeddingService` only ever places the key in the `Authorization` header,
never in error paths; the key is never persisted into the graph, so
exports can't leak it.

---

## Security Checklist

### Development

- [ ] All user input validated with Zod schemas
- [ ] File paths validated before use
- [ ] No hardcoded secrets in code
- [ ] Environment variables used for configuration
- [ ] TypeScript strict mode enabled
- [ ] No `any` types for user input

### Deployment

- [ ] HTTPS enabled for all endpoints
- [ ] API keys stored in secrets manager
- [ ] File permissions restricted (600/700)
- [ ] Data directory isolated per user
- [ ] Rate limiting configured
- [ ] Audit logging enabled

### Operations

- [ ] Regular security updates applied
- [ ] Backup encryption enabled
- [ ] Access logs monitored
- [ ] Unused accounts removed
- [ ] Secrets rotated regularly

### Code Review

- [ ] No SQL string concatenation
- [ ] No eval() or dynamic code execution
- [ ] No path traversal vulnerabilities
- [ ] Sensitive data not logged
- [ ] Error messages don't leak internals

---

## Vulnerability Reporting

### Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Email security details to the maintainers
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Severity | Initial Response | Fix Target |
|----------|-----------------|------------|
| Critical | 24 hours | 48 hours |
| High | 48 hours | 1 week |
| Medium | 1 week | 2 weeks |
| Low | 2 weeks | Next release |

### Security Updates

Security updates are released as patch versions (e.g., 1.1.1 -> 1.1.2).

```bash
# Always use latest patch version
npm update @danielsimonjr/memoryjs
```

---

**Document Version**: 1.0
**Last Updated**: 2026-07-24
