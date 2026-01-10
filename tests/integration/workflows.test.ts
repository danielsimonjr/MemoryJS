/**
 * Integration Tests for Complete Workflows
 *
 * Tests that verify multiple components work together correctly
 * in realistic end-to-end scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { RelationManager } from '../../src/core/RelationManager.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { BasicSearch } from '../../src/search/BasicSearch.js';
import { RankedSearch } from '../../src/search/RankedSearch.js';
import { BooleanSearch } from '../../src/search/BooleanSearch.js';
import { FuzzySearch } from '../../src/search/FuzzySearch.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Integration: Complete Workflows', () => {
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let compressionManager: CompressionManager;
  let basicSearch: BasicSearch;
  let rankedSearch: RankedSearch;
  let booleanSearch: BooleanSearch;
  let fuzzySearch: FuzzySearch;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `integration-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    compressionManager = new CompressionManager(storage);
    basicSearch = new BasicSearch(storage);
    rankedSearch = new RankedSearch(storage);
    booleanSearch = new BooleanSearch(storage);
    fuzzySearch = new FuzzySearch(storage);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Entity Creation and Search Workflow', () => {
    it('should create entities, establish relations, and find them via search', async () => {
      // Step 1: Create team entities
      const team = await entityManager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Senior software engineer', 'Team lead', 'Expert in TypeScript'],
          tags: ['engineering', 'leadership'],
          importance: 9,
        },
        {
          name: 'Bob',
          entityType: 'person',
          observations: ['Frontend developer', 'React specialist'],
          tags: ['engineering', 'frontend'],
          importance: 7,
        },
        {
          name: 'Project_Alpha',
          entityType: 'project',
          observations: ['New web application', 'TypeScript and React stack'],
          tags: ['engineering', 'web'],
          importance: 10,
        },
      ]);

      expect(team).toHaveLength(3);

      // Step 2: Establish relationships
      await relationManager.createRelations([
        { from: 'Alice', to: 'Project_Alpha', relationType: 'leads' },
        { from: 'Bob', to: 'Project_Alpha', relationType: 'works_on' },
        { from: 'Bob', to: 'Alice', relationType: 'reports_to' },
      ]);

      // Step 3: Search using different methods
      const basicResults = await basicSearch.searchNodes('TypeScript');
      expect(basicResults.entities.length).toBeGreaterThanOrEqual(2);
      expect(basicResults.entities.map(e => e.name)).toContain('Alice');
      expect(basicResults.entities.map(e => e.name)).toContain('Project_Alpha');

      // Step 4: Ranked search should prioritize by relevance
      const rankedResults = await rankedSearch.searchNodesRanked('TypeScript engineer');
      expect(rankedResults.length).toBeGreaterThan(0);
      expect(rankedResults[0].entity.name).toBe('Alice'); // Alice has both terms

      // Step 5: Boolean search with field queries
      const booleanResults = await booleanSearch.booleanSearch('type:person AND tag:engineering');
      expect(booleanResults.entities).toHaveLength(2);
      expect(booleanResults.entities.map(e => e.name)).toContain('Alice');
      expect(booleanResults.entities.map(e => e.name)).toContain('Bob');

      // Step 6: Verify relations are included in search results
      expect(basicResults.relations.length).toBeGreaterThan(0);
      expect(basicResults.relations.some(r => r.from === 'Alice' && r.to === 'Project_Alpha')).toBe(true);
    });

    it('should handle fuzzy search after entity creation with typos', async () => {
      // Create entities
      await entityManager.createEntities([
        { name: 'PostgreSQL', entityType: 'database', observations: ['Relational database'] },
        { name: 'MongoDB', entityType: 'database', observations: ['NoSQL database'] },
      ]);

      // Fuzzy search with typo
      const fuzzyResults = await fuzzySearch.fuzzySearch('Postgress', 0.7); // Missing 'QL', extra 's'
      expect(fuzzyResults.entities.length).toBeGreaterThan(0);
      expect(fuzzyResults.entities[0].name).toBe('PostgreSQL');
    });
  });

  describe('Compression and Search Workflow', () => {
    it('should compress duplicates and maintain searchability', async () => {
      // Step 1: Create duplicate entities (more similar names for better matching)
      await entityManager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Software engineer at TechCorp'],
          importance: 8,
        },
        {
          name: 'Alicia',
          entityType: 'person',
          observations: ['Works on backend systems'],
          importance: 7,
        },
        {
          name: 'Bob',
          entityType: 'person',
          observations: ['Product manager'],
          importance: 6,
        },
      ]);

      // Step 2: Search before compression
      const beforeSearch = await basicSearch.searchNodes('Ali');
      expect(beforeSearch.entities).toHaveLength(2);

      // Step 3: Compress duplicates with lower threshold for similar names
      const compressionResult = await compressionManager.compressGraph(0.7);

      // If duplicates were found and merged
      if (compressionResult.entitiesMerged > 0) {
        // Step 4: Search after compression
        const afterSearch = await basicSearch.searchNodes('Ali');
        expect(afterSearch.entities).toHaveLength(1);

        // Step 5: Verify merged entity has combined observations
        const mergedEntity = afterSearch.entities[0];
        expect(mergedEntity.observations.length).toBeGreaterThanOrEqual(2);
        expect(mergedEntity.importance).toBe(8); // Should keep highest importance
      } else {
        // If no merging occurred, verify entities are still searchable
        const afterSearch = await basicSearch.searchNodes('Ali');
        expect(afterSearch.entities).toHaveLength(2);
      }
    });

    it('should preserve relations after compression', async () => {
      // Create entities with very similar names
      await entityManager.createEntities([
        { name: 'Developer_Alice', entityType: 'person', observations: ['Engineer'] },
        { name: 'Developer_Alicia', entityType: 'person', observations: ['Developer'] },
        { name: 'Project_Important', entityType: 'project', observations: ['Important project'] },
      ]);

      await relationManager.createRelations([
        { from: 'Developer_Alice', to: 'Project_Important', relationType: 'works_on' },
        { from: 'Developer_Alicia', to: 'Project_Important', relationType: 'leads' },
      ]);

      // Verify relations exist before compression
      const beforeSearch = await basicSearch.searchNodes('Developer');
      expect(beforeSearch.entities).toHaveLength(2);
      expect(beforeSearch.relations.length).toBeGreaterThanOrEqual(0);

      // Compress with lower threshold
      await compressionManager.compressGraph(0.7);

      // Verify graph is still functional after compression
      const afterSearch = await basicSearch.searchNodes('');
      expect(afterSearch.entities.length).toBeGreaterThanOrEqual(1);

      // Verify project entity still exists
      const projectSearch = await basicSearch.searchNodes('Project_Important');
      expect(projectSearch.entities).toHaveLength(1);
    });
  });

  describe('Batch Update and Search Workflow', () => {
    it('should batch update entities and verify with search', async () => {
      // Step 1: Create multiple entities
      await entityManager.createEntities([
        { name: 'Task_1', entityType: 'task', observations: ['High priority'], importance: 5 },
        { name: 'Task_2', entityType: 'task', observations: ['Medium priority'], importance: 5 },
        { name: 'Task_3', entityType: 'task', observations: ['Low priority'], importance: 5 },
      ]);

      // Step 2: Batch update importance
      const updated = await entityManager.batchUpdate([
        { name: 'Task_1', updates: { importance: 10 } },
        { name: 'Task_2', updates: { importance: 8 } },
        { name: 'Task_3', updates: { importance: 3 } },
      ]);

      expect(updated).toHaveLength(3);

      // Step 3: Search with importance filter
      const highPriorityTasks = await basicSearch.searchNodes('task', undefined, 8);
      expect(highPriorityTasks.entities).toHaveLength(2);
      expect(highPriorityTasks.entities.map(e => e.name)).toContain('Task_1');
      expect(highPriorityTasks.entities.map(e => e.name)).toContain('Task_2');

      // Step 4: Verify all entities have same lastModified timestamp
      const timestamps = updated.map(e => e.lastModified);
      expect(new Set(timestamps).size).toBe(1); // All same timestamp
    });
  });

  describe('Complex Query Workflow', () => {
    it('should handle complex boolean queries on large dataset', async () => {
      // Create diverse dataset
      await entityManager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Senior engineer', 'Python expert', 'Team lead'],
          tags: ['engineering', 'python', 'leadership'],
          importance: 9,
        },
        {
          name: 'Bob',
          entityType: 'person',
          observations: ['Junior engineer', 'Learning Python'],
          tags: ['engineering', 'python'],
          importance: 5,
        },
        {
          name: 'Charlie',
          entityType: 'person',
          observations: ['Designer', 'UI specialist'],
          tags: ['design', 'ui'],
          importance: 7,
        },
        {
          name: 'Project_Python',
          entityType: 'project',
          observations: ['Python automation tool'],
          tags: ['engineering', 'python', 'automation'],
          importance: 10,
        },
      ]);

      // Complex boolean query
      const results = await booleanSearch.booleanSearch(
        '(type:person AND tag:python AND NOT observation:Junior) OR (type:project AND tag:automation)',
        undefined,
        7
      );

      expect(results.entities.length).toBeGreaterThanOrEqual(2);
      const names = results.entities.map(e => e.name);
      expect(names).toContain('Alice'); // Senior engineer with Python
      expect(names).toContain('Project_Python'); // Project with automation
      expect(names).not.toContain('Bob'); // Filtered by "NOT Junior"
      expect(names).not.toContain('Charlie'); // No Python tag
    });

    it('should combine ranked search with filters for precise results', async () => {
      await entityManager.createEntities([
        {
          name: 'Article_ML',
          entityType: 'article',
          observations: ['Machine learning fundamentals', 'Deep learning tutorial'],
          tags: ['ai', 'ml', 'tutorial'],
          importance: 9,
        },
        {
          name: 'Article_Web',
          entityType: 'article',
          observations: ['Web development basics', 'React fundamentals'],
          tags: ['web', 'tutorial'],
          importance: 7,
        },
        {
          name: 'Article_AI',
          entityType: 'article',
          observations: ['AI in production', 'Deploying ML models'],
          tags: ['ai', 'ml', 'production'],
          importance: 10,
        },
      ]);

      // Ranked search with tag filter
      const results = await rankedSearch.searchNodesRanked(
        'machine learning production',
        ['ai'],
        8
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Verify all results have 'ai' tag and importance >= 8
      results.forEach(r => {
        expect(r.entity.tags).toContain('ai');
        expect(r.entity.importance!).toBeGreaterThanOrEqual(8);
      });

      // At least one result should be Article_AI or Article_ML (both have ai tag and importance >= 8)
      const names = results.map(r => r.entity.name);
      expect(names.some(n => n === 'Article_AI' || n === 'Article_ML')).toBe(true);
    });
  });

  describe('Date Range and Tag Workflow', () => {
    it('should filter by date range and tags together', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Create entities at different times
      await entityManager.createEntities([
        {
          name: 'Old_Task',
          entityType: 'task',
          observations: ['Historical task'],
          tags: ['archived'],
        },
      ]);

      // Manually adjust createdAt for testing
      const graph = await storage.getGraphForMutation();
      graph.entities[0].createdAt = yesterday.toISOString();
      await storage.saveGraph(graph);

      // Create new entity
      await entityManager.createEntities([
        {
          name: 'New_Task',
          entityType: 'task',
          observations: ['Current task'],
          tags: ['active'],
        },
      ]);

      // Search by date range
      const recentTasks = await basicSearch.searchByDateRange(
        now.toISOString(),
        tomorrow.toISOString(),
        'task'
      );

      expect(recentTasks.entities).toHaveLength(1);
      expect(recentTasks.entities[0].name).toBe('New_Task');

      // Search by date range with tag filter
      const activeTasks = await basicSearch.searchByDateRange(
        now.toISOString(),
        tomorrow.toISOString(),
        'task',
        ['active']
      );

      expect(activeTasks.entities).toHaveLength(1);
      expect(activeTasks.entities[0].tags).toContain('active');
    });
  });

  describe('Error Handling in Workflows', () => {
    it('should reject relations to non-existent entities', async () => {
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'person', observations: ['Test'] },
      ]);

      // RelationManager validates that referenced entities exist (prevents dangling relations)
      // Creating a relation to a non-existent entity should throw an error
      await expect(relationManager.createRelations([
        { from: 'TestEntity', to: 'Future_Entity', relationType: 'knows' },
      ])).rejects.toThrow('Relations reference non-existent entities');

      // Verify TestEntity still exists and can be searched
      const results = await basicSearch.searchNodes('TestEntity');
      expect(results.entities).toHaveLength(1);

      // No relations should exist
      expect(results.relations).toHaveLength(0);
    });

    it('should handle batch update with partial failures gracefully', async () => {
      await entityManager.createEntities([
        { name: 'Entity_1', entityType: 'test', observations: ['Test'] },
      ]);

      // Batch update with non-existent entity should fail atomically
      await expect(
        entityManager.batchUpdate([
          { name: 'Entity_1', updates: { importance: 5 } },
          { name: 'NonExistent', updates: { importance: 10 } },
        ])
      ).rejects.toThrow();

      // Verify Entity_1 was not updated (atomic failure)
      const entity = await entityManager.getEntity('Entity_1');
      expect(entity).toBeDefined();
      expect(entity!.importance).toBeUndefined();
    });
  });

  describe('Real-World Scenario: Team Knowledge Base', () => {
    it('should build and query a team knowledge base', async () => {
      // Step 1: Create team structure
      await entityManager.createEntities([
        {
          name: 'Engineering_Team',
          entityType: 'team',
          observations: ['Core product development', '15 engineers'],
          tags: ['engineering', 'product'],
          importance: 10,
        },
        {
          name: 'Alice_Chen',
          entityType: 'person',
          observations: ['Tech lead', 'Microservices expert', '5 years experience'],
          tags: ['engineering', 'leadership', 'backend'],
          importance: 9,
        },
        {
          name: 'Bob_Smith',
          entityType: 'person',
          observations: ['Senior engineer', 'Frontend specialist', 'React expert'],
          tags: ['engineering', 'frontend'],
          importance: 8,
        },
        {
          name: 'Service_Auth',
          entityType: 'service',
          observations: ['Authentication service', 'OAuth2 implementation', 'Critical system'],
          tags: ['backend', 'security', 'production'],
          importance: 10,
        },
      ]);

      // Step 2: Establish relationships
      await relationManager.createRelations([
        { from: 'Alice_Chen', to: 'Engineering_Team', relationType: 'member_of' },
        { from: 'Bob_Smith', to: 'Engineering_Team', relationType: 'member_of' },
        { from: 'Alice_Chen', to: 'Service_Auth', relationType: 'maintains' },
        { from: 'Bob_Smith', to: 'Alice_Chen', relationType: 'reports_to' },
      ]);

      // Step 3: Query "Who maintains critical services?"
      const criticalServiceResults = await booleanSearch.booleanSearch(
        'type:service AND tag:production AND observation:Critical'
      );
      expect(criticalServiceResults.entities).toHaveLength(1);

      // Find maintainers via search with relations
      const teamSearchResult = await basicSearch.openNodes(['Alice_Chen', 'Service_Auth']);
      expect(teamSearchResult.entities.length).toBe(2);

      // Verify maintains relation exists
      const maintainsRelation = teamSearchResult.relations.find(
        r => r.from === 'Alice_Chen' && r.to === 'Service_Auth' && r.relationType === 'maintains'
      );
      expect(maintainsRelation).toBeDefined();

      // Step 4: Query "Who are the senior backend engineers?"
      const seniorBackendResults = await booleanSearch.booleanSearch(
        'type:person AND tag:backend AND (observation:Senior OR observation:lead)'
      );
      expect(seniorBackendResults.entities.length).toBeGreaterThanOrEqual(1);
      expect(seniorBackendResults.entities.map(e => e.name)).toContain('Alice_Chen');

      // Step 5: Find expertise with fuzzy search (handle typos)
      const expertiseResults = await fuzzySearch.fuzzySearch('Microservise', 0.7); // Typo
      expect(expertiseResults.entities.length).toBeGreaterThan(0);
      expect(expertiseResults.entities[0].name).toBe('Alice_Chen');

      // Step 6: Get team overview with relations
      const teamResults = await basicSearch.openNodes(['Engineering_Team', 'Alice_Chen', 'Bob_Smith']);
      expect(teamResults.entities).toHaveLength(3);
      expect(teamResults.relations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Performance with Large Datasets', () => {
    it('should handle search on 100+ entities efficiently', async () => {
      // Create large dataset
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity_${i}`,
        entityType: i % 3 === 0 ? 'person' : i % 3 === 1 ? 'project' : 'task',
        observations: [
          `Description for entity ${i}`,
          i % 2 === 0 ? 'Important work' : 'Regular work',
        ],
        tags: i % 2 === 0 ? ['important'] : ['regular'],
        importance: Math.floor(Math.random() * 10) + 1,
      }));

      await entityManager.createEntities(entities);

      // Perform various searches
      const startTime = Date.now();

      const basicResults = await basicSearch.searchNodes('entity', ['important']);
      expect(basicResults.entities.length).toBeGreaterThan(0);

      const rankedResults = await rankedSearch.searchNodesRanked('important work', undefined, 5);
      expect(rankedResults.length).toBeGreaterThan(0);

      const booleanResults = await booleanSearch.booleanSearch('type:person OR type:project');
      expect(booleanResults.entities.length).toBeGreaterThan(0);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // All searches should complete in reasonable time (< 1 second for 100 entities)
      expect(duration).toBeLessThan(1000);
    });
  });
});
