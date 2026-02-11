/**
 * Tests for CLI Command Registry
 *
 * @module tests/unit/cli/commands.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Mock managers
const mockEntityManager = {
  createEntities: vi.fn(),
  getEntity: vi.fn(),
  updateEntity: vi.fn(),
  deleteEntities: vi.fn(),
};

const mockRelationManager = {
  createRelations: vi.fn(),
  deleteRelations: vi.fn(),
};

const mockSearchManager = {
  searchNodes: vi.fn(),
  autoSearch: vi.fn(),
};

const mockAnalyticsManager = {
  getGraphStats: vi.fn(),
};

const mockIoManager = {
  importGraph: vi.fn(),
  exportGraph: vi.fn(),
};

const mockStorage = {
  loadGraph: vi.fn(),
};

vi.mock('../../../src/core/ManagerContext.js', () => {
  return {
    ManagerContext: class MockManagerContext {
      entityManager = mockEntityManager;
      relationManager = mockRelationManager;
      searchManager = mockSearchManager;
      analyticsManager = mockAnalyticsManager;
      ioManager = mockIoManager;
      storage = mockStorage;
      constructor() {}
    },
  };
});

// Import after mocks
import { registerCommands } from '../../../src/cli/commands/index.js';

describe('CLI Commands', () => {
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    });
    program.option('-s, --storage <path>', 'Path to storage file', './test.jsonl');
    program.option('-f, --format <type>', 'Output format', 'json');
    program.option('-q, --quiet', 'Suppress output');
    program.option('--verbose', 'Enable verbose');

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Default mock implementations
    mockStorage.loadGraph.mockResolvedValue({
      entities: [{ name: 'Test', entityType: 'test', observations: [] }],
      relations: [{ from: 'A', to: 'B', relationType: 'related' }],
    });

    mockEntityManager.createEntities.mockResolvedValue([{
      name: 'NewEntity',
      entityType: 'test',
      observations: [],
    }]);

    mockEntityManager.getEntity.mockResolvedValue({
      name: 'Test',
      entityType: 'test',
      observations: ['obs'],
    });

    mockEntityManager.updateEntity.mockResolvedValue({
      name: 'Test',
      entityType: 'updated',
      observations: [],
    });

    mockSearchManager.searchNodes.mockResolvedValue({
      entities: [{ name: 'Result', entityType: 'test', observations: [] }],
    });

    mockSearchManager.autoSearch.mockResolvedValue({
      selectedMethod: 'ranked',
      selectionReason: 'default',
      results: [{ entity: { name: 'Result', entityType: 'test', observations: [] }, score: 0.95 }],
      executionTimeMs: 10,
    });

    mockAnalyticsManager.getGraphStats.mockResolvedValue({
      totalEntities: 10,
      totalRelations: 5,
      entityTypesCounts: { person: 5, organization: 3, project: 2 },
      relationTypesCounts: { knows: 3, works_at: 2 },
    });

    mockIoManager.importGraph.mockResolvedValue({
      entitiesAdded: 5,
      relationsAdded: 3,
    });

    mockIoManager.exportGraph.mockReturnValue('{"entities":[],"relations":[]}');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('Command Registration', () => {
    it('should register entity command', () => {
      registerCommands(program);
      const entityCmd = program.commands.find(c => c.name() === 'entity');
      expect(entityCmd).toBeDefined();
    });

    it('should register relation command', () => {
      registerCommands(program);
      const relationCmd = program.commands.find(c => c.name() === 'relation');
      expect(relationCmd).toBeDefined();
    });

    it('should register search command', () => {
      registerCommands(program);
      const searchCmd = program.commands.find(c => c.name() === 'search');
      expect(searchCmd).toBeDefined();
    });

    it('should register import command', () => {
      registerCommands(program);
      const importCmd = program.commands.find(c => c.name() === 'import');
      expect(importCmd).toBeDefined();
    });

    it('should register export command', () => {
      registerCommands(program);
      const exportCmd = program.commands.find(c => c.name() === 'export');
      expect(exportCmd).toBeDefined();
    });

    it('should register stats command', () => {
      registerCommands(program);
      const statsCmd = program.commands.find(c => c.name() === 'stats');
      expect(statsCmd).toBeDefined();
    });

    it('should register interactive command with alias', () => {
      registerCommands(program);
      const interactiveCmd = program.commands.find(c => c.name() === 'interactive');
      expect(interactiveCmd).toBeDefined();
      expect(interactiveCmd?.alias()).toBe('i');
    });

    it('should register all entity subcommands', () => {
      registerCommands(program);
      const entityCmd = program.commands.find(c => c.name() === 'entity');
      const subcommands = entityCmd?.commands.map(c => c.name()) || [];
      expect(subcommands).toContain('create');
      expect(subcommands).toContain('get');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('update');
      expect(subcommands).toContain('delete');
    });

    it('should register all relation subcommands', () => {
      registerCommands(program);
      const relationCmd = program.commands.find(c => c.name() === 'relation');
      const subcommands = relationCmd?.commands.map(c => c.name()) || [];
      expect(subcommands).toContain('create');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('delete');
    });
  });

  describe('Entity Commands', () => {
    it('entity create should create an entity', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'create', 'TestEntity', '-t', 'person']);

      expect(mockEntityManager.createEntities).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'TestEntity',
          entityType: 'person',
        }),
      ]);
    });

    it('entity create should handle observations', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'create', 'TestEntity', '-o', 'obs1', 'obs2']);

      expect(mockEntityManager.createEntities).toHaveBeenCalledWith([
        expect.objectContaining({
          observations: ['obs1', 'obs2'],
        }),
      ]);
    });

    it('entity create should handle tags', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'create', 'TestEntity', '--tags', 'tag1', 'tag2']);

      expect(mockEntityManager.createEntities).toHaveBeenCalledWith([
        expect.objectContaining({
          tags: ['tag1', 'tag2'],
        }),
      ]);
    });

    it('entity create should handle importance', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'create', 'TestEntity', '-i', '8']);

      expect(mockEntityManager.createEntities).toHaveBeenCalledWith([
        expect.objectContaining({
          importance: 8,
        }),
      ]);
    });

    it('entity create should handle errors', async () => {
      mockEntityManager.createEntities.mockRejectedValue(new Error('Create failed'));
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'entity', 'create', 'TestEntity'])
      ).rejects.toThrow();
    });

    it('entity get should retrieve an entity', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'get', 'TestEntity']);

      expect(mockEntityManager.getEntity).toHaveBeenCalledWith('TestEntity');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('entity get should handle not found', async () => {
      mockEntityManager.getEntity.mockResolvedValue(null);
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'entity', 'get', 'Missing'])
      ).rejects.toThrow();
    });

    it('entity list should list entities', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'list']);

      expect(mockStorage.loadGraph).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('entity list should filter by type', async () => {
      mockStorage.loadGraph.mockResolvedValue({
        entities: [
          { name: 'Person1', entityType: 'person', observations: [] },
          { name: 'Org1', entityType: 'organization', observations: [] },
        ],
        relations: [],
      });

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'list', '-t', 'person']);

      // Should only show person type
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('entity list should filter by tags', async () => {
      mockStorage.loadGraph.mockResolvedValue({
        entities: [
          { name: 'Tagged', entityType: 'test', observations: [], tags: ['important'] },
          { name: 'Untagged', entityType: 'test', observations: [] },
        ],
        relations: [],
      });

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'list', '--tags', 'important']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('entity list should limit results', async () => {
      mockStorage.loadGraph.mockResolvedValue({
        entities: Array.from({ length: 20 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
        })),
        relations: [],
      });

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'list', '-l', '5']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('entity update should update an entity', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'update', 'Test', '-t', 'newtype']);

      expect(mockEntityManager.getEntity).toHaveBeenCalledWith('Test');
      expect(mockEntityManager.updateEntity).toHaveBeenCalledWith('Test', expect.objectContaining({
        entityType: 'newtype',
      }));
    });

    it('entity update should add observations', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'update', 'Test', '-o', 'new obs']);

      expect(mockEntityManager.updateEntity).toHaveBeenCalledWith('Test', expect.objectContaining({
        observations: expect.arrayContaining(['obs', 'new obs']),
      }));
    });

    it('entity update should set tags', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'update', 'Test', '--tags', 'tag1', 'tag2']);

      expect(mockEntityManager.updateEntity).toHaveBeenCalledWith('Test', expect.objectContaining({
        tags: ['tag1', 'tag2'],
      }));
    });

    it('entity update should set importance', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'update', 'Test', '-i', '9']);

      expect(mockEntityManager.updateEntity).toHaveBeenCalledWith('Test', expect.objectContaining({
        importance: 9,
      }));
    });

    it('entity update should handle not found', async () => {
      mockEntityManager.getEntity.mockResolvedValue(null);
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'entity', 'update', 'Missing', '-t', 'new'])
      ).rejects.toThrow();
    });

    it('entity delete should delete an entity', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'entity', 'delete', 'Test']);

      expect(mockEntityManager.deleteEntities).toHaveBeenCalledWith(['Test']);
    });

    it('entity delete should handle errors', async () => {
      mockEntityManager.deleteEntities.mockRejectedValue(new Error('Delete failed'));
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'entity', 'delete', 'Test'])
      ).rejects.toThrow();
    });
  });

  describe('Relation Commands', () => {
    it('relation create should create a relation', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'relation', 'create', 'Entity1', 'knows', 'Entity2']);

      expect(mockRelationManager.createRelations).toHaveBeenCalledWith([{
        from: 'Entity1',
        to: 'Entity2',
        relationType: 'knows',
      }]);
    });

    it('relation create should handle errors', async () => {
      mockRelationManager.createRelations.mockRejectedValue(new Error('Create failed'));
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'relation', 'create', 'A', 'rel', 'B'])
      ).rejects.toThrow();
    });

    it('relation list should list relations', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'relation', 'list']);

      expect(mockStorage.loadGraph).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('relation list should filter by from', async () => {
      mockStorage.loadGraph.mockResolvedValue({
        entities: [],
        relations: [
          { from: 'A', to: 'B', relationType: 'rel' },
          { from: 'C', to: 'D', relationType: 'rel' },
        ],
      });

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'relation', 'list', '--from', 'A']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('relation list should filter by to', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'relation', 'list', '--to', 'B']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('relation list should filter by type', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'relation', 'list', '-t', 'related']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('relation delete should delete a relation', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'relation', 'delete', 'A', 'related', 'B']);

      expect(mockRelationManager.deleteRelations).toHaveBeenCalledWith([{
        from: 'A',
        to: 'B',
        relationType: 'related',
      }]);
    });

    it('relation delete should handle errors', async () => {
      mockRelationManager.deleteRelations.mockRejectedValue(new Error('Delete failed'));
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'relation', 'delete', 'A', 'rel', 'B'])
      ).rejects.toThrow();
    });
  });

  describe('Search Command', () => {
    it('should search entities', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'search', 'test query']);

      expect(mockSearchManager.autoSearch).toHaveBeenCalledWith('test query', 10);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should filter by type', async () => {
      mockSearchManager.autoSearch.mockResolvedValue({
        selectedMethod: 'ranked',
        selectionReason: 'default',
        results: [
          { entity: { name: 'Person1', entityType: 'person', observations: [] }, score: 0.9 },
          { entity: { name: 'Org1', entityType: 'organization', observations: [] }, score: 0.8 },
        ],
        executionTimeMs: 10,
      });

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'search', 'query', '-t', 'person']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should limit results', async () => {
      mockSearchManager.autoSearch.mockResolvedValue({
        selectedMethod: 'ranked',
        selectionReason: 'default',
        results: Array.from({ length: 20 }, (_, i) => ({
          entity: { name: `Entity${i}`, entityType: 'test', observations: [] },
          score: 1.0 - i * 0.01,
        })),
        executionTimeMs: 10,
      });

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'search', 'query', '-l', '5']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should handle search errors', async () => {
      mockSearchManager.autoSearch.mockRejectedValue(new Error('Search failed'));
      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'search', 'query'])
      ).rejects.toThrow();
    });
  });

  describe('Import Command', () => {
    it('should import from file', async () => {
      const fs = await import('fs');
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{"entities":[],"relations":[]}');

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'import', 'data.json']);

      expect(mockIoManager.importGraph).toHaveBeenCalledWith(
        'json',
        '{"entities":[],"relations":[]}',
        'skip'
      );
    });

    it('should use default json format', async () => {
      const fs = await import('fs');
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{"entities":[],"relations":[]}');

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'import', 'data.json']);

      // Default format is json
      expect(mockIoManager.importGraph).toHaveBeenCalledWith(
        'json',
        expect.any(String),
        'skip'
      );
    });

    it('should support merge option', async () => {
      const fs = await import('fs');
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{}');

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'import', 'data.json', '--merge', 'replace']);

      expect(mockIoManager.importGraph).toHaveBeenCalledWith(
        'json',
        expect.any(String),
        'replace'
      );
    });

    it('should handle import errors', async () => {
      mockIoManager.importGraph.mockRejectedValue(new Error('Import failed'));
      const fs = await import('fs');
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{}');

      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'import', 'data.json'])
      ).rejects.toThrow();
    });
  });

  describe('Export Command', () => {
    it('should export to file', async () => {
      const fs = await import('fs');

      registerCommands(program);
      await program.parseAsync(['node', 'test', 'export', 'output.json']);

      expect(mockStorage.loadGraph).toHaveBeenCalled();
      expect(mockIoManager.exportGraph).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith('output.json', expect.any(String), 'utf-8');
    });

    it('should use default json format', async () => {
      registerCommands(program);
      await program.parseAsync(['node', 'test', 'export', 'output.json']);

      // Default format is json
      expect(mockIoManager.exportGraph).toHaveBeenCalledWith(
        expect.anything(),
        'json'
      );
    });

    it('should handle export errors', async () => {
      mockIoManager.exportGraph.mockImplementation(() => {
        throw new Error('Export failed');
      });

      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'export', 'output.json'])
      ).rejects.toThrow();
    });
  });

  describe('Stats Command', () => {
    it('should show stats in table format', async () => {
      registerCommands(program);
      // Pass -f table to get table format (default is json)
      await program.parseAsync(['node', 'test', '-f', 'table', 'stats']);

      expect(mockAnalyticsManager.getGraphStats).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Statistics'));
    });

    it('should show stats in JSON format', async () => {
      registerCommands(program);
      // Default format is json, so this should output JSON
      await program.parseAsync(['node', 'test', 'stats']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('{'));
    });

    it('should handle stats errors', async () => {
      mockAnalyticsManager.getGraphStats.mockRejectedValue(new Error('Stats failed'));

      registerCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'stats'])
      ).rejects.toThrow();
    });
  });

  describe('Command Descriptions', () => {
    it('all commands should have descriptions', () => {
      registerCommands(program);

      for (const cmd of program.commands) {
        expect(cmd.description()).toBeTruthy();
      }
    });

    it('entity subcommands should have descriptions', () => {
      registerCommands(program);
      const entityCmd = program.commands.find(c => c.name() === 'entity');

      for (const cmd of entityCmd?.commands || []) {
        expect(cmd.description()).toBeTruthy();
      }
    });

    it('relation subcommands should have descriptions', () => {
      registerCommands(program);
      const relationCmd = program.commands.find(c => c.name() === 'relation');

      for (const cmd of relationCmd?.commands || []) {
        expect(cmd.description()).toBeTruthy();
      }
    });
  });
});
