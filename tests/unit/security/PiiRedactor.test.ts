/**
 * η.6.3 — PiiRedactor Tests
 */

import { describe, it, expect } from 'vitest';
import {
  PiiRedactor,
  DEFAULT_PII_PATTERNS,
} from '../../../src/security/index.js';

describe('η.6.3 PiiRedactor', () => {
  describe('default pattern bank', () => {
    it('redacts emails', () => {
      const r = new PiiRedactor();
      expect(r.redact('Contact alice@example.com please.')).toBe('Contact <EMAIL> please.');
    });

    it('redacts US SSNs', () => {
      const r = new PiiRedactor();
      expect(r.redact('SSN: 123-45-6789')).toBe('SSN: <SSN>');
    });

    it('redacts credit-card-shaped numbers', () => {
      const r = new PiiRedactor();
      expect(r.redact('Card 4111 1111 1111 1111 used')).toBe('Card <CC> used');
      expect(r.redact('4111-1111-1111-1111')).toBe('<CC>');
    });

    it('redacts North American phone numbers', () => {
      const r = new PiiRedactor();
      expect(r.redact('Call (555) 123-4567 today')).toBe('Call <PHONE> today');
      expect(r.redact('+1 555.123.4567')).toBe('<PHONE>');
      expect(r.redact('5551234567')).toBe('<PHONE>');
    });

    it('redacts IPv4 addresses', () => {
      const r = new PiiRedactor();
      expect(r.redact('Server at 192.168.1.100 is down')).toBe('Server at <IP> is down');
    });

    it('redacts multiple PII items in the same string', () => {
      const r = new PiiRedactor();
      const out = r.redact('Email alice@example.com, SSN 123-45-6789, IP 10.0.0.1');
      expect(out).toBe('Email <EMAIL>, SSN <SSN>, IP <IP>');
    });
  });

  describe('non-PII content is preserved', () => {
    it('does not touch normal text', () => {
      const r = new PiiRedactor();
      const text = 'The quick brown fox jumps over the lazy dog.';
      expect(r.redact(text)).toBe(text);
    });

    it('does not redact obviously non-SSN dash patterns', () => {
      const r = new PiiRedactor();
      expect(r.redact('Episode 12-345-67890')).toContain('12-345-67890'); // wrong shape
    });
  });

  describe('redactWithStats', () => {
    it('reports per-pattern counts and total bytes', () => {
      const r = new PiiRedactor();
      const result = r.redactWithStats(
        'a@b.com c@d.com 192.168.0.1',
      );
      expect(result.text).toBe('<EMAIL> <EMAIL> <IP>');
      expect(result.stats.countsByPattern.get('email')).toBe(2);
      expect(result.stats.countsByPattern.get('ipv4')).toBe(1);
      expect(result.stats.totalRedactedBytes).toBeGreaterThan(0);
    });

    it('omits patterns with zero matches from countsByPattern', () => {
      const r = new PiiRedactor();
      const result = r.redactWithStats('clean text only');
      expect(result.stats.countsByPattern.size).toBe(0);
      expect(result.stats.totalRedactedBytes).toBe(0);
    });
  });

  describe('redactGraph', () => {
    it('applies redaction to every observation in a graph-shaped object', () => {
      const r = new PiiRedactor();
      const graph = {
        entities: [
          {
            name: 'Alice',
            entityType: 'person',
            observations: ['email: alice@example.com', 'phone (555) 123-4567'],
          },
          {
            name: 'Bob',
            entityType: 'person',
            observations: ['no PII here'],
          },
        ],
        relations: [],
      };
      const out = r.redactGraph(graph);
      expect(out.entities[0].observations).toEqual([
        'email: <EMAIL>',
        'phone <PHONE>',
      ]);
      expect(out.entities[1].observations).toEqual(['no PII here']);
      // Original unchanged
      expect(graph.entities[0].observations[0]).toBe('email: alice@example.com');
    });
  });

  describe('custom patterns', () => {
    it('replaces the default pattern bank when `patterns` option is set', () => {
      const r = new PiiRedactor({
        patterns: [
          { name: 'tag', regex: /<TAG>/g, replacement: '[scrubbed]' },
        ],
      });
      // Default email pattern should NOT fire.
      expect(r.redact('Email a@b.com is fine; <TAG> is not')).toBe(
        'Email a@b.com is fine; [scrubbed] is not',
      );
    });

    it('layers `additionalPatterns` on top of defaults', () => {
      const r = new PiiRedactor({
        additionalPatterns: [
          { name: 'license', regex: /\bDL\d{8}\b/g, replacement: '<DL>' },
        ],
      });
      expect(r.redact('Email a@b.com and license DL12345678'))
        .toBe('Email <EMAIL> and license <DL>');
    });

    it('default pattern bank is exposed for callers to extend', () => {
      expect(DEFAULT_PII_PATTERNS.map(p => p.name).sort())
        .toEqual(['credit-card', 'email', 'ipv4', 'phone', 'ssn']);
    });
  });
});
