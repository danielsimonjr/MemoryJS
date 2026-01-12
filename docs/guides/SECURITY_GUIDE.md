# MemoryJS Security Guide

**Version**: 1.1.1
**Last Updated**: 2026-01-12

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
11. [Security Checklist](#security-checklist)
12. [Vulnerability Reporting](#vulnerability-reporting)

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
**Last Updated**: 2026-01-12
