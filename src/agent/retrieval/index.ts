/**
 * Active Retrieval Module — Barrel Export (3B.5)
 *
 * @module agent/retrieval
 */

export {
  QueryRewriter,
  type RewriteResult,
} from './QueryRewriter.js';

export {
  ActiveRetrievalController,
  type RetrievalContext,
  type RetrievalDecision,
  type RetrievalRound,
  type AdaptiveResult,
  type ActiveRetrievalConfig,
} from './ActiveRetrievalController.js';
