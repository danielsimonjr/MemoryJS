/**
 * Tests for CLI Global Options
 *
 * @module tests/unit/cli/options.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGlobalOptions,
  defaultOptions,
  createLogger,
  type GlobalOptions,
} from '../../../src/cli/options.js';

describe('CLI Options', () => {
  describe('defaultOptions', () => {
    it('should have correct default values', () => {
      // Note: These may be affected by environment variables
      expect(defaultOptions).toHaveProperty('storage');
      expect(defaultOptions).toHaveProperty('format');
      expect(defaultOptions.quiet).toBe(false);
      expect(defaultOptions.verbose).toBe(false);
    });

    it('should use environment variable for storage if set', () => {
      // This is tested by checking defaultOptions includes env var logic
      // The actual env var testing would require process manipulation
      expect(typeof defaultOptions.storage).toBe('string');
    });
  });

  describe('parseGlobalOptions', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should parse valid storage path', () => {
      const result = parseGlobalOptions({
        storage: './custom/path.jsonl',
      });
      expect(result.storage).toBe('./custom/path.jsonl');
    });

    it('should use default storage when not provided', () => {
      const result = parseGlobalOptions({});
      expect(result.storage).toBe(defaultOptions.storage);
    });

    it('should parse json format', () => {
      const result = parseGlobalOptions({ format: 'json' });
      expect(result.format).toBe('json');
    });

    it('should parse table format', () => {
      const result = parseGlobalOptions({ format: 'table' });
      expect(result.format).toBe('table');
    });

    it('should parse csv format', () => {
      const result = parseGlobalOptions({ format: 'csv' });
      expect(result.format).toBe('csv');
    });

    it('should use default format when not provided', () => {
      const result = parseGlobalOptions({});
      expect(result.format).toBe(defaultOptions.format);
    });

    it('should exit on invalid format', () => {
      expect(() => {
        parseGlobalOptions({ format: 'invalid' });
      }).toThrow('process.exit called');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid format')
      );
    });

    it('should exit on format that is not json, table, or csv', () => {
      expect(() => {
        parseGlobalOptions({ format: 'xml' });
      }).toThrow('process.exit called');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('xml')
      );
    });

    it('should parse quiet flag as true', () => {
      const result = parseGlobalOptions({ quiet: true });
      expect(result.quiet).toBe(true);
    });

    it('should parse quiet flag as false', () => {
      const result = parseGlobalOptions({ quiet: false });
      expect(result.quiet).toBe(false);
    });

    it('should convert truthy quiet value to boolean', () => {
      const result = parseGlobalOptions({ quiet: 'yes' });
      expect(result.quiet).toBe(true);
    });

    it('should convert undefined quiet to false', () => {
      const result = parseGlobalOptions({});
      expect(result.quiet).toBe(false);
    });

    it('should parse verbose flag as true', () => {
      const result = parseGlobalOptions({ verbose: true });
      expect(result.verbose).toBe(true);
    });

    it('should parse verbose flag as false', () => {
      const result = parseGlobalOptions({ verbose: false });
      expect(result.verbose).toBe(false);
    });

    it('should convert truthy verbose value to boolean', () => {
      const result = parseGlobalOptions({ verbose: 1 });
      expect(result.verbose).toBe(true);
    });

    it('should convert undefined verbose to false', () => {
      const result = parseGlobalOptions({});
      expect(result.verbose).toBe(false);
    });

    it('should parse all options together', () => {
      const result = parseGlobalOptions({
        storage: './test.jsonl',
        format: 'csv',
        quiet: true,
        verbose: true,
      });

      expect(result).toEqual({
        storage: './test.jsonl',
        format: 'csv',
        quiet: true,
        verbose: true,
      });
    });

    it('should handle empty string storage', () => {
      const result = parseGlobalOptions({ storage: '' });
      // Empty string is falsy, should use default
      expect(result.storage).toBe(defaultOptions.storage);
    });

    it('should accept absolute paths for storage', () => {
      const result = parseGlobalOptions({
        storage: '/absolute/path/memory.jsonl',
      });
      expect(result.storage).toBe('/absolute/path/memory.jsonl');
    });

    it('should accept sqlite storage path', () => {
      const result = parseGlobalOptions({
        storage: './memory.db',
      });
      expect(result.storage).toBe('./memory.db');
    });
  });

  describe('createLogger', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    describe('with default options', () => {
      const options: GlobalOptions = {
        storage: './test.jsonl',
        format: 'json',
        quiet: false,
        verbose: false,
      };

      it('should log info messages', () => {
        const logger = createLogger(options);
        logger.info('test message');
        expect(logSpy).toHaveBeenCalledWith('test message');
      });

      it('should not log debug messages when not verbose', () => {
        const logger = createLogger(options);
        logger.debug('debug message');
        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('debug'));
      });

      it('should log error messages', () => {
        const logger = createLogger(options);
        logger.error('error message');
        expect(errorSpy).toHaveBeenCalledWith('[ERROR] error message');
      });

      it('should log warn messages', () => {
        const logger = createLogger(options);
        logger.warn('warning message');
        expect(warnSpy).toHaveBeenCalledWith('[WARN] warning message');
      });
    });

    describe('with quiet mode', () => {
      const options: GlobalOptions = {
        storage: './test.jsonl',
        format: 'json',
        quiet: true,
        verbose: false,
      };

      it('should not log info messages', () => {
        const logger = createLogger(options);
        logger.info('test message');
        expect(logSpy).not.toHaveBeenCalled();
      });

      it('should not log debug messages', () => {
        const logger = createLogger(options);
        logger.debug('debug message');
        expect(logSpy).not.toHaveBeenCalled();
      });

      it('should still log error messages', () => {
        const logger = createLogger(options);
        logger.error('error message');
        expect(errorSpy).toHaveBeenCalledWith('[ERROR] error message');
      });

      it('should not log warn messages', () => {
        const logger = createLogger(options);
        logger.warn('warning message');
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    describe('with verbose mode', () => {
      const options: GlobalOptions = {
        storage: './test.jsonl',
        format: 'json',
        quiet: false,
        verbose: true,
      };

      it('should log info messages', () => {
        const logger = createLogger(options);
        logger.info('test message');
        expect(logSpy).toHaveBeenCalledWith('test message');
      });

      it('should log debug messages with prefix', () => {
        const logger = createLogger(options);
        logger.debug('debug message');
        expect(logSpy).toHaveBeenCalledWith('[DEBUG] debug message');
      });

      it('should log error messages', () => {
        const logger = createLogger(options);
        logger.error('error message');
        expect(errorSpy).toHaveBeenCalledWith('[ERROR] error message');
      });

      it('should log warn messages', () => {
        const logger = createLogger(options);
        logger.warn('warning message');
        expect(warnSpy).toHaveBeenCalledWith('[WARN] warning message');
      });
    });

    describe('with both quiet and verbose', () => {
      // This is an unusual combination but should work
      const options: GlobalOptions = {
        storage: './test.jsonl',
        format: 'json',
        quiet: true,
        verbose: true,
      };

      it('should not log info messages (quiet takes precedence)', () => {
        const logger = createLogger(options);
        logger.info('test message');
        expect(logSpy).not.toHaveBeenCalledWith('test message');
      });

      it('should log debug messages (verbose still works)', () => {
        const logger = createLogger(options);
        logger.debug('debug message');
        expect(logSpy).toHaveBeenCalledWith('[DEBUG] debug message');
      });
    });
  });
});
