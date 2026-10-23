/**
 * JSONL map file codec
 *
 * Converts between map entries and JSONL text. Each line holds one JSON
 * object. The key and the value sit in two fields whose names the caller
 * chooses. The codec does not touch files or locks. The caller reads and
 * writes the text.
 *
 * @module utils/jsonlMapFile
 */

import { logger } from './logger.js';

/** Field names of one JSONL map line. */
export interface JsonlMapFormat {
  /** Field that holds the map key. */
  keyField: string;
  /** Field that holds the map value. */
  valueField: string;
}

/** Options for {@link parseJsonlMapLines}. */
export interface JsonlMapParseOptions extends JsonlMapFormat {
  /** Text that starts each warning, for example `DiskWarmTier(warm)`. */
  warnPrefix: string;
  /** Word that names the key in the warning for a non-string key, for example `key`. */
  keyLabel: string;
  /** File path that each warning names. */
  filePath: string;
}

/**
 * Parses JSONL map text into a map.
 *
 * Blank lines are skipped. A line that is not valid JSON is skipped with a
 * warning. A line whose key field is not a string is skipped with a warning.
 * A later line with the same key replaces the earlier value.
 *
 * @param raw - JSONL text to parse
 * @param options - Field names and warning texts
 * @returns Map from key to value, in file order
 */
export function parseJsonlMapLines<V>(raw: string, options: JsonlMapParseOptions): Map<string, V> {
  const { keyField, valueField, warnPrefix, keyLabel, filePath } = options;
  const map = new Map<string, V>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const key = parsed[keyField];
      if (typeof key !== 'string') {
        logger.warn(`${warnPrefix}: skipping line with non-string ${keyLabel} in ${filePath}`);
        continue;
      }
      map.set(key, parsed[valueField] as V);
    } catch {
      logger.warn(`${warnPrefix}: skipping malformed line in ${filePath}`);
    }
  }
  return map;
}

/**
 * Serialises a map to JSONL text, with one line per entry in map order.
 *
 * An empty map gives an empty string. Otherwise every line ends with a
 * newline character.
 *
 * @param map - Entries to serialise
 * @param format - Field names for the key and the value
 * @returns JSONL text
 */
export function serializeJsonlMap<V>(map: ReadonlyMap<string, V>, format: JsonlMapFormat): string {
  const lines: string[] = [];
  for (const [key, value] of map) {
    lines.push(JSON.stringify({ [format.keyField]: key, [format.valueField]: value }));
  }
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}
