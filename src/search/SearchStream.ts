/**
 * Search Stream
 *
 * `AsyncIterable` adapters over the existing search APIs. Returns
 * results progressively so callers that need only the top-N can
 * `break` from `for await` and avoid materialising the full set.
 *
 * Phase 3 step 30 — composes over `SearchManager` rather than rewriting
 * each search method. Two adapters:
 *
 *   - `streamArrayInChunks` — generic helper that yields an array in
 *     fixed-size chunks via `setImmediate` so the loop body gets to
 *     run between chunks (lets callers break early without blocking
 *     the event loop).
 *   - `streamMergedByScore` — priority-queue merge over multiple
 *     ranked subsystems, yielding the highest-scoring result first.
 *     Used by hybrid search to surface top-K with minimum latency.
 *
 * @module search/SearchStream
 */

/** A single scored item — the minimum shape the merger needs. */
export interface ScoredItem<T = unknown> {
  /** Higher = more relevant. */
  score: number;
  /** Caller-defined payload (typically an `Entity` or its name). */
  value: T;
}

/**
 * Yield a fully-materialised array progressively. Useful as the
 * "drop-in" adapter that turns `SearchManager.searchNodes(query)` into
 * a streamable thing without changing the underlying call.
 *
 * @example
 * ```typescript
 * const all = await searchManager.searchNodes(query);
 * for await (const result of streamArrayInChunks(all, 10)) {
 *   if (gotEnough(result)) break; // stops without materialising the rest
 * }
 * ```
 */
export async function* streamArrayInChunks<T>(
  source: readonly T[],
  chunkSize: number = 10,
): AsyncIterable<T> {
  // Local — never mutate the function parameter.
  const size = chunkSize <= 0 ? 1 : chunkSize;
  for (let i = 0; i < source.length; i++) {
    yield source[i]!;
    if ((i + 1) % size === 0 && i + 1 < source.length) {
      // Yield the event loop so a `break` from the consumer's `for await`
      // is observed promptly. Cheap; on a few-hundred-element batch this
      // adds <1 ms of latency to the full traversal.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

/**
 * Priority-queue merge over multiple `AsyncIterable<ScoredItem>`
 * sources. Yields highest-scoring results first, regardless of which
 * source produced them.
 *
 * Each source is "peeked" eagerly: the merger pulls one item from each
 * iterator, picks the highest, and advances only that source. Sources
 * that exhaust drop out of the queue.
 *
 * **Precondition:** every source MUST yield items in non-increasing
 * score order. The merger only inspects head positions, so a
 * non-monotone source silently produces a globally non-monotone
 * output stream — there is no runtime check. Hybrid-search callers
 * already sort their layer outputs before adapting them, so this
 * holds in practice; document the contract at every adapter site.
 *
 * Useful for hybrid search where lexical / semantic / symbolic layers
 * each yield ranked results — callers see the global top-K before any
 * single layer finishes.
 */
export async function* streamMergedByScore<T>(
  sources: ReadonlyArray<AsyncIterable<ScoredItem<T>>>,
): AsyncIterable<ScoredItem<T>> {
  // Per-source iterator + the most recent peek from each.
  type Slot = {
    iter: AsyncIterator<ScoredItem<T>>;
    head: ScoredItem<T> | null;
    done: boolean;
  };

  const slots: Slot[] = sources.map((s) => ({
    iter: s[Symbol.asyncIterator](),
    head: null,
    done: false,
  }));

  // Initial peek on every slot.
  for (const slot of slots) {
    const next = await slot.iter.next();
    if (next.done) {
      slot.done = true;
    } else {
      slot.head = next.value;
    }
  }

  for (;;) {
    // Find the slot with the highest-scoring head.
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.done || slot.head === null) continue;
      if (slot.head.score > bestScore) {
        bestScore = slot.head.score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return; // every source exhausted

    const slot = slots[bestIdx]!;
    const head = slot.head!;
    yield head;

    // Advance the chosen slot.
    const next = await slot.iter.next();
    if (next.done) {
      slot.done = true;
      slot.head = null;
    } else {
      slot.head = next.value;
    }
  }
}

/**
 * Convenience: collect an `AsyncIterable` into an array, optionally
 * capped at `limit` items. Mirrors a common consumer pattern so call
 * sites don't repeat the boilerplate.
 */
export async function collectStream<T>(
  source: AsyncIterable<T>,
  limit: number = Infinity,
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
