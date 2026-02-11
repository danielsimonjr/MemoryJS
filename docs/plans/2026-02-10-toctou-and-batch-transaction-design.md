# Design: TOCTOU Race Fix (M1) & BatchTransaction Partial Save (M4)

**Date:** 2026-02-10
**Status:** Approved

## Problem

### M1: TOCTOU Race in createEntities/createRelations
`EntityManager.createEntities` and `RelationManager.createRelations` call `loadGraph()` for validation, then `getGraphForMutation()` for mutation. Between these two calls, a concurrent caller can modify the graph, invalidating the first caller's validation (e.g., duplicate entity names, entity count exceeding limits).

### M4: BatchTransaction Partial Save on stopOnError:false
When `stopOnError: false`, failed operations set `result.success = false` but the graph is still saved with all successful mutations. The caller has no way to know which operations succeeded and which failed — only the last error is reported.

## Solution

### AsyncMutex (new utility)
A promise-based queue (~30 lines) in `src/utils/AsyncMutex.ts`:

```typescript
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise(resolve => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  get isLocked(): boolean { return this.locked; }
  get queueLength(): number { return this.queue.length; }
}
```

### M1 Fix: Operation-Level Mutex
Each manager gets its own `AsyncMutex` instance. The critical section (validate + mutate + save) is wrapped in `mutex.acquire()` / `release()`.

**EntityManager.createEntities:** Replace separate `loadGraph()` + `getGraphForMutation()` with a single `getGraphForMutation()` inside the lock. Use the mutable copy for both validation and mutation.

**RelationManager.createRelations:** Same pattern — single `getGraphForMutation()` inside the lock for both validation and mutation.

### M4 Fix: Per-Operation Result Tracking
Add `OperationResult` type and `operationResults` array to `BatchResult`:

```typescript
interface OperationResult {
  index: number;
  success: boolean;
  error?: string;
}

interface BatchResult {
  // ...existing fields...
  operationResults?: OperationResult[];
}
```

When `stopOnError: false`, collect per-operation results. Set `result.error` to a summary like "3 of 10 operations failed" instead of just the last error.

## Files Changed

| File | Change |
|------|--------|
| `src/utils/AsyncMutex.ts` | **New** — AsyncMutex class |
| `src/utils/index.ts` | Export AsyncMutex |
| `src/core/EntityManager.ts` | Add mutex, consolidate to single getGraphForMutation() |
| `src/core/RelationManager.ts` | Add mutex, consolidate to single getGraphForMutation() |
| `src/core/TransactionManager.ts` | Add OperationResult tracking in execute() |
| `src/types/types.ts` | Add OperationResult type, extend BatchResult |

## Testing Strategy

- **AsyncMutex unit tests:** Serialization, concurrent acquire, release ordering
- **EntityManager concurrent test:** Two concurrent `createEntities` calls with overlapping names — verify no duplicates
- **BatchTransaction test:** `stopOnError: false` with mixed success/failure — verify `operationResults` array
