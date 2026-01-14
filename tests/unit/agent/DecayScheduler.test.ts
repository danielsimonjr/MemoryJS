/**
 * Unit tests for DecayScheduler
 *
 * Tests the decay scheduler functionality including:
 * - Start/stop lifecycle
 * - Scheduled decay cycles
 * - Manual cycle execution
 * - Callbacks and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecayScheduler, type DecaySchedulerConfig } from '../../../src/agent/DecayScheduler.js';
import type { DecayEngine } from '../../../src/agent/DecayEngine.js';
import type { DecayResult, ForgetResult } from '../../../src/types/agent-memory.js';

// ==================== Mock DecayEngine ====================

function createMockDecayEngine(): DecayEngine {
  return {
    applyDecay: vi.fn(async (): Promise<DecayResult> => ({
      entitiesProcessed: 10,
      averageDecay: 0.3,
      memoriesAtRisk: 2,
      processingTimeMs: 15,
    })),
    forgetWeakMemories: vi.fn(async (): Promise<ForgetResult> => ({
      memoriesForgotten: 1,
      forgottenNames: ['forgotten_entity'],
      memoriesProtected: 2,
      memoriesTooYoung: 0,
      dryRun: false,
    })),
    getConfig: vi.fn(() => ({
      halfLifeHours: 168,
      importanceModulation: true,
      accessModulation: true,
      minImportance: 0.1,
    })),
  } as unknown as DecayEngine;
}

// ==================== Constructor Tests ====================

describe('DecayScheduler Constructor', () => {
  it('should create instance with default config', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    expect(scheduler).toBeInstanceOf(DecayScheduler);
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getInterval()).toBe(60 * 60 * 1000); // Default 1 hour
  });

  it('should create instance with custom config', () => {
    const engine = createMockDecayEngine();
    const config: DecaySchedulerConfig = {
      decayIntervalMs: 30000,
      autoForget: true,
      forgetOptions: { effectiveImportanceThreshold: 0.5 },
    };
    const scheduler = new DecayScheduler(engine, config);

    expect(scheduler.getInterval()).toBe(30000);
  });
});

// ==================== Start/Stop Tests ====================

describe('DecayScheduler.start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start the scheduler', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it('should run immediately on start', async () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    scheduler.start();

    // Should have called applyDecay immediately
    expect(engine.applyDecay).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should stop the scheduler', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should be idempotent when starting multiple times', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    scheduler.start();
    scheduler.start();
    scheduler.start();

    // Should only have called applyDecay once (on first start)
    expect(engine.applyDecay).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should be safe to stop when not running', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    // Should not throw
    expect(() => scheduler.stop()).not.toThrow();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should run decay cycles at configured interval', async () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 1000, // 1 second interval
    });

    scheduler.start();

    // Initial call
    expect(engine.applyDecay).toHaveBeenCalledTimes(1);

    // Advance time by 1 second
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.applyDecay).toHaveBeenCalledTimes(2);

    // Advance time by another second
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.applyDecay).toHaveBeenCalledTimes(3);

    scheduler.stop();
  });
});

// ==================== Callback Tests ====================

describe('DecayScheduler Callbacks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call onDecayComplete callback', async () => {
    const engine = createMockDecayEngine();
    const onDecayComplete = vi.fn();

    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 10000,
      onDecayComplete,
    });

    scheduler.start();

    // Wait for the initial async cycle to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(onDecayComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        entitiesProcessed: 10,
        averageDecay: 0.3,
      })
    );

    scheduler.stop();
  });

  it('should call onForgetComplete callback when autoForget enabled', async () => {
    const engine = createMockDecayEngine();
    const onForgetComplete = vi.fn();

    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 10000,
      autoForget: true,
      forgetOptions: { effectiveImportanceThreshold: 0.5 },
      onForgetComplete,
    });

    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(engine.forgetWeakMemories).toHaveBeenCalled();
    expect(onForgetComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        memoriesForgotten: 1,
      })
    );

    scheduler.stop();
  });

  it('should not call forgetWeakMemories when autoForget disabled', async () => {
    const engine = createMockDecayEngine();

    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 10000,
      autoForget: false,
    });

    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(engine.forgetWeakMemories).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('should call onError callback when decay fails', async () => {
    const engine = createMockDecayEngine();
    const error = new Error('Decay failed');
    engine.applyDecay = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 10000,
      onError,
    });

    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(error);

    scheduler.stop();
  });

  it('should handle non-Error exceptions', async () => {
    const engine = createMockDecayEngine();
    engine.applyDecay = vi.fn().mockRejectedValue('string error');
    const onError = vi.fn();

    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 10000,
      onError,
    });

    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    scheduler.stop();
  });
});

// ==================== runNow Tests ====================

describe('DecayScheduler.runNow', () => {
  it('should return decay result', async () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    const result = await scheduler.runNow();

    expect(result.decay).toEqual(
      expect.objectContaining({
        entitiesProcessed: 10,
        averageDecay: 0.3,
      })
    );
    expect(result.forget).toBeUndefined();
  });

  it('should return forget result when autoForget enabled', async () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine, {
      autoForget: true,
      forgetOptions: { effectiveImportanceThreshold: 0.5 },
    });

    const result = await scheduler.runNow();

    expect(result.decay).toBeDefined();
    expect(result.forget).toEqual(
      expect.objectContaining({
        memoriesForgotten: 1,
        forgottenNames: ['forgotten_entity'],
      })
    );
  });

  it('should work independently of scheduler running state', async () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    expect(scheduler.isRunning()).toBe(false);

    const result = await scheduler.runNow();

    expect(result.decay).toBeDefined();
    expect(scheduler.isRunning()).toBe(false);
  });
});

// ==================== isRunning Tests ====================

describe('DecayScheduler.isRunning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false initially', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    expect(scheduler.isRunning()).toBe(false);
  });

  it('should return true after start', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it('should return false after stop', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    scheduler.start();
    scheduler.stop();

    expect(scheduler.isRunning()).toBe(false);
  });
});

// ==================== getInterval Tests ====================

describe('DecayScheduler.getInterval', () => {
  it('should return default interval', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine);

    expect(scheduler.getInterval()).toBe(60 * 60 * 1000);
  });

  it('should return custom interval', () => {
    const engine = createMockDecayEngine();
    const scheduler = new DecayScheduler(engine, {
      decayIntervalMs: 5000,
    });

    expect(scheduler.getInterval()).toBe(5000);
  });
});
