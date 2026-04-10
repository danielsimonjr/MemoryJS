/**
 * Contradiction Detector
 *
 * Detects when new observations contradict existing ones using semantic
 * similarity. Feature 2 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/ContradictionDetector
 */

import type { Entity } from '../types/types.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';

export interface Contradiction {
  /** Existing observation on the entity */
  existingObservation: string;
  /** New observation attempting to be added */
  newObservation: string;
  /** Cosine similarity score (0-1) */
  similarity: number;
}

export class ContradictionDetector {
  constructor(
    private semanticSearch: SemanticSearch,
    private threshold: number = 0.85
  ) {}

  /**
   * Check if any new observation contradicts an existing observation on the entity.
   *
   * Contradiction = high semantic similarity but not exact match. Two facts
   * about the same subject with different values (e.g. "Lives in NYC" vs
   * "Lives in SF") will be semantically close but textually different.
   */
  async detect(
    entity: Entity,
    newObservations: string[]
  ): Promise<Contradiction[]> {
    if (entity.observations.length === 0) return [];
    if (newObservations.length === 0) return [];

    const contradictions: Contradiction[] = [];

    for (const newObs of newObservations) {
      for (const existingObs of entity.observations) {
        if (newObs === existingObs) continue; // skip exact matches
        const similarity = await this.semanticSearch.calculateSimilarity(
          newObs,
          existingObs
        );
        if (similarity >= this.threshold) {
          contradictions.push({
            existingObservation: existingObs,
            newObservation: newObs,
            similarity,
          });
        }
      }
    }

    return contradictions;
  }
}
