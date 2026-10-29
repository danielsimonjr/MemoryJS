import { durableWriteFile } from './durableWriteFile.js';

/**
 * Writes JSONL records to a file and updates the in-memory cache on success.
 */
export async function writeJsonlRecordsUpdatingCache<T>(
  filePath: string,
  records: readonly T[],
  onWriteFailure: () => void,
  onWriteSuccess: (records: T[]) => void,
): Promise<void> {
  const text = records.map(record => JSON.stringify(record)).join('\n');
  try {
    await durableWriteFile(filePath, text);
  } catch (err) {
    onWriteFailure();
    throw err;
  }
  onWriteSuccess(records as T[]);
}

/**
 * Removes every record whose key matches and saves when the list shrinks.
 */
export async function deleteRecordsByKey<T>(
  load: () => Promise<T[]>,
  save: (records: T[]) => Promise<void>,
  keyOf: (record: T) => string,
  key: string,
): Promise<boolean> {
  const records = await load();
  const initialLength = records.length;
  const filtered = records.filter(record => keyOf(record) !== key);
  if (filtered.length === initialLength) {
    return false;
  }
  await save(filtered);
  return true;
}
