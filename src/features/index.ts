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

// Phase 2C: Auto-Linking
export {
  AutoLinker,
  type AutoLinkOptions,
  type AutoLinkResult,
} from './AutoLinker.js';

// Phase 3B: Fact Extraction
export {
  FactExtractor,
  type ExtractedFact,
  type FactExtractionOptions,
  type FactExtractionResult,
} from './FactExtractor.js';

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

// Feature 8: Dynamic Memory Governance
export {
  AuditLog,
  type AuditEntry,
  type AuditOperation,
  type AuditFilter,
  type AuditStats,
} from './AuditLog.js';
export {
  GovernanceManager,
  GovernanceTransaction,
  type GovernancePolicy,
  type GovernanceOperationOptions,
} from './GovernanceManager.js';

// Freshness Management
export {
  FreshnessManager,
  type FreshnessManagerConfig,
  type FreshnessReport,
} from './FreshnessManager.js';

// Feature 2: Contradiction Detection (v1.8.0)
export { ContradictionDetector } from './ContradictionDetector.js';
export type { Contradiction } from './ContradictionDetector.js';

// Feature 3: Semantic Forget (v1.8.0)
export { SemanticForget } from './SemanticForget.js';
export type { SemanticForgetResult, SemanticForgetOptions } from './SemanticForget.js';
