/**
 * Sidecar path derivation.
 *
 * Several subsystems keep a companion file next to the main storage file
 * (saved searches, tag aliases, ref index, audit log, tiered-index shards).
 * All of them use the same `<dir>/<basename><suffix><ext>` shape, so the
 * derivation lives here instead of being repeated at each call site.
 *
 * @module utils/sidecarPath
 * @internal
 */

import path from 'path';

/**
 * Derive a sidecar file path from a storage file path.
 *
 * The result is `<dir>/<basename><suffix><ext>`, where `basename` is the
 * storage file name without its final extension. `suffix` is appended
 * verbatim, so it normally includes its leading hyphen (for example
 * `'-audit'`). Paths are assembled with `path.join`, so separators are
 * platform-correct.
 *
 * @example
 * sidecarPath('/data/memory.db', '-audit')          // '/data/memory-audit.jsonl'
 * sidecarPath('/data/memory.v2.jsonl', '-audit')    // '/data/memory.v2-audit.jsonl'
 * sidecarPath('/data/memory', '-tiered-cold', '.jsonl.br') // '/data/memory-tiered-cold.jsonl.br'
 *
 * @param storageFilePath - Path of the primary storage file.
 * @param suffix - Text inserted between the basename and the extension.
 * @param ext - Extension for the sidecar, including the leading dot.
 * @returns The derived sidecar path.
 * @internal
 */
export function sidecarPath(storageFilePath: string, suffix: string, ext = '.jsonl'): string {
  const dir = path.dirname(storageFilePath);
  const basename = path.basename(storageFilePath, path.extname(storageFilePath));
  return path.join(dir, `${basename}${suffix}${ext}`);
}
