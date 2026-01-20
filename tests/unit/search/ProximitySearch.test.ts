/**
 * Tests for Proximity Search
 *
 * @module tests/unit/search/ProximitySearch.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProximitySearch } from '../../../src/search/ProximitySearch.js';
import type { Entity } from '../../../src/types/types.js';
import type { ProximityNode } from '../../../src/types/search.js';

describe('ProximitySearch', () => {
  let search: ProximitySearch;

  const createEntity = (name: string, observations: string[] = []): Entity => ({
    name,
    entityType: 'test',
    observations,
  });

  beforeEach(() => {
    search = new ProximitySearch();
  });

  describe('Basic Search', () => {
    it('should find entities with terms within distance', () => {
      const entities = [
        createEntity('Test', ['hello world foo']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 2,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      expect(results[0].entity.name).toBe('Test');
    });

    it('should not find entities with terms outside distance', () => {
      const entities = [
        createEntity('Test', ['hello foo bar baz world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 2,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(0);
    });

    it('should return empty array for empty entities', () => {
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search([], node);

      expect(results).toHaveLength(0);
    });

    it('should match in entity name', () => {
      const entities = [
        createEntity('hello world entity'),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 2,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      expect(results[0].matches.some(m => m.field === 'name')).toBe(true);
    });

    it('should match in observations', () => {
      const entities = [
        createEntity('Test', ['the hello world text']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 2,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      expect(results[0].matches.some(m => m.field === 'observation')).toBe(true);
    });
  });

  describe('Distance Calculation', () => {
    it('should return distance 0 for adjacent terms', () => {
      const entities = [
        createEntity('Test', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      expect(results[0].minDistance).toBe(1);
    });

    it('should return correct distance for spaced terms', () => {
      const entities = [
        createEntity('Test', ['hello foo bar world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      expect(results[0].minDistance).toBe(3); // hello at 0, world at 3
    });

    it('should find minimum distance across multiple occurrences', () => {
      const entities = [
        createEntity('Test', ['hello far away world but hello world here']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      // Should find the closer "hello world" pair
      expect(results[0].minDistance).toBeLessThanOrEqual(1);
    });
  });

  describe('Scoring', () => {
    it('should score closer matches higher', () => {
      const entities = [
        createEntity('Close', ['hello world']),
        createEntity('Far', ['hello foo bar baz world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 10,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(2);
      expect(results[0].entity.name).toBe('Close');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should calculate score as 1/(1+distance)', () => {
      const entities = [
        createEntity('Test', ['hello world']), // distance 1
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results[0].score).toBeCloseTo(0.5); // 1/(1+1)
    });
  });

  describe('Multiple Terms', () => {
    it('should require all terms present', () => {
      const entities = [
        createEntity('Partial', ['hello foo']),
        createEntity('Complete', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
      expect(results[0].entity.name).toBe('Complete');
    });

    it('should handle three terms', () => {
      const entities = [
        createEntity('Test', ['hello beautiful world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'beautiful', 'world'],
        distance: 3,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
    });

    it('should calculate span for multiple terms', () => {
      const entities = [
        createEntity('Test', ['hello beautiful world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results[0].minDistance).toBe(2); // hello at 0, world at 2
    });
  });

  describe('Edge Cases', () => {
    it('should handle single term', () => {
      const entities = [
        createEntity('Test', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello'],
        distance: 5,
      };

      const results = search.search(entities, node);

      // Single term is distance 0 from itself
      expect(results).toHaveLength(1);
    });

    it('should handle empty terms array', () => {
      const entities = [
        createEntity('Test', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: [],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(0);
    });

    it('should handle distance 0', () => {
      const entities = [
        createEntity('Test', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 0,
      };

      const results = search.search(entities, node);

      // Adjacent terms have distance 1, not 0
      expect(results).toHaveLength(0);
    });

    it('should handle entity with no observations', () => {
      const entities = [
        createEntity('hello world', []),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      // Should match in name
      expect(results).toHaveLength(1);
    });

    it('should handle entity with undefined observations', () => {
      const entity: Entity = {
        name: 'hello world',
        entityType: 'test',
        observations: undefined as unknown as string[],
      };
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search([entity], node);

      // Should match in name
      expect(results).toHaveLength(1);
    });

    it('should be case insensitive', () => {
      const entities = [
        createEntity('Test', ['HELLO WORLD']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results).toHaveLength(1);
    });

    it('should match partial words', () => {
      const entities = [
        createEntity('Test', ['testing helloworld']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'test'],
        distance: 5,
      };

      const results = search.search(entities, node);

      // 'helloworld' contains 'hello', 'testing' contains 'test'
      expect(results).toHaveLength(1);
    });
  });

  describe('Match Locations', () => {
    it('should record match locations', () => {
      const entities = [
        createEntity('Test', ['hello world foo']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results[0].matches).toHaveLength(1);
      expect(results[0].matches[0].field).toBe('observation');
    });

    it('should record positions in match', () => {
      const entities = [
        createEntity('Test', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      const positions = results[0].matches[0].positions;
      expect(positions.get('hello')).toContain(0);
      expect(positions.get('world')).toContain(1);
    });

    it('should record distance in match', () => {
      const entities = [
        createEntity('Test', ['hello world']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results[0].matches[0].distance).toBe(1);
    });

    it('should find matches in both name and observations', () => {
      const entities = [
        createEntity('hello world', ['hello world too']),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const results = search.search(entities, node);

      expect(results[0].matches).toHaveLength(2);
      expect(results[0].matches.some(m => m.field === 'name')).toBe(true);
      expect(results[0].matches.some(m => m.field === 'observation')).toBe(true);
    });
  });

  describe('Large Documents', () => {
    it('should handle large text efficiently', () => {
      const largeText = Array(1000).fill('word').join(' ') +
        ' hello target world ' +
        Array(1000).fill('more').join(' ');

      const entities = [
        createEntity('Test', [largeText]),
      ];
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const start = Date.now();
      const results = search.search(entities, node);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(1);
      expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should handle many entities', () => {
      const entities = Array.from({ length: 100 }, (_, i) =>
        createEntity(`Entity${i}`, [`hello world text ${i}`])
      );
      const node: ProximityNode = {
        type: 'proximity',
        terms: ['hello', 'world'],
        distance: 5,
      };

      const start = Date.now();
      const results = search.search(entities, node);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(100);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('calculateProximityScore static method', () => {
    it('should calculate score for two terms', () => {
      const score = ProximitySearch.calculateProximityScore(
        'hello world',
        'hello',
        'world',
        5
      );

      expect(score).toBeCloseTo(0.5); // 1/(1+1)
    });

    it('should return null for missing first term', () => {
      const score = ProximitySearch.calculateProximityScore(
        'foo bar',
        'hello',
        'bar',
        5
      );

      expect(score).toBeNull();
    });

    it('should return null for missing second term', () => {
      const score = ProximitySearch.calculateProximityScore(
        'hello bar',
        'hello',
        'world',
        5
      );

      expect(score).toBeNull();
    });

    it('should return null if distance exceeds max', () => {
      const score = ProximitySearch.calculateProximityScore(
        'hello foo bar baz world',
        'hello',
        'world',
        2
      );

      expect(score).toBeNull();
    });

    it('should be case insensitive', () => {
      const score = ProximitySearch.calculateProximityScore(
        'HELLO WORLD',
        'hello',
        'world',
        5
      );

      expect(score).not.toBeNull();
    });

    it('should find minimum distance with multiple occurrences', () => {
      const score = ProximitySearch.calculateProximityScore(
        'hello far world but hello world here',
        'hello',
        'world',
        5
      );

      expect(score).not.toBeNull();
      // Should use closest pair (hello world at positions 4,5)
      expect(score).toBeCloseTo(0.5); // 1/(1+1)
    });
  });
});
