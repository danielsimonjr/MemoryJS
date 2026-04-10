import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FactExtractor } from '../../../src/features/FactExtractor.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { RelationManager } from '../../../src/core/RelationManager.js';

describe('FactExtractor', () => {
  let extractor: FactExtractor;

  beforeEach(() => {
    extractor = new FactExtractor();
  });

  describe('extract', () => {
    it('should extract "works at" facts', () => {
      const facts = extractor.extract('Alice works at Google');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      const worksAt = facts.find(f => f.relation === 'works_at');
      expect(worksAt).toBeDefined();
      expect(worksAt!.subject).toBe('alice');
      expect(worksAt!.object).toBe('google');
      expect(worksAt!.confidence).toBe(0.9);
    });

    it('should extract "works for" facts', () => {
      const facts = extractor.extract('Bob works for Microsoft');
      const worksAt = facts.find(f => f.relation === 'works_at');
      expect(worksAt).toBeDefined();
      expect(worksAt!.subject).toBe('bob');
      expect(worksAt!.object).toBe('microsoft');
    });

    it('should extract "is a" facts', () => {
      const facts = extractor.extract('Python is a programming language');
      const isA = facts.find(f => f.relation === 'is_a');
      expect(isA).toBeDefined();
      expect(isA!.subject).toBe('python');
      expect(isA!.object).toBe('programming language');
      expect(isA!.confidence).toBe(0.85);
    });

    it('should extract "is an" facts', () => {
      const facts = extractor.extract('TypeScript is an advanced language');
      const isA = facts.find(f => f.relation === 'is_a');
      expect(isA).toBeDefined();
      expect(isA!.subject).toBe('typescript');
      expect(isA!.object).toBe('advanced language');
    });

    it('should extract "located in" facts', () => {
      const facts = extractor.extract('The server is located in US-East');
      const locatedIn = facts.find(f => f.relation === 'located_in');
      expect(locatedIn).toBeDefined();
      expect(locatedIn!.subject).toContain('server');
      expect(locatedIn!.confidence).toBe(0.9);
    });

    it('should extract "uses" facts', () => {
      const facts = extractor.extract('The team uses TypeScript');
      const uses = facts.find(f => f.relation === 'uses');
      expect(uses).toBeDefined();
      expect(uses!.object).toContain('typescript');
      expect(uses!.confidence).toBe(0.7);
    });

    it('should extract "prefers" facts', () => {
      const facts = extractor.extract('Alice prefers dark mode');
      const prefers = facts.find(f => f.relation === 'prefers');
      expect(prefers).toBeDefined();
      expect(prefers!.subject).toBe('alice');
      expect(prefers!.object).toBe('dark mode');
    });

    it('should extract "created by" facts', () => {
      const facts = extractor.extract('Linux was created by Linus Torvalds');
      const createdBy = facts.find(f => f.relation === 'created_by');
      expect(createdBy).toBeDefined();
      expect(createdBy!.subject).toBe('linux');
      expect(createdBy!.object).toContain('linus');
    });

    it('should extract "part of" facts', () => {
      const facts = extractor.extract('The engine is part of the car');
      const partOf = facts.find(f => f.relation === 'part_of');
      expect(partOf).toBeDefined();
      expect(partOf!.subject).toContain('engine');
    });

    it('should extract "depends on" facts', () => {
      const facts = extractor.extract('The frontend depends on the API');
      const dependsOn = facts.find(f => f.relation === 'depends_on');
      expect(dependsOn).toBeDefined();
      expect(dependsOn!.subject).toContain('frontend');
    });

    it('should extract "manages" facts', () => {
      const facts = extractor.extract('Alice manages the engineering team');
      const manages = facts.find(f => f.relation === 'manages');
      expect(manages).toBeDefined();
      expect(manages!.subject).toBe('alice');
    });

    it('should extract "owned by" facts', () => {
      const facts = extractor.extract('YouTube is owned by Google');
      const ownedBy = facts.find(f => f.relation === 'owned_by');
      expect(ownedBy).toBeDefined();
      expect(ownedBy!.subject).toBe('youtube');
      expect(ownedBy!.object).toBe('google');
    });

    it('should extract multiple facts from single text', () => {
      // "is a" and "uses" can both match
      const facts = extractor.extract('Alice is a developer');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.relation === 'is_a')).toBe(true);
    });

    it('should handle text with no extractable facts', () => {
      const facts = extractor.extract('The weather is nice today');
      // Should return empty or very few low-confidence results
      // "is" alone without "a/an" after it won't trigger is_a
      expect(facts.every(f => f.confidence >= 0.5)).toBe(true);
    });

    it('should preserve sourceText in extracted facts', () => {
      const text = 'Alice works at Google';
      const facts = extractor.extract(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].sourceText).toBe(text);
    });
  });

  describe('normalizeName', () => {
    it('should convert to lowercase', () => {
      expect(extractor.normalizeName('Alice')).toBe('alice');
      expect(extractor.normalizeName('GOOGLE')).toBe('google');
    });

    it('should strip Dr. title', () => {
      expect(extractor.normalizeName('Dr. Smith')).toBe('smith');
    });

    it('should strip Mr. title', () => {
      expect(extractor.normalizeName('Mr. Johnson')).toBe('johnson');
    });

    it('should strip Mrs. title', () => {
      expect(extractor.normalizeName('Mrs. Williams')).toBe('williams');
    });

    it('should strip Ms. title', () => {
      expect(extractor.normalizeName('Ms. Davis')).toBe('davis');
    });

    it('should strip Prof. title', () => {
      expect(extractor.normalizeName('Prof. Anderson')).toBe('anderson');
    });

    it('should trim whitespace', () => {
      expect(extractor.normalizeName('  Alice  ')).toBe('alice');
    });

    it('should collapse multiple spaces', () => {
      expect(extractor.normalizeName('John   Doe')).toBe('john doe');
    });

    it('should handle combined normalization', () => {
      expect(extractor.normalizeName('  Dr.  John   Smith  ')).toBe('john smith');
    });
  });

  describe('minConfidence filter', () => {
    it('should filter out facts below minConfidence', () => {
      const facts = extractor.extract('Alice uses TypeScript', { minConfidence: 0.8 });
      // 'uses' has confidence 0.7, should be filtered out
      const uses = facts.find(f => f.relation === 'uses');
      expect(uses).toBeUndefined();
    });

    it('should keep facts at or above minConfidence', () => {
      const facts = extractor.extract('Alice works at Google', { minConfidence: 0.9 });
      const worksAt = facts.find(f => f.relation === 'works_at');
      expect(worksAt).toBeDefined();
    });

    it('should default minConfidence to 0.5', () => {
      const facts = extractor.extract('Alice uses TypeScript');
      // 'uses' has confidence 0.7, should be included with default 0.5
      const uses = facts.find(f => f.relation === 'uses');
      expect(uses).toBeDefined();
    });
  });

  describe('normalizeNames option', () => {
    it('should normalize names by default', () => {
      const facts = extractor.extract('Dr. Alice works at Google');
      const worksAt = facts.find(f => f.relation === 'works_at');
      expect(worksAt).toBeDefined();
      expect(worksAt!.subject).toBe('alice');
    });

    it('should skip normalization when disabled', () => {
      const facts = extractor.extract('Alice works at Google', { normalizeNames: false });
      const worksAt = facts.find(f => f.relation === 'works_at');
      expect(worksAt).toBeDefined();
      expect(worksAt!.subject).toBe('Alice');
      expect(worksAt!.object).toBe('Google');
    });
  });

  describe('extractAndPersist', () => {
    it('should extract facts and return them', async () => {
      const result = await extractor.extractAndPersist('alice', [
        'Alice works at Google',
        'Alice is a developer',
      ], { createRelations: false });

      expect(result.facts.length).toBeGreaterThanOrEqual(2);
      expect(result.facts.some(f => f.relation === 'works_at')).toBe(true);
      expect(result.facts.some(f => f.relation === 'is_a')).toBe(true);
      expect(result.relationsCreated).toBe(0);
    });

    it('should deduplicate facts by subject+relation+object', async () => {
      const result = await extractor.extractAndPersist('alice', [
        'Alice works at Google',
        'Alice works at Google',  // duplicate
      ], { createRelations: false });

      const worksAtFacts = result.facts.filter(f =>
        f.relation === 'works_at' && f.subject === 'alice' && f.object === 'google'
      );
      expect(worksAtFacts.length).toBe(1);
    });

    it('should create relations when createRelations is true', async () => {
      const mockRelationManager = {
        createRelations: vi.fn().mockResolvedValue([{ from: 'alice', to: 'google', relationType: 'works_at' }]),
      } as unknown as RelationManager;

      const persistExtractor = new FactExtractor(undefined, mockRelationManager);
      const result = await persistExtractor.extractAndPersist('alice', [
        'Alice works at Google',
      ], { createRelations: true });

      expect(mockRelationManager.createRelations).toHaveBeenCalled();
      expect(result.relationsCreated).toBe(1);
    });

    it('should create entities when createEntities is true', async () => {
      const mockEntityManager = {
        getEntity: vi.fn().mockResolvedValue(null),
        createEntities: vi.fn().mockImplementation((entities) =>
          Promise.resolve(entities)
        ),
      } as unknown as EntityManager;

      const persistExtractor = new FactExtractor(mockEntityManager, undefined);
      const result = await persistExtractor.extractAndPersist('alice', [
        'Alice works at Google',
      ], { createEntities: true, createRelations: false });

      expect(mockEntityManager.createEntities).toHaveBeenCalled();
      expect(result.entitiesCreated.length).toBeGreaterThan(0);
    });

    it('should not create entities that already exist', async () => {
      const mockEntityManager = {
        getEntity: vi.fn().mockResolvedValue({ name: 'alice', entityType: 'person', observations: [] }),
        createEntities: vi.fn().mockResolvedValue([]),
      } as unknown as EntityManager;

      const persistExtractor = new FactExtractor(mockEntityManager, undefined);
      await persistExtractor.extractAndPersist('alice', [
        'Alice works at Google',
      ], { createEntities: true, createRelations: false });

      // getEntity returns a value, so createEntities should not be called for existing entities
      // But it will be called for entities that getEntity returns null for
      // Since we always return an entity, no creates should happen
      expect(mockEntityManager.createEntities).not.toHaveBeenCalled();
    });

    it('should handle errors from relation creation gracefully', async () => {
      const mockRelationManager = {
        createRelations: vi.fn().mockRejectedValue(new Error('Entity not found')),
      } as unknown as RelationManager;

      const persistExtractor = new FactExtractor(undefined, mockRelationManager);
      const result = await persistExtractor.extractAndPersist('alice', [
        'Alice works at Google',
      ], { createRelations: true });

      // Should not throw, relationsCreated should be 0
      expect(result.relationsCreated).toBe(0);
      expect(result.facts.length).toBeGreaterThan(0);
    });

    it('should handle empty observations', async () => {
      const result = await extractor.extractAndPersist('alice', [], {
        createRelations: false,
      });

      expect(result.facts).toEqual([]);
      expect(result.entitiesCreated).toEqual([]);
      expect(result.relationsCreated).toBe(0);
    });

    it('should handle observations with no extractable facts', async () => {
      const result = await extractor.extractAndPersist('alice', [
        'The weather is nice',
        'Hello world',
      ], { createRelations: false });

      // May or may not have facts depending on patterns, but should not error
      expect(result.entitiesCreated).toEqual([]);
      expect(result.relationsCreated).toBe(0);
    });
  });
});
