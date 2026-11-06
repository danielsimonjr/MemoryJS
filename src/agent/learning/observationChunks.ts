/**
 * Chunked observation storage for leaf-learner records (Recursa RS-18).
 *
 * Entity observations are capped at 5000 characters (`observationSchema`). A serialized run or
 * task list is therefore stored as numbered observations `<tag> i/n] <chunk>`, each at most
 * {@link OBSERVATION_CHUNK_CHARS} characters. Internal to the learning trace.
 *
 * @module agent/learning/observationChunks
 * @internal
 */

/**
 * Characters per stored observation chunk. Entity observations are capped at 5000 characters
 * (`observationSchema`), so a larger serialized record is split across numbered observations.
 */
export const OBSERVATION_CHUNK_CHARS = 4000;

/**
 * Split text into pieces of at most `size` UTF-16 units, never splitting a surrogate pair.
 *
 * @param text - Text to split.
 * @param size - Maximum units per piece.
 * @returns The pieces in order (one empty piece for empty text).
 */
export function splitForObservations(text: string, size: number = OBSERVATION_CHUNK_CHARS): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push(text.slice(start, end));
    start = end;
  }
  return out.length > 0 ? out : [''];
}

/**
 * Encode a serialized record as numbered observations under `tag`.
 *
 * @param tag - Observation tag, e.g. `[leaf-state`.
 * @param text - Serialized record.
 * @returns One observation per chunk, in order.
 */
export function encodeChunks(tag: string, text: string): string[] {
  const parts = splitForObservations(text);
  return parts.map((part, i) => `${tag} ${i + 1}/${parts.length}] ${part}`);
}

/**
 * Whether an observation belongs to a tag.
 *
 * @param observation - Observation text.
 * @param tag - Observation tag.
 * @returns True for every chunk of that tag.
 */
export function isTagged(observation: string, tag: string): boolean {
  return observation.startsWith(`${tag} `);
}

/**
 * Reassemble a record from its numbered observations.
 *
 * @param observations - Observations of the trace.
 * @param tag - Observation tag.
 * @returns The serialized record, or `undefined` when no chunk exists.
 * @throws Error when the chunks are incomplete or inconsistent, or the indices are not exactly `1..n`.
 */
export function decodeChunks(observations: readonly string[], tag: string): string | undefined {
  const parts: Array<{ index: number; total: number; text: string }> = [];
  for (const observation of observations) {
    if (!isTagged(observation, tag)) continue;
    const match = /^(\d+)\/(\d+)\] /.exec(observation.slice(tag.length + 1));
    if (!match) throw new Error(`LearningTrace: malformed ${tag}] observation`);
    parts.push({ index: Number(match[1]), total: Number(match[2]), text: observation.slice(tag.length + 1 + match[0].length) });
  }
  if (parts.length === 0) return undefined;
  const total = parts[0]!.total;
  if (parts.length !== total || parts.some((p) => p.total !== total)) throw new Error(`LearningTrace: ${tag}] observations are incomplete`);
  parts.sort((a, b) => a.index - b.index);
  // Indices must be exactly 1..n: no duplicate, none out of range.
  if (parts.some((p, i) => p.index !== i + 1)) throw new Error(`LearningTrace: ${tag}] observations have duplicate or out-of-range indices`);
  return parts.map((p) => p.text).join('');
}
