/**
 * SPARQL Unit Tests
 *
 * Covers Phase 6 step 52: parser + evaluator for the minimal
 * SPARQL SELECT subset.
 */

import { describe, it, expect } from 'vitest';
import {
  parseSparql,
  evaluateSparql,
  runSparql,
  graphToTriples,
  SparqlError,
  DEFAULT_PREFIXES,
} from '../../../src/search/SPARQL.js';
import type { Entity, Relation, KnowledgeGraph } from '../../../src/types/types.js';

function makeGraph(): KnowledgeGraph {
  const entities: Entity[] = [
    { name: 'alice', entityType: 'person', observations: ['likes coffee'], tags: ['expert'] },
    { name: 'bob', entityType: 'person', observations: ['likes tea'] },
    { name: 'TechCo', entityType: 'company', observations: [] },
  ];
  const relations: Relation[] = [
    { from: 'alice', to: 'bob', relationType: 'knows' },
    { from: 'alice', to: 'TechCo', relationType: 'works_at' },
  ];
  return { entities, relations };
}

describe('graphToTriples', () => {
  it('emits rdf:type, rdfs:label, rdfs:comment, dcterms:subject triples per entity', () => {
    const graph: KnowledgeGraph = {
      entities: [
        { name: 'a', entityType: 'person', observations: ['hi'], tags: ['t1'] },
      ],
      relations: [],
    };
    const triples = graphToTriples(graph);
    const preds = triples.map((t) => t.predicate);
    expect(preds).toContain(DEFAULT_PREFIXES.rdf + 'type');
    expect(preds).toContain(DEFAULT_PREFIXES.rdfs + 'label');
    expect(preds).toContain(DEFAULT_PREFIXES.rdfs + 'comment');
    expect(preds).toContain(DEFAULT_PREFIXES.dcterms + 'subject');
  });

  it('emits relation triples', () => {
    const graph: KnowledgeGraph = {
      entities: [
        { name: 'a', entityType: 'x', observations: [] },
        { name: 'b', entityType: 'x', observations: [] },
      ],
      relations: [{ from: 'a', to: 'b', relationType: 'knows' }],
    };
    const triples = graphToTriples(graph);
    const rel = triples.find((t) => t.predicate.includes('rel:knows'));
    expect(rel).toBeDefined();
    expect(rel?.isLiteral).toBe(false);
  });
});

describe('parseSparql', () => {
  it('parses a basic SELECT', () => {
    const ast = parseSparql('SELECT ?s WHERE { ?s ?p ?o }');
    expect(ast.kind).toBe('select');
    expect(ast.variables).toEqual(['s']);
    expect(ast.patterns).toHaveLength(1);
  });

  it('parses SELECT *', () => {
    const ast = parseSparql('SELECT * WHERE { ?s ?p ?o }');
    expect(ast.variables).toEqual([]);
  });

  it('parses DISTINCT', () => {
    const ast = parseSparql('SELECT DISTINCT ?s WHERE { ?s ?p ?o }');
    expect(ast.distinct).toBe(true);
  });

  it('parses PREFIX declarations', () => {
    const ast = parseSparql(
      "PREFIX foo: <http://example.org/> SELECT ?s WHERE { ?s foo:bar ?o }",
    );
    expect(ast.prefixes.foo).toBe('http://example.org/');
    expect(ast.patterns[0]!.predicate).toEqual({
      kind: 'iri',
      iri: 'http://example.org/bar',
    });
  });

  it('parses LIMIT and OFFSET', () => {
    const ast = parseSparql('SELECT ?s WHERE { ?s ?p ?o } LIMIT 5 OFFSET 10');
    expect(ast.limit).toBe(5);
    expect(ast.offset).toBe(10);
  });

  it('parses FILTER clauses', () => {
    const ast = parseSparql(
      'SELECT ?s WHERE { ?s ?p ?o FILTER (?s = "alice") }',
    );
    expect(ast.filters).toHaveLength(1);
    expect(ast.filters[0]).toEqual({
      variable: 's',
      op: '=',
      value: 'alice',
    });
  });

  it('parses multiple triples with `.` separator', () => {
    const ast = parseSparql(
      'SELECT ?s ?o WHERE { ?s ?p1 ?x . ?x ?p2 ?o }',
    );
    expect(ast.patterns).toHaveLength(2);
  });

  it('tolerates a final `.` before the closing brace', () => {
    const ast = parseSparql('SELECT ?s WHERE { ?s ?p ?o . }');
    expect(ast.patterns).toHaveLength(1);
  });

  it('strips # line comments', () => {
    const ast = parseSparql(
      '# comment\nSELECT ?s WHERE {\n  ?s ?p ?o # inline\n}',
    );
    expect(ast.variables).toEqual(['s']);
  });

  it('throws on unterminated IRI', () => {
    expect(() => parseSparql('SELECT ?s WHERE { ?s <foo ?o }')).toThrow(SparqlError);
  });

  it('throws on unknown prefix', () => {
    expect(() =>
      parseSparql('SELECT ?s WHERE { ?s nope:bar ?o }'),
    ).toThrow(SparqlError);
  });

  it('throws on bare identifier', () => {
    expect(() => parseSparql('SELECT ?s WHERE { ?s bareword ?o }')).toThrow(SparqlError);
  });

  it('throws on missing variables in SELECT', () => {
    expect(() => parseSparql('SELECT WHERE { ?s ?p ?o }')).toThrow(SparqlError);
  });
});

describe('evaluateSparql', () => {
  const graph = makeGraph();

  it('binds variables from a single triple', () => {
    const result = runSparql(
      'SELECT ?s WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#label> "alice" }',
      graph,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.s).toContain('urn:memoryjs:entity:alice');
  });

  it('joins across two triples sharing a variable', () => {
    const result = runSparql(
      `SELECT ?label WHERE {
        ?s <${DEFAULT_PREFIXES.rdf}type> <urn:memoryjs:type:person> .
        ?s <${DEFAULT_PREFIXES.rdfs}label> ?label
      }`,
      graph,
    );
    expect(result.map((r) => r.label).sort()).toEqual(['alice', 'bob']);
  });

  it('uses PREFIX-resolved IRIs', () => {
    const result = runSparql(
      `PREFIX rdfs: <${DEFAULT_PREFIXES.rdfs}>
       SELECT ?o WHERE { ?s rdfs:comment ?o }`,
      graph,
    );
    expect(result.map((r) => r.o).sort()).toEqual(['likes coffee', 'likes tea']);
  });

  it('LIMIT caps result count', () => {
    const result = runSparql(
      `SELECT ?o WHERE { ?s <${DEFAULT_PREFIXES.rdfs}label> ?o } LIMIT 2`,
      graph,
    );
    expect(result).toHaveLength(2);
  });

  it('OFFSET skips initial rows', () => {
    const all = runSparql(
      `SELECT ?o WHERE { ?s <${DEFAULT_PREFIXES.rdfs}label> ?o }`,
      graph,
    );
    const offset = runSparql(
      `SELECT ?o WHERE { ?s <${DEFAULT_PREFIXES.rdfs}label> ?o } LIMIT 10 OFFSET 1`,
      graph,
    );
    expect(offset).toHaveLength(all.length - 1);
  });

  it('DISTINCT deduplicates rows', () => {
    // Multiple `dcterms:subject` may produce duplicate ?s for entities with multiple tags.
    const result = runSparql(
      `SELECT DISTINCT ?s WHERE { ?s <${DEFAULT_PREFIXES.rdf}type> <urn:memoryjs:type:person> }`,
      graph,
    );
    expect(new Set(result.map((r) => r.s)).size).toBe(result.length);
  });

  it('FILTER constrains the result set', () => {
    const result = runSparql(
      `SELECT ?label WHERE {
        ?s <${DEFAULT_PREFIXES.rdfs}label> ?label
        FILTER (?label = "alice")
      }`,
      graph,
    );
    expect(result).toEqual([{ label: 'alice' }]);
  });

  it('FILTER LIKE matches wildcards', () => {
    const result = runSparql(
      `SELECT ?label WHERE {
        ?s <${DEFAULT_PREFIXES.rdfs}label> ?label
        FILTER (?label LIKE "a%")
      }`,
      graph,
    );
    expect(result).toEqual([{ label: 'alice' }]);
  });

  it('SELECT * returns full bindings', () => {
    const result = runSparql(
      'SELECT * WHERE { ?s ?p ?o }',
      graph,
    );
    expect(result.length).toBeGreaterThan(0);
    for (const row of result) {
      expect(row.s).toBeDefined();
      expect(row.p).toBeDefined();
      expect(row.o).toBeDefined();
    }
  });

  it('returns [] when no triples match', () => {
    const result = runSparql(
      `SELECT ?o WHERE { ?s <urn:memoryjs:type:martian> ?o }`,
      graph,
    );
    expect(result).toEqual([]);
  });

  it('queries relations between entities', () => {
    const result = runSparql(
      `SELECT ?from ?to WHERE {
        ?from <urn:memoryjs:rel:knows> ?to
      }`,
      graph,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.from).toContain('alice');
    expect(result[0]!.to).toContain('bob');
  });
});
