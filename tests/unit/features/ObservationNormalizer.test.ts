import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationNormalizer } from '../../../src/features/ObservationNormalizer.js';
import { KeywordExtractor } from '../../../src/features/KeywordExtractor.js';
import type { Entity } from '../../../src/types/index.js';

describe('ObservationNormalizer', () => {
  let normalizer: ObservationNormalizer;

  beforeEach(() => {
    normalizer = new ObservationNormalizer();
  });

  describe('coreference resolution', () => {
    it('should resolve masculine pronouns', () => {
      const entity: Entity = { name: 'Bob', entityType: 'person', observations: [] };
      const result = normalizer.normalize('He started the project', entity);
      expect(result.normalized).toContain('Bob');
      expect(result.normalized).not.toContain('He');
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should resolve feminine pronouns', () => {
      const entity: Entity = { name: 'Alice', entityType: 'person', observations: [] };
      const result = normalizer.normalize('She completed the task', entity);
      expect(result.normalized).toContain('Alice');
      expect(result.normalized).not.toContain('She');
    });

    it('should resolve possessive pronouns', () => {
      const entity: Entity = { name: 'James', entityType: 'person', observations: [] };
      const result = normalizer.normalize('His work was excellent', entity);
      expect(result.normalized).toContain('James');
    });

    it('should resolve neutral pronouns for non-person entities', () => {
      const entity: Entity = { name: 'ProjectX', entityType: 'project', observations: [] };
      const result = normalizer.normalize('They released it last week', entity);
      expect(result.normalized).toContain('ProjectX');
    });

    it('should not change text without pronouns', () => {
      const entity: Entity = { name: 'Bob', entityType: 'person', observations: [] };
      const result = normalizer.normalize('The project started', entity);
      expect(result.normalized).toBe('The project started');
      expect(result.changes.length).toBe(0);
    });

    it('should handle multiple pronouns', () => {
      const entity: Entity = { name: 'Bob', entityType: 'person', observations: [] };
      const result = normalizer.normalize('He said his task was done', entity);
      expect(result.normalized).toBe('Bob said Bob task was done');
    });
  });

  describe('timestamp anchoring', () => {
    const referenceDate = new Date('2026-01-08');

    it('should anchor yesterday', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Meeting happened yesterday', entity, {
        referenceDate,
      });
      expect(result.normalized).toContain('2026-01-07');
      expect(result.normalized).not.toContain('yesterday');
    });

    it('should anchor today', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Task is due today', entity, {
        referenceDate,
      });
      expect(result.normalized).toContain('2026-01-08');
    });

    it('should anchor tomorrow', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Meeting scheduled for tomorrow', entity, {
        referenceDate,
      });
      expect(result.normalized).toContain('2026-01-09');
    });

    it('should anchor last month', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Started last month', entity, {
        referenceDate,
      });
      expect(result.normalized).toContain('2025-12');
    });

    it('should anchor last year', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Was founded last year', entity, {
        referenceDate,
      });
      expect(result.normalized).toContain('2025');
    });

    it('should anchor this week', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Will happen this week', entity, {
        referenceDate,
      });
      expect(result.normalized).toContain('week of');
    });

    it('should track replacements in changes', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Meeting happened yesterday', entity, {
        referenceDate,
      });
      expect(result.changes.some(c => c.includes('yesterday'))).toBe(true);
    });
  });

  describe('keyword extraction', () => {
    it('should extract keywords when enabled', () => {
      const entity: Entity = { name: 'Test', entityType: 'project', observations: [] };
      const result = normalizer.normalize(
        'The software project was completed successfully',
        entity,
        { extractKeywords: true }
      );
      expect(result.keywords).toBeDefined();
      expect(result.keywords).toContain('software');
      expect(result.keywords).toContain('project');
      expect(result.keywords).toContain('completed');
    });

    it('should not extract keywords when disabled', () => {
      const entity: Entity = { name: 'Test', entityType: 'project', observations: [] };
      const result = normalizer.normalize('The software project was completed', entity, {
        extractKeywords: false,
      });
      expect(result.keywords).toBeUndefined();
    });

    it('should filter out stopwords', () => {
      const entity: Entity = { name: 'Test', entityType: 'project', observations: [] };
      const result = normalizer.normalize(
        'The project is running well',
        entity,
        { extractKeywords: true }
      );
      expect(result.keywords).not.toContain('the');
      expect(result.keywords).not.toContain('is');
    });
  });

  describe('normalize pipeline', () => {
    it('should combine all transformations', () => {
      const entity: Entity = { name: 'Alice', entityType: 'person', observations: [] };
      const result = normalizer.normalize(
        'She completed the task yesterday',
        entity,
        { referenceDate: new Date('2026-01-08'), extractKeywords: true }
      );
      expect(result.normalized).toContain('Alice');
      expect(result.normalized).toContain('2026-01-07');
      expect(result.keywords).toBeDefined();
    });

    it('should disable coreference resolution when specified', () => {
      const entity: Entity = { name: 'Alice', entityType: 'person', observations: [] };
      const result = normalizer.normalize('She completed the task', entity, {
        resolveCoreferences: false,
      });
      expect(result.normalized).toContain('She');
    });

    it('should disable timestamp anchoring when specified', () => {
      const entity: Entity = { name: 'Test', entityType: 'event', observations: [] };
      const result = normalizer.normalize('Meeting happened yesterday', entity, {
        anchorTimestamps: false,
      });
      expect(result.normalized).toContain('yesterday');
    });
  });

  describe('normalizeEntity', () => {
    it('should normalize all observations for an entity', () => {
      const entity: Entity = {
        name: 'Bob',
        entityType: 'person',
        observations: [
          'He started the project',
          'He completed it yesterday',
          'He presented results',
        ],
      };
      const { entity: normalized, results } = normalizer.normalizeEntity(entity, {
        referenceDate: new Date('2026-01-08'),
      });

      expect(normalized.observations.length).toBe(3);
      expect(normalized.observations[0]).toContain('Bob');
      expect(normalized.observations[1]).toContain('Bob');
      expect(normalized.observations[1]).toContain('2026-01-07');
      expect(results.length).toBe(3);
    });

    it('should preserve entity properties', () => {
      const entity: Entity = {
        name: 'Alice',
        entityType: 'person',
        observations: ['She works here'],
        tags: ['developer'],
        importance: 8,
      };
      const { entity: normalized } = normalizer.normalizeEntity(entity);

      expect(normalized.name).toBe('Alice');
      expect(normalized.entityType).toBe('person');
      expect(normalized.tags).toEqual(['developer']);
      expect(normalized.importance).toBe(8);
    });
  });
});

describe('KeywordExtractor', () => {
  let extractor: KeywordExtractor;

  beforeEach(() => {
    extractor = new KeywordExtractor();
  });

  describe('extract', () => {
    it('should extract keywords from text', () => {
      const keywords = extractor.extract('The software project was completed on time');
      const keywordNames = keywords.map(k => k.keyword);
      expect(keywordNames).toContain('software');
      expect(keywordNames).toContain('project');
      expect(keywordNames).toContain('completed');
      expect(keywordNames).toContain('time');
    });

    it('should filter out stopwords', () => {
      const keywords = extractor.extract('The cat is on the mat');
      const keywordNames = keywords.map(k => k.keyword);
      expect(keywordNames).not.toContain('the');
      expect(keywordNames).not.toContain('is');
      expect(keywordNames).not.toContain('on');
    });

    it('should filter out short words', () => {
      const keywords = extractor.extract('I am a developer');
      const keywordNames = keywords.map(k => k.keyword);
      expect(keywordNames).not.toContain('am');
      expect(keywordNames).toContain('developer');
    });

    it('should return keywords with positions', () => {
      const keywords = extractor.extract('project started, project completed');
      const projectKw = keywords.find(k => k.keyword === 'project');
      expect(projectKw).toBeDefined();
      expect(projectKw!.positions.length).toBe(2);
      expect(projectKw!.positions).toContain(0);
    });
  });

  describe('scoring', () => {
    it('should score domain keywords higher', () => {
      const keywords = extractor.extract('The project meeting was productive');
      const projectKw = keywords.find(k => k.keyword === 'project');
      const meetingKw = keywords.find(k => k.keyword === 'meeting');
      const productiveKw = keywords.find(k => k.keyword === 'productive');

      expect(projectKw!.score).toBeGreaterThan(productiveKw!.score);
      expect(meetingKw!.score).toBeGreaterThan(productiveKw!.score);
    });

    it('should score earlier words higher', () => {
      const keywords = extractor.extract('important crucial significant');
      // All words have same length, no domain boost, so first should score highest
      expect(keywords[0].keyword).toBe('important');
    });

    it('should boost longer words', () => {
      // Compare words at same position with no domain boost
      const keywords = extractor.extract('development code');
      const devKw = keywords.find(k => k.keyword === 'development');
      const codeKw = keywords.find(k => k.keyword === 'code');
      // Development is longer, so should have length boost
      expect(devKw!.score).toBeGreaterThan(codeKw!.score);
    });

    it('should increase score for repeated keywords', () => {
      const keywords = extractor.extract('project alpha project beta project gamma');
      const projectKw = keywords.find(k => k.keyword === 'project');
      const alphaKw = keywords.find(k => k.keyword === 'alpha');
      // Project appears 3 times, alpha appears once
      expect(projectKw!.score).toBeGreaterThan(alphaKw!.score);
    });
  });

  describe('extractTop', () => {
    it('should return top N keywords', () => {
      const text = 'The software project was completed successfully with great results';
      const top3 = extractor.extractTop(text, 3);
      expect(top3.length).toBe(3);
    });

    it('should return all keywords if fewer than N', () => {
      const text = 'short text';
      const top10 = extractor.extractTop(text, 10);
      expect(top10.length).toBeLessThanOrEqual(10);
    });

    it('should return only keyword strings', () => {
      const text = 'The software project was completed';
      const top3 = extractor.extractTop(text, 3);
      expect(top3.every(k => typeof k === 'string')).toBe(true);
    });
  });

  describe('domain boosts', () => {
    it('should allow adding custom domain boosts', () => {
      extractor.addDomainBoost('typescript', 2.0);
      const keywords = extractor.extract('typescript javascript python');
      const tsKw = keywords.find(k => k.keyword === 'typescript');
      const jsKw = keywords.find(k => k.keyword === 'javascript');
      expect(tsKw!.score).toBeGreaterThan(jsKw!.score);
    });

    it('should allow removing domain boosts', () => {
      extractor.addDomainBoost('custom', 2.0);
      expect(extractor.removeDomainBoost('custom')).toBe(true);
      expect(extractor.removeDomainBoost('nonexistent')).toBe(false);
    });

    it('should return all domain boosts', () => {
      const boosts = extractor.getDomainBoosts();
      expect(boosts.get('project')).toBe(1.5);
      expect(boosts.get('task')).toBe(1.5);
      expect(boosts.get('meeting')).toBe(1.3);
    });
  });
});
