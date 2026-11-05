/**
 * Token Estimation Helpers
 *
 * Cheap, dependency-free token estimate: whitespace word count multiplied by
 * a caller-supplied factor and rounded up. Shared by the agent context and
 * formatting code so the heuristic is defined once.
 *
 * @module utils/tokenEstimate
 */

/**
 * Estimate the token count of a text as `ceil(wordCount * multiplier)`.
 *
 * Words are maximal runs of non-whitespace characters. Empty and
 * whitespace-only text has zero words and therefore estimates to 0.
 * The product is computed in floating point and then rounded up, so
 * a multiplier such as 1.1 can add one token at exact boundaries
 * (for example 3 words yields 4, because 3 * 1.1 is 3.3000000000000003).
 *
 * @param text - Text to estimate
 * @param multiplier - Tokens per word (typically 1.3)
 * @returns Estimated token count (non-negative integer)
 */
export function estimateTokensFromText(text: string, multiplier: number): number {
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.ceil(wordCount * multiplier);
}
