/**
 * Half-Life Utilities
 *
 * Exponential half-life decay factor shared by the decay, recency and freshness code.
 *
 * @module utils/halfLife
 */

/**
 * Returns `exp(-(ln 2 / halfLifeHours) * ageHours)`.
 * Returns 1 at age 0 and 0.5 after one half-life.
 * This function does not clamp the result.
 * This function does not check its inputs.
 * The caller decides how to floor the age or clamp the result.
 * The operation order is fixed, so every caller gets the same floating-point result.
 *
 * @param ageHours - The elapsed age in hours.
 * @param halfLifeHours - The half-life period in hours.
 * @returns The decay factor for the given age and half-life.
 */
export function halfLifeFactor(ageHours: number, halfLifeHours: number): number {
  return Math.exp(-(Math.LN2 / halfLifeHours) * ageHours);
}

/**
 * Returns the clamped half-life score of a timestamp.
 * An empty timestamp returns 0. A future timestamp clamps to 1.
 * An unparseable timestamp still produces NaN, matching both callers.
 */
export function clampedHalfLifeScore(timestamp: string, halfLifeHours: number): number {
  if (!timestamp) {
    return 0;
  }
  const lastAccess = new Date(timestamp).getTime();
  const now = Date.now();
  const hoursSinceAccess = (now - lastAccess) / (1000 * 60 * 60);
  const score = halfLifeFactor(hoursSinceAccess, halfLifeHours);
  return Math.max(0, Math.min(1, score));
}
