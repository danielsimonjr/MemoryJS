/**
 * Tests for Query Logger
 *
 * @module tests/unit/search/QueryLogger.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryLogger, QueryLoggerConfig } from '../../../src/search/QueryLogger.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    appendFileSync: vi.fn(),
  };
});

import { appendFileSync } from 'fs';

describe('QueryLogger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    // Clear relevant env vars
    delete process.env.MEMORY_QUERY_LOGGING;
    delete process.env.MEMORY_QUERY_LOG_FILE;
    delete process.env.MEMORY_QUERY_LOG_LEVEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Constructor and Configuration', () => {
    it('should create logger with default config', () => {
      const logger = new QueryLogger();
      expect(logger.isEnabled()).toBe(false);
    });

    it('should create logger with console enabled', () => {
      const logger = new QueryLogger({ console: true });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should create logger with file path', () => {
      const logger = new QueryLogger({ filePath: '/tmp/query.log' });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should create logger with callback', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should read config from environment variables', () => {
      process.env.MEMORY_QUERY_LOGGING = 'true';
      process.env.MEMORY_QUERY_LOG_FILE = '/tmp/env-query.log';
      process.env.MEMORY_QUERY_LOG_LEVEL = 'debug';

      const logger = new QueryLogger();
      expect(logger.isEnabled()).toBe(true);
    });

    it('should prefer explicit config over environment', () => {
      process.env.MEMORY_QUERY_LOG_LEVEL = 'error';

      const logger = new QueryLogger({ level: 'debug', console: true });
      // Logger should use 'debug' level from config, not 'error' from env
      expect(logger.isEnabled()).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return false when no outputs configured', () => {
      const logger = new QueryLogger({});
      expect(logger.isEnabled()).toBe(false);
    });

    it('should return true when console is enabled', () => {
      const logger = new QueryLogger({ console: true });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should return true when file path is set', () => {
      const logger = new QueryLogger({ filePath: '/tmp/test.log' });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should return true when callback is set', () => {
      const logger = new QueryLogger({ callback: () => {} });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should return true when multiple outputs configured', () => {
      const logger = new QueryLogger({ console: true, filePath: '/tmp/test.log' });
      expect(logger.isEnabled()).toBe(true);
    });
  });

  describe('logQueryStart', () => {
    it('should log query start event', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryStart('q123', 'hello world', 'ranked');

      expect(callback).toHaveBeenCalledTimes(1);
      const entry = callback.mock.calls[0][0];
      expect(entry.queryId).toBe('q123');
      expect(entry.queryText).toBe('hello world');
      expect(entry.queryType).toBe('ranked');
      expect(entry.event).toBe('query_start');
      expect(entry.level).toBe('info');
    });

    it('should include timestamp in entry', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryStart('q123', 'test', 'basic');

      const entry = callback.mock.calls[0][0];
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('logQueryEnd', () => {
    it('should log query end event', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryEnd('q123', 150, 10);

      expect(callback).toHaveBeenCalledTimes(1);
      const entry = callback.mock.calls[0][0];
      expect(entry.queryId).toBe('q123');
      expect(entry.duration).toBe(150);
      expect(entry.resultCount).toBe(10);
      expect(entry.event).toBe('query_end');
    });
  });

  describe('logStage', () => {
    it('should log stage event with debug level', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'debug' });

      logger.logStage('q123', 'tokenize', 5, { tokens: 3 });

      expect(callback).toHaveBeenCalledTimes(1);
      const entry = callback.mock.calls[0][0];
      expect(entry.queryId).toBe('q123');
      expect(entry.event).toBe('stage_tokenize');
      expect(entry.duration).toBe(5);
      expect(entry.metadata).toEqual({ tokens: 3 });
      expect(entry.level).toBe('debug');
    });

    it('should not log stage when level is above debug', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logStage('q123', 'tokenize', 5);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Log Level Methods', () => {
    it('should log debug message', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'debug' });

      logger.debug('q123', 'debug message', { key: 'value' });

      const entry = callback.mock.calls[0][0];
      expect(entry.level).toBe('debug');
      expect(entry.event).toBe('debug message');
    });

    it('should log info message', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.info('q123', 'info message', { key: 'value' });

      const entry = callback.mock.calls[0][0];
      expect(entry.level).toBe('info');
      expect(entry.event).toBe('info message');
    });

    it('should log warn message', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'warn' });

      logger.warn('q123', 'warning message');

      const entry = callback.mock.calls[0][0];
      expect(entry.level).toBe('warn');
      expect(entry.event).toBe('warning message');
    });

    it('should log error message', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'error' });

      logger.error('q123', 'error message');

      const entry = callback.mock.calls[0][0];
      expect(entry.level).toBe('error');
      expect(entry.event).toBe('error message');
    });

    it('should log error with Error object', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'error' });
      const error = new Error('test error');

      logger.error('q123', 'error occurred', error);

      const entry = callback.mock.calls[0][0];
      expect(entry.metadata?.error).toBe('test error');
      expect(entry.metadata?.stack).toBeDefined();
    });
  });

  describe('Log Level Filtering', () => {
    it('should filter debug when level is info', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.debug('q123', 'debug message');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should filter info when level is warn', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'warn' });

      logger.info('q123', 'info message');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should filter warn when level is error', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'error' });

      logger.warn('q123', 'warn message');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow error at any level', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'error' });

      logger.error('q123', 'error message');

      expect(callback).toHaveBeenCalled();
    });

    it('should allow all messages at debug level', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'debug' });

      logger.debug('q1', 'debug');
      logger.info('q2', 'info');
      logger.warn('q3', 'warn');
      logger.error('q4', 'error');

      expect(callback).toHaveBeenCalledTimes(4);
    });
  });

  describe('Console Output', () => {
    it('should log to console.debug for debug level', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'debug' });

      logger.debug('q123', 'debug message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log to console.info for info level', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'info' });

      logger.info('q123', 'info message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log to console.warn for warn level', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'warn' });

      logger.warn('q123', 'warn message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log to console.error for error level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'error' });

      logger.error('q123', 'error message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include timestamp in console output by default', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'info' });

      logger.info('q123', 'test message');

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/^\[.*\]/); // Starts with timestamp
      consoleSpy.mockRestore();
    });

    it('should exclude timestamp when disabled', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'info', timestamps: false });

      logger.info('q123', 'test message');

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).not.toMatch(/^\[.*T.*\]/); // No ISO timestamp at start
      consoleSpy.mockRestore();
    });

    it('should format console message correctly', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'info', timestamps: false });

      logger.logQueryStart('q123', 'test query', 'basic');

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('[INFO]');
      expect(output).toContain('query_start');
      consoleSpy.mockRestore();
    });
  });

  describe('File Output', () => {
    it('should append to file when filePath is set', () => {
      const logger = new QueryLogger({ filePath: '/tmp/test.log', level: 'info' });

      logger.info('q123', 'test message');

      expect(appendFileSync).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('"queryId":"q123"')
      );
    });

    it('should write JSON line to file', () => {
      const logger = new QueryLogger({ filePath: '/tmp/test.log', level: 'info' });

      logger.info('q123', 'test message');

      const call = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toMatch(/\}[\n]$/); // Ends with JSON object and newline
    });

    it('should silently fail on file write error', () => {
      (appendFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Write failed');
      });
      const logger = new QueryLogger({ filePath: '/tmp/test.log', level: 'info' });

      // Should not throw
      expect(() => logger.info('q123', 'test')).not.toThrow();
    });
  });

  describe('Callback Output', () => {
    it('should call callback with log entry', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.info('q123', 'test message');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          queryId: 'q123',
          event: 'test message',
          level: 'info',
        })
      );
    });

    it('should silently fail on callback error', () => {
      const callback = vi.fn().mockImplementation(() => {
        throw new Error('Callback failed');
      });
      const logger = new QueryLogger({ callback, level: 'info' });

      // Should not throw
      expect(() => logger.info('q123', 'test')).not.toThrow();
    });
  });

  describe('Multiple Outputs', () => {
    it('should log to all configured outputs', () => {
      const callback = vi.fn();
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new QueryLogger({
        console: true,
        filePath: '/tmp/test.log',
        callback,
        level: 'info',
      });

      logger.info('q123', 'test message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(appendFileSync).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('generateQueryId', () => {
    it('should generate unique query IDs', () => {
      const id1 = QueryLogger.generateQueryId();
      const id2 = QueryLogger.generateQueryId();

      expect(id1).not.toBe(id2);
    });

    it('should start with "q_" prefix', () => {
      const id = QueryLogger.generateQueryId();

      expect(id).toMatch(/^q_/);
    });

    it('should contain timestamp', () => {
      const before = Date.now();
      const id = QueryLogger.generateQueryId();
      const after = Date.now();

      // Extract timestamp from ID (format: q_<timestamp>_<random>)
      const parts = id.split('_');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should contain random suffix', () => {
      const id = QueryLogger.generateQueryId();
      const parts = id.split('_');

      expect(parts).toHaveLength(3);
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('should generate many unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(QueryLogger.generateQueryId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('Entry Structure', () => {
    it('should include all required fields', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'debug' });

      logger.logQueryStart('q123', 'test query', 'basic');

      const entry = callback.mock.calls[0][0];
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('queryId');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('event');
    });

    it('should handle missing queryId gracefully', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      // Internal log method with missing queryId
      (logger as any).log('info', 'test', {});

      const entry = callback.mock.calls[0][0];
      expect(entry.queryId).toBe('unknown');
    });

    it('should filter undefined values in console data', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new QueryLogger({ console: true, level: 'info', timestamps: false });

      logger.info('q123', 'test', undefined);

      // Console output should not include "undefined"
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).not.toContain('undefined');
      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query text', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryStart('q123', '', 'basic');

      const entry = callback.mock.calls[0][0];
      expect(entry.queryText).toBe('');
    });

    it('should handle special characters in query text', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryStart('q123', 'test "quoted" & special <chars>', 'basic');

      const entry = callback.mock.calls[0][0];
      expect(entry.queryText).toBe('test "quoted" & special <chars>');
    });

    it('should handle unicode in query text', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryStart('q123', '日本語テスト', 'basic');

      const entry = callback.mock.calls[0][0];
      expect(entry.queryText).toBe('日本語テスト');
    });

    it('should handle very long query text', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });
      const longQuery = 'a'.repeat(10000);

      logger.logQueryStart('q123', longQuery, 'basic');

      const entry = callback.mock.calls[0][0];
      expect(entry.queryText).toHaveLength(10000);
    });

    it('should handle zero duration', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryEnd('q123', 0, 5);

      const entry = callback.mock.calls[0][0];
      expect(entry.duration).toBe(0);
    });

    it('should handle zero result count', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryEnd('q123', 100, 0);

      const entry = callback.mock.calls[0][0];
      expect(entry.resultCount).toBe(0);
    });

    it('should handle large result count', () => {
      const callback = vi.fn();
      const logger = new QueryLogger({ callback, level: 'info' });

      logger.logQueryEnd('q123', 100, 1000000);

      const entry = callback.mock.calls[0][0];
      expect(entry.resultCount).toBe(1000000);
    });
  });
});
