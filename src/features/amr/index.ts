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
export { writeAmrFile, type AmrWriteOptions, type AmrWriteResult, type AmrWriteReason } from './AmrWriter.js';
