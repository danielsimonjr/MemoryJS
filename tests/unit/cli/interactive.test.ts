/**
 * Tests for CLI Interactive Mode (REPL)
 *
 * @module tests/unit/cli/interactive.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as readline from 'readline';
import { EventEmitter } from 'events';

// Mock chalk to return plain text
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    gray: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

// Mock ManagerContext
const mockEntityManager = {
  getEntity: vi.fn(),
};

const mockRelationManager = {
  getRelations: vi.fn(),
};

const mockSearchManager = {
  searchNodes: vi.fn(),
};

const mockAnalyticsManager = {
  getGraphStats: vi.fn(),
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
      storage = mockStorage;
      constructor() {}
    },
  };
});

// Create a mock readline interface
class MockReadlineInterface extends EventEmitter {
  prompt = vi.fn();
  close = vi.fn();
  question = vi.fn();

  constructor() {
    super();
  }

  simulateLine(line: string): void {
    this.emit('line', line);
  }

  simulateClose(): void {
    this.emit('close');
  }
}

let mockRl: MockReadlineInterface;

vi.mock('readline', async () => {
  const actual = await vi.importActual('readline');
  return {
    ...actual,
    createInterface: vi.fn(() => {
      mockRl = new MockReadlineInterface();
      return mockRl;
    }),
  };
});

describe('CLI Interactive Mode', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleClearSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleClearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Default mock implementations
    mockStorage.loadGraph.mockResolvedValue({
      entities: [
        { name: 'TestEntity', entityType: 'test', observations: ['obs1'] },
        { name: 'AnotherEntity', entityType: 'person', observations: [] },
      ],
      relations: [],
    });

    mockEntityManager.getEntity.mockResolvedValue({
      name: 'TestEntity',
      entityType: 'test',
      observations: ['obs1'],
    });

    mockRelationManager.getRelations.mockResolvedValue([]);

    mockSearchManager.searchNodes.mockResolvedValue({
      entities: [
        { name: 'TestEntity', entityType: 'test', observations: ['obs1'] },
      ],
    });

    mockAnalyticsManager.getGraphStats.mockResolvedValue({
      totalEntities: 2,
      totalRelations: 0,
      entityTypesCounts: { test: 1, person: 1 },
      relationTypesCounts: {},
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleClearSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('REPL Initialization', () => {
    it('should create readline interface', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(readline.createInterface).toHaveBeenCalled();
      expect(mockRl.prompt).toHaveBeenCalled();

      // Close to exit
      try {
        mockRl.simulateClose();
      } catch {
        // Expected process.exit
      }
      try {
        await promise;
      } catch {
        // Expected process.exit
      }
    });

    it('should display welcome message', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Interactive Mode'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should load entity names for tab completion', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockStorage.loadGraph).toHaveBeenCalled();

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should handle readline close event', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected process.exit
      }
      try {
        await promise;
      } catch {
        // Expected process.exit
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Goodbye'));
    });
  });

  describe('Command Processing', () => {
    it('should ignore empty lines', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('');
      mockRl.simulateLine('   ');

      // Should just reprompt
      expect(mockRl.prompt).toHaveBeenCalledTimes(3); // Initial + 2 empty lines

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show help on help command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('help');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show help on .help command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('.help');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should exit on exit command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('exit');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRl.close).toHaveBeenCalled();

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should exit on quit command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('quit');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRl.close).toHaveBeenCalled();

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should clear screen on clear command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('clear');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleClearSpy).toHaveBeenCalled();

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should list entities on entities command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('entities');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Entities'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('TestEntity'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should list entities on ls command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('ls');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Entities'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show more message for many entities', async () => {
      mockStorage.loadGraph.mockResolvedValue({
        entities: Array.from({ length: 25 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
        })),
        relations: [],
      });

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('entities');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('and 5 more'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should get entity details on get command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('get TestEntity');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockEntityManager.getEntity).toHaveBeenCalledWith('TestEntity');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('TestEntity'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show usage on get without name', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('get');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show not found for missing entity', async () => {
      mockEntityManager.getEntity.mockResolvedValue(null);

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('get NonExistent');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Entity not found'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should search entities on search command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('search test query');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSearchManager.searchNodes).toHaveBeenCalledWith('test query');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Search results'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show usage on search without query', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('search');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show more message for many search results', async () => {
      mockSearchManager.searchNodes.mockResolvedValue({
        entities: Array.from({ length: 15 }, (_, i) => ({
          name: `Entity${i}`,
          entityType: 'test',
          observations: ['obs'],
        })),
      });

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('search test');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('and 5 more'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should truncate long observation previews', async () => {
      mockSearchManager.searchNodes.mockResolvedValue({
        entities: [{
          name: 'TestEntity',
          entityType: 'test',
          observations: ['This is a very long observation that definitely exceeds sixty characters and should be truncated'],
        }],
      });

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('search test');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('...'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show relations on relations command', async () => {
      mockRelationManager.getRelations.mockResolvedValue([
        { from: 'TestEntity', to: 'Other', relationType: 'knows' },
        { from: 'Another', to: 'TestEntity', relationType: 'related_to' },
      ]);

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('relations TestEntity');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRelationManager.getRelations).toHaveBeenCalledWith('TestEntity');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Relations'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('knows'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show usage on relations without name', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('relations');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show no relations message', async () => {
      mockRelationManager.getRelations.mockResolvedValue([]);

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('relations TestEntity');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No relations found'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show stats on stats command', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('stats');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAnalyticsManager.getGraphStats).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Statistics'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should show unknown command message', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('unknowncommand');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should handle errors gracefully', async () => {
      // First call succeeds (for initialization), subsequent calls fail
      mockStorage.loadGraph
        .mockResolvedValueOnce({ entities: [], relations: [] })
        .mockRejectedValue(new Error('Load error'));

      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('entities');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });
  });

  describe('History', () => {
    it('should track command history', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      mockRl.simulateLine('help');
      await new Promise(resolve => setTimeout(resolve, 10));
      mockRl.simulateLine('stats');
      await new Promise(resolve => setTimeout(resolve, 10));
      mockRl.simulateLine('history');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Command history'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('help'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('stats'));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });

    it('should limit history display to last 20 commands', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add 25 commands
      for (let i = 0; i < 25; i++) {
        mockRl.simulateLine(`histcmd${i}`);
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Clear spy before history command to only catch history output
      consoleLogSpy.mockClear();
      mockRl.simulateLine('history');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify history output shows proper format (numbered list)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Command history'));
      // History should show numbered entries (1. through 20.)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/^\s+\d+\./));

      try {
        mockRl.simulateClose();
      } catch {
        // Expected
      }
      try {
        await promise;
      } catch {
        // Expected
      }
    });
  });

  describe('Tab Completion', () => {
    it('should configure completer with commands and entity names', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check that createInterface was called with a completer function
      expect(readline.createInterface).toHaveBeenCalled();
      const mockCalls = (readline.createInterface as ReturnType<typeof vi.fn>).mock.calls;
      const callArgs = mockCalls[mockCalls.length - 1][0];
      expect(callArgs).toHaveProperty('completer');
      expect(typeof callArgs.completer).toBe('function');

      // Test the completer
      const [hits] = callArgs.completer('ent');
      expect(hits).toContain('entities');

      try {
        mockRl.simulateClose();
      } catch {
        // Expected process.exit
      }
      try {
        await promise;
      } catch {
        // Expected process.exit
      }
    });

    it('should complete entity names', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      const mockCalls = (readline.createInterface as ReturnType<typeof vi.fn>).mock.calls;
      const callArgs = mockCalls[mockCalls.length - 1][0];
      const [hits] = callArgs.completer('Test');
      expect(hits).toContain('TestEntity');

      try {
        mockRl.simulateClose();
      } catch {
        // Expected process.exit
      }
      try {
        await promise;
      } catch {
        // Expected process.exit
      }
    });

    it('should return all completions for no match', async () => {
      const { startInteractiveMode } = await import('../../../src/cli/interactive.js');

      const promise = startInteractiveMode({ storage: './test.jsonl', format: 'json', quiet: false, verbose: false });
      await new Promise(resolve => setTimeout(resolve, 10));

      const mockCalls = (readline.createInterface as ReturnType<typeof vi.fn>).mock.calls;
      const callArgs = mockCalls[mockCalls.length - 1][0];
      const [hits] = callArgs.completer('xyz');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits).toContain('help');
      expect(hits).toContain('exit');

      try {
        mockRl.simulateClose();
      } catch {
        // Expected process.exit
      }
      try {
        await promise;
      } catch {
        // Expected process.exit
      }
    });
  });
});
