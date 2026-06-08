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

export {
  ABACPolicy,
  type ABACContext,
  type ABACCondition,
  type ABACDecision,
  type ABACEffect,
  type ABACOp,
  type ABACRule,
} from './ABACPolicy.js';

export {
  RowLevelFilter,
  type RowPredicate,
} from './RowLevelFilter.js';

export {
  APIKeyStore,
  type IssueOptions,
  type IssueResult,
  type KeyRecord,
  type ValidationResult as APIKeyValidationResult,
} from './APIKeyStore.js';
