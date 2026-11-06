/**
 * Env-derived defaults for agent-memory components (src/agent/AgentEnvDefaults.ts).
 * Env is read when the owning getter first builds its component; code config wins.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  readEntropyFilterFromEnv,
  readDefaultVisibilityFromEnv,
  readCognitiveLoadMaxFromEnv,
  readConsolidationSchedulerEnabled,
} from '../../../src/agent/AgentEnvDefaults.js';
import { AgentMemoryManager } from '../../../src/agent/AgentMemoryManager.js';
import { CognitiveLoadAnalyzer } from '../../../src/agent/CognitiveLoadAnalyzer.js';
import { createStorageFromPath } from '../../../src/core/StorageFactory.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';
import { logger } from '../../../src/utils/logger.js';

const LOW_ENTROPY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function freshManager(): AgentMemoryManager {
  return new AgentMemoryManager(createStorageFromPath(makeTempJsonlPath()) as GraphStorage);
}

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTempDirs();
});

describe('reader functions', () => {
  it('entropy filter is off unless MEMORY_ENTROPY_FILTER_ENABLED is true', () => {
    vi.stubEnv('MEMORY_ENTROPY_FILTER_ENABLED', 'false');
    expect(readEntropyFilterFromEnv()).toBeUndefined();
    vi.stubEnv('MEMORY_ENTROPY_FILTER_ENABLED', 'TRUE');
    expect(readEntropyFilterFromEnv()).toEqual({ minEntropy: 1.5 });
    vi.stubEnv('MEMORY_ENTROPY_THRESHOLD', '2.25');
    expect(readEntropyFilterFromEnv()).toEqual({ minEntropy: 2.25 });
  });

  it('visibility accepts the five levels and falls back to undefined otherwise', () => {
    vi.stubEnv('MEMORY_DEFAULT_VISIBILITY', 'team');
    expect(readDefaultVisibilityFromEnv()).toBe('team');
    vi.stubEnv('MEMORY_DEFAULT_VISIBILITY', 'galaxy');
    expect(readDefaultVisibilityFromEnv()).toBeUndefined();
  });

  it('cognitive load max defaults to 0.7 and rejects values outside 0-1', () => {
    expect(readCognitiveLoadMaxFromEnv()).toBe(0.7);
    vi.stubEnv('MEMORY_COGNITIVE_LOAD_MAX', '0.5');
    expect(readCognitiveLoadMaxFromEnv()).toBe(0.5);
    vi.stubEnv('MEMORY_COGNITIVE_LOAD_MAX', '1.5');
    expect(readCognitiveLoadMaxFromEnv()).toBe(0.7);
  });

  it('consolidation scheduler enables from either alias', () => {
    expect(readConsolidationSchedulerEnabled()).toBe(false);
    vi.stubEnv('MEMORY_CONSOLIDATION_SCHEDULER_ENABLED', 'true');
    expect(readConsolidationSchedulerEnabled()).toBe(true);
    vi.unstubAllEnvs();
    vi.stubEnv('MEMORY_AUTO_CONSOLIDATION', 'true');
    expect(readConsolidationSchedulerEnabled()).toBe(true);
  });
});

describe('wiring into AgentMemoryManager', () => {
  it('entropy filter from env rejects low-entropy content when set before first access', async () => {
    vi.stubEnv('MEMORY_ENTROPY_FILTER_ENABLED', 'true');
    await expect(freshManager().workingMemory.createWorkingMemory('s1', LOW_ENTROPY)).rejects.toThrow(/entropy/i);
  });

  it('entropy filter is not applied when the env is unset', async () => {
    const memory = await freshManager().workingMemory.createWorkingMemory('s1', LOW_ENTROPY);
    expect(memory.name).toBeTruthy();
  });

  it('env changed after the working memory was built is not re-read', async () => {
    const manager = freshManager();
    manager.workingMemory; // built with the env off
    vi.stubEnv('MEMORY_ENTROPY_FILTER_ENABLED', 'true');
    const memory = await manager.workingMemory.createWorkingMemory('s1', LOW_ENTROPY);
    expect(memory.name).toBeTruthy();
  });

  it('code-supplied entropyFilter wins over the env', async () => {
    vi.stubEnv('MEMORY_ENTROPY_FILTER_ENABLED', 'true');
    const manager = new AgentMemoryManager(
      createStorageFromPath(makeTempJsonlPath()) as GraphStorage,
      { workingMemory: { entropyFilter: { minEntropy: 0 } } as never },
    );
    const memory = await manager.workingMemory.createWorkingMemory('s1', LOW_ENTROPY);
    expect(memory.name).toBeTruthy();
  });

  it('MEMORY_DEFAULT_VISIBILITY becomes the multi-agent default visibility', () => {
    vi.stubEnv('MEMORY_DEFAULT_VISIBILITY', 'team');
    const cfg = (freshManager().multiAgentManager as unknown as { config: { defaultVisibility: string } }).config;
    expect(cfg.defaultVisibility).toBe('team');
  });

  it('MEMORY_DEFAULT_VISIBILITY unset keeps the private default', () => {
    const cfg = (freshManager().multiAgentManager as unknown as { config: { defaultVisibility: string } }).config;
    expect(cfg.defaultVisibility).toBe('private');
  });
});

describe('wiring into CognitiveLoadAnalyzer', () => {
  it('uses MEMORY_COGNITIVE_LOAD_MAX as loadThreshold unless code sets one', () => {
    vi.stubEnv('MEMORY_COGNITIVE_LOAD_MAX', '0.4');
    const threshold = (a: CognitiveLoadAnalyzer) => (a as unknown as { config: { loadThreshold: number } }).config.loadThreshold;
    expect(threshold(new CognitiveLoadAnalyzer())).toBe(0.4);
    expect(threshold(new CognitiveLoadAnalyzer({ loadThreshold: 0.9 }))).toBe(0.9);
  });
});

describe('invalid env values warn once per process', () => {
  // Each case uses a value no other test uses: the warned-key set is module-level.
  it('MEMORY_COGNITIVE_LOAD_MAX: three analyzer constructions log one warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubEnv('MEMORY_COGNITIVE_LOAD_MAX', '7.25');
    for (let i = 0; i < 3; i++) new CognitiveLoadAnalyzer();
    expect(warn.mock.calls.filter(([m]) => String(m).includes('MEMORY_COGNITIVE_LOAD_MAX'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('MEMORY_ENTROPY_THRESHOLD: three working-memory builds log one warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubEnv('MEMORY_ENTROPY_FILTER_ENABLED', 'true');
    vi.stubEnv('MEMORY_ENTROPY_THRESHOLD', 'not-a-number-1');
    for (let i = 0; i < 3; i++) void freshManager().workingMemory;
    expect(warn.mock.calls.filter(([m]) => String(m).includes('MEMORY_ENTROPY_THRESHOLD'))).toHaveLength(1);
    expect(readEntropyFilterFromEnv()).toEqual({ minEntropy: 1.5 });
    warn.mockRestore();
  });

  it('MEMORY_DEFAULT_VISIBILITY: three multi-agent builds log one warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubEnv('MEMORY_DEFAULT_VISIBILITY', 'nebula-once');
    for (let i = 0; i < 3; i++) void freshManager().multiAgentManager;
    expect(warn.mock.calls.filter(([m]) => String(m).includes('MEMORY_DEFAULT_VISIBILITY'))).toHaveLength(1);
    warn.mockRestore();
  });
});
