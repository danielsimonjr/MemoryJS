/**
 * SPARQL Minimal Subset
 *
 * Phase 6 step 52 (§13.4) — a focused subset of SPARQL 1.1 SELECT.
 * Closes the deferral from Phase 5 by shipping the parser + evaluator
 * that complements the RDF export half (Turtle / RDF-XML / JSON-LD
 * already in `IOManager`).
 *
 * **Supported grammar:**
 *
 * ```sparql
 * PREFIX foo: <http://example.org/>
 * SELECT ?s ?o
 * WHERE {
 *   ?s rdfs:label ?label .
 *   ?s <urn:memoryjs:type:person> ?type .
 *   FILTER (?label = "Alice")
 * }
 * LIMIT 10 OFFSET 0
 * ```
 *
 * - `SELECT [DISTINCT] ?var ?var ...` (or `SELECT *`)
 * - Triple patterns with `?var`, `<iri>`, `prefix:local`, `"literal"`,
 *   and a final `.` separator (last `.` optional)
 * - `FILTER (...)` over `?var op rhs` with `= != < > <= >= LIKE`
 * - `LIMIT n` and `OFFSET n`
 *
 * **Not supported** (deliberately out of scope — would balloon to a
 * full SPARQL parser):
 * - `OPTIONAL`, `UNION`, `MINUS`, `BIND`, `GROUP BY`, aggregates
 * - Property paths (`p1/p2`, `p+`, `^p`)
 * - `CONSTRUCT` / `ASK` / `DESCRIBE`
 * - SPARQL Update (`INSERT DATA`, `DELETE DATA`, etc.)
 *
 * Callers who need the full surface should defer to a real SPARQL
 * engine (`rdflib`, `quadstore-comunica`) — this module is the
 * built-in option for self-hosted callers who want a meaningful
 * subset without an external dep.
 *
 * **No external deps.** Hand-rolled tokenizer + recursive-descent
 * parser + brute-force triple-matching evaluator.
 *
 * @module search/SPARQL
 * @experimental Grammar will grow new clauses in non-breaking ways
 *   as users hit limits. Existing queries keep parsing.
 */

import type { Entity, KnowledgeGraph, Relation } from '../types/types.js';

// ==================== Triple Model ====================

/** A single RDF-ish triple from the knowledge graph. */
export interface Triple {
  subject: string;
  predicate: string;
  object: string;
  /** When `object` is a string literal (vs an IRI). */
  isLiteral: boolean;
}

/** Default IRI prefixes — match what `IOManager.exportAsTurtle` emits. */
export const DEFAULT_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  dcterms: 'http://purl.org/dc/terms/',
});

/**
 * Convert a `KnowledgeGraph` to a triple store. Matches the export
 * convention in `IOManager`:
 *
 * - Entity → `<urn:memoryjs:entity:<name>>`
 * - Entity type → `rdf:type` of `<urn:memoryjs:type:<type>>`
 * - Observation → `rdfs:comment` literal
 * - Tag → `dcterms:subject` literal
 * - createdAt → `dcterms:created` literal
 * - Relation → `<from-iri> <urn:memoryjs:rel:<type>> <to-iri>`
 */
export function graphToTriples(graph: KnowledgeGraph): Triple[] {
  const triples: Triple[] = [];
  for (const e of graph.entities) {
    const subj = entityIri(e.name);
    triples.push({ subject: subj, predicate: DEFAULT_PREFIXES.rdf + 'type', object: typeIri(e.entityType), isLiteral: false });
    triples.push({ subject: subj, predicate: DEFAULT_PREFIXES.rdfs + 'label', object: e.name, isLiteral: true });
    for (const obs of e.observations) {
      triples.push({ subject: subj, predicate: DEFAULT_PREFIXES.rdfs + 'comment', object: obs, isLiteral: true });
    }
    for (const tag of e.tags ?? []) {
      triples.push({ subject: subj, predicate: DEFAULT_PREFIXES.dcterms + 'subject', object: tag, isLiteral: true });
    }
    if (e.createdAt) {
      triples.push({ subject: subj, predicate: DEFAULT_PREFIXES.dcterms + 'created', object: e.createdAt, isLiteral: true });
    }
  }
  for (const r of graph.relations) {
    triples.push({
      subject: entityIri(r.from),
      predicate: relationIri(r.relationType),
      object: entityIri(r.to),
      isLiteral: false,
    });
  }
  return triples;
}

function entityIri(name: string): string {
  return `urn:memoryjs:entity:${encodeURIComponent(name)}`;
}
function typeIri(type: string): string {
  return `urn:memoryjs:type:${encodeURIComponent(type)}`;
}
function relationIri(type: string): string {
  return `urn:memoryjs:rel:${encodeURIComponent(type)}`;
}

// Re-exported to make callers' types compile without dragging `types.ts`.
export type { Entity, Relation };

// ==================== AST ====================

export type SparqlTerm =
  | { kind: 'var'; name: string }
  | { kind: 'iri'; iri: string }
  | { kind: 'literal'; value: string };

export interface SparqlTriplePattern {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
}

export type SparqlFilterOp = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE';

export interface SparqlFilter {
  variable: string;
  op: SparqlFilterOp;
  /** Literal RHS (number or string). */
  value: string | number;
}

export interface SparqlSelectQuery {
  kind: 'select';
  distinct: boolean;
  /** Empty array means `SELECT *`. */
  variables: string[];
  prefixes: Record<string, string>;
  patterns: SparqlTriplePattern[];
  filters: SparqlFilter[];
  limit?: number;
  offset?: number;
}

/** Recoverable parse / evaluation failure. */
export class SparqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SparqlError';
  }
}

// ==================== Tokenizer ====================

type SparqlTok =
  | { kind: 'kw'; value: string }
  | { kind: 'var'; name: string }
  | { kind: 'iri'; iri: string }
  | { kind: 'pname'; prefix: string; local: string }
  | { kind: 'literal'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: SparqlFilterOp }
  | { kind: 'punct'; value: '{' | '}' | '(' | ')' | '.' | '*' };

const KEYWORDS = new Set([
  'SELECT',
  'DISTINCT',
  'WHERE',
  'FILTER',
  'PREFIX',
  'LIMIT',
  'OFFSET',
  'LIKE',
]);

function tokenize(input: string): SparqlTok[] {
  const toks: SparqlTok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') {
      // SPARQL line comment until end of line.
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    if (c === '{' || c === '}' || c === '(' || c === ')' || c === '.' || c === '*') {
      toks.push({ kind: 'punct', value: c });
      i++;
      continue;
    }
    if (c === '<') {
      let j = i + 1;
      while (j < input.length && input[j] !== '>') j++;
      if (j >= input.length) throw new SparqlError('Unterminated IRI <...>');
      toks.push({ kind: 'iri', iri: input.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '?') {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++;
      if (j === i + 1) throw new SparqlError(`Empty variable name at position ${i}`);
      toks.push({ kind: 'var', name: input.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === '\'') {
      const quote = c;
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < input.length) {
          const esc = input[j + 1]!;
          str += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          j += 2;
        } else {
          str += input[j];
          j++;
        }
      }
      if (j >= input.length) throw new SparqlError('Unterminated string literal');
      toks.push({ kind: 'literal', value: str });
      i = j + 1;
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
    if (c === '<' && input[i + 1] === '=') {
      // unreachable — handled above
      toks.push({ kind: 'op', value: '<=' });
      i += 2;
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
    if ((c >= '0' && c <= '9') || (c === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i;
      if (input[j] === '-') j++;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      const num = Number(input.slice(i, j));
      if (Number.isNaN(num)) throw new SparqlError(`Invalid number at position ${i}`);
      toks.push({ kind: 'number', value: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++;
      const word = input.slice(i, j);
      // Check for `prefix:local`.
      if (input[j] === ':') {
        let k = j + 1;
        while (k < input.length && /[A-Za-z0-9_.\-]/.test(input[k]!)) k++;
        toks.push({ kind: 'pname', prefix: word, local: input.slice(j + 1, k) });
        i = k;
        continue;
      }
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        if (upper === 'LIKE') toks.push({ kind: 'op', value: 'LIKE' });
        else toks.push({ kind: 'kw', value: upper });
      } else {
        // Bare identifiers without `:` aren't valid SPARQL terms.
        throw new SparqlError(`Unexpected bare identifier '${word}' — use ?${word} for a variable or prefix:${word} for a prefixed name`);
      }
      i = j;
      continue;
    }
    throw new SparqlError(`Unexpected character '${c}' at position ${i}`);
  }
  return toks;
}

// ==================== Parser ====================

class Parser {
  private pos = 0;
  private prefixes: Record<string, string> = { ...DEFAULT_PREFIXES };

  constructor(private readonly toks: SparqlTok[]) {}

  parse(): SparqlSelectQuery {
    while (this.peekKw('PREFIX')) {
      this.consume();
      const nameTok = this.consume();
      if (!nameTok || nameTok.kind !== 'pname' || nameTok.local !== '') {
        throw new SparqlError('Expected `prefix:` after PREFIX');
      }
      const iriTok = this.consume();
      if (!iriTok || iriTok.kind !== 'iri') {
        throw new SparqlError('Expected <iri> after PREFIX prefix:');
      }
      this.prefixes[nameTok.prefix] = iriTok.iri;
    }

    this.expectKw('SELECT');
    let distinct = false;
    if (this.peekKw('DISTINCT')) {
      this.consume();
      distinct = true;
    }

    const variables: string[] = [];
    if (this.peekPunct('*')) {
      this.consume();
    } else {
      while (this.toks[this.pos]?.kind === 'var') {
        variables.push((this.consume() as { kind: 'var'; name: string }).name);
      }
      if (variables.length === 0) {
        throw new SparqlError('SELECT requires at least one variable or `*`');
      }
    }

    this.expectKw('WHERE');
    if (!this.peekPunct('{')) throw new SparqlError('Expected `{` after WHERE');
    this.consume();

    const patterns: SparqlTriplePattern[] = [];
    const filters: SparqlFilter[] = [];

    while (!this.peekPunct('}')) {
      if (this.peekKw('FILTER')) {
        this.consume();
        filters.push(this.parseFilter());
        continue;
      }
      patterns.push(this.parseTriple());
      // Triples are separated by `.`. Allow the final `.` before `}`
      // to be omitted — the SPARQL spec allows this.
      if (this.peekPunct('.')) this.consume();
    }
    this.consume(); // `}`

    const query: SparqlSelectQuery = {
      kind: 'select',
      distinct,
      variables,
      prefixes: this.prefixes,
      patterns,
      filters,
    };

    if (this.peekKw('LIMIT')) {
      this.consume();
      const n = this.consume();
      if (!n || n.kind !== 'number') throw new SparqlError('Expected number after LIMIT');
      query.limit = n.value;
    }
    if (this.peekKw('OFFSET')) {
      this.consume();
      const n = this.consume();
      if (!n || n.kind !== 'number') throw new SparqlError('Expected number after OFFSET');
      query.offset = n.value;
    }

    if (this.pos < this.toks.length) {
      throw new SparqlError(`Unexpected trailing tokens after end of query`);
    }
    return query;
  }

  private parseTriple(): SparqlTriplePattern {
    const subject = this.parseTerm();
    const predicate = this.parseTerm();
    const object = this.parseTerm();
    return { subject, predicate, object };
  }

  private parseTerm(): SparqlTerm {
    const tok = this.consume();
    if (!tok) throw new SparqlError('Expected term, got end of input');
    if (tok.kind === 'var') return { kind: 'var', name: tok.name };
    if (tok.kind === 'iri') return { kind: 'iri', iri: tok.iri };
    if (tok.kind === 'pname') return { kind: 'iri', iri: this.resolvePrefix(tok.prefix, tok.local) };
    if (tok.kind === 'literal') return { kind: 'literal', value: tok.value };
    if (tok.kind === 'number') return { kind: 'literal', value: String(tok.value) };
    throw new SparqlError(`Expected term, got ${tok.kind}`);
  }

  private parseFilter(): SparqlFilter {
    if (!this.peekPunct('(')) throw new SparqlError('Expected `(` after FILTER');
    this.consume();
    const v = this.consume();
    if (!v || v.kind !== 'var') {
      throw new SparqlError('FILTER expression must start with a variable');
    }
    const op = this.consume();
    if (!op || op.kind !== 'op') {
      throw new SparqlError('Expected comparison operator in FILTER');
    }
    const rhs = this.consume();
    if (!rhs) throw new SparqlError('Expected RHS in FILTER');
    let value: string | number;
    if (rhs.kind === 'literal') value = rhs.value;
    else if (rhs.kind === 'number') value = rhs.value;
    else throw new SparqlError('FILTER RHS must be a literal or number');
    if (!this.peekPunct(')')) throw new SparqlError('Expected `)` to close FILTER');
    this.consume();
    return { variable: v.name, op: op.value, value };
  }

  private resolvePrefix(prefix: string, local: string): string {
    const base = this.prefixes[prefix];
    if (!base) throw new SparqlError(`Unknown prefix '${prefix}'`);
    return base + local;
  }

  private consume(): SparqlTok | undefined {
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
      throw new SparqlError(`Expected keyword '${value}'`);
    }
    this.consume();
  }
}

/** Parse a SPARQL string into a `SparqlSelectQuery` AST. */
export function parseSparql(input: string): SparqlSelectQuery {
  const toks = tokenize(input);
  return new Parser(toks).parse();
}

// ==================== Evaluator ====================

export type SparqlBindings = Record<string, string>;

/**
 * Evaluate a parsed SPARQL SELECT against a triple store. Returns
 * one bindings row per match — the caller selects the variables they
 * care about by `query.variables`.
 *
 * Pattern matching is brute-force (O(|patterns| × |triples| × |solutions|))
 * which is fine for the typical knowledge-graph sizes we ship for.
 * Callers with > 100k triples should plug in a real SPARQL engine.
 */
export function evaluateSparql(query: SparqlSelectQuery, triples: Triple[]): SparqlBindings[] {
  // Build the solution set by joining triple patterns iteratively.
  let solutions: SparqlBindings[] = [{}];
  for (const pattern of query.patterns) {
    const next: SparqlBindings[] = [];
    for (const sol of solutions) {
      for (const triple of triples) {
        const merged = matchTriple(pattern, triple, sol);
        if (merged) next.push(merged);
      }
    }
    solutions = next;
    if (solutions.length === 0) break;
  }

  // Apply filters.
  if (query.filters.length > 0) {
    solutions = solutions.filter((sol) => query.filters.every((f) => evalFilter(f, sol)));
  }

  // Project to the requested variables (or keep everything for SELECT *).
  let projected: SparqlBindings[] = solutions.map((sol) => {
    if (query.variables.length === 0) return { ...sol };
    const row: SparqlBindings = {};
    for (const v of query.variables) {
      if (sol[v] !== undefined) row[v] = sol[v];
    }
    return row;
  });

  if (query.distinct) {
    const seen = new Set<string>();
    projected = projected.filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const offset = query.offset ?? 0;
  if (offset > 0) projected = projected.slice(offset);
  if (query.limit !== undefined) projected = projected.slice(0, query.limit);
  return projected;
}

/** Convenience: parse + evaluate against a `KnowledgeGraph`. */
export function runSparql(
  input: string,
  graph: KnowledgeGraph | Triple[],
): SparqlBindings[] {
  const triples = Array.isArray(graph) ? graph : graphToTriples(graph);
  return evaluateSparql(parseSparql(input), triples);
}

function matchTriple(
  pattern: SparqlTriplePattern,
  triple: Triple,
  bindings: SparqlBindings,
): SparqlBindings | null {
  const next = { ...bindings };
  if (!matchTerm(pattern.subject, triple.subject, next)) return null;
  if (!matchTerm(pattern.predicate, triple.predicate, next)) return null;
  if (!matchTerm(pattern.object, triple.object, next)) return null;
  return next;
}

function matchTerm(term: SparqlTerm, value: string, bindings: SparqlBindings): boolean {
  if (term.kind === 'var') {
    const existing = bindings[term.name];
    if (existing !== undefined) return existing === value;
    bindings[term.name] = value;
    return true;
  }
  if (term.kind === 'iri') return term.iri === value;
  if (term.kind === 'literal') return term.value === value;
  return false;
}

function evalFilter(filter: SparqlFilter, sol: SparqlBindings): boolean {
  const left = sol[filter.variable];
  if (left === undefined) return false;
  const right = filter.value;

  if (filter.op === '=') return looseEq(left, right);
  if (filter.op === '!=') return !looseEq(left, right);
  if (filter.op === 'LIKE') {
    if (typeof right !== 'string') return false;
    const re = new RegExp(
      '^' + escapeRegex(right).replace(/%/g, '.*').replace(/_/g, '.') + '$',
      'i',
    );
    return re.test(left);
  }

  // Ordered comparison — coerce to numbers when both sides are numeric.
  const ln = Number(left);
  const rn = typeof right === 'number' ? right : Number(right);
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
    if (filter.op === '<') return ln < rn;
    if (filter.op === '>') return ln > rn;
    if (filter.op === '<=') return ln <= rn;
    if (filter.op === '>=') return ln >= rn;
  }
  // Fall back to string compare.
  const rs = String(right);
  if (filter.op === '<') return left < rs;
  if (filter.op === '>') return left > rs;
  if (filter.op === '<=') return left <= rs;
  if (filter.op === '>=') return left >= rs;
  return false;
}

function looseEq(left: string, right: string | number): boolean {
  if (typeof right === 'number') {
    const n = Number(left);
    return !Number.isNaN(n) && n === right;
  }
  return left === right;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
