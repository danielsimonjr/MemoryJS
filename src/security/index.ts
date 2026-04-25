/**
 * Security Module — Barrel Export (η.6.3)
 *
 * @module security
 */

export {
  PiiRedactor,
  DEFAULT_PII_PATTERNS,
  type PiiPattern,
  type PiiRedactorOptions,
  type RedactionStats,
  type RedactionResult,
} from './PiiRedactor.js';
