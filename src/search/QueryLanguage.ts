/**
 * Query Language DSL
 *
 * Phase 5 step 49 (§11B.1) — a SQL-flavored DSL for querying entities
 * and relations. The DSL is intentionally tiny so it can ship without
 * external parser deps: a recursive-descent parser produces a small
 * AST, and an executor walks the AST against an in-memory
 * `KnowledgeGraph` snapshot.
 *
 * **Grammar (informal):**
 * ```
 * Query     := 'FROM' Source ('WHERE' Expr)? ('ORDER BY' Field ('ASC'|'DESC')?)? ('LIMIT' Number ('OFFSET' Number)?)?
 * Source    := 'entities' | 'relations'
 * Expr      := OrExpr
 * OrExpr    := AndExpr ('OR' AndExpr)*
 * AndExpr   := NotExpr ('AND' NotExpr)*
 * NotExpr   := 'NOT' NotExpr | Atom
 * Atom      := '(' Expr ')'
 *            | StringLit 'IN' Field
 *            | Field Op Value
 * Op        := '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'CONTAINS'
 * Value     := StringLit | Number | 'true' | 'false' | 'null'
 * Field     := identifier ('.' identifier)*    // e.g. `name`, `entityType`, `metadata.x`
 * StringLit := '\'' chars '\'' | '"' chars '"'
 * ```
 *
 * **Examples:**
 * ```
 * FROM entities WHERE entityType = 'person'
 * FROM entities WHERE entityType = 'person' AND importance > 5 ORDER BY name LIMIT 10
 * FROM entities WHERE 'expert' IN tags
 * FROM entities WHERE name LIKE 'Ali%'
 * FROM relations WHERE relationType = 'knows' AND from = 'Alice'
 * ```
 *
 * **No external deps.** Hand-rolled tokenizer + recursive-descent
 * parser; no peg.js / nearley / etc.
 *
 * @module search/QueryLanguage
 * @experimental Grammar may grow (joins, aggregations, projection)
 *   in non-breaking ways. Existing queries will keep parsing.
 */

import type { Entity, Relation, KnowledgeGraph } from '../types/types.js';

// ==================== AST ====================

export type DslSource = 'entities' | 'relations';
export type DslOp = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'CONTAINS';
export type DslSortDir = 'ASC' | 'DESC';

export type DslExpr =
  | { kind: 'and'; left: DslExpr; right: DslExpr }
  | { kind: 'or'; left: DslExpr; right: DslExpr }
  | { kind: 'not'; expr: DslExpr }
  | { kind: 'compare'; field: string[]; op: DslOp; value: DslValue }
  | { kind: 'in'; needle: string; field: string[] };

export type DslValue = string | number | boolean | null;

export interface DslQuery {
  source: DslSource;
  where?: DslExpr;
  orderBy?: { field: string[]; dir: DslSortDir };
  limit?: number;
  offset?: number;
}

// ==================== Tokenizer ====================

type Tok =
  | { kind: 'kw'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: DslOp }
  | { kind: 'punct'; value: '(' | ')' | '.' };

const KEYWORDS = new Set([
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'LIMIT',
  'OFFSET',
  'TRUE',
  'FALSE',
  'NULL',
  'LIKE',
  'CONTAINS',
]);

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i]!;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (c === '(' || c === ')' || c === '.') {
      toks.push({ kind: 'punct', value: c });
      i++;
      continue;
    }

    if (c === '=') {
      toks.push({ kind: 'op', value: '=' });
      i++;
      continue;
    }

    if (c === '!' && input[i + 1] === '=') {
      toks.push({ kind: 'op', value: '!=' });
      i += 2;
      continue;
    }

    if (c === '<') {
      if (input[i + 1] === '=') {
        toks.push({ kind: 'op', value: '<=' });
        i += 2;
      } else {
        toks.push({ kind: 'op', value: '<' });
        i++;
      }
      continue;
    }

    if (c === '>') {
      if (input[i + 1] === '=') {
        toks.push({ kind: 'op', value: '>=' });
        i += 2;
      } else {
        toks.push({ kind: 'op', value: '>' });
        i++;
      }
      continue;
    }

    if (c === '\'' || c === '"') {
      const quote = c;
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < input.length) {
          str += input[j + 1];
          j += 2;
        } else {
          str += input[j];
          j++;
        }
      }
      if (j >= input.length) {
        throw new QueryDslError(`Unterminated string literal starting at position ${i}`);
      }
      toks.push({ kind: 'string', value: str });
      i = j + 1;
      continue;
    }

    if ((c >= '0' && c <= '9') || (c === '-' && input[i + 1] && /[0-9]/.test(input[i + 1]!))) {
      let j = i;
      if (input[j] === '-') j++;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      const num = Number(input.slice(i, j));
      if (Number.isNaN(num)) {
        throw new QueryDslError(`Invalid number at position ${i}`);
      }
      toks.push({ kind: 'number', value: num });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++;
      const word = input.slice(i, j);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        if (upper === 'LIKE' || upper === 'CONTAINS') {
          toks.push({ kind: 'op', value: upper });
        } else {
          toks.push({ kind: 'kw', value: upper });
        }
      } else {
        toks.push({ kind: 'ident', value: word });
      }
      i = j;
      continue;
    }

    throw new QueryDslError(`Unexpected character '${c}' at position ${i}`);
  }

  return toks;
}

// ==================== Parser ====================

/**
 * Recoverable parse / execution failure for the DSL. Includes the
 * original query text when available so error messages point at the
 * caller's input rather than the AST.
 */
export class QueryDslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryDslError';
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly toks: Tok[]) {}

  parse(): DslQuery {
    this.expectKw('FROM');
    const sourceTok = this.consume();
    if (!sourceTok || sourceTok.kind !== 'ident') {
      throw new QueryDslError('Expected entity source after FROM (entities | relations)');
    }
    const sourceName = sourceTok.value.toLowerCase();
    if (sourceName !== 'entities' && sourceName !== 'relations') {
      throw new QueryDslError(`Unknown source '${sourceName}' — expected 'entities' or 'relations'`);
    }
    const source: DslSource = sourceName;

    const query: DslQuery = { source };

    if (this.peekKw('WHERE')) {
      this.consume();
      query.where = this.parseExpr();
    }

    if (this.peekKw('ORDER')) {
      this.consume();
      this.expectKw('BY');
      const field = this.parseField();
      let dir: DslSortDir = 'ASC';
      if (this.peekKw('ASC')) {
        this.consume();
      } else if (this.peekKw('DESC')) {
        this.consume();
        dir = 'DESC';
      }
      query.orderBy = { field, dir };
    }

    if (this.peekKw('LIMIT')) {
      this.consume();
      const n = this.consume();
      if (!n || n.kind !== 'number') {
        throw new QueryDslError('Expected number after LIMIT');
      }
      query.limit = n.value;
      if (this.peekKw('OFFSET')) {
        this.consume();
        const o = this.consume();
        if (!o || o.kind !== 'number') {
          throw new QueryDslError('Expected number after OFFSET');
        }
        query.offset = o.value;
      }
    }

    if (this.pos < this.toks.length) {
      const next = this.toks[this.pos]!;
      throw new QueryDslError(`Unexpected token after end of query: ${describeTok(next)}`);
    }

    return query;
  }

  private parseExpr(): DslExpr {
    return this.parseOr();
  }

  private parseOr(): DslExpr {
    let left = this.parseAnd();
    while (this.peekKw('OR')) {
      this.consume();
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): DslExpr {
    let left = this.parseNot();
    while (this.peekKw('AND')) {
      this.consume();
      const right = this.parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  private parseNot(): DslExpr {
    if (this.peekKw('NOT')) {
      this.consume();
      return { kind: 'not', expr: this.parseNot() };
    }
    return this.parseAtom();
  }

  private parseAtom(): DslExpr {
    if (this.peekPunct('(')) {
      this.consume();
      const inner = this.parseExpr();
      if (!this.peekPunct(')')) {
        throw new QueryDslError('Expected closing ) in expression');
      }
      this.consume();
      return inner;
    }

    if (this.toks[this.pos]?.kind === 'string') {
      const saved = this.pos;
      const strTok = this.consume() as { kind: 'string'; value: string };
      if (this.peekKw('IN')) {
        this.consume();
        const field = this.parseField();
        return { kind: 'in', needle: strTok.value, field };
      }
      this.pos = saved;
    }

    const field = this.parseField();
    const opTok = this.consume();
    if (!opTok || opTok.kind !== 'op') {
      throw new QueryDslError(
        `Expected comparison operator after field '${field.join('.')}', got ${describeTok(opTok)}`,
      );
    }
    const value = this.parseValue();
    return { kind: 'compare', field, op: opTok.value, value };
  }

  private parseField(): string[] {
    const first = this.consume();
    if (!first || first.kind !== 'ident') {
      throw new QueryDslError(`Expected field name, got ${describeTok(first)}`);
    }
    const parts = [first.value];
    while (this.peekPunct('.')) {
      this.consume();
      const next = this.consume();
      if (!next || next.kind !== 'ident') {
        throw new QueryDslError(`Expected identifier after '.', got ${describeTok(next)}`);
      }
      parts.push(next.value);
    }
    return parts;
  }

  private parseValue(): DslValue {
    const tok = this.consume();
    if (!tok) throw new QueryDslError('Expected value (string, number, boolean, or null)');
    if (tok.kind === 'string') return tok.value;
    if (tok.kind === 'number') return tok.value;
    if (tok.kind === 'kw') {
      if (tok.value === 'TRUE') return true;
      if (tok.value === 'FALSE') return false;
      if (tok.value === 'NULL') return null;
    }
    throw new QueryDslError(`Expected literal value, got ${describeTok(tok)}`);
  }

  private consume(): Tok | undefined {
    return this.toks[this.pos++];
  }

  private peekKw(value: string): boolean {
    const t = this.toks[this.pos];
    return !!t && t.kind === 'kw' && t.value === value;
  }

  private peekPunct(value: string): boolean {
    const t = this.toks[this.pos];
    return !!t && t.kind === 'punct' && t.value === value;
  }

  private expectKw(value: string): void {
    if (!this.peekKw(value)) {
      throw new QueryDslError(`Expected keyword '${value}', got ${describeTok(this.toks[this.pos])}`);
    }
    this.consume();
  }
}

function describeTok(t: Tok | undefined): string {
  if (!t) return 'end of input';
  if (t.kind === 'string') return `string '${t.value}'`;
  if (t.kind === 'number') return `number ${t.value}`;
  return `${t.kind} '${t.value}'`;
}

/**
 * Parse a DSL string into a `DslQuery` AST. Throws `QueryDslError`
 * on a syntax error.
 *
 * @example
 * ```typescript
 * const ast = parseDsl("FROM entities WHERE entityType = 'person' AND importance > 5");
 * ```
 */
export function parseDsl(input: string): DslQuery {
  const toks = tokenize(input);
  return new Parser(toks).parse();
}

// ==================== Executor ====================

/**
 * Run a parsed DSL query against an in-memory `KnowledgeGraph`.
 * Returns `Entity[]` for `FROM entities` and `Relation[]` for
 * `FROM relations`.
 *
 * @example
 * ```typescript
 * const ast = parseDsl("FROM entities WHERE entityType = 'person'");
 * const rows = executeDsl(ast, graph);
 * ```
 */
export function executeDsl(query: DslQuery, graph: KnowledgeGraph): Entity[] | Relation[] {
  const rows: ReadonlyArray<Entity | Relation> =
    query.source === 'entities' ? graph.entities : graph.relations;

  let filtered: Array<Entity | Relation> = query.where
    ? rows.filter((row) => evalExpr(query.where!, row))
    : [...rows];

  if (query.orderBy) {
    const { field, dir } = query.orderBy;
    const factor = dir === 'DESC' ? -1 : 1;
    filtered.sort((a, b) => {
      const av = readField(a, field);
      const bv = readField(b, field);
      return compareValues(av, bv) * factor;
    });
  }

  const offset = query.offset ?? 0;
  if (offset > 0) filtered = filtered.slice(offset);
  if (query.limit !== undefined) filtered = filtered.slice(0, query.limit);

  return filtered as Entity[] | Relation[];
}

/** Convenience: parse + execute in one call. */
export function runDsl(input: string, graph: KnowledgeGraph): Entity[] | Relation[] {
  return executeDsl(parseDsl(input), graph);
}

function evalExpr(expr: DslExpr, row: Entity | Relation): boolean {
  switch (expr.kind) {
    case 'and':
      return evalExpr(expr.left, row) && evalExpr(expr.right, row);
    case 'or':
      return evalExpr(expr.left, row) || evalExpr(expr.right, row);
    case 'not':
      return !evalExpr(expr.expr, row);
    case 'in': {
      const target = readField(row, expr.field);
      if (Array.isArray(target)) {
        return target.includes(expr.needle);
      }
      if (typeof target === 'string') {
        return target.includes(expr.needle);
      }
      return false;
    }
    case 'compare':
      return evalCompare(readField(row, expr.field), expr.op, expr.value);
  }
}

function readField(row: Entity | Relation, path: string[]): unknown {
  let cur: unknown = row;
  for (const part of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evalCompare(left: unknown, op: DslOp, right: DslValue): boolean {
  if (op === '=') return looseEqual(left, right);
  if (op === '!=') return !looseEqual(left, right);

  if (op === 'LIKE') {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const re = new RegExp(
      '^' + escapeRegex(right).replace(/%/g, '.*').replace(/_/g, '.') + '$',
      'i',
    );
    return re.test(left);
  }

  if (op === 'CONTAINS') {
    if (typeof right !== 'string') return false;
    if (typeof left === 'string') return left.includes(right);
    if (Array.isArray(left)) return left.includes(right);
    return false;
  }

  // Ordered comparison — only meaningful for matching primitive types.
  if (typeof left !== typeof right) return false;
  if (typeof left !== 'number' && typeof left !== 'string') return false;
  const l = left as number | string;
  const r = right as number | string;
  switch (op) {
    case '<':
      return l < r;
    case '>':
      return l > r;
    case '<=':
      return l <= r;
    case '>=':
      return l >= r;
  }
}

function looseEqual(left: unknown, right: DslValue): boolean {
  if (left === right) return true;
  // Treat `undefined` as `null` for `field = NULL` comparisons.
  if (right === null && left === undefined) return true;
  return false;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
