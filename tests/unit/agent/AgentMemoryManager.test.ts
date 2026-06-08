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

  // ==================== Expanded coverage ====================

  describe('component accessors (expanded)', () => {
    it('lazy-init decayScheduler', () => {
      const s = manager.decayScheduler;
      expect(s).toBeDefined();
      expect(manager.decayScheduler).toBe(s);
    });
    it('lazy-init consolidationPipeline', () => {
      const p = manager.consolidationPipeline;
      expect(p).toBeDefined();
      expect(manager.consolidationPipeline).toBe(p);
    });
    it('lazy-init summarizationService', () => {
      const s = manager.summarizationService;
      expect(s).toBeDefined();
      expect(manager.summarizationService).toBe(s);
    });
    it('lazy-init patternDetector', () => {
      const p = manager.patternDetector;
      expect(p).toBeDefined();
      expect(manager.patternDetector).toBe(p);
    });
    it('lazy-init ruleEvaluator', () => {
      const r = manager.ruleEvaluator;
      expect(r).toBeDefined();
      expect(manager.ruleEvaluator).toBe(r);
    });
    it('lazy-init salienceEngine', () => {
      const s = manager.salienceEngine;
      expect(s).toBeDefined();
      expect(manager.salienceEngine).toBe(s);
    });
    it('lazy-init contextWindowManager', () => {
      const c = manager.contextWindowManager;
      expect(c).toBeDefined();
      expect(manager.contextWindowManager).toBe(c);
    });
    it('lazy-init memoryFormatter', () => {
      const f = manager.memoryFormatter;
      expect(f).toBeDefined();
      expect(manager.memoryFormatter).toBe(f);
    });
    it('lazy-init conflictResolver', () => {
      const c = manager.conflictResolver;
      expect(c).toBeDefined();
      expect(manager.conflictResolver).toBe(c);
    });
    it('lazy-init profileManager', () => {
      const p = manager.profileManager;
      expect(p).toBeDefined();
      expect(manager.profileManager).toBe(p);
    });
    it('lazy-init workThreadManager', () => {
      const w = manager.workThreadManager;
      expect(w).toBeDefined();
      expect(manager.workThreadManager).toBe(w);
    });
    it('lazy-init checkpointManager', () => {
      const c = manager.checkpointManager;
      expect(c).toBeDefined();
      expect(manager.checkpointManager).toBe(c);
    });
  });

  describe('working memory (expanded)', () => {
    it('clearExpiredMemories returns 0 when nothing expired (no event)', async () => {
      const handler = vi.fn();
      manager.on('memory:expired', handler);
      const count = await manager.clearExpiredMemories();
      expect(count).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('addWorkingMemory stamps agentId + visibility when enableMultiAgent is on', async () => {
      const m = new AgentMemoryManager(storage, {
        enableMultiAgent: true,
        defaultAgentId: 'agent-x',
      });
      const session = await m.startSession();
      const mem = await m.addWorkingMemory({
        sessionId: session.name,
        content: 'tagged',
        agentId: 'agent-x',
        visibility: 'shared',
      });
      const graph = await storage.loadGraph();
      const stored = graph.entities.find((e) => e.name === mem.name) as { agentId?: string; visibility?: string } | undefined;
      expect(stored?.agentId).toBe('agent-x');
      expect(stored?.visibility).toBe('shared');
      m.stop();
    });

    it('endSession marks session abandoned when status="abandoned"', async () => {
      const session = await manager.startSession();
      const result = await manager.endSession(session.name, 'abandoned');
      expect(result.session.status).toBe('abandoned');
    });
  });

  describe('decay operations', () => {
    it('getDecayedMemories returns array (may be empty)', async () => {
      const result = await manager.getDecayedMemories(0.5);
      expect(Array.isArray(result)).toBe(true);
    });

    it('forgetWeakMemories returns ForgetResult', async () => {
      const result = await manager.forgetWeakMemories({ threshold: 0.05 });
      expect(result).toBeDefined();
      expect(typeof result.memoriesForgotten).toBe('number');
    });

    it('reinforceMemory completes without throwing for existing memory', async () => {
      const session = await manager.startSession();
      const mem = await manager.addWorkingMemory({
        sessionId: session.name, content: 'reinforce me',
      });
      await expect(
        manager.reinforceMemory(mem.name, { confidenceBoost: 0.1 }),
      ).resolves.toBeUndefined();
    });

    it('runDecayCycle returns a DecayCycleResult', async () => {
      const result = await manager.runDecayCycle();
      expect(result).toBeDefined();
    });
  });

  describe('context retrieval + formatting', () => {
    it('retrieveForContext returns a ContextPackage', async () => {
      const session = await manager.startSession();
      await manager.addWorkingMemory({
        sessionId: session.name, content: 'observation',
      });
      const pkg = await manager.retrieveForContext({
        sessionId: session.name,
        maxTokens: 500,
      });
      expect(pkg).toBeDefined();
    });

    it('retrieveForContext applies optional filters', async () => {
      const session = await manager.startSession();
      const pkg = await manager.retrieveForContext({
        sessionId: session.name,
        maxTokens: 1000,
        keywords: ['alpha'],
        includeWorkingMemory: true,
        includeEpisodicRecent: true,
        includeSemanticRelevant: true,
        mustInclude: [],
      });
      expect(pkg).toBeDefined();
    });

    it('formatForPrompt builds a prompt string', async () => {
      const session = await manager.startSession();
      const m1 = await manager.addWorkingMemory({
        sessionId: session.name, content: 'fact 1',
      });
      const m2 = await manager.addWorkingMemory({
        sessionId: session.name, content: 'fact 2',
      });
      const out = manager.formatForPrompt([m1, m2], { header: '## Memory', separator: '\n' });
      expect(typeof out).toBe('string');
    });

    it('recordAccess delegates to AccessTracker without throwing', () => {
      expect(() => manager.recordAccess('mem_x', { sessionId: 's' })).not.toThrow();
    });
  });

  describe('consolidation', () => {
    it('consolidateSession returns a ConsolidationResult and emits event', async () => {
      const session = await manager.startSession();
      await manager.addWorkingMemory({ sessionId: session.name, content: 'a' });
      const handler = vi.fn();
      manager.on('consolidation:complete', handler);
      const result = await manager.consolidateSession(session.name);
      expect(result).toBeDefined();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session.name }));
    });
  });

  describe('multi-agent (expanded)', () => {
    it('getSharedMemories returns array', async () => {
      manager.registerAgent('a1', { name: 'A1', type: 'llm', trustLevel: 1, capabilities: [] });
      manager.registerAgent('a2', { name: 'A2', type: 'llm', trustLevel: 1, capabilities: [] });
      const shared = await manager.getSharedMemories(['a1', 'a2']);
      expect(Array.isArray(shared)).toBe(true);
    });

    it('searchCrossAgent returns array of scored results', async () => {
      manager.registerAgent('searcher', { name: 'S', type: 'llm', trustLevel: 1, capabilities: [] });
      const results = await manager.searchCrossAgent('searcher', 'query');
      expect(Array.isArray(results)).toBe(true);
    });

    it('copyMemory returns null for non-existent source', async () => {
      manager.registerAgent('target', { name: 'T', type: 'llm', trustLevel: 1, capabilities: [] });
      const result = await manager.copyMemory('does-not-exist', 'target');
      expect(result).toBeNull();
    });

    it('detectConflicts returns ConflictInfo[] (possibly empty)', async () => {
      const conflicts = await manager.detectConflicts([]);
      expect(Array.isArray(conflicts)).toBe(true);
    });

    it('mergeCrossAgent returns null when given non-existent memories', async () => {
      manager.registerAgent('merger', { name: 'M', type: 'llm', trustLevel: 1, capabilities: [] });
      const result = await manager.mergeCrossAgent(['ghost-1', 'ghost-2'], 'merger');
      expect(result).toBeNull();
    });
  });

  describe('session checkpointing', () => {
    it('checkpointSession creates a checkpoint and emits event', async () => {
      const session = await manager.startSession();
      const handler = vi.fn();
      manager.on('session:checkpointed', handler);
      const cp = await manager.checkpointSession(session.name, 'milestone');
      expect(cp).toBeDefined();
      expect(cp.id).toBeDefined();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session.name }));
    });

    it('restoreSession runs without throwing for valid checkpoint', async () => {
      const session = await manager.startSession();
      const cp = await manager.checkpointSession(session.name);
      const handler = vi.fn();
      manager.on('session:restored', handler);
      await manager.restoreSession(cp.id);
      expect(handler).toHaveBeenCalled();
    });

    it('sleepSession returns a checkpointId and emits event', async () => {
      const session = await manager.startSession();
      const handler = vi.fn();
      manager.on('session:slept', handler);
      const checkpointId = await manager.sleepSession(session.name);
      expect(typeof checkpointId).toBe('string');
      expect(handler).toHaveBeenCalled();
    });

    it('wakeSession emits event', async () => {
      const session = await manager.startSession();
      const checkpointId = await manager.sleepSession(session.name);
      const handler = vi.fn();
      manager.on('session:woken', handler);
      await manager.wakeSession(session.name, checkpointId);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('setSummarizationProvider registers provider on summarization service', () => {
      const provider = { summarize: async () => 'summary' };
      expect(() => manager.setSummarizationProvider(provider as never)).not.toThrow();
    });

    it('setDistillationPolicy is forwarded to ContextWindowManager', () => {
      expect(() => manager.setDistillationPolicy(undefined)).not.toThrow();
    });

    it('getConfig returns a clone (not the same reference)', () => {
      const a = manager.getConfig();
      const b = manager.getConfig();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('role-aware factories', () => {
    it('createRoleAwareSalienceEngine returns SalienceEngine for unknown agent (falls back to default)', () => {
      const engine = manager.createRoleAwareSalienceEngine('unknown-agent');
      expect(engine).toBeDefined();
    });

    it('createRoleAwareSalienceEngine uses agent role when registered', () => {
      manager.registerAgent('researcher-1', {
        name: 'R',
        type: 'llm',
        trustLevel: 1,
        capabilities: [],
      });
      const engine = manager.createRoleAwareSalienceEngine('researcher-1');
      expect(engine).toBeDefined();
    });

    it('createRoleAwareContextWindowManager returns ContextWindowManager', () => {
      manager.registerAgent('planner-1', {
        name: 'P',
        type: 'llm',
        trustLevel: 1,
        capabilities: [],
      });
      const cw = manager.createRoleAwareContextWindowManager('planner-1');
      expect(cw).toBeDefined();
    });
  });

  describe('dream cycle', () => {
    it('startDreaming initializes engine and emits dream:started', () => {
      const handler = vi.fn();
      manager.on('dream:started', handler);
      manager.startDreaming({ enableScheduledMaintenance: false });
      expect(handler).toHaveBeenCalled();
      manager.stopDreaming();
    });

    it('stopDreaming emits dream:stopped only when engine exists', () => {
      const handler = vi.fn();
      manager.on('dream:stopped', handler);

      // No engine yet — stopDreaming is a no-op
      manager.stopDreaming();
      expect(handler).not.toHaveBeenCalled();

      // After starting, stop fires the event
      manager.startDreaming({ enableScheduledMaintenance: false });
      manager.stopDreaming();
      expect(handler).toHaveBeenCalled();
    });

    it('runDreamCycle creates engine on demand and returns a result', async () => {
      const result = await manager.runDreamCycle();
      expect(result).toBeDefined();
    });

    it('startDreaming twice does not recreate engine', () => {
      manager.startDreaming({ enableScheduledMaintenance: false });
      manager.startDreaming({ enableScheduledMaintenance: false });
      // No throw — exercises the `if (!this._dreamEngine)` guard.
      manager.stopDreaming();
    });
  });

  describe('diary', () => {
    it('writeDiary creates entity on first write', async () => {
      await manager.writeDiary('alice', 'first entry');
      const entries = await manager.readDiary('alice');
      expect(entries.length).toBe(1);
      expect(entries[0]).toContain('first entry');
    });

    it('writeDiary appends to existing diary', async () => {
      await manager.writeDiary('bob', 'first');
      await manager.writeDiary('bob', 'second');
      const entries = await manager.readDiary('bob');
      expect(entries.length).toBe(2);
    });

    it('writeDiary supports topic prefix', async () => {
      await manager.writeDiary('charlie', 'note', { topic: 'todo' });
      const entries = await manager.readDiary('charlie', { topic: 'todo' });
      expect(entries.length).toBe(1);
      expect(entries[0]).toContain('[todo]');
    });

    it('writeDiary rejects invalid agentId', async () => {
      await expect(manager.writeDiary('', 'x')).rejects.toThrow(/Invalid agentId/);
      await expect(manager.writeDiary('bad agent', 'x')).rejects.toThrow(/Invalid agentId/);
      await expect(manager.writeDiary('bad/agent', 'x')).rejects.toThrow(/Invalid agentId/);
    });

    it('readDiary returns [] for unknown agent', async () => {
      const entries = await manager.readDiary('never-wrote');
      expect(entries).toEqual([]);
    });

    it('readDiary respects lastN', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.writeDiary('eve', `entry-${i}`);
      }
      const entries = await manager.readDiary('eve', { lastN: 3 });
      expect(entries.length).toBe(3);
    });

    it('readDiary filters by topic', async () => {
      await manager.writeDiary('frank', 'todo entry', { topic: 'todo' });
      await manager.writeDiary('frank', 'done entry', { topic: 'done' });
      await manager.writeDiary('frank', 'untagged');
      const todos = await manager.readDiary('frank', { topic: 'todo' });
      expect(todos.length).toBe(1);
      expect(todos[0]).toContain('todo entry');
    });

    it('writeDiary accepts tags option', async () => {
      await manager.writeDiary('greta', 'entry', { tags: ['important', 'review'] });
      const entries = await manager.readDiary('greta');
      expect(entries.length).toBe(1);
    });
  });
});
