/**
 * Proximity Search
 *
 * Finds entities where terms appear within a specified distance.
 * Phase 1 Sprint 8: Full-Text Search Operators.
 *
 * @module search/ProximitySearch
 */

import type { Entity } from '../types/types.js';
import type { ProximityNode } from '../types/search.js';

/**
 * Result of a proximity match.
 */
export interface ProximityMatch {
  /** The matched entity */
  entity: Entity;
  /** Score based on proximity (closer = higher) */
  score: number;
  /** Minimum distance found between terms */
  minDistance: number;
  /** Detailed match locations */
  matches: ProximityMatchLocation[];
}

/**
 * Location where proximity match was found.
 */
export interface ProximityMatchLocation {
  /** Field where match was found */
  field: string;
  /** Term positions in the text */
  positions: Map<string, number[]>;
  /** Distance between terms */
  distance: number;
}

/**
 * Proximity search implementation.
 *
 * @example
 * ```typescript
 * const search = new ProximitySearch();
 *
 * // Find entities where "machine" and "learning" appear within 3 words
 * const results = search.search(entities, {
 *   type: 'proximity',
 *   terms: ['machine', 'learning'],
 *   distance: 3
 * });
 * ```
 */
export class ProximitySearch {
  /**
   * Search for entities where terms appear within distance.
   */
  search(entities: Entity[], node: ProximityNode): ProximityMatch[] {
    const results: ProximityMatch[] = [];

    for (const entity of entities) {
      const match = this.matchEntity(entity, node);
      if (match) {
        results.push(match);
      }
    }

    // Sort by score (closer = higher)
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Check if entity matches the proximity query.
   */
  private matchEntity(entity: Entity, node: ProximityNode): ProximityMatch | null {
    const locations: ProximityMatchLocation[] = [];
    let minDistance = Infinity;

    // Check entity name
    const nameDistance = this.findProximity(entity.name, node.terms);
    if (nameDistance !== null && nameDistance <= node.distance) {
      locations.push({
        field: 'name',
        positions: this.getPositions(entity.name, node.terms),
        distance: nameDistance,
      });
      minDistance = Math.min(minDistance, nameDistance);
    }

    // Check observations
    for (const obs of entity.observations || []) {
      const distance = this.findProximity(obs, node.terms);
      if (distance !== null && distance <= node.distance) {
        locations.push({
          field: 'observation',
          positions: this.getPositions(obs, node.terms),
          distance,
        });
        minDistance = Math.min(minDistance, distance);
      }
    }

    if (locations.length === 0) return null;

    // Score: higher for closer matches
    // 1.0 for adjacent terms, decreasing as distance increases
    const score = 1 / (1 + minDistance);

    return {
      entity,
      score,
      minDistance,
      matches: locations,
    };
  }

  /**
   * Find minimum distance between all terms in text.
   * Returns null if any term is not found.
   */
  private findProximity(text: string, terms: string[]): number | null {
    if (terms.length === 0) return null;
    if (terms.length === 1) return 0; // Single term is always "adjacent" to itself

    const words = text.toLowerCase().split(/\s+/);
    const positions = new Map<string, number[]>();

    // Find all positions of each term
    for (const term of terms) {
      const termPositions: number[] = [];
      for (let i = 0; i < words.length; i++) {
        // Check for exact match or contains
        if (words[i] === term || words[i].includes(term)) {
          termPositions.push(i);
        }
      }
      if (termPositions.length === 0) return null; // Term not found
      positions.set(term, termPositions);
    }

    // Find minimum span containing all terms
    return this.findMinSpan(positions, terms);
  }

  /**
   * Find minimum span containing all terms.
   */
  private findMinSpan(positions: Map<string, number[]>, terms: string[]): number {
    const allPositions = terms.map((t) => positions.get(t)!);
    let minSpan = Infinity;

    // Use recursive approach to find minimum span
    // (For small number of terms, this is efficient enough)
    const findMin = (index: number, selected: number[]): void => {
      if (index === allPositions.length) {
        const span = Math.max(...selected) - Math.min(...selected);
        minSpan = Math.min(minSpan, span);
        return;
      }

      for (const pos of allPositions[index]) {
        findMin(index + 1, [...selected, pos]);
      }
    };

    findMin(0, []);
    return minSpan;
  }

  /**
   * Get positions of all terms in text.
   */
  private getPositions(text: string, terms: string[]): Map<string, number[]> {
    const words = text.toLowerCase().split(/\s+/);
    const positions = new Map<string, number[]>();

    for (const term of terms) {
      const termPositions: number[] = [];
      for (let i = 0; i < words.length; i++) {
        if (words[i] === term || words[i].includes(term)) {
          termPositions.push(i);
        }
      }
      positions.set(term, termPositions);
    }

    return positions;
  }

  /**
   * Calculate proximity score between two specific terms.
   */
  static calculateProximityScore(
    text: string,
    term1: string,
    term2: string,
    maxDistance: number
  ): number | null {
    const words = text.toLowerCase().split(/\s+/);
    const positions1: number[] = [];
    const positions2: number[] = [];

    for (let i = 0; i < words.length; i++) {
      if (words[i].includes(term1.toLowerCase())) {
        positions1.push(i);
      }
      if (words[i].includes(term2.toLowerCase())) {
        positions2.push(i);
      }
    }

    if (positions1.length === 0 || positions2.length === 0) {
      return null;
    }

    // Find minimum distance
    let minDist = Infinity;
    for (const p1 of positions1) {
      for (const p2 of positions2) {
        minDist = Math.min(minDist, Math.abs(p1 - p2));
      }
    }

    if (minDist > maxDistance) {
      return null;
    }

    // Score: 1.0 for adjacent, decreasing as distance increases
    return 1 / (1 + minDist);
  }
}
