# Contributing to MemoryJS

Thank you for your interest in contributing to MemoryJS! This document provides guidelines and instructions for contributing.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Pull Request Process](#pull-request-process)
5. [Coding Standards](#coding-standards)
6. [Testing Requirements](#testing-requirements)
7. [Documentation](#documentation)
8. [Issue Guidelines](#issue-guidelines)

---

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Accept constructive criticism gracefully
- Focus on what's best for the project
- Show empathy towards other contributors

### Unacceptable Behavior

- Harassment, trolling, or personal attacks
- Publishing others' private information
- Other conduct inappropriate for a professional setting

---

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher
- Git
- A code editor (VS Code recommended)

### Setup

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/MemoryJS.git
cd MemoryJS

# Install dependencies
npm install

# Build the project
npm run build

# Run tests to verify setup
npm test
```

### Project Structure

```
MemoryJS/
├── src/                 # Source code
│   ├── core/           # Storage, managers, transactions
│   ├── search/         # Search implementations
│   ├── features/       # Import/export, compression, analytics
│   ├── utils/          # Shared utilities
│   ├── types/          # TypeScript type definitions
│   └── workers/        # Worker pool for CPU-intensive tasks
├── tests/              # Test files
│   ├── unit/          # Unit tests
│   ├── integration/   # Integration tests
│   ├── performance/   # Benchmarks
│   └── edge-cases/    # Boundary condition tests
├── docs/               # Documentation
│   ├── architecture/  # Architecture documentation
│   ├── development/   # Developer guides
│   └── guides/        # User guides
└── tools/              # Build and analysis tools
```

---

## Development Workflow

### 1. Create a Branch

```bash
# Update main branch
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/issue-description
```

### Branch Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/description` | `feature/add-graphql-export` |
| Bug fix | `fix/issue-description` | `fix/search-pagination-bug` |
| Refactor | `refactor/description` | `refactor/storage-layer` |
| Docs | `docs/description` | `docs/api-reference-update` |
| Test | `test/description` | `test/search-edge-cases` |

### 2. Make Changes

```bash
# Make your changes, then build
npm run build

# Run type checking
npm run typecheck

# Run tests
npm test

# Run specific test file
npx vitest run tests/unit/core/EntityManager.test.ts
```

### 3. Commit Changes

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Format: type(scope): description

git commit -m "feat(search): add BM25 ranking algorithm"
git commit -m "fix(storage): handle concurrent writes correctly"
git commit -m "docs(api): update SearchManager documentation"
git commit -m "test(core): add EntityManager edge case tests"
git commit -m "refactor(utils): simplify validation logic"
```

**Commit Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `test`: Adding or updating tests
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `chore`: Build process or auxiliary tool changes

### 4. Push and Create PR

```bash
git push -u origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

---

## Pull Request Process

### Before Submitting

1. **Build passes**: `npm run build` succeeds
2. **Tests pass**: `npm test` passes
3. **Type check passes**: `npm run typecheck` passes
4. **Documentation updated**: If adding features, update docs
5. **Changelog updated**: Add entry to CHANGELOG.md if significant

### PR Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Documentation
- [ ] API docs updated
- [ ] README updated (if needed)
- [ ] CHANGELOG updated

## Related Issues
Fixes #123
```

### Review Process

1. **Automated checks**: CI must pass
2. **Code review**: At least one maintainer approval
3. **Feedback**: Address review comments
4. **Merge**: Maintainer merges when approved

### After Merge

```bash
# Update your local main
git checkout main
git pull origin main

# Delete feature branch
git branch -d feature/your-feature-name
```

---

## Coding Standards

### TypeScript

- Use strict mode (`"strict": true`)
- Prefer `const` over `let`
- Use explicit types for function parameters and return values
- Avoid `any` type - use `unknown` if type is truly unknown

```typescript
// Good
async function searchEntities(query: string, limit: number = 10): Promise<Entity[]> {
  const results = await this.storage.loadGraph();
  return results.entities.filter(e => e.name.includes(query)).slice(0, limit);
}

// Avoid
async function searchEntities(query, limit) {
  const results: any = await this.storage.loadGraph();
  return results.entities.filter(e => e.name.includes(query)).slice(0, limit);
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `EntityManager` |
| Interfaces | PascalCase | `SearchOptions` |
| Functions | camelCase | `findEntityByName` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_LIMIT` |
| Files | PascalCase for classes | `EntityManager.ts` |
| Test files | Same as source + `.test` | `EntityManager.test.ts` |

### File Organization

```typescript
// 1. Imports - external packages first, then internal
import { z } from 'zod';
import { Entity } from '../types/index.js';
import { ValidationError } from '../utils/errors.js';

// 2. Type definitions
interface SearchOptions {
  limit?: number;
  offset?: number;
}

// 3. Constants
const DEFAULT_LIMIT = 50;

// 4. Main class/function
export class SearchManager {
  // ...
}

// 5. Helper functions (if not in separate file)
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}
```

### Error Handling

- Use custom error classes from `utils/errors.ts`
- Include meaningful error messages
- Don't swallow errors silently

```typescript
import { EntityNotFoundError, ValidationError } from '../utils/errors.js';

// Good
if (!entity) {
  throw new EntityNotFoundError(`Entity '${name}' not found`);
}

// Avoid
if (!entity) {
  throw new Error('not found');
}
```

---

## Testing Requirements

### Test Coverage

- All new features require tests
- Bug fixes should include regression tests
- Aim for >80% line coverage on new code

### Test Organization

```
tests/
├── unit/              # Isolated component tests
│   ├── core/         # Core module tests
│   ├── search/       # Search module tests
│   ├── features/     # Features module tests
│   └── utils/        # Utility tests
├── integration/       # Cross-module tests
├── performance/       # Benchmarks
└── edge-cases/        # Boundary conditions
```

### Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityManager } from '../../../src/core/EntityManager.js';

describe('EntityManager', () => {
  let manager: EntityManager;

  beforeEach(async () => {
    // Setup
    manager = new EntityManager(mockStorage);
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('createEntities', () => {
    it('should create a valid entity', async () => {
      const entities = await manager.createEntities([
        { name: 'Test', entityType: 'test', observations: ['obs1'] }
      ]);

      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Test');
    });

    it('should reject invalid entity names', async () => {
      await expect(
        manager.createEntities([{ name: '', entityType: 'test', observations: [] }])
      ).rejects.toThrow(ValidationError);
    });
  });
});
```

### Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Specific file
npx vitest run tests/unit/core/EntityManager.test.ts

# Watch mode
npm run test:watch

# Pattern matching
npx vitest run --grep "EntityManager"
```

---

## Documentation

### When to Update Docs

- Adding new public API methods
- Changing existing API behavior
- Adding new features
- Fixing incorrect documentation

### Documentation Locations

| Content | Location |
|---------|----------|
| API changes | `docs/guides/API_REFERENCE.md` |
| Architecture changes | `docs/architecture/` |
| New features | `docs/guides/IMPLEMENTATION_GUIDE.md` |
| Configuration changes | `docs/guides/CONFIGURATION.md` |

### Documentation Style

- Use clear, concise language
- Include code examples
- Keep examples runnable and tested
- Use tables for reference information

---

## Issue Guidelines

### Reporting Bugs

Include:
1. **Description**: What happened vs. what you expected
2. **Steps to reproduce**: Minimal code to reproduce
3. **Environment**: Node.js version, OS, MemoryJS version
4. **Error messages**: Full stack traces

```markdown
## Bug Description
Search results are not sorted by score

## Steps to Reproduce
```typescript
const results = await ctx.searchManager.searchRanked('test');
console.log(results.map(r => r.score));
// Expected: [0.9, 0.8, 0.7]
// Actual: [0.7, 0.9, 0.8]
```

## Environment
- Node.js: 18.17.0
- OS: macOS 14.0
- MemoryJS: 1.1.1

## Error Output
(none - wrong behavior)
```

### Feature Requests

Include:
1. **Use case**: Why you need this feature
2. **Proposed solution**: How it should work
3. **Alternatives**: Other solutions you considered

### Questions

- Check existing documentation first
- Search closed issues for similar questions
- Use GitHub Discussions for general questions

---

## Recognition

Contributors are recognized in:
- CHANGELOG.md for significant contributions
- GitHub contributors list
- Release notes for major features

---

## Questions?

- Open a GitHub Discussion
- Check `docs/development/` for detailed guides
- Review existing PRs for examples

Thank you for contributing to MemoryJS!
