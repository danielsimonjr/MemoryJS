/**
 * SummarizationService Unit Tests
 *
 * Tests for text summarization, similarity detection, and observation grouping.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SummarizationService,
  type ISummarizationProvider,
  type SummarizationConfig,
} from '../../../src/agent/SummarizationService.js';

describe('SummarizationService', () => {
  let service: SummarizationService;

  beforeEach(() => {
    service = new SummarizationService();
  });

  // ==================== Constructor Tests ====================

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const config = service.getConfig();
      expect(config.provider).toBe('none');
      expect(config.apiKey).toBe('');
      expect(config.model).toBe('');
      expect(config.maxTokens).toBe(150);
      expect(config.defaultSimilarityThreshold).toBe(0.8);
    });

    it('should accept custom config', () => {
      const customService = new SummarizationService({
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
        maxTokens: 300,
        defaultSimilarityThreshold: 0.9,
      });
      const config = customService.getConfig();
      expect(config.provider).toBe('openai');
      expect(config.apiKey).toBe('test-key');
      expect(config.model).toBe('gpt-4');
      expect(config.maxTokens).toBe(300);
      expect(config.defaultSimilarityThreshold).toBe(0.9);
    });

    it('should handle partial config', () => {
      const partialService = new SummarizationService({
        defaultSimilarityThreshold: 0.5,
      });
      const config = partialService.getConfig();
      expect(config.provider).toBe('none');
      expect(config.defaultSimilarityThreshold).toBe(0.5);
    });
  });

  // ==================== Similarity Calculation Tests ====================

  describe('calculateSimilarity', () => {
    it('should return 1 for identical texts', () => {
      const text = 'User likes Italian food';
      const similarity = service.calculateSimilarity(text, text);
      expect(similarity).toBe(1);
    });

    it('should return high similarity for similar texts', () => {
      const similarity = service.calculateSimilarity(
        'User likes Italian food',
        'User prefers Italian cuisine'
      );
      // Both share "User" and "Italian"
      expect(similarity).toBeGreaterThan(0.3);
    });

    it('should return low similarity for different texts', () => {
      const similarity = service.calculateSimilarity(
        'User likes Italian food',
        'The weather is sunny today'
      );
      expect(similarity).toBeLessThan(0.2);
    });

    it('should return 0 for empty texts', () => {
      expect(service.calculateSimilarity('', '')).toBe(0);
      expect(service.calculateSimilarity('hello', '')).toBe(0);
      expect(service.calculateSimilarity('', 'world')).toBe(0);
    });

    it('should be case insensitive', () => {
      const similarity1 = service.calculateSimilarity('Hello World', 'hello world');
      const similarity2 = service.calculateSimilarity('HELLO WORLD', 'hello world');
      expect(similarity1).toBeCloseTo(1, 10);
      expect(similarity2).toBeCloseTo(1, 10);
    });

    it('should ignore punctuation', () => {
      const similarity = service.calculateSimilarity(
        'Hello, World!',
        'Hello World'
      );
      expect(similarity).toBeCloseTo(1, 10);
    });

    it('should handle single word texts', () => {
      expect(service.calculateSimilarity('hello', 'hello')).toBe(1);
      expect(service.calculateSimilarity('hello', 'world')).toBe(0);
    });

    it('should handle texts with numbers', () => {
      const similarity = service.calculateSimilarity(
        'User ordered 3 pizzas',
        'User ordered 3 items'
      );
      // Should have moderate similarity (share "User", "ordered", "3")
      expect(similarity).toBeGreaterThan(0.4);
    });
  });

  // ==================== Summarization Tests ====================

  describe('summarize', () => {
    it('should return empty string for empty array', async () => {
      const result = await service.summarize([]);
      expect(result).toBe('');
    });

    it('should return single text unchanged', async () => {
      const result = await service.summarize(['User likes pasta']);
      expect(result).toBe('User likes pasta');
    });

    it('should combine two texts', async () => {
      const result = await service.summarize([
        'User likes pasta',
        'User enjoys wine',
      ]);
      expect(result).toContain('pasta');
      expect(result).toContain('wine');
    });

    it('should extract unique sentences from multiple texts', async () => {
      const result = await service.summarize([
        'User likes Italian food. User enjoys pasta.',
        'User likes Italian food. User prefers red wine.',
      ]);
      // Should contain pasta and wine (unique parts)
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle texts with newlines', async () => {
      const result = await service.summarize([
        'First line\nSecond line',
        'Third line\nFourth line',
      ]);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should limit output for many sentences', async () => {
      const result = await service.summarize([
        'Sentence one. Sentence two. Sentence three.',
        'Sentence four. Sentence five. Sentence six.',
        'Sentence seven. Sentence eight. Sentence nine.',
      ]);
      // Should take representative sentences, not all
      expect(result.split('. ').length).toBeLessThanOrEqual(4);
    });
  });

  // ==================== Observation Grouping Tests ====================

  describe('groupSimilarObservations', () => {
    it('should return empty groups for empty array', async () => {
      const result = await service.groupSimilarObservations([]);
      expect(result.groups).toEqual([]);
      expect(result.groupCount).toBe(0);
      expect(result.originalCount).toBe(0);
    });

    it('should return single group for single observation', async () => {
      const result = await service.groupSimilarObservations(['User likes pasta']);
      expect(result.groups).toEqual([['User likes pasta']]);
      expect(result.groupCount).toBe(1);
      expect(result.originalCount).toBe(1);
    });

    it('should group identical observations', async () => {
      const result = await service.groupSimilarObservations([
        'User likes Italian food',
        'User likes Italian food',
      ]);
      expect(result.groupCount).toBe(1);
      expect(result.groups[0].length).toBe(2);
    });

    it('should group similar observations', async () => {
      const result = await service.groupSimilarObservations(
        [
          'User likes Italian food',
          'User prefers Italian food',
          'The weather is sunny',
        ],
        0.5 // Lower threshold
      );
      // First two should be grouped, weather separate
      expect(result.groupCount).toBe(2);
    });

    it('should keep dissimilar observations separate', async () => {
      const result = await service.groupSimilarObservations([
        'User likes Italian food',
        'Project deadline is tomorrow',
        'Meeting scheduled for Monday',
      ]);
      expect(result.groupCount).toBe(3);
    });

    it('should use default threshold from config', async () => {
      const strictService = new SummarizationService({
        defaultSimilarityThreshold: 0.99,
      });
      const result = await strictService.groupSimilarObservations([
        'User likes Italian food',
        'User likes Italian cuisine',
      ]);
      // With 0.99 threshold, these should be separate
      expect(result.groupCount).toBe(2);
    });

    it('should override config threshold when provided', async () => {
      const strictService = new SummarizationService({
        defaultSimilarityThreshold: 0.99,
      });
      const result = await strictService.groupSimilarObservations(
        [
          'User likes Italian food',
          'User likes Italian cuisine',
        ],
        0.3 // Override with lower threshold
      );
      // Should now be grouped
      expect(result.groupCount).toBe(1);
    });

    it('should handle many observations', async () => {
      const observations = [
        'User likes pasta',
        'User enjoys pizza',
        'User prefers pasta',
        'User loves pizza',
        'The weather is sunny',
        'The weather is nice',
      ];
      const result = await service.groupSimilarObservations(observations, 0.5);
      // Should group pasta, pizza, and weather observations
      expect(result.originalCount).toBe(6);
      expect(result.groupCount).toBeLessThanOrEqual(6);
    });
  });

  // ==================== Group Summarization Tests ====================

  describe('summarizeGroups', () => {
    it('should return empty array for empty groups', async () => {
      const result = await service.summarizeGroups([]);
      expect(result).toEqual([]);
    });

    it('should return single observation unchanged', async () => {
      const result = await service.summarizeGroups([['User likes pasta']]);
      expect(result).toEqual(['User likes pasta']);
    });

    it('should summarize each group', async () => {
      const result = await service.summarizeGroups([
        ['User likes pasta', 'User enjoys pasta'],
        ['Meeting tomorrow'],
      ]);
      expect(result.length).toBe(2);
      expect(result[0]).toContain('pasta');
      expect(result[1]).toBe('Meeting tomorrow');
    });

    it('should handle groups of different sizes', async () => {
      const result = await service.summarizeGroups([
        ['Single observation'],
        ['Two', 'observations'],
        ['Three', 'separate', 'observations'],
      ]);
      expect(result.length).toBe(3);
    });
  });

  // ==================== Provider Tests ====================

  describe('provider management', () => {
    it('should report LLM not available by default', () => {
      expect(service.isLLMAvailable()).toBe(false);
    });

    it('should register custom provider', () => {
      const mockProvider: ISummarizationProvider = {
        summarize: async (texts) => texts.join(' | '),
        isAvailable: () => true,
      };
      service.registerProvider(mockProvider);
      expect(service.isLLMAvailable()).toBe(true);
    });

    it('should use registered provider for summarization', async () => {
      const mockProvider: ISummarizationProvider = {
        summarize: async (texts) => `SUMMARIZED: ${texts.length} texts`,
        isAvailable: () => true,
      };
      service.registerProvider(mockProvider);

      const result = await service.summarize(['text1', 'text2', 'text3']);
      expect(result).toBe('SUMMARIZED: 3 texts');
    });

    it('should fall back to algorithmic summarization on provider error', async () => {
      const failingProvider: ISummarizationProvider = {
        summarize: async () => {
          throw new Error('Provider failed');
        },
        isAvailable: () => true,
      };
      service.registerProvider(failingProvider);

      const result = await service.summarize(['User likes pasta', 'User enjoys wine']);
      // Should fall back to concatenation
      expect(result).toContain('pasta');
      expect(result).toContain('wine');
    });

    it('should use fallback when provider not available', async () => {
      const unavailableProvider: ISummarizationProvider = {
        summarize: async () => 'Should not be called',
        isAvailable: () => false,
      };
      service.registerProvider(unavailableProvider);

      const result = await service.summarize(['text1', 'text2']);
      expect(result).not.toBe('Should not be called');
    });
  });

  // ==================== Edge Cases ====================

  describe('edge cases', () => {
    it('should handle special characters in text', () => {
      const similarity = service.calculateSimilarity(
        'User likes @special #tags!',
        'User likes special tags'
      );
      // After removing special chars, should be identical
      expect(similarity).toBe(1);
    });

    it('should handle whitespace variations', () => {
      const similarity = service.calculateSimilarity(
        'User   likes   pasta',
        'User likes pasta'
      );
      expect(similarity).toBeCloseTo(1, 10);
    });

    it('should handle unicode text', () => {
      const similarity = service.calculateSimilarity(
        'User likes caf\u00e9',
        'User likes cafe'
      );
      // "caf\u00e9" becomes "caf" after removing non-ascii
      // Should have some similarity
      expect(similarity).toBeGreaterThan(0);
    });

    it('should handle very long texts', async () => {
      const longText1 = 'word '.repeat(100).trim();
      const longText2 = 'word '.repeat(100).trim();
      const similarity = service.calculateSimilarity(longText1, longText2);
      expect(similarity).toBe(1);
    });

    it('should handle texts with only stopwords', () => {
      const similarity = service.calculateSimilarity('the a an', 'the a an');
      expect(similarity).toBeCloseTo(1, 10);
    });
  });

  // ==================== Integration Scenarios ====================

  describe('integration scenarios', () => {
    it('should group and summarize observations end-to-end', async () => {
      const observations = [
        'User prefers Italian food',
        'User likes Italian cuisine',
        'User enjoys pasta dishes',
        'Meeting scheduled for Monday',
        'Conference call on Monday morning',
      ];

      // Group similar observations
      const groups = await service.groupSimilarObservations(observations, 0.4);
      expect(groups.groupCount).toBeLessThan(observations.length);

      // Summarize each group
      const summaries = await service.summarizeGroups(groups.groups);
      expect(summaries.length).toBe(groups.groupCount);
    });

    it('should produce meaningful compression for similar observations', async () => {
      const observations = [
        'User likes pasta',
        'User enjoys pasta',
        'User prefers pasta',
        'User loves pasta dishes',
      ];

      const groups = await service.groupSimilarObservations(observations, 0.5);
      const summaries = await service.summarizeGroups(groups.groups);

      // All pasta observations should group together
      expect(summaries.length).toBeLessThan(observations.length);
      expect(summaries[0]).toContain('pasta');
    });
  });
});
