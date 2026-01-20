/**
 * Query Logger
 *
 * Provides structured logging for search operations.
 * Supports console, file, and callback outputs.
 * Phase 1 Sprint 6: Query Logging and Tracing.
 *
 * @module search/QueryLogger
 */

import { appendFileSync } from 'fs';
import type { LogLevel, QueryLogEntry } from '../types/search.js';

/**
 * Configuration for QueryLogger.
 */
export interface QueryLoggerConfig {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Log to console */
  console?: boolean;
  /** Log to file path */
  filePath?: string;
  /** Custom callback for log entries */
  callback?: (entry: QueryLogEntry) => void;
  /** Include timestamps in console output */
  timestamps?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Query logger for search operations.
 *
 * @example
 * ```typescript
 * const logger = new QueryLogger({ level: 'debug', console: true });
 * logger.logQueryStart('q123', 'hello world', 'ranked');
 * // ... search executes ...
 * logger.logQueryEnd('q123', 150, 10);
 * ```
 */
export class QueryLogger {
  private readonly config: Required<Omit<QueryLoggerConfig, 'callback'>> & {
    callback?: (entry: QueryLogEntry) => void;
  };

  constructor(config: QueryLoggerConfig = {}) {
    this.config = {
      level: config.level ?? (process.env.MEMORY_QUERY_LOG_LEVEL as LogLevel) ?? 'info',
      console: config.console ?? process.env.MEMORY_QUERY_LOGGING === 'true',
      filePath: config.filePath ?? process.env.MEMORY_QUERY_LOG_FILE ?? '',
      callback: config.callback,
      timestamps: config.timestamps ?? true,
    };
  }

  /**
   * Check if logging is enabled (any output configured).
   */
  isEnabled(): boolean {
    return this.config.console || !!this.config.filePath || !!this.config.callback;
  }

  /**
   * Log the start of a query.
   */
  logQueryStart(queryId: string, queryText: string, queryType: string): void {
    this.log('info', 'query_start', {
      queryId,
      queryText,
      queryType,
    });
  }

  /**
   * Log the end of a query.
   */
  logQueryEnd(queryId: string, durationMs: number, resultCount: number): void {
    this.log('info', 'query_end', {
      queryId,
      duration: durationMs,
      resultCount,
    });
  }

  /**
   * Log a query stage.
   */
  logStage(
    queryId: string,
    stage: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): void {
    this.log('debug', `stage_${stage}`, {
      queryId,
      duration: durationMs,
      metadata,
    });
  }

  /**
   * Log a debug message.
   */
  debug(queryId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, { queryId, metadata });
  }

  /**
   * Log an info message.
   */
  info(queryId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, { queryId, metadata });
  }

  /**
   * Log a warning.
   */
  warn(queryId: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, { queryId, metadata });
  }

  /**
   * Log an error.
   */
  error(queryId: string, message: string, error?: Error): void {
    this.log('error', message, {
      queryId,
      metadata: error ? { error: error.message, stack: error.stack } : undefined,
    });
  }

  private log(level: LogLevel, event: string, data: Partial<QueryLogEntry>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    const entry: QueryLogEntry = {
      timestamp: new Date().toISOString(),
      queryId: data.queryId ?? 'unknown',
      level,
      event,
      ...data,
    };

    // Console output
    if (this.config.console) {
      const prefix = this.config.timestamps ? `[${entry.timestamp}] ` : '';
      const msg = `${prefix}[${level.toUpperCase()}] ${event} - ${JSON.stringify(this.formatConsoleData(data))}`;
      switch (level) {
        case 'debug':
          console.debug(msg);
          break;
        case 'info':
          console.info(msg);
          break;
        case 'warn':
          console.warn(msg);
          break;
        case 'error':
          console.error(msg);
          break;
      }
    }

    // File output
    if (this.config.filePath) {
      try {
        appendFileSync(this.config.filePath, JSON.stringify(entry) + '\n');
      } catch {
        // Silently fail file writes to not disrupt search operations
      }
    }

    // Callback
    if (this.config.callback) {
      try {
        this.config.callback(entry);
      } catch {
        // Silently fail callbacks to not disrupt search operations
      }
    }
  }

  /**
   * Format data for console output (remove undefined values).
   */
  private formatConsoleData(data: Partial<QueryLogEntry>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Generate a unique query ID.
   */
  static generateQueryId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
