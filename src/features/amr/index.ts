/**
 * @module features/amr/index
 * @experimental
 * Barrel for the Agent Memory Repo codec.
 */
export * from './AmrCodec.js';
export {
  AMR_READER_DEFAULTS,
  checkAmrLink,
  readAmrFile,
  loadAmrContext,
  findCaseDuplicates,
  checkAmr,
  walkAmrMarkdown,
  type AmrCheckOptions,
  type AmrReaderOptions,
  type AmrLinkCheck,
  type AmrLinkReason,
  type AmrReadResult,
  type AmrContext,
  type AmrIssue,
  type AmrIssueCode,
  type AmrCheckReport,
} from './AmrReader.js';
export { AMR_GIT_DEFAULTS, AmrGitError, GitRunner, type GitRunnerConfig, type GitRunResult, type GitCleanCheck, type GitCommitResult, type AmrGitErrorCode } from './GitRunner.js';
export {
  DEFAULT_SECRET_PATTERNS,
  loadSecretPatterns,
  scanForSecrets,
  validateSecretPatterns,
  type SecretPattern,
  type SecretHit,
} from './SecretScanner.js';
export {
  writeAmrFile,
  writeAmrFiles,
  commitAmrEdits,
  AMR_COMMIT_MESSAGE_MAX_CHARS,
  checkAmrWritePath,
  checkFileText,
  type AmrFileRefusal,
  type AmrWriteOptions,
  type AmrWriteResult,
  type AmrWriteReason,
  type AmrFileText,
  type AmrBatchResult,
  type AmrEditOptions,
} from './AmrWriter.js';
export { parseFrontMatter, renderFrontMatter, type FrontMatterValues, type FrontMatterParse } from './AmrFrontMatter.js';
export {
  AMR_SYNC_DEFAULTS,
  amrPathForEntity,
  exportAmr,
  importAmr,
  normalizeObservation,
  type AmrSyncDefaults,
  type AmrSyncMode,
  type AmrSyncOptions,
  type AmrFileReport,
  type AmrExportReport,
  type AmrImportEntity,
  type AmrImportOptions,
  type AmrImportReport,
} from './AmrSync.js';
