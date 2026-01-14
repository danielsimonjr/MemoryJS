/**
 * AgentMemoryManager Unit Tests
 *
 * Tests for the unified agent memory facade.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentMemoryManager, type AgentMemoryConfig } from '../../../src/agent/index.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager', () => {
  let storage: GraphStorage;
  let manager: AgentMemoryManager;
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmem-test-'));
    testFile = path.join(tempDir, 'test-memory.jsonl');
    storage = new GraphStorage(testFile);
    manager = new AgentMemoryManager(storage);
  });

  afterEach(async () => {
    manager.stop();
    // Allow any pending async operations to complete before cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create manager with default configuration', () => {
      const config = manager.getConfig();
      expect(config).toBeDefined();
    });

    it('should create manager with custom configuration', () => {
      const customConfig: AgentMemoryConfig = {
        enableMultiAgent: true,
        defaultAgentId: 'test_agent',
      };
      const customManager = new AgentMemoryManager(storage, customConfig);
      const config = customManager.getConfig();

      expect(config.enableMultiAgent).toBe(true);
      expect(config.defaultAgentId).toBe('test_agent');
      customManager.stop();
    });

    it('should validate invalid configuration', () => {
      expect(() => {
        new AgentMemoryManager(storage, {
          decay: { halfLifeHours: -1 },
        });
      }).toThrow('decay.halfLifeHours must be positive');
    });
  });

  describe('component accessors', () => {
    it('should provide lazy-initialized accessTracker', () => {
      const tracker = manager.accessTracker;
      expect(tracker).toBeDefined();
      // Should return same instance
      expect(manager.accessTracker).toBe(tracker);
    });

    it('should provide lazy-initialized decayEngine', () => {
      const engine = manager.decayEngine;
      expect(engine).toBeDefined();
      expect(manager.decayEngine).toBe(engine);
    });

    it('should provide lazy-initialized workingMemory', () => {
      const wm = manager.workingMemory;
      expect(wm).toBeDefined();
      expect(manager.workingMemory).toBe(wm);
    });

    it('should provide lazy-initialized sessionManager', () => {
      const sm = manager.sessionManager;
      expect(sm).toBeDefined();
      expect(manager.sessionManager).toBe(sm);
    });

    it('should provide lazy-initialized episodicMemory', () => {
      const em = manager.episodicMemory;
      expect(em).toBeDefined();
      expect(manager.episodicMemory).toBe(em);
    });

    it('should provide lazy-initialized multiAgentManager', () => {
      const mam = manager.multiAgentManager;
      expect(mam).toBeDefined();
      expect(manager.multiAgentManager).toBe(mam);
    });
  });

  describe('session lifecycle', () => {
    it('should start a session', async () => {
      const session = await manager.startSession({ agentId: 'test_agent' });

      expect(session).toBeDefined();
      expect(session.name).toBeDefined();
      expect(session.entityType).toBe('session');
      expect(session.status).toBe('active');
    });

    it('should emit session:started event', async () => {
      const handler = vi.fn();
      manager.on('session:started', handler);

      await manager.startSession();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: expect.any(String),
      }));
    });

    it('should end a session', async () => {
      const session = await manager.startSession();
      const result = await manager.endSession(session.name);

      expect(result).toBeDefined();
      expect(result.session.name).toBe(session.name);
      expect(result.session.status).toBe('completed');
    });

    it('should get active session', async () => {
      const session = await manager.startSession();
      const active = await manager.getActiveSession();

      expect(active).toBeDefined();
      expect(active?.name).toBe(session.name);
    });
  });

  describe('working memory operations', () => {
    it('should add working memory', async () => {
      const session = await manager.startSession();
      const memory = await manager.addWorkingMemory({
        sessionId: session.name,
        content: 'Test observation',
        importance: 7,
      });

      expect(memory).toBeDefined();
      expect(memory.observations).toContain('Test observation');
      expect(memory.sessionId).toBe(session.name);
    });

    it('should emit memory:created event', async () => {
      const handler = vi.fn();
      manager.on('memory:created', handler);

      const session = await manager.startSession();
      await manager.addWorkingMemory({
        sessionId: session.name,
        content: 'Test',
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should get session memories', async () => {
      const session = await manager.startSession();
      await manager.addWorkingMemory({
        sessionId: session.name,
        content: 'Memory 1',
      });
      await manager.addWorkingMemory({
        sessionId: session.name,
        content: 'Memory 2',
      });

      const memories = await manager.getSessionMemories(session.name);

      expect(memories.length).toBe(2);
    });

    it('should confirm a memory', async () => {
      const session = await manager.startSession();
      const memory = await manager.addWorkingMemory({
        sessionId: session.name,
        content: 'Confirm me',
      });

      const result = await manager.confirmMemory(memory.name, 0.1);

      expect(result.confirmed).toBe(true);
    });

    it('should promote a memory', async () => {
      const session = await manager.startSession();
      const memory = await manager.addWorkingMemory({
        sessionId: session.name,
        content: 'Promote me',
      });

      const result = await manager.promoteMemory(memory.name, 'episodic');

      expect(result.entityName).toBe(memory.name);
      expect(result.toType).toBe('episodic');
    });
  });

  describe('episodic memory operations', () => {
    it('should create an episode', async () => {
      const session = await manager.startSession();
      const episode = await manager.createEpisode('Important event happened', {
        sessionId: session.name,
        importance: 8,
      });

      expect(episode).toBeDefined();
      expect(episode.memoryType).toBe('episodic');
    });

    it('should get timeline', async () => {
      const session = await manager.startSession();
      await manager.createEpisode('Event 1', { sessionId: session.name });
      await manager.createEpisode('Event 2', { sessionId: session.name });

      const timeline = await manager.getTimeline(session.name);

      expect(timeline.length).toBe(2);
    });
  });

  describe('multi-agent operations', () => {
    it('should register an agent', () => {
      manager.registerAgent('agent_1', {
        name: 'Agent One',
        type: 'llm',
        trustLevel: 0.8,
        capabilities: ['read', 'write'],
      });

      const agent = manager.multiAgentManager.getAgent('agent_1');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('Agent One');
    });

    it('should emit agent:registered event', () => {
      const handler = vi.fn();
      manager.on('agent:registered', handler);

      manager.registerAgent('agent_2', {
        name: 'Agent Two',
        type: 'human',
        trustLevel: 1.0,
        capabilities: ['all'],
      });

      expect(handler).toHaveBeenCalledWith({ agentId: 'agent_2' });
    });
  });

  describe('lifecycle', () => {
    it('should stop cleanly', () => {
      const handler = vi.fn();
      manager.on('manager:stopped', handler);

      manager.stop();

      expect(handler).toHaveBeenCalled();
    });
  });
});
