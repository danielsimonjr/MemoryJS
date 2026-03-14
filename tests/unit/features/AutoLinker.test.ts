/**
 * AutoLinker Unit Tests
 *
 * Tests for automatic entity mention detection and relation creation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutoLinker } from '../../../src/features/AutoLinker.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Entity } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AutoLinker', () => {
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let autoLinker: AutoLinker;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `autolinker-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    autoLinker = new AutoLinker(storage, relationManager);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('detectMentions', () => {
    const knownEntities: Entity[] = [
      { name: 'Alice', entityType: 'person', observations: [] },
      { name: 'Bob', entityType: 'person', observations: [] },
      { name: 'TechCorp', entityType: 'company', observations: [] },
      { name: 'Project Apollo', entityType: 'project', observations: [] },
    ];

    it('should detect simple entity mentions in text', () => {
      const mentions = autoLinker.detectMentions(
        'Alice works at TechCorp on Project Apollo',
        knownEntities
      );

      expect(mentions).toContain('Alice');
      expect(mentions).toContain('TechCorp');
      expect(mentions).toContain('Project Apollo');
    });

    it('should respect minNameLength and skip short names', () => {
      const mentions = autoLinker.detectMentions(
        'Alice and Bob work together',
        knownEntities,
        undefined,
        { minNameLength: 4 }
      );

      expect(mentions).toContain('Alice');
      expect(mentions).not.toContain('Bob'); // 'Bob' is 3 chars, below minNameLength of 4
    });

    it('should be case-insensitive by default', () => {
      const mentions = autoLinker.detectMentions(
        'alice works at techcorp',
        knownEntities
      );

      expect(mentions).toContain('Alice');
      expect(mentions).toContain('TechCorp');
    });

    it('should respect caseSensitive option', () => {
      const mentions = autoLinker.detectMentions(
        'alice works at techcorp',
        knownEntities,
        undefined,
        { caseSensitive: true }
      );

      expect(mentions).not.toContain('Alice');
      expect(mentions).not.toContain('TechCorp');
    });

    it('should skip self-references', () => {
      const mentions = autoLinker.detectMentions(
        'Alice works at TechCorp',
        knownEntities,
        'Alice'
      );

      expect(mentions).not.toContain('Alice');
      expect(mentions).toContain('TechCorp');
    });

    it('should use word boundaries to avoid partial matches', () => {
      const entities: Entity[] = [
        { name: 'Art', entityType: 'concept', observations: [] },
        { name: 'Mart', entityType: 'store', observations: [] },
      ];

      // 'Art' is 3 chars (below default minNameLength of 4), but let's lower the threshold
      const mentions = autoLinker.detectMentions(
        'The article about martial arts was great',
        entities,
        undefined,
        { minNameLength: 3 }
      );

      // 'Art' should not match 'article' or 'arts' (partial match)
      // 'Mart' should not match 'martial' (partial match)
      expect(mentions).not.toContain('Art');
      expect(mentions).not.toContain('Mart');
    });

    it('should match exact word boundaries', () => {
      const entities: Entity[] = [
        { name: 'Mart', entityType: 'store', observations: [] },
      ];

      const mentions = autoLinker.detectMentions(
        'I went to Mart yesterday',
        entities
      );

      expect(mentions).toContain('Mart');
    });

    it('should handle empty text', () => {
      const mentions = autoLinker.detectMentions('', knownEntities);
      expect(mentions).toEqual([]);
    });

    it('should handle whitespace-only text', () => {
      const mentions = autoLinker.detectMentions('   \n\t  ', knownEntities);
      expect(mentions).toEqual([]);
    });

    it('should respect allowedEntityTypes filter', () => {
      const mentions = autoLinker.detectMentions(
        'Alice works at TechCorp on Project Apollo',
        knownEntities,
        undefined,
        { allowedEntityTypes: ['person'] }
      );

      expect(mentions).toContain('Alice');
      expect(mentions).not.toContain('TechCorp');
      expect(mentions).not.toContain('Project Apollo');
    });

    it('should respect excludedEntityTypes filter', () => {
      const mentions = autoLinker.detectMentions(
        'Alice works at TechCorp on Project Apollo',
        knownEntities,
        undefined,
        { excludedEntityTypes: ['company'] }
      );

      expect(mentions).toContain('Alice');
      expect(mentions).not.toContain('TechCorp');
      expect(mentions).toContain('Project Apollo');
    });

    it('should handle special characters in entity names', () => {
      const entities: Entity[] = [
        { name: 'C++ Programming', entityType: 'skill', observations: [] },
        { name: 'AT&T', entityType: 'company', observations: [] },
        { name: 'Node.js', entityType: 'technology', observations: [] },
      ];

      const mentions = autoLinker.detectMentions(
        'She learned C++ Programming and used Node.js at AT&T',
        entities
      );

      expect(mentions).toContain('C++ Programming');
      expect(mentions).toContain('AT&T');
      expect(mentions).toContain('Node.js');
    });

    it('should skip stopwords that match entity names', () => {
      const entities: Entity[] = [
        { name: 'Type', entityType: 'concept', observations: [] },
        { name: 'Name', entityType: 'concept', observations: [] },
        { name: 'Alice', entityType: 'person', observations: [] },
      ];

      const mentions = autoLinker.detectMentions(
        'The type and name of Alice are important',
        entities,
        undefined,
        { minNameLength: 3 }
      );

      expect(mentions).toContain('Alice');
      expect(mentions).not.toContain('Type');
      expect(mentions).not.toContain('Name');
    });
  });

  describe('linkObservations', () => {
    beforeEach(async () => {
      // Create test entities in storage
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'TechCorp', entityType: 'company', observations: [] },
        { name: 'Project Apollo', entityType: 'project', observations: [] },
        { name: 'Charlie', entityType: 'person', observations: [] },
      ]);
    });

    it('should create mentions relations for detected entities', async () => {
      const result = await autoLinker.linkObservations(
        'Charlie',
        ['Met with Alice at TechCorp to discuss Project Apollo']
      );

      expect(result.sourceEntity).toBe('Charlie');
      expect(result.mentionedEntities).toContain('Alice');
      expect(result.mentionedEntities).toContain('TechCorp');
      expect(result.mentionedEntities).toContain('Project Apollo');
      expect(result.relationsCreated).toBe(3);

      // Verify relations were actually created in storage
      const relations = await relationManager.getRelations('Charlie');
      const mentionRelations = relations.filter(r => r.relationType === 'mentions' && r.from === 'Charlie');
      expect(mentionRelations).toHaveLength(3);
      expect(mentionRelations.map(r => r.to)).toContain('Alice');
      expect(mentionRelations.map(r => r.to)).toContain('TechCorp');
      expect(mentionRelations.map(r => r.to)).toContain('Project Apollo');
    });

    it('should not create duplicate relations', async () => {
      // First call creates relations
      await autoLinker.linkObservations(
        'Charlie',
        ['Met with Alice at TechCorp']
      );

      // Second call with same mentions should not create duplicates
      const result = await autoLinker.linkObservations(
        'Charlie',
        ['Alice from TechCorp called me']
      );

      expect(result.mentionedEntities).toContain('Alice');
      expect(result.mentionedEntities).toContain('TechCorp');
      expect(result.relationsCreated).toBe(0); // No new relations created

      // Verify only one set of relations exists
      const relations = await relationManager.getRelations('Charlie');
      const aliceMentions = relations.filter(
        r => r.from === 'Charlie' && r.to === 'Alice' && r.relationType === 'mentions'
      );
      expect(aliceMentions).toHaveLength(1);
    });

    it('should return empty result for observations with no mentions', async () => {
      const result = await autoLinker.linkObservations(
        'Charlie',
        ['Had a quiet day at the office']
      );

      expect(result.sourceEntity).toBe('Charlie');
      expect(result.mentionedEntities).toHaveLength(0);
      expect(result.relationsCreated).toBe(0);
    });

    it('should return empty result for empty observations array', async () => {
      const result = await autoLinker.linkObservations('Charlie', []);

      expect(result.sourceEntity).toBe('Charlie');
      expect(result.mentionedEntities).toHaveLength(0);
      expect(result.relationsCreated).toBe(0);
    });

    it('should use custom relation type when specified', async () => {
      const result = await autoLinker.linkObservations(
        'Charlie',
        ['Collaborated with Alice'],
        { createRelationType: 'references' }
      );

      expect(result.relationsCreated).toBe(1);

      const relations = await relationManager.getRelations('Charlie');
      const refRelations = relations.filter(r => r.relationType === 'references');
      expect(refRelations).toHaveLength(1);
      expect(refRelations[0].to).toBe('Alice');
    });

    it('should aggregate mentions across multiple observations', async () => {
      const result = await autoLinker.linkObservations(
        'Charlie',
        [
          'Met with Alice today',
          'Visited TechCorp headquarters',
          'Alice introduced me to Project Apollo',
        ]
      );

      // Alice appears in two observations but should only be counted once
      expect(result.mentionedEntities).toContain('Alice');
      expect(result.mentionedEntities).toContain('TechCorp');
      expect(result.mentionedEntities).toContain('Project Apollo');
      expect(result.relationsCreated).toBe(3);
    });
  });

  describe('constructor options', () => {
    it('should use instance-level default options', async () => {
      const strictLinker = new AutoLinker(
        storage,
        relationManager,
        { minNameLength: 10, caseSensitive: true }
      );

      const entities: Entity[] = [
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Very Long Entity Name', entityType: 'thing', observations: [] },
      ];

      const mentions = strictLinker.detectMentions(
        'Alice and Very Long Entity Name are here',
        entities
      );

      // 'Alice' is only 5 chars, below minNameLength of 10
      expect(mentions).not.toContain('Alice');
      expect(mentions).toContain('Very Long Entity Name');
    });

    it('should allow call-level options to override instance defaults', () => {
      const strictLinker = new AutoLinker(
        storage,
        relationManager,
        { minNameLength: 10 }
      );

      const entities: Entity[] = [
        { name: 'Alice', entityType: 'person', observations: [] },
      ];

      // Override minNameLength at call level
      const mentions = strictLinker.detectMentions(
        'Alice is here',
        entities,
        undefined,
        { minNameLength: 3 }
      );

      expect(mentions).toContain('Alice');
    });
  });
});
