## Task 6: Zero-config semantic search

**Files:**
- Modify: `src/core/ManagerContext.ts`
- Test: `tests/unit/core/manager-context-default-embedding.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/manager-context-default-embedding.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Zero-config semantic search default', () => {
  const originalEnv = process.env.MEMORY_EMBEDDING_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MEMORY_EMBEDDING_PROVIDER;
    } else {
      process.env.MEMORY_EMBEDDING_PROVIDER = originalEnv;
    }
  });

  it('defaults embedding provider to local when env var not set', () => {
    delete process.env.MEMORY_EMBEDDING_PROVIDER;
    // Re-import to pick up changed env
    const { getEmbeddingConfig } = require('../../../src/utils/constants.js');
    const config = getEmbeddingConfig();
    expect(config.provider).toBe('local');
  });

  it('respects explicit none setting', () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const { getEmbeddingConfig } = require('../../../src/utils/constants.js');
    const config = getEmbeddingConfig();
    expect(config.provider).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/manager-context-default-embedding.test.ts`

- [ ] **Step 3: Change default in constants**

Find `src/utils/constants.ts` or wherever `getEmbeddingConfig` is defined. Change the default provider from `'none'` to `'local'`:

```typescript
// Before:
const provider = process.env.MEMORY_EMBEDDING_PROVIDER || 'none';

// After:
const provider = process.env.MEMORY_EMBEDDING_PROVIDER || 'local';
```

Also add a graceful fallback in the `SemanticSearch` constructor or `EmbeddingService` initialization: if `local` provider fails to initialize (ONNX not available), log a warning and fall back to `none`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/manager-context-default-embedding.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -5`
Expected: no new failures (some existing tests may need `MEMORY_EMBEDDING_PROVIDER=none` if they don't want embeddings).

- [ ] **Step 6: Commit**

```
feat(search): Default embedding provider to local (zero-config semantic)

Semantic search now works out of the box without setting
MEMORY_EMBEDDING_PROVIDER. Defaults to 'local' (ONNX MiniLM model).
Falls back to 'none' if ONNX runtime unavailable.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
