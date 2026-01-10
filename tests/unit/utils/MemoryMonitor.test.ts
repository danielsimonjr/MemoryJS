/**
 * MemoryMonitor Unit Tests
 *
 * Phase 12 Sprint 6: Tests for memory usage monitoring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryMonitor, globalMemoryMonitor } from '../../../src/utils/MemoryMonitor.js';

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor;

  beforeEach(() => {
    monitor = new MemoryMonitor();
  });

  describe('component registration', () => {
    it('should register a component', () => {
      monitor.registerComponent('test', () => 1000);

      const usage = monitor.getUsage();
      expect(usage.components.length).toBe(1);
      expect(usage.components[0].name).toBe('test');
      expect(usage.components[0].bytes).toBe(1000);
    });

    it('should register component with item counter', () => {
      monitor.registerComponent('entities', () => 5000, () => 100);

      const usage = monitor.getUsage();
      expect(usage.components[0].itemCount).toBe(100);
      expect(usage.components[0].bytesPerItem).toBe(50);
    });

    it('should unregister component', () => {
      monitor.registerComponent('test', () => 1000);
      monitor.unregisterComponent('test');

      const usage = monitor.getUsage();
      expect(usage.components.length).toBe(0);
    });
  });

  describe('usage calculation', () => {
    it('should calculate total bytes', () => {
      monitor.registerComponent('comp1', () => 1000);
      monitor.registerComponent('comp2', () => 2000);
      monitor.registerComponent('comp3', () => 3000);

      const usage = monitor.getUsage();
      expect(usage.totalBytes).toBe(6000);
    });

    it('should sort components by usage descending', () => {
      monitor.registerComponent('small', () => 1000);
      monitor.registerComponent('large', () => 5000);
      monitor.registerComponent('medium', () => 2500);

      const usage = monitor.getUsage();
      expect(usage.components[0].name).toBe('large');
      expect(usage.components[1].name).toBe('medium');
      expect(usage.components[2].name).toBe('small');
    });

    it('should get specific component usage', () => {
      monitor.registerComponent('test', () => 1000, () => 10);

      const compUsage = monitor.getComponentUsage('test');
      expect(compUsage).toBeDefined();
      expect(compUsage!.bytes).toBe(1000);
      expect(compUsage!.itemCount).toBe(10);
    });

    it('should return undefined for non-existent component', () => {
      const compUsage = monitor.getComponentUsage('nonexistent');
      expect(compUsage).toBeUndefined();
    });
  });

  describe('formatting', () => {
    it('should format bytes correctly', () => {
      expect(monitor.formatBytes(0)).toBe('0 B');
      expect(monitor.formatBytes(512)).toBe('512 B');
      expect(monitor.formatBytes(1024)).toBe('1.00 KB');
      expect(monitor.formatBytes(1536)).toBe('1.50 KB');
      expect(monitor.formatBytes(1048576)).toBe('1.00 MB');
      expect(monitor.formatBytes(1073741824)).toBe('1.00 GB');
    });

    it('should parse formatted bytes', () => {
      expect(monitor.parseBytes('1024 B')).toBe(1024);
      expect(monitor.parseBytes('1 KB')).toBe(1024);
      expect(monitor.parseBytes('1 MB')).toBe(1048576);
      expect(monitor.parseBytes('1.5 GB')).toBe(1610612736);
    });

    it('should generate summary', () => {
      monitor.registerComponent('entities', () => 1000000, () => 100);
      monitor.registerComponent('vectors', () => 500000, () => 50);

      const summary = monitor.getSummary();
      expect(summary).toContain('Memory Usage Summary');
      expect(summary).toContain('entities');
      expect(summary).toContain('vectors');
    });
  });

  describe('thresholds', () => {
    it('should check total threshold warning', () => {
      monitor.setThresholds({ warning: 1000, critical: 5000 });
      monitor.registerComponent('large', () => 1500);

      const alerts = monitor.checkThresholds();
      expect(alerts.some(a => a.level === 'warning' && a.component === 'total')).toBe(true);
    });

    it('should check total threshold critical', () => {
      monitor.setThresholds({ warning: 1000, critical: 5000 });
      monitor.registerComponent('huge', () => 6000);

      const alerts = monitor.checkThresholds();
      expect(alerts.some(a => a.level === 'critical' && a.component === 'total')).toBe(true);
    });

    it('should check component thresholds', () => {
      // Component thresholds are 50% of total thresholds
      // componentWarning = 1000 * 0.5 = 500, componentCritical = 5000 * 0.5 = 2500
      // 3000 > 2500 (critical), so this should trigger critical
      monitor.setThresholds({ warning: 1000, critical: 5000 });
      monitor.registerComponent('large', () => 3000);

      const alerts = monitor.checkThresholds();
      expect(alerts.some(a => a.level === 'critical' && a.component === 'large')).toBe(true);
    });

    it('should return no alerts when under threshold', () => {
      monitor.setThresholds({ warning: 100000, critical: 500000 });
      monitor.registerComponent('small', () => 1000);

      const alerts = monitor.checkThresholds();
      expect(alerts.length).toBe(0);
    });

    it('should get and set thresholds', () => {
      monitor.setThresholds({ warning: 2000, critical: 10000 });

      const thresholds = monitor.getThresholds();
      expect(thresholds.warning).toBe(2000);
      expect(thresholds.critical).toBe(10000);
    });
  });

  describe('listeners', () => {
    it('should notify listeners on getUsage', () => {
      const callback = vi.fn();
      monitor.addListener(callback);
      monitor.registerComponent('test', () => 1000);

      monitor.getUsage();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        totalBytes: 1000,
      }));
    });

    it('should remove listener', () => {
      const callback = vi.fn();
      monitor.addListener(callback);
      monitor.removeListener(callback);
      monitor.registerComponent('test', () => 1000);

      monitor.getUsage();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const errorCallback = vi.fn(() => { throw new Error('Callback error'); });
      const goodCallback = vi.fn();

      monitor.addListener(errorCallback);
      monitor.addListener(goodCallback);
      monitor.registerComponent('test', () => 1000);

      // Should not throw
      expect(() => monitor.getUsage()).not.toThrow();
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  describe('last usage', () => {
    it('should track last usage', () => {
      monitor.registerComponent('test', () => 1000);

      expect(monitor.getLastUsage()).toBeNull();

      monitor.getUsage();

      const lastUsage = monitor.getLastUsage();
      expect(lastUsage).not.toBeNull();
      expect(lastUsage!.totalBytes).toBe(1000);
    });

    it('should clear last usage on clear', () => {
      monitor.registerComponent('test', () => 1000);
      monitor.getUsage();

      expect(monitor.getLastUsage()).not.toBeNull();

      monitor.clear();

      expect(monitor.getLastUsage()).toBeNull();
    });
  });

  describe('heap stats', () => {
    it('should include heap stats if available', () => {
      monitor.registerComponent('test', () => 1000);
      const usage = monitor.getUsage();

      // In Node.js environment, heap stats should be available
      expect(usage.heapStats).toBeDefined();
      expect(usage.heapStats!.heapUsed).toBeGreaterThan(0);
      expect(usage.heapStats!.heapTotal).toBeGreaterThan(0);
    });
  });

  describe('globalMemoryMonitor', () => {
    it('should be a singleton instance', () => {
      expect(globalMemoryMonitor).toBeInstanceOf(MemoryMonitor);
    });
  });

  describe('edge cases', () => {
    it('should handle empty monitor', () => {
      const usage = monitor.getUsage();

      expect(usage.totalBytes).toBe(0);
      expect(usage.components.length).toBe(0);
      expect(usage.totalFormatted).toBe('0 B');
    });

    it('should handle zero-returning estimator', () => {
      monitor.registerComponent('empty', () => 0);

      const usage = monitor.getUsage();
      expect(usage.totalBytes).toBe(0);
      expect(usage.components[0].bytes).toBe(0);
    });

    it('should handle item counter returning zero', () => {
      monitor.registerComponent('test', () => 1000, () => 0);

      const compUsage = monitor.getComponentUsage('test');
      expect(compUsage!.itemCount).toBe(0);
      expect(compUsage!.bytesPerItem).toBeUndefined();
    });
  });
});
