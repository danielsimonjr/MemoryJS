/**
 * Compression Utility Module
 *
 * Provides brotli compression and decompression utilities using Node.js
 * built-in zlib module. No external dependencies required.
 *
 * Brotli offers 15-20% better compression than gzip, with 60-75%
 * compression typical for JSON data.
 *
 * @module utils/compressionUtil
 */

import { brotliCompress, brotliDecompress, constants } from 'zlib';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { COMPRESSION_CONFIG } from './constants.js';

// Promisify Node.js zlib functions for async/await usage
const compressAsync = promisify(brotliCompress);
const decompressAsync = promisify(brotliDecompress);

/**
 * Default output-size cap for decompression: 256 MB. Generous for graph
 * backups while preventing decompression bombs (a few-KB crafted `.br`
 * payload expanding to exhaust process memory).
 *
 * Override per call via `DecompressionOptions.maxOutputLength`, or globally
 * via the `MEMORY_MAX_DECOMPRESSED_BYTES` env var (positive integer, bytes).
 */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

/**
 * Resolve the effective decompression output cap:
 * explicit option > `MEMORY_MAX_DECOMPRESSED_BYTES` env var > 256 MB default.
 * Invalid env values (non-integer, <= 0) fall back to the default.
 */
function resolveMaxOutputLength(explicit?: number): number {
  if (explicit !== undefined && Number.isInteger(explicit) && explicit > 0) {
    return explicit;
  }
  const env = process.env.MEMORY_MAX_DECOMPRESSED_BYTES;
  if (env !== undefined && /^[1-9][0-9]*$/.test(env.trim())) {
    return Number.parseInt(env.trim(), 10);
  }
  return DEFAULT_MAX_DECOMPRESSED_BYTES;
}

/**
 * Options for decompression operations.
 */
export interface DecompressionOptions {
  /**
   * Maximum allowed decompressed output size in bytes. Exceeding it throws
   * a clear error naming the limit instead of exhausting memory.
   * @default 256 MB (or `MEMORY_MAX_DECOMPRESSED_BYTES` env var when set)
   */
  maxOutputLength?: number;
}

/**
 * Options for compression operations.
 */
export interface CompressionOptions {
  /**
   * Brotli quality level (0-11).
   * Higher values = better compression but slower.
   * @default 6
   */
  quality?: number;

  /**
   * Window size (10-24) for the LZ77 algorithm.
   * Larger windows = better compression for large files.
   * @default 22
   */
  lgwin?: number;

  /**
   * Compression mode hint.
   * - 'text': Optimized for UTF-8 text
   * - 'generic': General-purpose compression
   * @default 'generic'
   */
  mode?: 'text' | 'generic';
}

/**
 * Result of a compression operation.
 */
export interface CompressionResult {
  /** The compressed data as a Buffer */
  compressed: Buffer;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (compressedSize / originalSize). Lower is better. */
  ratio: number;
}

/**
 * Metadata about a compressed file for storage alongside the compressed data.
 */
export interface CompressionMetadata {
  /** Whether the data is compressed */
  compressed: boolean;
  /** Compression format used */
  compressionFormat: 'brotli' | 'none';
  /** Original size before compression in bytes */
  originalSize: number;
  /** Size after compression in bytes */
  compressedSize: number;
  /** Optional checksum of original data for integrity verification */
  originalChecksum?: string;
  /** ISO 8601 timestamp when compression was performed */
  createdAt: string;
}

/**
 * Check if a file path indicates brotli compression based on extension.
 *
 * Note: Brotli doesn't have reliable magic bytes for detection.
 * Using file extension (.br) is the recommended detection method.
 *
 * @param filePath - The file path to check
 * @returns True if the path ends with .br extension
 *
 * @example
 * ```typescript
 * hasBrotliExtension('backup.jsonl.br') // true
 * hasBrotliExtension('backup.jsonl')    // false
 * hasBrotliExtension('data.json')       // false
 * ```
 */
export function hasBrotliExtension(filePath: string): boolean {
  return filePath.endsWith(COMPRESSION_CONFIG.BROTLI_EXTENSION);
}

/**
 * Compress data using brotli algorithm.
 *
 * @param data - The data to compress (string or Buffer)
 * @param options - Compression options
 * @returns Compression result with compressed data and statistics
 *
 * @example
 * ```typescript
 * const jsonData = JSON.stringify({ entities: [...] });
 * const result = await compress(jsonData, { quality: 11 });
 * console.log(`Compressed from ${result.originalSize} to ${result.compressedSize} bytes`);
 * console.log(`Compression ratio: ${(result.ratio * 100).toFixed(1)}%`);
 * ```
 */
export async function compress(
  data: Buffer | string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  const quality = options.quality ?? COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH;

  // Validate quality range
  if (quality < 0 || quality > 11) {
    throw new Error(`Invalid brotli quality level: ${quality}. Must be 0-11.`);
  }

  const zlibOptions: { params: Record<number, number> } = {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_MODE]:
        options.mode === 'text'
          ? constants.BROTLI_MODE_TEXT
          : constants.BROTLI_MODE_GENERIC,
    },
  };

  if (options.lgwin !== undefined) {
    if (options.lgwin < 10 || options.lgwin > 24) {
      throw new Error(
        `Invalid brotli window size: ${options.lgwin}. Must be 10-24.`
      );
    }
    zlibOptions.params[constants.BROTLI_PARAM_LGWIN] = options.lgwin;
  }

  const compressed = await compressAsync(input, zlibOptions);

  return {
    compressed,
    originalSize: input.length,
    compressedSize: compressed.length,
    ratio: input.length > 0 ? compressed.length / input.length : 1,
  };
}

/**
 * Decompress brotli-compressed data.
 *
 * Output size is capped (decompression-bomb guard, Sec8): by default 256 MB,
 * configurable via `options.maxOutputLength` or the
 * `MEMORY_MAX_DECOMPRESSED_BYTES` env var. Exceeding the cap throws an error
 * naming the limit.
 *
 * @param data - The compressed data as a Buffer
 * @param options - Decompression options (output-size cap)
 * @returns The decompressed data as a Buffer
 * @throws Error if decompression fails (corrupt or invalid data) or the
 *         decompressed output exceeds the configured cap
 *
 * @example
 * ```typescript
 * const compressed = await fs.readFile('backup.jsonl.br');
 * const decompressed = await decompress(compressed);
 * const jsonData = decompressed.toString('utf-8');
 * ```
 */
export async function decompress(
  data: Buffer,
  options: DecompressionOptions = {}
): Promise<Buffer> {
  if (!Buffer.isBuffer(data)) {
    throw new Error('Input must be a Buffer');
  }

  if (data.length === 0) {
    return Buffer.alloc(0);
  }

  const maxOutputLength = resolveMaxOutputLength(options.maxOutputLength);

  try {
    return await decompressAsync(data, { maxOutputLength });
  } catch (error) {
    if (isOutputLimitError(error)) {
      throw new Error(
        `Brotli decompression aborted: output exceeds the maximum allowed size of ` +
        `${maxOutputLength} bytes (decompression-bomb guard). Raise the limit via the ` +
        `maxOutputLength option or the MEMORY_MAX_DECOMPRESSED_BYTES env var if this ` +
        `payload is trusted.`
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Brotli decompression failed: ${message}`);
  }
}

/**
 * Detect Node's "output would exceed maxOutputLength" zlib failure
 * (`ERR_BUFFER_TOO_LARGE`) so it can be reported distinctly from
 * corrupt-input failures.
 */
function isOutputLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
  );
}

/**
 * Calculate compression ratio.
 *
 * @param originalSize - Original size in bytes
 * @param compressedSize - Compressed size in bytes
 * @returns Ratio as a decimal (e.g., 0.25 = 75% compression)
 *
 * @example
 * ```typescript
 * const ratio = getCompressionRatio(1000, 250);
 * console.log(`Compression ratio: ${(1 - ratio) * 100}%`); // "Compression ratio: 75%"
 * ```
 */
export function getCompressionRatio(
  originalSize: number,
  compressedSize: number
): number {
  if (originalSize <= 0) return 1;
  return compressedSize / originalSize;
}

/**
 * Compress a file and write the result to disk.
 *
 * @param inputPath - Path to the input file
 * @param outputPath - Path for the compressed output file
 * @param options - Compression options
 * @returns Compression result with statistics
 *
 * @example
 * ```typescript
 * const result = await compressFile(
 *   'memory.jsonl',
 *   'memory.jsonl.br',
 *   { quality: 11 }
 * );
 * console.log(`Saved ${result.originalSize - result.compressedSize} bytes`);
 * ```
 */
export async function compressFile(
  inputPath: string,
  outputPath: string,
  options?: CompressionOptions
): Promise<CompressionResult> {
  const input = await fs.readFile(inputPath);
  const result = await compress(input, options);
  await fs.writeFile(outputPath, result.compressed);
  return result;
}

/**
 * Decompress a file and write the result to disk.
 *
 * Output size is capped like {@link decompress} (256 MB default,
 * `options.maxOutputLength` / `MEMORY_MAX_DECOMPRESSED_BYTES` override).
 *
 * @param inputPath - Path to the compressed input file
 * @param outputPath - Path for the decompressed output file
 * @param options - Decompression options (output-size cap)
 * @throws Error if file not found, decompression fails, or the output
 *         exceeds the configured cap
 *
 * @example
 * ```typescript
 * await decompressFile('backup.jsonl.br', 'restored.jsonl');
 * ```
 */
export async function decompressFile(
  inputPath: string,
  outputPath: string,
  options: DecompressionOptions = {}
): Promise<void> {
  const input = await fs.readFile(inputPath);
  const decompressed = await decompress(input, options);
  await fs.writeFile(outputPath, decompressed);
}

/**
 * Create metadata object for a compression result.
 * This metadata should be stored alongside compressed files for
 * integrity verification and restoration.
 *
 * @param result - The compression result
 * @param checksum - Optional checksum of the original data
 * @returns Compression metadata object
 *
 * @example
 * ```typescript
 * const result = await compress(data);
 * const metadata = createMetadata(result);
 * await fs.writeFile('backup.meta.json', JSON.stringify(metadata, null, 2));
 * ```
 */
export function createMetadata(
  result: CompressionResult,
  checksum?: string
): CompressionMetadata {
  return {
    compressed: true,
    compressionFormat: 'brotli',
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    originalChecksum: checksum,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create metadata for uncompressed data.
 * Useful for consistent metadata format when compression is disabled.
 *
 * @param size - Size of the data in bytes
 * @returns Compression metadata indicating no compression
 */
export function createUncompressedMetadata(size: number): CompressionMetadata {
  return {
    compressed: false,
    compressionFormat: 'none',
    originalSize: size,
    compressedSize: size,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compress a string and return base64-encoded result.
 * Useful for embedding compressed data in JSON responses.
 *
 * @param data - String data to compress
 * @param options - Compression options
 * @returns Base64-encoded compressed data
 *
 * @example
 * ```typescript
 * const encoded = await compressToBase64(jsonString);
 * // Send in response: { compressed: true, data: encoded }
 * ```
 */
export async function compressToBase64(
  data: string,
  options?: CompressionOptions
): Promise<string> {
  const result = await compress(data, options);
  return result.compressed.toString('base64');
}

/**
 * Decompress base64-encoded compressed data.
 * Counterpart to compressToBase64.
 *
 * @param base64Data - Base64-encoded compressed data
 * @returns Decompressed string
 *
 * @example
 * ```typescript
 * const original = await decompressFromBase64(response.data);
 * const parsed = JSON.parse(original);
 * ```
 */
export async function decompressFromBase64(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const decompressed = await decompress(buffer);
  return decompressed.toString('utf-8');
}
