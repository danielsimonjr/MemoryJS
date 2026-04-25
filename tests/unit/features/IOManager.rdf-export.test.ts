/**
 * IOManager RDF/Linked-Data Export Tests (η.5.4.1+2)
 *
 * Covers the W3C-standards export formats added in η.5.4:
 * - Turtle (RDF 1.1 Turtle text serialization)
 * - RDF/XML (RDF 1.1 XML serialization, using Statement reification
 *   for arbitrary predicate IRIs)
 * - JSON-LD (JSON for Linking Data with @context to RDFS + DCTerms)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IOManager } from '../../../src/features/IOManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { KnowledgeGraph } from '../../../src/types/index.js';
import { join } from 'path';
import { tmpdir } from 'os';

describe('IOManager — RDF / Linked Data Export (η.5.4)', () => {
  let manager: IOManager;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    const storage = new GraphStorage(join(tmpdir(), `rdf-${Date.now()}-${Math.random()}.jsonl`));
    manager = new IOManager(storage);
    graph = {
      entities: [
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Developer', 'Says "hello"', 'Line\nbreak'],
          tags: ['backend', 'senior'],
          createdAt: '2024-01-01T00:00:00Z',
          lastModified: '2024-01-02T00:00:00Z',
        },
        {
          name: 'AT&T Corp',
          entityType: 'company',
          observations: ['Telecom giant'],
          tags: [],
        },
      ],
      relations: [
        {
          from: 'Alice',
          to: 'AT&T Corp',
          relationType: 'works at',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
    };
  });

  // -------- Turtle --------
  describe('Turtle export', () => {
    it('emits the standard W3C prefixes', () => {
      const out = manager.exportGraph(graph, 'turtle');
      expect(out).toContain('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .');
      expect(out).toContain('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .');
      expect(out).toContain('@prefix dcterms: <http://purl.org/dc/terms/> .');
    });

    it('emits one IRI subject per entity', () => {
      const out = manager.exportGraph(graph, 'turtle');
      expect(out).toContain('<urn:memoryjs:entity:Alice>');
      // AT&T Corp must be percent-encoded — `&` and space are reserved in IRIs
      expect(out).toContain('<urn:memoryjs:entity:AT%26T%20Corp>');
    });

    it('escapes special characters in literals', () => {
      const out = manager.exportGraph(graph, 'turtle');
      expect(out).toContain('rdfs:comment "Says \\"hello\\""');
      expect(out).toContain('rdfs:comment "Line\\nbreak"');
    });

    it('escapes the full Turtle ECHAR set (\\b \\f \\n \\r \\t and C0 controls)', () => {
      // Regex literal `/\b/` is word-boundary in JS; the source code uses
      // `\x08` (backspace U+0008) and `\x0c` (form-feed U+000C) explicitly.
      // This test exercises that exact gotcha.
      const ctrlGraph: KnowledgeGraph = {
        entities: [
          {
            name: 'X',
            entityType: 't',
            // Note: declarations use explicit \x escapes so the source
            // file stays free of literal control bytes.
            observations: ['back\bspace', 'form\ffeed', 'bell', 'vt'],
            tags: [],
          },
        ],
        relations: [],
      };
      const out = manager.exportGraph(ctrlGraph, 'turtle');
      expect(out).toContain('rdfs:comment "back\\bspace"');
      expect(out).toContain('rdfs:comment "form\\ffeed"');
      // Other C0 controls escape as \uXXXX
      expect(out).toContain('rdfs:comment "bell\\u0007"');
      expect(out).toContain('rdfs:comment "vt\\u000B"');
    });

    it('maps entityType to rdf:type with custom IRI', () => {
      const out = manager.exportGraph(graph, 'turtle');
      expect(out).toContain('a <urn:memoryjs:type:person>');
      expect(out).toContain('a <urn:memoryjs:type:company>');
    });

    it('maps tags to dcterms:subject', () => {
      const out = manager.exportGraph(graph, 'turtle');
      expect(out).toContain('dcterms:subject "backend"');
      expect(out).toContain('dcterms:subject "senior"');
    });

    it('maps relations as predicate triples', () => {
      const out = manager.exportGraph(graph, 'turtle');
      expect(out).toMatch(
        /<urn:memoryjs:entity:Alice>\s+<urn:memoryjs:rel:works%20at>\s+<urn:memoryjs:entity:AT%26T%20Corp>\s+\./,
      );
    });

    it('terminates each entity block with a period', () => {
      const out = manager.exportGraph(graph, 'turtle');
      // Each subject block must end with " ." not " ;"
      const lines = out.split('\n');
      // Find the lines that close subject blocks (the line preceding a blank line or another `<` start)
      const closers = lines.filter((l) => l.trim().endsWith(' .'));
      // 2 entity terminators + 1 relation triple = 3 closers minimum
      expect(closers.length).toBeGreaterThanOrEqual(3);
    });

    it('handles empty graph', () => {
      const out = manager.exportGraph({ entities: [], relations: [] }, 'turtle');
      expect(out).toContain('@prefix rdf:');
      expect(out).not.toMatch(/<urn:memoryjs:entity:/);
    });
  });

  // -------- RDF/XML --------
  describe('RDF/XML export', () => {
    it('emits well-formed XML prologue and root element', () => {
      const out = manager.exportGraph(graph, 'rdf-xml');
      expect(out).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
      expect(out).toContain('<rdf:RDF');
      expect(out).toContain('xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"');
      expect(out).toContain('xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"');
      expect(out).toContain('xmlns:mjsRel="urn:memoryjs:rel:"');
      expect(out).toContain('</rdf:RDF>');
    });

    it('escapes XML special characters in entity names and observations', () => {
      const out = manager.exportGraph(graph, 'rdf-xml');
      // The IRI uses percent-encoding (%26), but the rdfs:label literal is the raw name with `&` -> `&amp;`
      expect(out).toContain('<rdfs:label>AT&amp;T Corp</rdfs:label>');
      // Observation containing `"` gets escaped as `&quot;` only inside attributes; inside element text it stays.
      // Our xmlEscape replaces all `"` with `&quot;` regardless — verify safe behavior:
      expect(out).toContain('Says &quot;hello&quot;');
    });

    it('falls back to Statement reification when relationType has chars invalid in an XML local name', () => {
      // `works at` has a space — not a valid XML NCName, so the exporter
      // emits a synthetic `mjsRel:link` triple (asserted) AND a reification
      // carrying the original predicate IRI (preserves the relation type).
      const out = manager.exportGraph(graph, 'rdf-xml');
      expect(out).toContain(
        '<rdf:type rdf:resource="http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement"/>',
      );
      expect(out).toContain('<rdf:subject rdf:resource="urn:memoryjs:entity:Alice"/>');
      expect(out).toContain('<rdf:predicate rdf:resource="urn:memoryjs:rel:works%20at"/>');
      expect(out).toContain('<rdf:object rdf:resource="urn:memoryjs:entity:AT%26T%20Corp"/>');
      // ALSO a direct-triple via synthetic predicate, so the relation
      // is materialized as a real edge in the RDF graph.
      expect(out).toContain('<mjsRel:link rdf:resource="urn:memoryjs:entity:AT%26T%20Corp"/>');
    });

    it('emits a direct property-element triple when relationType is a valid NCName', () => {
      const ncGraph: KnowledgeGraph = {
        entities: [
          { name: 'A', entityType: 'person', observations: [] },
          { name: 'B', entityType: 'person', observations: [] },
        ],
        relations: [{ from: 'A', to: 'B', relationType: 'reports_to' }],
      };
      const out = manager.exportGraph(ncGraph, 'rdf-xml');
      expect(out).toContain('<mjsRel:reports_to rdf:resource="urn:memoryjs:entity:B"/>');
      // No reification needed for valid NCName predicates.
      expect(out).not.toContain('rdf-syntax-ns#Statement');
      expect(out).toContain('xmlns:mjsRel="urn:memoryjs:rel:"');
    });

    it('emits one Description per entity (relations add their own)', () => {
      const out = manager.exportGraph(graph, 'rdf-xml');
      const entityDescriptions = out.match(
        /<rdf:Description rdf:about="urn:memoryjs:entity:[^"]+">/g,
      );
      // 2 entities + 1 relation (subject `<from>` Description for the link triple)
      expect(entityDescriptions).toHaveLength(3);
    });
  });

  // -------- JSON-LD --------
  describe('JSON-LD export', () => {
    it('produces valid JSON', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      expect(parsed).toBeTruthy();
      expect(parsed['@context']).toBeTruthy();
      expect(Array.isArray(parsed['@graph'])).toBe(true);
    });

    it('declares the standard vocabulary mappings in @context', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      expect(parsed['@context'].rdfs).toBe('http://www.w3.org/2000/01/rdf-schema#');
      expect(parsed['@context'].dcterms).toBe('http://purl.org/dc/terms/');
      expect(parsed['@context'].name).toBe('rdfs:label');
      expect(parsed['@context'].entityType).toBe('@type');
    });

    it('models observations as a set so each becomes its own triple (matches Turtle/RDF-XML)', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      expect(parsed['@context'].observations).toEqual({
        '@id': 'rdfs:comment',
        '@container': '@set',
      });
    });

    it('models tags as an unordered set', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      expect(parsed['@context'].tags).toEqual({
        '@id': 'dcterms:subject',
        '@container': '@set',
      });
    });

    it('emits one @graph node per entity with @id', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      const entityNodes = parsed['@graph'].filter((n: { name?: string }) => n.name !== undefined);
      expect(entityNodes).toHaveLength(2);
      expect(entityNodes[0]['@id']).toBe('urn:memoryjs:entity:Alice');
      expect(entityNodes[1]['@id']).toBe('urn:memoryjs:entity:AT%26T%20Corp');
    });

    it('preserves observation insertion order in the JSON output', () => {
      // JSON-LD `@set` doesn't assert order in the RDF graph, but the JSON
      // shape is still a plain array — order is preserved at the JSON level.
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      const alice = parsed['@graph'].find(
        (n: { name?: string }) => n.name === 'Alice',
      ) as { observations: string[] };
      expect(alice.observations).toEqual(['Developer', 'Says "hello"', 'Line\nbreak']);
    });

    it('omits empty tags array', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      const att = parsed['@graph'].find(
        (n: { name?: string }) => n.name === 'AT&T Corp',
      ) as Record<string, unknown>;
      expect(att.tags).toBeUndefined();
    });

    it('emits relation nodes alongside entity nodes', () => {
      const out = manager.exportGraph(graph, 'json-ld');
      const parsed = JSON.parse(out);
      const relationNodes = parsed['@graph'].filter(
        (n: { relationType?: string }) => n.relationType !== undefined,
      );
      expect(relationNodes).toHaveLength(1);
      expect(relationNodes[0].from).toBe('urn:memoryjs:entity:Alice');
      expect(relationNodes[0].to).toBe('urn:memoryjs:entity:AT%26T%20Corp');
      expect(relationNodes[0].relationType).toBe('works at');
    });
  });

  // -------- Dispatcher coverage --------
  describe('exportGraph dispatcher', () => {
    it('dispatches to turtle', () => {
      expect(manager.exportGraph(graph, 'turtle')).toContain('@prefix rdf:');
    });
    it('dispatches to rdf-xml', () => {
      expect(manager.exportGraph(graph, 'rdf-xml')).toContain('<rdf:RDF');
    });
    it('dispatches to json-ld', () => {
      expect(manager.exportGraph(graph, 'json-ld')).toContain('"@context"');
    });
  });
});
