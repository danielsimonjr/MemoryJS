/**
 * Updates a map entry and flushes; restores the prior entry if flush fails.
 */
export async function mutateMapWithFlushRollback<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  flush: (map: Map<K, V>) => Promise<void>,
): Promise<void> {
  const hadPrior = cache.has(key);
  const priorValue = hadPrior ? cache.get(key)! : undefined;
  cache.set(key, value);
  try {
    await flush(cache);
  } catch (err) {
    if (hadPrior) cache.set(key, priorValue!);
    else cache.delete(key);
    throw err;
  }
}

/**
 * Clears `cache` and flushes. On flush failure, puts the snapshotted entries back
 * in their previous order and rethrows. An empty cache returns before flush.
 */
export async function clearMapWithFlushRollback<K, V>(
  cache: Map<K, V>,
  flush: (map: Map<K, V>) => Promise<void>,
): Promise<void> {
  if (cache.size === 0) {
    return;
  }
  const priorSnapshot = new Map(cache);
  cache.clear();
  try {
    await flush(cache);
  } catch (err) {
    for (const [k, v] of priorSnapshot) {
      cache.set(k, v);
    }
    throw err;
  }
}
