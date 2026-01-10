/**
 * Memory Usage Monitor
 *
 * Phase 12 Sprint 6: Track memory usage across all components
 * with human-readable formatting.
 *
 * @module utils/MemoryMonitor
 */

/**
 * Memory usage for a single component.
 */
export interface ComponentMemoryUsage {
  /** Component name */
  name: string;
  /** Estimated memory usage in bytes */
  bytes: number;
  /** Item count (if applicable) */
  itemCount?: number;
  /** Average bytes per item */
  bytesPerItem?: number;
}

/**
 * Aggregate memory usage statistics.
 */
export interface MemoryUsageStats {
  /** Total memory usage in bytes */
  totalBytes: number;
  /** Formatted total memory */
  totalFormatted: string;
  /** Per-component breakdown */
  components: ComponentMemoryUsage[];
  /** Timestamp of measurement */
  timestamp: Date;
  /** Node.js heap stats (if available) */
  heapStats?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
}

/**
 * Memory threshold configuration.
 */
export interface MemoryThresholds {
  /** Warning threshold in bytes */
  warning: number;
  /** Critical threshold in bytes */
  critical: number;
}

/**
 * Memory alert.
 */
export interface MemoryAlert {
  /** Alert level */
  level: 'warning' | 'critical';
  /** Component that triggered the alert */
  component: string;
  /** Current usage */
  currentBytes: number;
  /** Threshold exceeded */
  threshold: number;
  /** Message */
  message: string;
}

/**
 * Callback for memory change events.
 */
export type MemoryChangeCallback = (usage: MemoryUsageStats) => void;

/**
 * Default memory thresholds.
 */
const DEFAULT_THRESHOLDS: MemoryThresholds = {
  warning: 100 * 1024 * 1024, // 100 MB
  critical: 500 * 1024 * 1024, // 500 MB
};

/**
 * Memory Monitor for tracking usage across components.
 *
 * @example
 * ```typescript
 * const monitor = new MemoryMonitor();
 *
 * // Register components
 * monitor.registerComponent('entities', () => entities.length * 500);
 * monitor.registerComponent('vectors', () => vectors.size * dimension * 4);
 *
 * // Get usage stats
 * const stats = monitor.getUsage();
 * console.log(`Total memory: ${stats.totalFormatted}`);
 *
 * // Check for alerts
 * const alerts = monitor.checkThresholds();
 * ```
 */
export class MemoryMonitor {
  private componentEstimators: Map<string, () => number>;
  private itemCounters: Map<string, () => number>;
  private thresholds: MemoryThresholds;
  private listeners: MemoryChangeCallback[];
  private lastUsage: MemoryUsageStats | null = null;

  constructor(thresholds?: Partial<MemoryThresholds>) {
    this.componentEstimators = new Map();
    this.itemCounters = new Map();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.listeners = [];
  }

  /**
   * Register a component for memory tracking.
   *
   * @param name - Component name
   * @param estimator - Function that returns estimated bytes
   * @param itemCounter - Optional function that returns item count
   */
  registerComponent(
    name: string,
    estimator: () => number,
    itemCounter?: () => number
  ): void {
    this.componentEstimators.set(name, estimator);
    if (itemCounter) {
      this.itemCounters.set(name, itemCounter);
    }
  }

  /**
   * Unregister a component.
   *
   * @param name - Component name
   */
  unregisterComponent(name: string): void {
    this.componentEstimators.delete(name);
    this.itemCounters.delete(name);
  }

  /**
   * Get current memory usage statistics.
   */
  getUsage(): MemoryUsageStats {
    const components: ComponentMemoryUsage[] = [];
    let totalBytes = 0;

    for (const [name, estimator] of this.componentEstimators) {
      const bytes = estimator();
      totalBytes += bytes;

      const itemCounter = this.itemCounters.get(name);
      const itemCount = itemCounter ? itemCounter() : undefined;
      const bytesPerItem = itemCount && itemCount > 0 ? Math.round(bytes / itemCount) : undefined;

      components.push({
        name,
        bytes,
        itemCount,
        bytesPerItem,
      });
    }

    // Sort by usage descending
    components.sort((a, b) => b.bytes - a.bytes);

    // Get Node.js heap stats if available
    let heapStats: MemoryUsageStats['heapStats'];
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const mem = process.memoryUsage();
      heapStats = {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
      };
    }

    const stats: MemoryUsageStats = {
      totalBytes,
      totalFormatted: this.formatBytes(totalBytes),
      components,
      timestamp: new Date(),
      heapStats,
    };

    this.lastUsage = stats;
    this.notifyListeners(stats);

    return stats;
  }

  /**
   * Get memory usage for a specific component.
   *
   * @param name - Component name
   */
  getComponentUsage(name: string): ComponentMemoryUsage | undefined {
    const estimator = this.componentEstimators.get(name);
    if (!estimator) return undefined;

    const bytes = estimator();
    const itemCounter = this.itemCounters.get(name);
    const itemCount = itemCounter ? itemCounter() : undefined;
    const bytesPerItem = itemCount && itemCount > 0 ? Math.round(bytes / itemCount) : undefined;

    return {
      name,
      bytes,
      itemCount,
      bytesPerItem,
    };
  }

  /**
   * Check memory thresholds and return alerts.
   */
  checkThresholds(): MemoryAlert[] {
    const alerts: MemoryAlert[] = [];
    const usage = this.getUsage();

    // Check total memory
    if (usage.totalBytes >= this.thresholds.critical) {
      alerts.push({
        level: 'critical',
        component: 'total',
        currentBytes: usage.totalBytes,
        threshold: this.thresholds.critical,
        message: `Total memory usage (${this.formatBytes(usage.totalBytes)}) exceeds critical threshold (${this.formatBytes(this.thresholds.critical)})`,
      });
    } else if (usage.totalBytes >= this.thresholds.warning) {
      alerts.push({
        level: 'warning',
        component: 'total',
        currentBytes: usage.totalBytes,
        threshold: this.thresholds.warning,
        message: `Total memory usage (${this.formatBytes(usage.totalBytes)}) exceeds warning threshold (${this.formatBytes(this.thresholds.warning)})`,
      });
    }

    // Check per-component thresholds (50% of total threshold per component)
    const componentWarning = this.thresholds.warning * 0.5;
    const componentCritical = this.thresholds.critical * 0.5;

    for (const component of usage.components) {
      if (component.bytes >= componentCritical) {
        alerts.push({
          level: 'critical',
          component: component.name,
          currentBytes: component.bytes,
          threshold: componentCritical,
          message: `Component '${component.name}' (${this.formatBytes(component.bytes)}) exceeds critical threshold`,
        });
      } else if (component.bytes >= componentWarning) {
        alerts.push({
          level: 'warning',
          component: component.name,
          currentBytes: component.bytes,
          threshold: componentWarning,
          message: `Component '${component.name}' (${this.formatBytes(component.bytes)}) exceeds warning threshold`,
        });
      }
    }

    return alerts;
  }

  /**
   * Set memory thresholds.
   *
   * @param thresholds - New threshold values
   */
  setThresholds(thresholds: Partial<MemoryThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Get current thresholds.
   */
  getThresholds(): MemoryThresholds {
    return { ...this.thresholds };
  }

  /**
   * Add a listener for memory changes.
   *
   * @param callback - Callback to invoke on memory changes
   */
  addListener(callback: MemoryChangeCallback): void {
    this.listeners.push(callback);
  }

  /**
   * Remove a listener.
   *
   * @param callback - Callback to remove
   */
  removeListener(callback: MemoryChangeCallback): void {
    const index = this.listeners.indexOf(callback);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Get a human-readable summary of memory usage.
   */
  getSummary(): string {
    const usage = this.getUsage();
    const lines: string[] = [
      '=== Memory Usage Summary ===',
      `Total: ${usage.totalFormatted}`,
      '',
      'By Component:',
    ];

    for (const component of usage.components) {
      const itemInfo = component.itemCount
        ? ` (${component.itemCount.toLocaleString()} items, ~${this.formatBytes(component.bytesPerItem ?? 0)}/item)`
        : '';
      lines.push(`  ${component.name}: ${this.formatBytes(component.bytes)}${itemInfo}`);
    }

    if (usage.heapStats) {
      lines.push('');
      lines.push('Node.js Heap:');
      lines.push(`  Heap Used: ${this.formatBytes(usage.heapStats.heapUsed)}`);
      lines.push(`  Heap Total: ${this.formatBytes(usage.heapStats.heapTotal)}`);
      lines.push(`  External: ${this.formatBytes(usage.heapStats.external)}`);
      lines.push(`  RSS: ${this.formatBytes(usage.heapStats.rss)}`);
    }

    return lines.join('\n');
  }

  /**
   * Get the last recorded usage without triggering a new measurement.
   */
  getLastUsage(): MemoryUsageStats | null {
    return this.lastUsage;
  }

  /**
   * Format bytes as human-readable string.
   *
   * @param bytes - Number of bytes
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  /**
   * Parse a formatted byte string back to number.
   *
   * @param formatted - Formatted string like "10 MB"
   */
  parseBytes(formatted: string): number {
    const match = formatted.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024,
    };

    return value * (units[unit] ?? 1);
  }

  /**
   * Clear all registered components.
   */
  clear(): void {
    this.componentEstimators.clear();
    this.itemCounters.clear();
    this.lastUsage = null;
  }

  // Private methods

  private notifyListeners(usage: MemoryUsageStats): void {
    for (const listener of this.listeners) {
      try {
        listener(usage);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Singleton instance for global memory monitoring.
 */
export const globalMemoryMonitor = new MemoryMonitor();
