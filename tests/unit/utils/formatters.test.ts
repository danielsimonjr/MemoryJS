/**
 * responseFormatter Unit Tests
 *
 * Tests for MCP tool response formatting utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  formatToolResponse,
  formatTextResponse,
  formatRawResponse,
  formatErrorResponse,
  ToolResponse
} from '../../../src/utils/index.js';

describe('responseFormatter', () => {
  describe('formatToolResponse', () => {
    it('should format object as JSON', () => {
      const data = { name: 'test', value: 42 };
      const result = formatToolResponse(data);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(data);
    });

    it('should format array as JSON', () => {
      const data = [1, 2, 3];
      const result = formatToolResponse(data);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(data);
    });

    it('should format primitive values', () => {
      expect(JSON.parse(formatToolResponse(42).content[0].text)).toBe(42);
      expect(JSON.parse(formatToolResponse('hello').content[0].text)).toBe('hello');
      expect(JSON.parse(formatToolResponse(true).content[0].text)).toBe(true);
      expect(JSON.parse(formatToolResponse(null).content[0].text)).toBe(null);
    });

    it('should pretty-print with 2-space indentation', () => {
      const data = { a: 1, b: 2 };
      const result = formatToolResponse(data);
      expect(result.content[0].text).toContain('\n');
      expect(result.content[0].text).toContain('  ');
    });

    it('should handle nested objects', () => {
      const data = {
        level1: {
          level2: {
            level3: 'deep'
          }
        }
      };
      const result = formatToolResponse(data);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.level1.level2.level3).toBe('deep');
    });

    it('should handle empty objects', () => {
      const result = formatToolResponse({});
      expect(JSON.parse(result.content[0].text)).toEqual({});
    });

    it('should handle empty arrays', () => {
      const result = formatToolResponse([]);
      expect(JSON.parse(result.content[0].text)).toEqual([]);
    });

    it('should not include isError flag', () => {
      const result = formatToolResponse({ data: 'test' });
      expect((result as Record<string, unknown>).isError).toBeUndefined();
    });

    it('should handle special characters in strings', () => {
      const data = { text: 'Line1\nLine2\tTabbed "Quoted"' };
      const result = formatToolResponse(data);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.text).toBe('Line1\nLine2\tTabbed "Quoted"');
    });

    it('should handle undefined values in objects', () => {
      const data = { defined: 'yes', undef: undefined };
      const result = formatToolResponse(data);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.defined).toBe('yes');
      expect('undef' in parsed).toBe(false); // undefined is stripped in JSON
    });
  });

  describe('formatTextResponse', () => {
    it('should format plain text message', () => {
      const result = formatTextResponse('Success message');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Success message');
    });

    it('should handle empty string', () => {
      const result = formatTextResponse('');
      expect(result.content[0].text).toBe('');
    });

    it('should preserve whitespace', () => {
      const result = formatTextResponse('  spaced  ');
      expect(result.content[0].text).toBe('  spaced  ');
    });

    it('should handle multiline text', () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const result = formatTextResponse(text);
      expect(result.content[0].text).toBe(text);
    });

    it('should not JSON-encode the text', () => {
      const result = formatTextResponse('{"not": "json"}');
      expect(result.content[0].text).toBe('{"not": "json"}');
    });

    it('should not include isError flag', () => {
      const result = formatTextResponse('message');
      expect((result as Record<string, unknown>).isError).toBeUndefined();
    });
  });

  describe('formatRawResponse', () => {
    it('should pass through raw string content', () => {
      const content = '# Markdown Header\n\nSome content';
      const result = formatRawResponse(content);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe(content);
    });

    it('should handle CSV content', () => {
      const csv = 'name,type\nAlice,person\nBob,person';
      const result = formatRawResponse(csv);
      expect(result.content[0].text).toBe(csv);
    });

    it('should handle XML/GraphML content', () => {
      const xml = '<?xml version="1.0"?><graphml><graph></graph></graphml>';
      const result = formatRawResponse(xml);
      expect(result.content[0].text).toBe(xml);
    });

    it('should handle empty content', () => {
      const result = formatRawResponse('');
      expect(result.content[0].text).toBe('');
    });

    it('should not include isError flag', () => {
      const result = formatRawResponse('content');
      expect((result as Record<string, unknown>).isError).toBeUndefined();
    });
  });

  describe('formatErrorResponse', () => {
    it('should format Error object', () => {
      const error = new Error('Something went wrong');
      const result = formatErrorResponse(error);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Something went wrong');
      expect(result.isError).toBe(true);
    });

    it('should format string error', () => {
      const result = formatErrorResponse('Direct error message');

      expect(result.content[0].text).toBe('Direct error message');
      expect(result.isError).toBe(true);
    });

    it('should handle Error subclasses', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const result = formatErrorResponse(new CustomError('Custom error'));
      expect(result.content[0].text).toBe('Custom error');
      expect(result.isError).toBe(true);
    });

    it('should handle empty error message', () => {
      const result = formatErrorResponse('');
      expect(result.content[0].text).toBe('');
      expect(result.isError).toBe(true);
    });

    it('should always set isError to true', () => {
      const result = formatErrorResponse('any error');
      expect(result.isError).toBe(true);
    });
  });

  describe('ToolResponse Type', () => {
    it('should conform to expected MCP SDK shape', () => {
      const response: ToolResponse = {
        content: [{ type: 'text', text: 'test' }]
      };

      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('test');
    });

    it('should allow optional isError', () => {
      const successResponse: ToolResponse = {
        content: [{ type: 'text', text: 'success' }]
      };

      const errorResponse: ToolResponse = {
        content: [{ type: 'text', text: 'error' }],
        isError: true
      };

      expect(successResponse.isError).toBeUndefined();
      expect(errorResponse.isError).toBe(true);
    });
  });

  describe('Response Format Consistency', () => {
    it('should all produce single-element content array', () => {
      const toolResp = formatToolResponse({ data: 'test' });
      const textResp = formatTextResponse('text');
      const rawResp = formatRawResponse('raw');
      const errorResp = formatErrorResponse('error');

      expect(toolResp.content).toHaveLength(1);
      expect(textResp.content).toHaveLength(1);
      expect(rawResp.content).toHaveLength(1);
      expect(errorResp.content).toHaveLength(1);
    });

    it('should all use text type', () => {
      const responses = [
        formatToolResponse({ data: 'test' }),
        formatTextResponse('text'),
        formatRawResponse('raw'),
        formatErrorResponse('error')
      ];

      for (const resp of responses) {
        expect(resp.content[0].type).toBe('text');
      }
    });

    it('should produce MCP SDK compatible output', () => {
      // Verify the structure matches what MCP SDK expects
      const result = formatToolResponse({ test: true });

      expect(result).toEqual({
        content: [{
          type: 'text',
          text: expect.any(String)
        }]
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle Date objects in formatToolResponse', () => {
      const data = { date: new Date('2024-01-15T10:00:00Z') };
      const result = formatToolResponse(data);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.date).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should handle circular reference errors gracefully', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      // JSON.stringify throws on circular references
      expect(() => formatToolResponse(circular)).toThrow();
    });

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(100000);
      const result = formatTextResponse(longString);
      expect(result.content[0].text.length).toBe(100000);
    });

    it('should handle unicode characters', () => {
      const unicode = 'Hello 世界 🌍 مرحبا';
      const result = formatTextResponse(unicode);
      expect(result.content[0].text).toBe(unicode);
    });

    it('should handle BigInt by throwing (JSON limitation)', () => {
      const data = { big: BigInt(9007199254740991) };
      expect(() => formatToolResponse(data)).toThrow();
    });
  });
});
