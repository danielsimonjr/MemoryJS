/**
 * QueryLanguage DSL Tests
 *
 * Covers Phase 5 step 49: parser + executor for the SQL-flavored
 * entity / relation query language.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDsl,
  executeDsl,
  runDsl,
  QueryDslError,
} from '../../../src/search/QueryLanguage.js';
import type { Entity, Relation, KnowledgeGraph } from '../../../src/types/types.js';

function makeGraph(): KnowledgeGraph {
  const entities: Entity[] = [
    {
      name: 'alice',
      entityType: 'person',
      observations: ['likes coffee'],
      tags: ['expert', 'engineer'],
      importance: 8,
    },
    {
      name: 'bob',
      entityType: 'person',
      observations: ['likes tea'],
      tags: ['junior'],
      importance: 3,
    },
    {
      name: 'TechCo',
      entityType: 'company',
      observations: ['software'],
      importance: 5,
    },
    {
      name: 'carol',
      entityType: 'person',
      observations: [],
      tags: ['expert'],
      importance: 6,
    },
  ];
  const relations: Relation[] = [
    { from: 'alice', to: 'bob', relationType: 'knows' },
    { from: 'alice', to: 'TechCo', relationType: 'works_at' },
    { from: 'carol', to: 'TechCo', relationType: 'works_at' },
  ];
  return { entities, relations };
}

describe('QueryLanguage parser', () => {
  it('parses FROM entities with no WHERE', () => {
    const ast = parseDsl('FROM entities');
    expect(ast.source).toBe('entities');
    expect(ast.where).toBeUndefined();
  });

  it('parses simple equality WHERE', () => {
    const ast = parseDsl("FROM entities WHERE entityType = 'person'");
    expect(ast.where).toEqual({
      kind: 'compare',
      field: ['entityType'],
      op: '=',
      value: 'person',
    });
  });

  it('parses AND with precedence over OR', () => {
    const ast = parseDsl(
      "FROM entities WHERE a = 1 OR b = 2 AND c = 3",
    );
    // Expect: a = 1 OR (b = 2 AND c = 3)
    expect(ast.where?.kind).toBe('or');
    if (ast.where?.kind === 'or') {
      expect(ast.where.right.kind).toBe('and');
    }
  });

  it('parses NOT', () => {
    const ast = parseDsl("FROM entities WHERE NOT entityType = 'company'");
    expect(ast.where?.kind).toBe('not');
  });

  it('parses parentheses', () => {
    const ast = parseDsl("FROM entities WHERE (a = 1 OR b = 2) AND c = 3");
    expect(ast.where?.kind).toBe('and');
    if (ast.where?.kind === 'and') {
      expect(ast.where.left.kind).toBe('or');
    }
  });

  it('parses IN expression', () => {
    const ast = parseDsl("FROM entities WHERE 'expert' IN tags");
    expect(ast.where).toEqual({
      kind: 'in',
      needle: 'expert',
      field: ['tags'],
    });
  });

  it('parses ORDER BY ASC/DESC', () => {
    const a1 = parseDsl('FROM entities ORDER BY importance');
    expect(a1.orderBy).toEqual({ field: ['importance'], dir: 'ASC' });
    const a2 = parseDsl('FROM entities ORDER BY importance DESC');
    expect(a2.orderBy).toEqual({ field: ['importance'], dir: 'DESC' });
  });

  it('parses LIMIT and OFFSET', () => {
    const ast = parseDsl('FROM entities LIMIT 5 OFFSET 10');
    expect(ast.limit).toBe(5);
    expect(ast.offset).toBe(10);
  });

  it('parses LIKE and CONTAINS operators', () => {
    const ast = parseDsl(
      "FROM entities WHERE name LIKE 'Ali%' AND observations CONTAINS 'coffee'",
    );
    expect(ast.where?.kind).toBe('and');
  });

  it('parses comparison operators', () => {
    const ast = parseDsl('FROM entities WHERE importance >= 5');
    expect(ast.where).toEqual({
      kind: 'compare',
      field: ['importance'],
      op: '>=',
      value: 5,
    });
  });

  it('parses string with double quotes and escape sequences', () => {
    const ast = parseDsl('FROM entities WHERE name = "O\\\'Brien"');
    expect(ast.where).toEqual({
      kind: 'compare',
      field: ['name'],
      op: '=',
      value: "O'Brien",
    });
  });

  it('throws on unterminated string', () => {
    expect(() => parseDsl("FROM entities WHERE name = 'unterminated")).toThrow(
      QueryDslError,
    );
  });

  it('throws on unknown source', () => {
    expect(() => parseDsl('FROM widgets')).toThrow(QueryDslError);
  });

  it('throws on trailing garbage', () => {
    expect(() => parseDsl('FROM entities WHERE a = 1 garbage')).toThrow(QueryDslError);
  });

  it('throws on missing comparison operator', () => {
    expect(() => parseDsl('FROM entities WHERE name')).toThrow(QueryDslError);
  });
});

describe('QueryLanguage executor', () => {
  const graph = makeGraph();

  it('returns all entities when no WHERE', () => {
    const result = executeDsl(parseDsl('FROM entities'), graph) as Entity[];
    expect(result).toHaveLength(4);
  });

  it('filters by entityType', () => {
    const result = runDsl("FROM entities WHERE entityType = 'person'", graph) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('AND combines filters', () => {
    const result = runDsl(
      "FROM entities WHERE entityType = 'person' AND importance > 5",
      graph,
    ) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['alice', 'carol']);
  });

  it('OR combines filters', () => {
    const result = runDsl(
      "FROM entities WHERE name = 'alice' OR name = 'bob'",
      graph,
    ) as Entity[];
    expect(result).toHaveLength(2);
  });

  it('NOT inverts filters', () => {
    const result = runDsl(
      "FROM entities WHERE NOT entityType = 'company'",
      graph,
    ) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it("'value' IN tags matches array membership", () => {
    const result = runDsl("FROM entities WHERE 'expert' IN tags", graph) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['alice', 'carol']);
  });

  it('LIKE supports % wildcards (case-insensitive)', () => {
    const result = runDsl("FROM entities WHERE name LIKE 'a%'", graph) as Entity[];
    expect(result.map((e) => e.name)).toEqual(['alice']);
  });

  it('LIKE _ matches a single char', () => {
    const result = runDsl("FROM entities WHERE name LIKE 'bo_'", graph) as Entity[];
    expect(result.map((e) => e.name)).toEqual(['bob']);
  });

  it('CONTAINS matches substring in string fields', () => {
    const result = runDsl("FROM entities WHERE name CONTAINS 'li'", graph) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['alice']);
  });

  it('CONTAINS matches array membership', () => {
    const result = runDsl("FROM entities WHERE tags CONTAINS 'expert'", graph) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['alice', 'carol']);
  });

  it('numeric comparisons work', () => {
    const result = runDsl('FROM entities WHERE importance >= 5', graph) as Entity[];
    expect(result.map((e) => e.name).sort()).toEqual(['TechCo', 'alice', 'carol']);
  });

  it('ORDER BY ASC sorts ascending', () => {
    const result = runDsl(
      'FROM entities ORDER BY importance ASC',
      graph,
    ) as Entity[];
    expect(result.map((e) => e.importance)).toEqual([3, 5, 6, 8]);
  });

  it('ORDER BY DESC sorts descending', () => {
    const result = runDsl(
      'FROM entities ORDER BY importance DESC',
      graph,
    ) as Entity[];
    expect(result.map((e) => e.importance)).toEqual([8, 6, 5, 3]);
  });

  it('LIMIT caps the result count', () => {
    const result = runDsl(
      'FROM entities ORDER BY importance DESC LIMIT 2',
      graph,
    ) as Entity[];
    expect(result.map((e) => e.name)).toEqual(['alice', 'carol']);
  });

  it('OFFSET skips the first N rows', () => {
    const result = runDsl(
      'FROM entities ORDER BY importance DESC LIMIT 10 OFFSET 2',
      graph,
    ) as Entity[];
    expect(result.map((e) => e.name)).toEqual(['TechCo', 'bob']);
  });

  it('queries relations', () => {
    const result = runDsl(
      "FROM relations WHERE relationType = 'works_at'",
      graph,
    ) as Relation[];
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.relationType === 'works_at')).toBe(true);
  });

  it("treats undefined values as null for `= NULL`", () => {
    const result = runDsl('FROM entities WHERE tags = null', graph) as Entity[];
    expect(result.map((e) => e.name)).toEqual(['TechCo']);
  });

  it('returns [] when nothing matches', () => {
    const result = runDsl(
      "FROM entities WHERE entityType = 'martian'",
      graph,
    ) as Entity[];
    expect(result).toEqual([]);
  });
});
