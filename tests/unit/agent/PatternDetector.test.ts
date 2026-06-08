/**
 * PatternDetector Unit Tests
 *
 * Tests for pattern detection including template extraction,
 * variable identification, and pattern matching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternDetector } from '../../../src/agent/PatternDetector.js';

describe('PatternDetector', () => {
  let detector: PatternDetector;

  beforeEach(() => {
    detector = new PatternDetector();
  });

  // ==================== Basic Pattern Detection ====================

  describe('detectPatterns', () => {
    it('should return empty array for empty observations', () => {
      const patterns = detector.detectPatterns([], 2);
      expect(patterns).toEqual([]);
    });

    it('should return empty array for single observation', () => {
      const patterns = detector.detectPatterns(['User likes pasta'], 2);
      expect(patterns).toEqual([]);
    });

    it('should detect simple patterns with variable slot', () => {
      const observations = [
        'User prefers Italian food',
        'User prefers Mexican food',
        'User prefers Japanese food',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].pattern).toBe('User prefers {X} food');
      expect(patterns[0].variables).toContain('Italian');
      expect(patterns[0].variables).toContain('Mexican');
      expect(patterns[0].variables).toContain('Japanese');
    });

    it('should respect minimum occurrences threshold', () => {
      const observations = [
        'User prefers Italian food',
        'User prefers Mexican food',
        'Meeting on Monday',
        'Meeting on Tuesday',
      ];

      // Both patterns appear 2 times, so minOccurrences=2 should find both
      const patterns = detector.detectPatterns(observations, 2);
      expect(patterns.length).toBe(2);

      // With minOccurrences=3, neither should be found
      const strictPatterns = detector.detectPatterns(observations, 3);
      expect(strictPatterns.length).toBe(0);
    });

    it('should calculate confidence based on frequency', () => {
      const observations = [
        'User likes pasta',
        'User likes pizza',
        'User likes sushi',
        'User likes tacos',
        'Random observation',
      ];

      const patterns = detector.detectPatterns(observations, 2);
      expect(patterns.length).toBeGreaterThan(0);

      // 4 out of 5 match the pattern, so confidence should be ~0.8
      expect(patterns[0].confidence).toBeGreaterThan(0.5);
    });

    it('should not detect patterns when observations differ in length', () => {
      const observations = [
        'User likes Italian food a lot',
        'User likes food',
        'User likes Thai food',
      ];

      // Different token counts should not match
      const patterns = detector.detectPatterns(observations, 2);

      // Should only find pattern between same-length observations
      const matchingPatterns = patterns.filter((p) =>
        p.pattern.includes('User likes')
      );
      // The first and third have different lengths, only 2nd and 3rd might match
      expect(matchingPatterns.length).toBeLessThanOrEqual(1);
    });

    it('should handle observations with multiple variable slots', () => {
      const observations = [
        'John likes pasta',
        'Jane likes pizza',
        'John likes pizza',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      // Should find "{X} likes {X}" or "{X} likes pasta" etc.
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should return empty when no meaningful patterns exist', () => {
      const observations = [
        'Apple',
        'Banana',
        'Cherry',
      ];

      // Single-word observations can't form meaningful patterns
      const patterns = detector.detectPatterns(observations, 2);
      expect(patterns.length).toBe(0);
    });

    it('should sort patterns by occurrences', () => {
      const observations = [
        'User likes pasta',
        'User likes pizza',
        'User likes sushi',
        'User likes tacos',
        'Meeting on Monday',
        'Meeting on Tuesday',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      // 'User likes {X}' should be first (4 occurrences)
      // 'Meeting on {X}' should be second (2 occurrences)
      if (patterns.length >= 2) {
        expect(patterns[0].occurrences).toBeGreaterThanOrEqual(patterns[1].occurrences);
      }
    });
  });

  // ==================== Pattern Template Tests ====================

  describe('pattern templates', () => {
    it('should create templates with {X} variable markers', () => {
      const observations = [
        'The weather is sunny',
        'The weather is cloudy',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].pattern).toContain('{X}');
    });

    it('should preserve word order in templates', () => {
      const observations = [
        'Task assigned to John',
        'Task assigned to Jane',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns[0].pattern).toBe('Task assigned to {X}');
    });

    it('should handle multiple variables in order', () => {
      const observations = [
        'John sent email to Jane',
        'Bob sent email to Alice',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns[0].pattern).toBe('{X} sent email to {X}');
    });
  });

  // ==================== Variable Extraction Tests ====================

  describe('variable extraction', () => {
    it('should extract all unique variable values', () => {
      const observations = [
        'Project status is active',
        'Project status is pending',
        'Project status is complete',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns[0].variables).toContain('active');
      expect(patterns[0].variables).toContain('pending');
      expect(patterns[0].variables).toContain('complete');
    });

    it('should deduplicate variable values', () => {
      const observations = [
        'Color is red',
        'Color is red',
        'Color is blue',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      // 'red' should only appear once in variables
      const redCount = patterns[0].variables.filter((v) => v === 'red').length;
      expect(redCount).toBe(1);
    });
  });

  // ==================== Pattern Specificity ====================

  describe('calculatePatternSpecificity', () => {
    it('should return high specificity for patterns with few variables', () => {
      const specificity = detector.calculatePatternSpecificity(
        'User prefers {X} food every day'
      );
      // 5 fixed tokens out of 6 total = ~0.833
      expect(specificity).toBeCloseTo(0.833, 2);
    });

    it('should return low specificity for patterns with many variables', () => {
      const specificity = detector.calculatePatternSpecificity(
        '{X} {X} {X} food'
      );
      // 1 fixed token out of 4 total = 0.25
      expect(specificity).toBe(0.25);
    });

    it('should return 1 for patterns with no variables', () => {
      const specificity = detector.calculatePatternSpecificity(
        'User likes food'
      );
      expect(specificity).toBe(1);
    });
  });

  // ==================== Edge Cases ====================

  describe('edge cases', () => {
    it('should handle case variations', () => {
      const observations = [
        'User Likes Pasta',
        'User likes pizza',
        'user likes sushi',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      // Should still find pattern despite case differences
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle observations with special characters', () => {
      const observations = [
        'User@work likes pasta!',
        'User@work likes pizza!',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      // Should handle special characters in tokens
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle long observations', () => {
      const observations = [
        'The user named John from the marketing department prefers Italian food',
        'The user named Jane from the marketing department prefers Mexican food',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].variables).toContain('John');
      expect(patterns[0].variables).toContain('Jane');
    });

    it('should handle observations with numbers', () => {
      const observations = [
        'Order 123 is pending',
        'Order 456 is pending',
        'Order 789 is pending',
      ];

      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns[0].pattern).toBe('Order {X} is pending');
      expect(patterns[0].variables).toContain('123');
      expect(patterns[0].variables).toContain('456');
      expect(patterns[0].variables).toContain('789');
    });

    it('should require more fixed tokens than variables for valid patterns', () => {
      const observations = [
        'a b',
        'c d',
      ];

      // Both tokens differ, so pattern would be '{X} {X}'
      // This should be rejected as not meaningful
      const patterns = detector.detectPatterns(observations, 2);

      expect(patterns.length).toBe(0);
    });
  });

  // ==================== Merge Consecutive Variables ====================

  describe('mergeConsecutiveVariables', () => {
    it('should merge consecutive {X} tokens', () => {
      const merged = detector.mergeConsecutiveVariables(
        'User {X} {X} {X} likes food'
      );
      expect(merged).toBe('User {X} likes food');
    });

    it('should preserve non-consecutive variables', () => {
      const merged = detector.mergeConsecutiveVariables(
        'User {X} likes {X} food'
      );
      expect(merged).toBe('User {X} likes {X} food');
    });

    it('should handle pattern with all fixed tokens', () => {
      const merged = detector.mergeConsecutiveVariables(
        'User likes food'
      );
      expect(merged).toBe('User likes food');
    });
  });
});
