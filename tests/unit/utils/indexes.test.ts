/**
 * Index Tests
 *
 * Tests for NameIndex, TypeIndex, LowercaseCache, RelationIndex, and ObservationIndex.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NameIndex, TypeIndex, LowercaseCache, RelationIndex, ObservationIndex } from '../../../src/utils/indexes.js';
import type { Entity, Relation } from '../../../src/types/index.js';

const createEntity = (name: string, type: string, observations: string[] = [], tags?: string[]): Entity => ({
  name,
  entityType: type,
  observations,
  tags,
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
});

describe('NameIndex', () => {
  let index: NameIndex;

  beforeEach(() => {
    index = new NameIndex();
  });

  describe('build', () => {
    it('should build index from entities', () => {
      const entities = [
        createEntity('Alice', 'person'),
        createEntity('Bob', 'person'),
        createEntity('Acme', 'company'),
      ];

      index.build(entities);

      expect(index.size).toBe(3);
      expect(index.has('Alice')).toBe(true);
      expect(index.has('Bob')).toBe(true);
      expect(index.has('Acme')).toBe(true);
    });

    it('should clear existing index on rebuild', () => {
      index.add(createEntity('Old', 'person'));
      expect(index.has('Old')).toBe(true);

      index.build([createEntity('New', 'person')]);

      expect(index.has('Old')).toBe(false);
      expect(index.has('New')).toBe(true);
    });
  });

  describe('get', () => {
    it('should return entity by name', () => {
      const alice = createEntity('Alice', 'person');
      index.add(alice);

      expect(index.get('Alice')).toBe(alice);
    });

    it('should return undefined for non-existent name', () => {
      expect(index.get('NonExistent')).toBeUndefined();
    });
  });

  describe('add', () => {
    it('should add entity to index', () => {
      const entity = createEntity('Test', 'test');
      index.add(entity);

      expect(index.get('Test')).toBe(entity);
    });

    it('should update existing entity reference', () => {
      const entity1 = createEntity('Test', 'test');
      const entity2 = createEntity('Test', 'updated');
      index.add(entity1);
      index.add(entity2);

      expect(index.get('Test')).toBe(entity2);
      expect(index.size).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove entity from index', () => {
      index.add(createEntity('Test', 'test'));
      expect(index.has('Test')).toBe(true);

      index.remove('Test');
      expect(index.has('Test')).toBe(false);
    });

    it('should handle removing non-existent entity', () => {
      expect(() => index.remove('NonExistent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      index.add(createEntity('A', 'test'));
      index.add(createEntity('B', 'test'));
      expect(index.size).toBe(2);

      index.clear();
      expect(index.size).toBe(0);
    });
  });
});

describe('TypeIndex', () => {
  let index: TypeIndex;

  beforeEach(() => {
    index = new TypeIndex();
  });

  describe('build', () => {
    it('should build index from entities', () => {
      const entities = [
        createEntity('Alice', 'person'),
        createEntity('Bob', 'Person'), // Different case
        createEntity('Acme', 'company'),
      ];

      index.build(entities);

      expect(index.getNames('person').size).toBe(2);
      expect(index.getNames('company').size).toBe(1);
    });

    it('should be case-insensitive', () => {
      index.add(createEntity('Test', 'UPPERCASE'));

      expect(index.getNames('uppercase').has('Test')).toBe(true);
      expect(index.getNames('UPPERCASE').has('Test')).toBe(true);
      expect(index.getNames('Uppercase').has('Test')).toBe(true);
    });
  });

  describe('getNames', () => {
    it('should return set of entity names by type', () => {
      index.add(createEntity('Alice', 'person'));
      index.add(createEntity('Bob', 'person'));

      const names = index.getNames('person');
      expect(names.has('Alice')).toBe(true);
      expect(names.has('Bob')).toBe(true);
    });

    it('should return empty set for unknown type', () => {
      const names = index.getNames('unknown');
      expect(names.size).toBe(0);
    });
  });

  describe('remove', () => {
    it('should remove entity from type bucket', () => {
      index.add(createEntity('Alice', 'person'));
      index.add(createEntity('Bob', 'person'));

      index.remove('Alice', 'person');

      const names = index.getNames('person');
      expect(names.has('Alice')).toBe(false);
      expect(names.has('Bob')).toBe(true);
    });

    it('should delete empty type buckets', () => {
      index.add(createEntity('Only', 'singleton'));
      index.remove('Only', 'singleton');

      expect(index.getTypes()).not.toContain('singleton');
    });
  });

  describe('updateType', () => {
    it('should move entity between types', () => {
      index.add(createEntity('Test', 'oldType'));
      index.updateType('Test', 'oldType', 'newType');

      expect(index.getNames('oldType').has('Test')).toBe(false);
      expect(index.getNames('newType').has('Test')).toBe(true);
    });
  });

  describe('getTypes', () => {
    it('should return all unique types', () => {
      index.add(createEntity('A', 'person'));
      index.add(createEntity('B', 'company'));
      index.add(createEntity('C', 'person'));

      const types = index.getTypes();
      expect(types).toContain('person');
      expect(types).toContain('company');
      expect(types.length).toBe(2);
    });
  });
});

describe('LowercaseCache', () => {
  let cache: LowercaseCache;

  beforeEach(() => {
    cache = new LowercaseCache();
  });

  describe('build', () => {
    it('should build cache from entities', () => {
      const entities = [
        createEntity('Alice', 'Person', ['Observation One'], ['Tag1']),
        createEntity('Bob', 'PERSON', ['OBSERVATION TWO'], ['TAG2']),
      ];

      cache.build(entities);

      expect(cache.size).toBe(2);
      expect(cache.has('Alice')).toBe(true);
      expect(cache.has('Bob')).toBe(true);
    });
  });

  describe('get', () => {
    it('should return pre-computed lowercase data', () => {
      const entity = createEntity('ALICE', 'PERSON', ['OBSERVATION'], ['TAG']);
      cache.set(entity);

      const lowercased = cache.get('ALICE');
      expect(lowercased).toBeDefined();
      expect(lowercased!.name).toBe('alice');
      expect(lowercased!.entityType).toBe('person');
      expect(lowercased!.observations).toEqual(['observation']);
      expect(lowercased!.tags).toEqual(['tag']);
    });

    it('should return undefined for non-existent entity', () => {
      expect(cache.get('NonExistent')).toBeUndefined();
    });

    it('should handle entity without tags', () => {
      const entity = createEntity('Test', 'Type', ['Obs']);
      cache.set(entity);

      const lowercased = cache.get('Test');
      expect(lowercased!.tags).toEqual([]);
    });
  });

  describe('set', () => {
    it('should add or update entity in cache', () => {
      const entity1 = createEntity('Test', 'TypeA', ['Obs1']);
      const entity2 = createEntity('Test', 'TypeB', ['Obs2']);

      cache.set(entity1);
      expect(cache.get('Test')!.entityType).toBe('typea');

      cache.set(entity2);
      expect(cache.get('Test')!.entityType).toBe('typeb');
      expect(cache.size).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove entity from cache', () => {
      cache.set(createEntity('Test', 'Type', []));
      expect(cache.has('Test')).toBe(true);

      cache.remove('Test');
      expect(cache.has('Test')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set(createEntity('A', 'Type', []));
      cache.set(createEntity('B', 'Type', []));
      expect(cache.size).toBe(2);

      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});

// Helper for creating relations
const createRelation = (from: string, to: string, relationType: string): Relation => ({
  from,
  to,
  relationType,
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
});

describe('RelationIndex', () => {
  let index: RelationIndex;

  beforeEach(() => {
    index = new RelationIndex();
  });

  describe('build', () => {
    it('should build index from relations', () => {
      const relations = [
        createRelation('Alice', 'Bob', 'works_with'),
        createRelation('Alice', 'Project', 'contributes_to'),
        createRelation('Bob', 'Project', 'leads'),
      ];

      index.build(relations);

      expect(index.size).toBe(3);
      expect(index.getRelationsFrom('Alice')).toHaveLength(2);
      expect(index.getRelationsTo('Project')).toHaveLength(2);
    });

    it('should clear existing index on rebuild', () => {
      index.add(createRelation('Old', 'Entity', 'relation'));
      expect(index.size).toBe(1);

      index.build([createRelation('New', 'Entity', 'relation')]);

      expect(index.getRelationsFrom('Old')).toHaveLength(0);
      expect(index.getRelationsFrom('New')).toHaveLength(1);
    });
  });

  describe('getRelationsFrom', () => {
    it('should return all outgoing relations', () => {
      const rel1 = createRelation('Alice', 'Bob', 'works_with');
      const rel2 = createRelation('Alice', 'Charlie', 'manages');
      const rel3 = createRelation('Bob', 'Charlie', 'reports_to');

      index.add(rel1);
      index.add(rel2);
      index.add(rel3);

      const aliceRelations = index.getRelationsFrom('Alice');
      expect(aliceRelations).toHaveLength(2);
      expect(aliceRelations).toContainEqual(rel1);
      expect(aliceRelations).toContainEqual(rel2);
    });

    it('should return empty array for entity with no outgoing relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));

      expect(index.getRelationsFrom('Bob')).toHaveLength(0);
    });
  });

  describe('getRelationsTo', () => {
    it('should return all incoming relations', () => {
      const rel1 = createRelation('Alice', 'Project', 'contributes_to');
      const rel2 = createRelation('Bob', 'Project', 'leads');
      const rel3 = createRelation('Alice', 'Bob', 'works_with');

      index.add(rel1);
      index.add(rel2);
      index.add(rel3);

      const projectRelations = index.getRelationsTo('Project');
      expect(projectRelations).toHaveLength(2);
      expect(projectRelations).toContainEqual(rel1);
      expect(projectRelations).toContainEqual(rel2);
    });

    it('should return empty array for entity with no incoming relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));

      expect(index.getRelationsTo('Alice')).toHaveLength(0);
    });
  });

  describe('getRelationsFor', () => {
    it('should return all relations involving the entity', () => {
      const rel1 = createRelation('Alice', 'Bob', 'works_with');
      const rel2 = createRelation('Charlie', 'Alice', 'reports_to');
      const rel3 = createRelation('Bob', 'Charlie', 'knows');

      index.add(rel1);
      index.add(rel2);
      index.add(rel3);

      const aliceRelations = index.getRelationsFor('Alice');
      expect(aliceRelations).toHaveLength(2);
      expect(aliceRelations).toContainEqual(rel1);
      expect(aliceRelations).toContainEqual(rel2);
    });

    it('should handle self-referential relations correctly', () => {
      const selfRef = createRelation('Node', 'Node', 'self_link');

      index.add(selfRef);

      const nodeRelations = index.getRelationsFor('Node');
      expect(nodeRelations).toHaveLength(1);
      expect(nodeRelations).toContainEqual(selfRef);
    });

    it('should return empty array for entity with no relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));

      expect(index.getRelationsFor('Charlie')).toHaveLength(0);
    });
  });

  describe('add', () => {
    it('should add relation to both indexes', () => {
      const rel = createRelation('Alice', 'Bob', 'works_with');
      index.add(rel);

      expect(index.getRelationsFrom('Alice')).toContainEqual(rel);
      expect(index.getRelationsTo('Bob')).toContainEqual(rel);
    });
  });

  describe('remove', () => {
    it('should remove relation from both indexes', () => {
      const rel1 = createRelation('Alice', 'Bob', 'works_with');
      const rel2 = createRelation('Alice', 'Bob', 'knows');

      index.add(rel1);
      index.add(rel2);
      expect(index.size).toBe(2);

      index.remove(rel1);

      expect(index.size).toBe(1);
      expect(index.getRelationsFrom('Alice')).toHaveLength(1);
      expect(index.getRelationsTo('Bob')).toHaveLength(1);
      expect(index.getRelationsFor('Alice')[0].relationType).toBe('knows');
    });

    it('should handle removing non-existent relation', () => {
      const rel = createRelation('Alice', 'Bob', 'works_with');
      expect(() => index.remove(rel)).not.toThrow();
    });

    it('should delete empty buckets', () => {
      const rel = createRelation('Alice', 'Bob', 'works_with');
      index.add(rel);
      index.remove(rel);

      expect(index.hasRelations('Alice')).toBe(false);
      expect(index.hasRelations('Bob')).toBe(false);
    });
  });

  describe('removeAllForEntity', () => {
    it('should remove all relations involving the entity', () => {
      const rel1 = createRelation('Alice', 'Bob', 'works_with');
      const rel2 = createRelation('Charlie', 'Alice', 'reports_to');
      const rel3 = createRelation('Bob', 'Charlie', 'knows');

      index.add(rel1);
      index.add(rel2);
      index.add(rel3);
      expect(index.size).toBe(3);

      const removed = index.removeAllForEntity('Alice');

      expect(removed).toHaveLength(2);
      expect(removed).toContainEqual(rel1);
      expect(removed).toContainEqual(rel2);
      expect(index.size).toBe(1);
      expect(index.hasRelations('Alice')).toBe(false);
    });

    it('should handle self-referential relations', () => {
      const selfRef = createRelation('Node', 'Node', 'self_link');
      const otherRel = createRelation('Node', 'Other', 'links_to');

      index.add(selfRef);
      index.add(otherRel);

      const removed = index.removeAllForEntity('Node');

      expect(removed).toHaveLength(2);
      expect(index.size).toBe(0);
    });

    it('should return empty array for entity with no relations', () => {
      const removed = index.removeAllForEntity('NonExistent');
      expect(removed).toHaveLength(0);
    });
  });

  describe('hasRelations', () => {
    it('should return true for entity with outgoing relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));

      expect(index.hasRelations('Alice')).toBe(true);
    });

    it('should return true for entity with incoming relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));

      expect(index.hasRelations('Bob')).toBe(true);
    });

    it('should return false for entity with no relations', () => {
      expect(index.hasRelations('NonExistent')).toBe(false);
    });
  });

  describe('getOutgoingCount', () => {
    it('should return count of outgoing relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));
      index.add(createRelation('Alice', 'Charlie', 'manages'));
      index.add(createRelation('Bob', 'Charlie', 'reports_to'));

      expect(index.getOutgoingCount('Alice')).toBe(2);
      expect(index.getOutgoingCount('Bob')).toBe(1);
      expect(index.getOutgoingCount('Charlie')).toBe(0);
    });
  });

  describe('getIncomingCount', () => {
    it('should return count of incoming relations', () => {
      index.add(createRelation('Alice', 'Bob', 'works_with'));
      index.add(createRelation('Alice', 'Charlie', 'manages'));
      index.add(createRelation('Bob', 'Charlie', 'reports_to'));

      expect(index.getIncomingCount('Alice')).toBe(0);
      expect(index.getIncomingCount('Bob')).toBe(1);
      expect(index.getIncomingCount('Charlie')).toBe(2);
    });
  });

  describe('size', () => {
    it('should return total count of relations', () => {
      index.add(createRelation('A', 'B', 'type1'));
      index.add(createRelation('B', 'C', 'type2'));
      index.add(createRelation('C', 'A', 'type3'));

      expect(index.size).toBe(3);
    });

    it('should return 0 for empty index', () => {
      expect(index.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      index.add(createRelation('A', 'B', 'type1'));
      index.add(createRelation('B', 'C', 'type2'));
      expect(index.size).toBe(2);

      index.clear();

      expect(index.size).toBe(0);
      expect(index.hasRelations('A')).toBe(false);
      expect(index.hasRelations('B')).toBe(false);
      expect(index.hasRelations('C')).toBe(false);
    });
  });
});

describe('ObservationIndex', () => {
  let index: ObservationIndex;

  beforeEach(() => {
    index = new ObservationIndex();
  });

  describe('add and getEntitiesWithWord', () => {
    it('should index single word observations', () => {
      index.add('Entity1', ['hello world']);

      const helloEntities = index.getEntitiesWithWord('hello');
      const worldEntities = index.getEntitiesWithWord('world');

      expect(helloEntities.has('Entity1')).toBe(true);
      expect(worldEntities.has('Entity1')).toBe(true);
    });

    it('should handle multiple entities with same word', () => {
      index.add('Entity1', ['hello there']);
      index.add('Entity2', ['hello world']);

      const helloEntities = index.getEntitiesWithWord('hello');

      expect(helloEntities.size).toBe(2);
      expect(helloEntities.has('Entity1')).toBe(true);
      expect(helloEntities.has('Entity2')).toBe(true);
    });

    it('should normalize to lowercase', () => {
      index.add('Entity1', ['Hello World']);

      const lowerHello = index.getEntitiesWithWord('hello');
      const upperHello = index.getEntitiesWithWord('HELLO');
      const mixedWorld = index.getEntitiesWithWord('WoRlD');

      expect(lowerHello.has('Entity1')).toBe(true);
      expect(upperHello.has('Entity1')).toBe(true);
      expect(mixedWorld.has('Entity1')).toBe(true);
    });

    it('should split on punctuation', () => {
      index.add('Entity1', ['hello,world;test!data']);

      expect(index.getEntitiesWithWord('hello').has('Entity1')).toBe(true);
      expect(index.getEntitiesWithWord('world').has('Entity1')).toBe(true);
      expect(index.getEntitiesWithWord('test').has('Entity1')).toBe(true);
      expect(index.getEntitiesWithWord('data').has('Entity1')).toBe(true);
    });

    it('should filter out short words (less than 2 chars)', () => {
      index.add('Entity1', ['a b cd ef']);

      expect(index.getEntitiesWithWord('a').size).toBe(0);
      expect(index.getEntitiesWithWord('b').size).toBe(0);
      expect(index.getEntitiesWithWord('cd').has('Entity1')).toBe(true);
      expect(index.getEntitiesWithWord('ef').has('Entity1')).toBe(true);
    });

    it('should return empty set for unknown word', () => {
      index.add('Entity1', ['hello world']);

      const result = index.getEntitiesWithWord('nonexistent');

      expect(result.size).toBe(0);
    });
  });

  describe('remove', () => {
    it('should remove entity from index', () => {
      index.add('Entity1', ['hello world']);
      index.add('Entity2', ['hello there']);

      index.remove('Entity1');

      const helloEntities = index.getEntitiesWithWord('hello');
      const worldEntities = index.getEntitiesWithWord('world');

      expect(helloEntities.has('Entity1')).toBe(false);
      expect(helloEntities.has('Entity2')).toBe(true);
      expect(worldEntities.size).toBe(0);
    });

    it('should clean up empty word entries', () => {
      index.add('Entity1', ['unique']);

      index.remove('Entity1');

      const stats = index.getStats();
      expect(stats.wordCount).toBe(0);
      expect(stats.entityCount).toBe(0);
    });

    it('should handle removing non-existent entity', () => {
      index.add('Entity1', ['hello']);

      // Should not throw
      expect(() => index.remove('NonExistent')).not.toThrow();

      // Original entity should still be there
      expect(index.getEntitiesWithWord('hello').has('Entity1')).toBe(true);
    });
  });

  describe('getEntitiesWithAnyWord', () => {
    it('should return union of entities matching any word', () => {
      index.add('Entity1', ['hello world']);
      index.add('Entity2', ['foo bar']);
      index.add('Entity3', ['hello bar']);

      const result = index.getEntitiesWithAnyWord(['hello', 'foo']);

      expect(result.size).toBe(3);
      expect(result.has('Entity1')).toBe(true);
      expect(result.has('Entity2')).toBe(true);
      expect(result.has('Entity3')).toBe(true);
    });

    it('should return empty for no matching words', () => {
      index.add('Entity1', ['hello world']);

      const result = index.getEntitiesWithAnyWord(['foo', 'bar']);

      expect(result.size).toBe(0);
    });
  });

  describe('getEntitiesWithAllWords', () => {
    it('should return intersection of entities matching all words', () => {
      index.add('Entity1', ['hello world foo']);
      index.add('Entity2', ['hello world']);
      index.add('Entity3', ['hello foo']);

      const result = index.getEntitiesWithAllWords(['hello', 'world']);

      expect(result.size).toBe(2);
      expect(result.has('Entity1')).toBe(true);
      expect(result.has('Entity2')).toBe(true);
      expect(result.has('Entity3')).toBe(false);
    });

    it('should return empty for no matching all words', () => {
      index.add('Entity1', ['hello']);
      index.add('Entity2', ['world']);

      const result = index.getEntitiesWithAllWords(['hello', 'world']);

      expect(result.size).toBe(0);
    });

    it('should return empty for empty words array', () => {
      index.add('Entity1', ['hello world']);

      const result = index.getEntitiesWithAllWords([]);

      expect(result.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      index.add('Entity1', ['hello world']);
      index.add('Entity2', ['foo bar']);

      index.clear();

      expect(index.getEntitiesWithWord('hello').size).toBe(0);
      expect(index.getEntitiesWithWord('foo').size).toBe(0);

      const stats = index.getStats();
      expect(stats.wordCount).toBe(0);
      expect(stats.entityCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct counts', () => {
      index.add('Entity1', ['hello world']);
      index.add('Entity2', ['foo bar']);
      index.add('Entity3', ['hello']);

      const stats = index.getStats();

      // Unique words: hello, world, foo, bar = 4
      expect(stats.wordCount).toBe(4);
      expect(stats.entityCount).toBe(3);
    });
  });

  describe('performance', () => {
    it('should handle large number of entities efficiently', () => {
      const startTime = Date.now();

      // Add 1000 entities with observations
      for (let i = 0; i < 1000; i++) {
        index.add(`Entity${i}`, [
          `observation ${i} with some common words`,
          `another observation for entity ${i}`,
        ]);
      }

      // Perform 100 lookups
      for (let i = 0; i < 100; i++) {
        index.getEntitiesWithWord('observation');
        index.getEntitiesWithWord('common');
        index.getEntitiesWithWord(`entity`);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 100ms for indexing + 100 lookups)
      expect(duration).toBeLessThan(100);
    });
  });
});
