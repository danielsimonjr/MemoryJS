# Development Setup Guide

Complete guide to setting up a MemoryJS development environment.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [IDE Configuration](#ide-configuration)
4. [Build System](#build-system)
5. [Testing Environment](#testing-environment)
6. [Storage Backends](#storage-backends)
7. [Embedding Providers](#embedding-providers)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18.x+ | JavaScript runtime |
| npm | 9.x+ | Package management |
| Git | 2.x+ | Version control |

### Optional

| Tool | Purpose |
|------|---------|
| VS Code | Recommended IDE with TypeScript support |
| SQLite CLI | Debug SQLite storage backend |
| Docker | Isolated test environments |

### Verify Installation

```bash
node --version   # Should be 18.x or higher
npm --version    # Should be 9.x or higher
git --version    # Should be 2.x or higher
```

---

## Initial Setup

### 1. Clone Repository

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/MemoryJS.git
cd MemoryJS

# Add upstream remote
git remote add upstream https://github.com/danielsimonjr/MemoryJS.git
```

### 2. Install Dependencies

```bash
npm install
```

This installs:
- **Production dependencies**: `better-sqlite3`, `zod`, `async-mutex`
- **Dev dependencies**: `vitest`, `typescript`, `tsx`, `@types/*`

### 3. Build Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in `dist/`.

### 4. Verify Setup

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Run single test to verify
npx vitest run tests/unit/core/EntityManager.test.ts
```

---

## IDE Configuration

### VS Code (Recommended)

#### Recommended Extensions

```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-next",
    "vitest.explorer"
  ]
}
```

#### Workspace Settings

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "vitest.enable": true,
  "vitest.commandLine": "npx vitest"
}
```

#### Debug Configuration

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Current Test File",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${relativeFile}"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "Debug All Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "Run Script",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["tsx", "${file}"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### WebStorm/IntelliJ

1. Open project folder
2. Wait for indexing to complete
3. Configure TypeScript:
   - Settings > Languages & Frameworks > TypeScript
   - Set TypeScript to `node_modules/typescript`
4. Configure test runner:
   - Run > Edit Configurations
   - Add Vitest configuration

---

## Build System

### Available Scripts

```bash
# Build TypeScript to dist/
npm run build

# Watch mode - rebuild on changes
npm run build:watch

# Type check without emitting
npm run typecheck

# Clean build artifacts
rm -rf dist/
```

### TypeScript Configuration

Key `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### Build Output Structure

```
dist/
├── core/
│   ├── EntityManager.js
│   ├── EntityManager.d.ts
│   └── EntityManager.js.map
├── search/
├── features/
├── utils/
├── types/
├── workers/
└── index.js
```

---

## Testing Environment

### Test Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/index.ts', '**/types.ts', 'dist/**']
    }
  }
});
```

### Running Tests

```bash
# All tests
npm test

# With coverage report
npm run test:coverage

# Watch mode
npm run test:watch

# Specific file
npx vitest run tests/unit/core/EntityManager.test.ts

# Pattern matching
npx vitest run --grep "EntityManager"

# Only unit tests
npx vitest run tests/unit

# Only integration tests
npx vitest run tests/integration

# Only performance tests
npx vitest run tests/performance
```

### Test Data Location

Tests create temporary files in:
- `tests/fixtures/` - Static test data
- `/tmp/memoryjs-test-*` - Temporary test files (auto-cleaned)

### Writing Test Fixtures

```typescript
// tests/fixtures/sample-graph.ts
export const sampleGraph = {
  entities: [
    { name: 'Alice', entityType: 'person', observations: ['Engineer'] },
    { name: 'Bob', entityType: 'person', observations: ['Designer'] }
  ],
  relations: [
    { from: 'Alice', to: 'Bob', relationType: 'knows' }
  ]
};
```

---

## Storage Backends

### JSONL Storage (Default)

No additional setup required. Files stored as line-delimited JSON.

```bash
# Test with JSONL
MEMORY_STORAGE_TYPE=jsonl npm test
```

### SQLite Storage

Requires `better-sqlite3` (installed automatically).

```bash
# Test with SQLite
MEMORY_STORAGE_TYPE=sqlite npm test
```

#### Debugging SQLite

```bash
# Install SQLite CLI
brew install sqlite  # macOS
apt install sqlite3  # Ubuntu

# Open database
sqlite3 ./test-memory.db

# Common queries
.tables
SELECT * FROM entities LIMIT 5;
SELECT * FROM entities_fts WHERE entities_fts MATCH 'alice';
.schema entities
```

---

## Embedding Providers

### Mock Provider (Default for Tests)

No setup required. Returns deterministic fake embeddings.

```bash
EMBEDDING_PROVIDER=none npm test
```

### OpenAI Provider

```bash
# Set API key
export OPENAI_API_KEY=sk-your-key-here

# Enable OpenAI embeddings
export EMBEDDING_PROVIDER=openai

# Run tests (will use real API)
npm test
```

**Warning**: Using OpenAI in tests incurs API costs.

### Local Provider

Uses locally computed embeddings (lower quality, no API needed).

```bash
export EMBEDDING_PROVIDER=local
npm test
```

---

## Environment Variables

### Development Environment

Create a `.env.development` file (not committed):

```bash
# Storage
MEMORY_STORAGE_TYPE=jsonl

# Embeddings (for semantic search testing)
EMBEDDING_PROVIDER=none
# OPENAI_API_KEY=sk-your-key-here

# Debugging
DEBUG=memoryjs:*
NODE_ENV=development
```

### Loading Environment

```bash
# Load and run
source .env.development && npm test
```

Or use `dotenv`:

```typescript
import 'dotenv/config';
```

---

## Common Development Tasks

### Adding a New Manager

1. Create file in appropriate module:
   ```
   src/features/NewManager.ts
   ```

2. Export from barrel:
   ```typescript
   // src/features/index.ts
   export { NewManager } from './NewManager.js';
   ```

3. Add to ManagerContext (if needed):
   ```typescript
   // src/core/ManagerContext.ts
   private _newManager?: NewManager;
   get newManager(): NewManager {
     return (this._newManager ??= new NewManager(this.storage));
   }
   ```

4. Add tests:
   ```
   tests/unit/features/NewManager.test.ts
   ```

5. Update documentation:
   ```
   docs/guides/API_REFERENCE.md
   ```

### Adding a New Search Algorithm

1. Create search class:
   ```
   src/search/NewSearch.ts
   ```

2. Implement search interface:
   ```typescript
   export class NewSearch {
     constructor(private storage: GraphStorage) {}

     async search(query: string, options?: SearchOptions): Promise<Entity[]> {
       // Implementation
     }
   }
   ```

3. Export and integrate with SearchManager

4. Add tests and documentation

### Debugging a Test Failure

```bash
# Run with verbose output
npx vitest run tests/unit/core/EntityManager.test.ts --reporter=verbose

# Run with debugger
node --inspect-brk node_modules/vitest/vitest.mjs run tests/unit/core/EntityManager.test.ts

# Run specific test
npx vitest run -t "should create entity"
```

---

## Troubleshooting

### Build Errors

#### "Cannot find module" errors

```bash
# Rebuild
rm -rf dist/ node_modules/
npm install
npm run build
```

#### Type errors

```bash
# Check types
npm run typecheck

# Clear TypeScript cache
rm -rf node_modules/.cache
```

### Test Errors

#### Timeout errors

```bash
# Increase timeout
npx vitest run --testTimeout=60000
```

#### SQLite errors

```bash
# Rebuild native modules
npm rebuild better-sqlite3
```

#### Permission errors

```bash
# Check temp directory permissions
ls -la /tmp/memoryjs-test-*

# Clean up old test files
rm -rf /tmp/memoryjs-test-*
```

### Native Module Issues

#### Apple Silicon (M1/M2)

```bash
# Rebuild for ARM
npm rebuild
```

#### Linux

```bash
# Install build essentials
sudo apt install build-essential python3
npm rebuild
```

---

## Next Steps

- Read [CODE_STYLE.md](./CODE_STYLE.md) for coding conventions
- Read [TESTING_GUIDE.md](./TESTING_GUIDE.md) for test writing
- Read [DEBUGGING_GUIDE.md](./DEBUGGING_GUIDE.md) for debugging techniques
- Check [../architecture/](../architecture/) for architecture details
