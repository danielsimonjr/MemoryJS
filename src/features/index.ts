/**
 * Features Module Barrel Export
 * Phase 4: Re-extracted specialized managers for single responsibility
 * Phase 7: Added streaming export utilities
 */

export { TagManager } from './TagManager.js';
export {
  IOManager,
  type ExportFormat,
  type ImportFormat,
  type MergeStrategy,
  type BackupMetadata,
  type BackupInfo,
} from './IOManager.js';
export { AnalyticsManager } from './AnalyticsManager.js';
export { CompressionManager } from './CompressionManager.js';
export {
  ArchiveManager,
  type ArchiveCriteria,
  type ArchiveOptions,
  type ArchiveResult,
} from './ArchiveManager.js';
export { StreamingExporter, type StreamResult } from './StreamingExporter.js';

// Phase 11 Sprint 5: Semantic Compression
export {
  ObservationNormalizer,
  type NormalizationOptions,
  type NormalizationResult,
} from './ObservationNormalizer.js';
export {
  KeywordExtractor,
  type ScoredKeyword,
} from './KeywordExtractor.js';
