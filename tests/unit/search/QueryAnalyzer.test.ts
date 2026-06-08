import { describe, it, expect, beforeEach } from 'vitest';
import { QueryAnalyzer } from '../../../src/search/QueryAnalyzer.js';

describe('QueryAnalyzer', () => {
  let analyzer: QueryAnalyzer;

  beforeEach(() => {
    analyzer = new QueryAnalyzer();
  });

  describe('person extraction', () => {
    it('should extract names after titles', () => {
      const result = analyzer.analyze('Talk to Dr. Smith about the project');
      expect(result.persons).toContain('Smith');
    });

    it('should extract capitalized names', () => {
      const result = analyzer.analyze('Find projects by Alice');
      expect(result.persons).toContain('Alice');
    });

    it('should deduplicate extracted names', () => {
      const result = analyzer.analyze('Ask Dr. Smith and then talk to Smith again');
      const smithCount = result.persons.filter(p => p === 'Smith').length;
      expect(smithCount).toBe(1);
    });

    it('should handle multiple persons', () => {
      const result = analyzer.analyze('Dr. Smith and Dr. Jones discussed the results');
      expect(result.persons).toContain('Smith');
      expect(result.persons).toContain('Jones');
    });
  });

  describe('location extraction', () => {
    it('should extract locations after prepositions', () => {
      const result = analyzer.analyze('The meeting is in Seattle');
      expect(result.locations).toContain('Seattle');
    });

    it('should extract from various location indicators', () => {
      const result = analyzer.analyze('Travel from London to Paris');
      expect(result.locations).toContain('London');
      expect(result.locations).toContain('Paris');
    });

    it('should not extract lowercase words after prepositions', () => {
      const result = analyzer.analyze('Talk to someone at home');
      expect(result.locations).not.toContain('home');
    });
  });

  describe('organization extraction', () => {
    it('should extract organizations with Inc.', () => {
      const result = analyzer.analyze('Contact Acme Inc. about the contract');
      expect(result.organizations.length).toBeGreaterThan(0);
      expect(result.organizations[0]).toContain('Acme');
    });

    it('should extract organizations with Corp.', () => {
      const result = analyzer.analyze('Work with TechCo Corp. on the project');
      expect(result.organizations.length).toBeGreaterThan(0);
    });

    it('should handle no organizations', () => {
      const result = analyzer.analyze('Find all projects');
      expect(result.organizations.length).toBe(0);
    });
  });

  describe('temporal parsing', () => {
    it('should detect relative dates - last month', () => {
      const result = analyzer.analyze('What happened last month?');
      expect(result.temporalRange?.relative).toBe('last month');
    });

    it('should detect relative dates - yesterday', () => {
      const result = analyzer.analyze('Show me yesterday meetings');
      expect(result.temporalRange?.relative).toBe('yesterday');
    });

    it('should detect relative dates - this year', () => {
      const result = analyzer.analyze('What projects started this year');
      expect(result.temporalRange?.relative).toBe('this year');
    });

    it('should parse ISO dates', () => {
      const result = analyzer.analyze('Find events between 2024-01-01 and 2024-12-31');
      expect(result.temporalRange?.start).toBe('2024-01-01');
      expect(result.temporalRange?.end).toBe('2024-12-31');
    });

    it('should handle single ISO date', () => {
      const result = analyzer.analyze('What happened on 2024-06-15?');
      expect(result.temporalRange?.start).toBe('2024-06-15');
    });

    it('should return null for no temporal reference', () => {
      const result = analyzer.analyze('Find all projects');
      expect(result.temporalRange).toBeNull();
    });
  });

  describe('question type detection', () => {
    it('should detect factual questions', () => {
      const result = analyzer.analyze('What is the project status?');
      expect(result.questionType).toBe('factual');
    });

    it('should detect temporal questions', () => {
      const result = analyzer.analyze('When did the project start?');
      expect(result.questionType).toBe('temporal');
    });

    it('should detect comparative questions', () => {
      const result = analyzer.analyze('Compare Alice and Bob performance');
      expect(result.questionType).toBe('comparative');
    });

    it('should detect aggregation questions', () => {
      const result = analyzer.analyze('How many projects are active?');
      expect(result.questionType).toBe('aggregation');
    });

    it('should detect conceptual questions', () => {
      const result = analyzer.analyze('Explain why the project failed');
      expect(result.questionType).toBe('conceptual');
    });

    it('should detect multi-hop questions', () => {
      const result = analyzer.analyze('Find Alice and then get her related projects');
      expect(result.questionType).toBe('multi-hop');
    });

    it('should default to factual for ambiguous queries', () => {
      const result = analyzer.analyze('projects');
      expect(result.questionType).toBe('factual');
    });
  });

  describe('complexity estimation', () => {
    it('should estimate low complexity for simple queries', () => {
      const result = analyzer.analyze('Find Alice');
      expect(result.complexity).toBe('low');
    });

    it('should estimate medium complexity for moderate queries', () => {
      const result = analyzer.analyze('Find projects and tasks from last month');
      expect(result.complexity).toBe('medium');
    });

    it('should estimate high complexity for complex queries', () => {
      const result = analyzer.analyze(
        'What projects did Alice work on last year, and how do they compare to Bob\'s projects in terms of success?'
      );
      expect(result.complexity).toBe('high');
    });

    it('should consider word count in complexity', () => {
      const shortQuery = analyzer.analyze('Find Alice');
      const longQuery = analyzer.analyze(
        'Find all projects where Alice participated as a team lead during the first quarter of the year'
      );
      expect(shortQuery.complexity).toBe('low');
      expect(longQuery.complexity).not.toBe('low');
    });
  });

  describe('confidence calculation', () => {
    it('should have higher confidence for simple queries', () => {
      const simple = analyzer.analyze('Find Alice');
      const complex = analyzer.analyze(
        'What projects did Alice work on last year, and how do they compare?'
      );
      expect(simple.confidence).toBeGreaterThan(complex.confidence);
    });

    it('should have confidence between 0 and 1', () => {
      const result = analyzer.analyze('Any random query here');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('required info types detection', () => {
    it('should detect person info type', () => {
      const result = analyzer.analyze('Who worked on the project?');
      expect(result.requiredInfoTypes).toContain('person');
    });

    it('should detect location info type', () => {
      const result = analyzer.analyze('Where is the meeting?');
      expect(result.requiredInfoTypes).toContain('location');
    });

    it('should detect temporal info type', () => {
      const result = analyzer.analyze('When did it happen?');
      expect(result.requiredInfoTypes).toContain('temporal');
    });

    it('should detect quantity info type', () => {
      const result = analyzer.analyze('How many tasks are there?');
      expect(result.requiredInfoTypes).toContain('quantity');
    });

    it('should detect multiple info types', () => {
      const result = analyzer.analyze('When and where did the people meet?');
      expect(result.requiredInfoTypes).toContain('temporal');
      expect(result.requiredInfoTypes).toContain('location');
      expect(result.requiredInfoTypes).toContain('person');
    });
  });

  describe('query decomposition', () => {
    it('should decompose queries with "and"', () => {
      const result = analyzer.analyze('Find Alice and show her projects');
      expect(result.subQueries).toBeDefined();
      expect(result.subQueries?.length).toBeGreaterThan(1);
    });

    it('should decompose queries with "and then"', () => {
      const result = analyzer.analyze('Find the project and then list tasks');
      expect(result.subQueries).toBeDefined();
      expect(result.subQueries?.length).toBeGreaterThan(1);
    });

    it('should not decompose simple queries', () => {
      const result = analyzer.analyze('Find all projects');
      expect(result.subQueries).toBeUndefined();
    });
  });

  describe('entities array', () => {
    it('should combine all extracted entities', () => {
      const result = analyzer.analyze(
        'Dr. Smith from Seattle contacted TechCo Corp.'
      );
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities.some(e => e.type === 'person')).toBe(true);
      expect(result.entities.some(e => e.type === 'location')).toBe(true);
    });

    it('should have correct entity types', () => {
      const result = analyzer.analyze('Ask Alice in London about Acme Inc.');
      for (const entity of result.entities) {
        expect(['person', 'location', 'organization', 'unknown']).toContain(entity.type);
      }
    });
  });
});

