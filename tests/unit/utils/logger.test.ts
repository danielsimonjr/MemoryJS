import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from '../../../src/utils/logger.js';

describe('logger', () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  // Spy on console methods
  // Note: debug and info use console.error to avoid interfering with JSON-RPC on stdout
  const consoleSpy = {
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  describe('debug', () => {
    it('should log debug messages when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('Test debug message');

      // debug uses console.error to avoid interfering with JSON-RPC on stdout
      expect(consoleSpy.error).toHaveBeenCalledWith('[DEBUG] Test debug message');
    });

    it('should log debug messages with additional arguments', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('Debug with args', { key: 'value' }, 123);

      expect(consoleSpy.error).toHaveBeenCalledWith('[DEBUG] Debug with args', { key: 'value' }, 123);
    });

    it('should NOT log debug messages when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;

      logger.debug('This should not appear');

      // No [DEBUG] prefix calls should be made
      expect(consoleSpy.error).not.toHaveBeenCalledWith(expect.stringMatching(/^\[DEBUG\]/));
    });

    it('should NOT log debug messages when LOG_LEVEL is info', () => {
      process.env.LOG_LEVEL = 'info';

      logger.debug('This should not appear');

      expect(consoleSpy.error).not.toHaveBeenCalledWith(expect.stringMatching(/^\[DEBUG\]/));
    });

    it('should NOT log debug messages when LOG_LEVEL is warn', () => {
      process.env.LOG_LEVEL = 'warn';

      logger.debug('This should not appear');

      expect(consoleSpy.error).not.toHaveBeenCalledWith(expect.stringMatching(/^\[DEBUG\]/));
    });

    it('should NOT log debug messages when LOG_LEVEL is error', () => {
      process.env.LOG_LEVEL = 'error';

      logger.debug('This should not appear');

      expect(consoleSpy.error).not.toHaveBeenCalledWith(expect.stringMatching(/^\[DEBUG\]/));
    });

    it('should handle empty message', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('');

      expect(consoleSpy.error).toHaveBeenCalledWith('[DEBUG] ');
    });

    it('should handle multiple arguments of different types', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('Mixed args', null, undefined, true, ['array'], { obj: true });

      expect(consoleSpy.error).toHaveBeenCalledWith(
        '[DEBUG] Mixed args',
        null,
        undefined,
        true,
        ['array'],
        { obj: true }
      );
    });
  });

  describe('info', () => {
    it('should log info messages', () => {
      logger.info('Test info message');

      // info uses console.error to avoid interfering with JSON-RPC on stdout
      expect(consoleSpy.error).toHaveBeenCalledWith('[INFO] Test info message');
    });

    it('should log info messages with additional arguments', () => {
      logger.info('Info with args', { data: 'test' }, 42);

      expect(consoleSpy.error).toHaveBeenCalledWith('[INFO] Info with args', { data: 'test' }, 42);
    });

    it('should always log info regardless of LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'error';

      logger.info('Info should appear');

      expect(consoleSpy.error).toHaveBeenCalledWith('[INFO] Info should appear');
    });

    it('should handle empty message', () => {
      logger.info('');

      expect(consoleSpy.error).toHaveBeenCalledWith('[INFO] ');
    });

    it('should handle no additional arguments', () => {
      logger.info('Simple message');

      expect(consoleSpy.error).toHaveBeenCalledWith('[INFO] Simple message');
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.warn('Test warning message');

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] Test warning message');
    });

    it('should log warning messages with additional arguments', () => {
      logger.warn('Warning with args', { issue: 'minor' }, 'extra');

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] Warning with args', { issue: 'minor' }, 'extra');
    });

    it('should always log warnings regardless of LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'error';

      logger.warn('Warning should appear');

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] Warning should appear');
    });

    it('should handle Error objects as arguments', () => {
      const error = new Error('Test error');

      logger.warn('Warning with error', error);

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] Warning with error', error);
    });

    it('should handle empty message', () => {
      logger.warn('');

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] ');
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      logger.error('Test error message');

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Test error message');
    });

    it('should log error messages with additional arguments', () => {
      logger.error('Error with args', { code: 500 }, new Error('inner'));

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Error with args', { code: 500 }, expect.any(Error));
    });

    it('should always log errors regardless of LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'info';

      logger.error('Error should appear');

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Error should appear');
    });

    it('should handle Error objects as arguments', () => {
      const error = new Error('Critical failure');

      logger.error('Critical error', error);

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Critical error', error);
    });

    it('should handle stack traces', () => {
      const error = new Error('With stack');

      logger.error('Error with stack', error.stack);

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Error with stack', expect.stringContaining('Error: With stack'));
    });

    it('should handle empty message', () => {
      logger.error('');

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] ');
    });
  });

  describe('logger object structure', () => {
    it('should have all required methods', () => {
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should have exactly 4 methods', () => {
      const methods = Object.keys(logger);
      expect(methods).toHaveLength(4);
      expect(methods).toContain('debug');
      expect(methods).toContain('info');
      expect(methods).toContain('warn');
      expect(methods).toContain('error');
    });
  });

  describe('format consistency', () => {
    it('should use consistent prefix format [LEVEL]', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');

      // debug, info, and error all use console.error (to keep stdout clean for JSON-RPC)
      // warn uses console.warn
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringMatching(/^\[DEBUG\] /));
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringMatching(/^\[INFO\] /));
      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[WARN\] /));
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringMatching(/^\[ERROR\] /));
    });
  });
});
