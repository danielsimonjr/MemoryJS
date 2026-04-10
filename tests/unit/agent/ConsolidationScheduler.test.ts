/**
 * Unit tests for ConsolidationScheduler
 *
 * Tests the consolidation scheduler functionality including:
 * - Start/stop lifecycle
 * - Scheduled consolidation cycles
 * - Manual cycle execution (runNow)
 * - Callbacks and error handling
 * - autoMergeDuplicates integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConsolidationScheduler,
  type ConsolidationSchedulerConfig,
  type ConsolidationCycleResult,
} from '../../../src/agent/ConsolidationScheduler.js';
import type { ConsolidationPipeline } from '../../../src/agent/ConsolidationPipeline.js';
import type { CompressionManager } from '../../../src/features/CompressionManager.js';
import type { ConsolidationResult } from '../../../src/types/agent-memory.js';

// ==================== Mock helpers ====================

function makeConsolidationResult(): ConsolidationResult {
  return {
    memoriesProcessed: 5,
    memoriesPromoted: 2,
    memoriesMerged: 1,
    patternsExtracted: 3,
    summariesCreated: 1,
    errors: [],
  };
}

function createMockPipeline(): ConsolidationPipeline {
  return {
    triggerManualConsolidation: vi.fn().mockResolvedValue(makeConsolidationResult()),
  } as unknown as ConsolidationPipeline;
}

function createMockCompressionManager(entitiesMerged = 2): CompressionManager {
  return {
    compressGraph: vi.fn().mockResolvedValue({
      entitiesMerged,
      relationsRemoved: 0,
      observationsDeduped: 0,
    }),
  } as unknown as CompressionManager;
}

// ==================== Constructor ====================

describe('ConsolidationScheduler Constructor', () => {
  it('should create instance with default config', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    expect(scheduler).toBeInstanceOf(ConsolidationScheduler);
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getInterval()).toBe(60 * 60 * 1000);
  });

  it('should create instance with custom interval', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 5000,
    });
    expect(scheduler.getInterval()).toBe(5000);
  });

  it('should accept CompressionManager as second argument', () => {
    const pipeline = createMockPipeline();
    const cm = createMockCompressionManager();
    const scheduler = new ConsolidationScheduler(pipeline, cm, {
      autoMergeDuplicates: true,
    });
    expect(scheduler).toBeInstanceOf(ConsolidationScheduler);
  });

  it('should expose config via getConfig', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 2000,
      autoMergeDuplicates: true,
      duplicateThreshold: 0.85,
    });
    const config = scheduler.getConfig();
    expect(config.consolidationIntervalMs).toBe(2000);
    expect(config.autoMergeDuplicates).toBe(true);
    expect(config.duplicateThreshold).toBe(0.85);
  });
});

// ==================== Start/Stop ====================

describe('ConsolidationScheduler.start/stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should start the scheduler', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });

  it('should run one cycle immediately on start', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    scheduler.start();
    expect(pipeline.triggerManualConsolidation).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('should stop the scheduler', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    scheduler.start();
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should be idempotent when starting multiple times', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    scheduler.start();
    scheduler.start();
    scheduler.start();
    expect(pipeline.triggerManualConsolidation).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('should be safe to stop when not running', () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    expect(() => scheduler.stop()).not.toThrow();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should run consolidation cycles at configured interval', async () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 1000,
    });
    scheduler.start();
    expect(pipeline.triggerManualConsolidation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(pipeline.triggerManualConsolidation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(pipeline.triggerManualConsolidation).toHaveBeenCalledTimes(3);

    scheduler.stop();
  });
});

// ==================== Callbacks ====================

describe('ConsolidationScheduler Callbacks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should call onConsolidationComplete callback', async () => {
    const pipeline = createMockPipeline();
    const onConsolidationComplete = vi.fn();
    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 10000,
      onConsolidationComplete,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onConsolidationComplete).toHaveBeenCalledOnce();
    const result: ConsolidationCycleResult = onConsolidationComplete.mock.calls[0][0];
    expect(result.consolidation.memoriesPromoted).toBe(2);
    expect(result.ranAt).toBeTruthy();
    scheduler.stop();
  });

  it('should call onError callback when pipeline throws', async () => {
    const pipeline = createMockPipeline();
    const error = new Error('Pipeline failed');
    (pipeline.triggerManualConsolidation as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    const onError = vi.fn();

    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 10000,
      onError,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(error);
    scheduler.stop();
  });

  it('should wrap non-Error exceptions', async () => {
    const pipeline = createMockPipeline();
    (pipeline.triggerManualConsolidation as ReturnType<typeof vi.fn>).mockRejectedValue(
      'string error'
    );
    const onError = vi.fn();

    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 10000,
      onError,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    scheduler.stop();
  });
});

// ==================== autoMergeDuplicates ====================

describe('ConsolidationScheduler autoMergeDuplicates', () => {
  it('should call compressionManager.compressGraph when enabled', async () => {
    const pipeline = createMockPipeline();
    const cm = createMockCompressionManager(3);
    const onConsolidationComplete = vi.fn();

    const scheduler = new ConsolidationScheduler(pipeline, cm, {
      autoMergeDuplicates: true,
      duplicateThreshold: 0.85,
      onConsolidationComplete,
    });

    const result = await scheduler.runNow();
    expect(cm.compressGraph).toHaveBeenCalledWith(0.85);
    expect(result.duplicatesMerged).toBe(3);
  });

  it('should NOT call compressGraph when autoMergeDuplicates is false', async () => {
    const pipeline = createMockPipeline();
    const cm = createMockCompressionManager();

    const scheduler = new ConsolidationScheduler(pipeline, cm, {
      autoMergeDuplicates: false,
    });

    const result = await scheduler.runNow();
    expect(cm.compressGraph).not.toHaveBeenCalled();
    expect(result.duplicatesMerged).toBeUndefined();
  });

  it('should NOT call compressGraph when no CompressionManager provided', async () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      autoMergeDuplicates: true,
    });

    const result = await scheduler.runNow();
    expect(result.duplicatesMerged).toBeUndefined();
  });
});

// ==================== runNow ====================

describe('ConsolidationScheduler.runNow', () => {
  it('should return consolidation result', async () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    const result = await scheduler.runNow();
    expect(result.consolidation.memoriesProcessed).toBe(5);
    expect(result.consolidation.memoriesPromoted).toBe(2);
    expect(result.ranAt).toBeTruthy();
  });

  it('should include a ranAt timestamp', async () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    const before = new Date().toISOString();
    const result = await scheduler.runNow();
    expect(result.ranAt >= before).toBe(true);
  });

  it('should work when scheduler is not started', async () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline);
    expect(scheduler.isRunning()).toBe(false);
    const result = await scheduler.runNow();
    expect(result.consolidation).toBeDefined();
    expect(scheduler.isRunning()).toBe(false);
  });
});

// ==================== EventEmitter events ====================

describe('ConsolidationScheduler EventEmitter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should emit consolidation:complete event', async () => {
    const pipeline = createMockPipeline();
    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 10000,
    });
    const listener = vi.fn();
    scheduler.on('consolidation:complete', listener);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it('should emit consolidation:error event on failure', async () => {
    const pipeline = createMockPipeline();
    const error = new Error('Cycle error');
    (pipeline.triggerManualConsolidation as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    const errorListener = vi.fn();

    const scheduler = new ConsolidationScheduler(pipeline, undefined, {
      consolidationIntervalMs: 10000,
      onError: () => {}, // Suppress console.error
    });
    scheduler.on('consolidation:error', errorListener);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errorListener).toHaveBeenCalledWith(error);
    scheduler.stop();
  });
});

// ==================== isRunning / getInterval ====================

describe('ConsolidationScheduler.isRunning', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should return false initially', () => {
    const scheduler = new ConsolidationScheduler(createMockPipeline());
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should return true after start', () => {
    const scheduler = new ConsolidationScheduler(createMockPipeline());
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });

  it('should return false after stop', () => {
    const scheduler = new ConsolidationScheduler(createMockPipeline());
    scheduler.start();
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});

describe('ConsolidationScheduler.getInterval', () => {
  it('should return default interval', () => {
    const scheduler = new ConsolidationScheduler(createMockPipeline());
    expect(scheduler.getInterval()).toBe(60 * 60 * 1000);
  });

  it('should return custom interval', () => {
    const scheduler = new ConsolidationScheduler(createMockPipeline(), undefined, {
      consolidationIntervalMs: 12345,
    });
    expect(scheduler.getInterval()).toBe(12345);
  });
});
