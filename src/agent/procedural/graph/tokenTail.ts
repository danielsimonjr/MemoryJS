/**
 * Token-tail truncation and deterministic trajectory concatenation (PG-14).
 *
 * Refiner trajectory context retains the final `Lmax` tokens of concatenated
 * training trajectories, dropping excess tokens from the beginning while
 * preserving final-token order. Parallel rollout results are concatenated in
 * deterministic input (batch/task) order, not completion order.
 *
 * @module agent/procedural/graph/tokenTail
 * @experimental
 */

import type { PGTrajectory } from '../../../types/proceduralGraph.js';

export interface PGTokenizer {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

/**
 * Keep the final `maxTokens` tokens of `text`, order preserved.
 * Input that already encodes to `maxTokens` tokens or fewer is returned unchanged.
 */
export function tokenTail(text: string, maxTokens: number, tokenizer: PGTokenizer): string {
  const tokens = tokenizer.encode(text);
  if (tokens.length <= maxTokens) {
    return text;
  }
  const kept = maxTokens > 0 ? tokens.slice(-maxTokens) : [];
  return tokenizer.decode(kept);
}

/**
 * Concatenate trajectories in the given array order.
 * Each block is `### Task <id> (score <score>)` followed by one
 * `Action` / `Observation` pair per step.
 */
export function concatTrajectories(trajectories: readonly PGTrajectory[]): string {
  const blocks: string[] = [];
  for (const trajectory of trajectories) {
    const lines: string[] = [`### Task ${trajectory.taskId} (score ${trajectory.score})`];
    for (const step of trajectory.steps) {
      lines.push(`Action: ${step.action}`);
      lines.push(`Observation: ${step.observation ?? ''}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n');
}
