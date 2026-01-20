/**
 * Query Parser
 *
 * Parses search query strings into structured query objects.
 * Supports: phrases ("..."), wildcards (*?), proximity (~N), fields (field:).
 * Phase 1 Sprint 8: Full-Text Search Operators.
 *
 * @module search/QueryParser
 */

import type { QueryNode, BooleanOpNode } from '../types/search.js';

/**
 * Query parser for advanced search syntax.
 *
 * @example
 * ```typescript
 * const parser = new QueryParser();
 *
 * // Phrase search
 * parser.parse('"machine learning"');
 *
 * // Wildcard search
 * parser.parse('data*');
 *
 * // Proximity search
 * parser.parse('"machine learning"~3');
 *
 * // Field-specific search
 * parser.parse('name:Alice');
 *
 * // Combined
 * parser.parse('name:"John Doe" AND type:person');
 * ```
 */
export class QueryParser {
  /**
   * Parse a query string into a QueryNode tree.
   */
  parse(query: string): QueryNode {
    const trimmed = query.trim();
    if (!trimmed) {
      return { type: 'term', value: '' };
    }

    // Check for boolean operators first
    const booleanNode = this.parseBooleanExpression(trimmed);
    if (booleanNode) {
      return booleanNode;
    }

    // Parse as simple query
    const tokens = this.tokenize(trimmed);
    return this.parseTokens(tokens);
  }

  /**
   * Check if a query uses advanced operators.
   */
  hasAdvancedOperators(query: string): boolean {
    // Check for quotes (phrase/proximity)
    if (query.includes('"')) return true;

    // Check for wildcards
    if (query.includes('*') || query.includes('?')) return true;

    // Check for field specifiers
    if (/\w+:/.test(query)) return true;

    // Check for boolean operators
    if (/\b(AND|OR|NOT)\b/i.test(query)) return true;

    return false;
  }

  /**
   * Parse boolean expressions (AND, OR, NOT).
   */
  private parseBooleanExpression(query: string): BooleanOpNode | null {
    // Simple regex-based parsing for AND/OR/NOT
    // More sophisticated parsing would use proper lexer/parser

    // Split by OR (lowest precedence)
    const orParts = this.splitByOperator(query, 'OR');
    if (orParts.length > 1) {
      return {
        type: 'boolean',
        operator: 'OR',
        operands: orParts.map((p) => this.parse(p.trim())),
      };
    }

    // Split by AND
    const andParts = this.splitByOperator(query, 'AND');
    if (andParts.length > 1) {
      return {
        type: 'boolean',
        operator: 'AND',
        operands: andParts.map((p) => this.parse(p.trim())),
      };
    }

    // Check for NOT prefix
    const notMatch = query.match(/^NOT\s+(.+)$/i);
    if (notMatch) {
      return {
        type: 'boolean',
        operator: 'NOT',
        operands: [this.parse(notMatch[1].trim())],
      };
    }

    return null;
  }

  /**
   * Split query by operator, respecting quotes.
   */
  private splitByOperator(query: string, operator: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let depth = 0;
    const regex = new RegExp(`\\b${operator}\\b`, 'i');

    for (let i = 0; i < query.length; i++) {
      const char = query[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (!inQuotes && depth === 0) {
        // Check if we're at the operator
        const remaining = query.slice(i);
        const match = remaining.match(regex);
        if (match && match.index === 0) {
          parts.push(current.trim());
          current = '';
          i += operator.length - 1; // Skip operator
          continue;
        }
        current += char;
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  /**
   * Tokenize query string, handling quotes.
   */
  private tokenize(query: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < query.length; i++) {
      const char = query[i];

      if (char === '"') {
        if (inQuotes) {
          // End of quote - check for proximity suffix
          const remaining = query.slice(i + 1);
          const proximityMatch = remaining.match(/^~(\d+)/);
          if (proximityMatch) {
            tokens.push(`"${current}"~${proximityMatch[1]}`);
            i += proximityMatch[0].length;
          } else {
            tokens.push(`"${current}"`);
          }
          current = '';
        }
        inQuotes = !inQuotes;
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Parse tokenized query.
   */
  private parseTokens(tokens: string[]): QueryNode {
    // Handle single token
    if (tokens.length === 1) {
      return this.parseToken(tokens[0]);
    }

    // Default to AND for multiple tokens
    const operands = tokens.map((t) => this.parseToken(t));
    return {
      type: 'boolean',
      operator: 'AND',
      operands,
    };
  }

  /**
   * Parse a single token into a QueryNode.
   */
  private parseToken(token: string): QueryNode {
    // Proximity: "term1 term2"~5
    const proximityMatch = token.match(/^"(.+)"~(\d+)$/);
    if (proximityMatch) {
      return {
        type: 'proximity',
        terms: proximityMatch[1].toLowerCase().split(/\s+/),
        distance: parseInt(proximityMatch[2], 10),
      };
    }

    // Phrase: "exact phrase"
    if (token.startsWith('"') && token.endsWith('"')) {
      const phrase = token.slice(1, -1);
      return {
        type: 'phrase',
        terms: phrase.toLowerCase().split(/\s+/),
      };
    }

    // Field: field:value
    const fieldMatch = token.match(/^(\w+):(.+)$/);
    if (fieldMatch) {
      return {
        type: 'field',
        field: fieldMatch[1].toLowerCase(),
        query: this.parseToken(fieldMatch[2]),
      };
    }

    // Wildcard: contains * or ?
    if (token.includes('*') || token.includes('?')) {
      return {
        type: 'wildcard',
        pattern: token,
        regex: this.wildcardToRegex(token),
      };
    }

    // Plain term
    return {
      type: 'term',
      value: token.toLowerCase(),
    };
  }

  /**
   * Convert wildcard pattern to regex.
   */
  private wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }
}

/**
 * Check if text contains the phrase (terms in order).
 */
export function matchesPhrase(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;

  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);

  for (let i = 0; i <= words.length - terms.length; i++) {
    let match = true;
    for (let j = 0; j < terms.length; j++) {
      if (words[i + j] !== terms[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }

  return false;
}

/**
 * Check if pattern is a simple prefix (e.g., 'foo*').
 */
export function isPrefixPattern(pattern: string): boolean {
  const starIndex = pattern.indexOf('*');
  return starIndex === pattern.length - 1 && !pattern.includes('?');
}

/**
 * Match text against prefix pattern.
 */
export function matchesPrefix(text: string, pattern: string): boolean {
  const prefix = pattern.slice(0, -1).toLowerCase();
  return text.toLowerCase().startsWith(prefix);
}
