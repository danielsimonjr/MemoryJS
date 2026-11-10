# TF-IDF index statistics and persistence

`TFIDFIndexManager` maintains document frequencies during mutations. IDF reads compute `log(documentCount / documentFrequency)` on demand, avoiding a vocabulary-wide recalculation after each individual insertion or deletion. Batches retain their public API and prune obsolete term keys at their boundary.

`getIndex()` materializes the native IDF Map backing values before returning the existing index, so an immediate `structuredClone(manager.getIndex())` contains current statistics. Retained IDF map references provide current `get`, iteration and `forEach` values after mutations. Call `getIndex()` again before native cloning a retained reference: native cloning bypasses overridden Map readers. Internal ranked-search code uses `getIndexForSearch()` to avoid materializing the vocabulary for each query.

## Files and saves

The initial save writes `.indexes/tfidf-index.json` using a uniquely named temporary file and atomic rename. Subsequent `saveIndex()` calls append changed document records to `.indexes/tfidf-index.json.journal`; no full index JSON serialization is needed for a small change. Each save is awaited: there is no delayed timer or background persistence that needs flushing at close. Calls to save, load and clear are serialized through one lifecycle queue. A failed save rejects its caller and restores pending changes for retry.

After 256 journal records, the next save writes a fresh snapshot and clears the journal. Every snapshot has a generation ID; journal entries from an older snapshot generation are ignored. Thus a crash between replacing a snapshot and clearing its old journal cannot replay old data over the newer snapshot. A failed save forces a full snapshot on retry. This is atomic replacement and completed-record recovery, not an fsync-based guarantee against power loss.

On load, only complete newline-terminated journal records are replayed. An interrupted final append is discarded and truncated before future writes. A malformed complete record invalidates the cached index load (which returns `undefined`, allowing the normal rebuild path); it is not silently treated as valid data. Document deletion and recreation preserve document insertion order across replay, including coalesced changes.

Legacy snapshots without generation IDs remain readable. The next save migrates them to the snapshot-plus-journal format. Calling `clearIndex()` removes both files. An index is a rebuildable search cache; the knowledge graph remains the authoritative record.

## Direct index edits

Use manager document mutation methods for incremental persistence. If a caller edits returned document vectors or Map contents directly, pass the index explicitly to `saveIndex(index)` to request a complete snapshot. Explicit saves always write a full snapshot, even when the argument is the manager's cached index. After saving an external index, the next save of the manager's own index also writes a snapshot, preventing cross-generation journal replay.

Changes to index build/mutation state while an asynchronous load is in flight prevent that load from replacing the newer in-memory generation. A build during a snapshot write keeps the new generation marked for its own subsequent snapshot.
