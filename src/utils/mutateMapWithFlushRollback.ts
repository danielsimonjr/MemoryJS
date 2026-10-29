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
