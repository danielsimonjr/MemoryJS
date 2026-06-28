import { describe, it, expect } from 'vitest';
import {
  CueTagContentGraph,
  normalizeKey,
} from '../../../../src/agent/reconstruction/CueTagContentGraph.js';

describe('CueTagContentGraph', () => {
  function buildGraph(): CueTagContentGraph {
    const g = new CueTagContentGraph();
    // Episodic content.
    g.addContent({ id: 'e1', layer: 'episodic', text: 'Nate won a tournament', timestamp: '2023-07-04' });
    g.addContent({ id: 'e2', layer: 'episodic', text: 'Caroline started painting', timestamp: '2023-07-10' });
    g.addTriple('Nate', 'tournament win', 'e1');
    g.addTriple('tournament', 'tournament win', 'e1');
    g.addTriple('Caroline', 'new hobby', 'e2');
    return g;
  }

  it('normalizeKey lowercases and collapses whitespace', () => {
    expect(normalizeKey('  Video   Game ')).toBe('video game');
  });

  it('φ_{c→g}: tagsForCue returns associated tags', () => {
    const g = buildGraph();
    const tags = g.tagsForCue('Nate');
    expect(tags.map(t => t.text)).toContain('tournament win');
  });

  it('φ_{(c,g)→v}: contentsForCueTag returns content for a cue–tag pair', () => {
    const g = buildGraph();
    const contents = g.contentsForCueTag('Nate', 'tournament win');
    expect(contents.map(c => c.id)).toEqual(['e1']);
  });

  it('φ_{(c,g)→v} filters by layer', () => {
    const g = buildGraph();
    g.addContent({ id: 's1', layer: 'semantic', text: 'Nate likes chess', person: 'Nate' });
    g.addTriple('Nate', 'preference', 's1');
    expect(g.contentsForCueTag('Nate', 'preference', 'episodic')).toHaveLength(0);
    expect(g.contentsForCueTag('Nate', 'preference', 'semantic')).toHaveLength(1);
  });

  it('φ_{v→(c,g)}: reverse traversal surfaces cues and tags from content', () => {
    const g = buildGraph();
    const pairs = g.cueTagsForContent('e1');
    const cueTexts = pairs.map(p => p.cue.text).sort();
    expect(cueTexts).toEqual(['Nate', 'tournament']);
  });

  it('φ_{τ→e}: topic links resolve to episodes', () => {
    const g = buildGraph();
    g.addContent({ id: 't1', layer: 'topic', text: 'Topic: games' });
    g.addContent({
      id: 'e3',
      layer: 'episodic',
      text: 'Nate played a new game',
      topicIds: ['t1'],
    });
    expect(g.episodesForTopic('t1').map(e => e.id)).toEqual(['e3']);
  });

  it('episodic contents come back in timeline order', () => {
    const g = buildGraph();
    expect(g.contentsByLayer('episodic').map(e => e.id)).toEqual(['e1', 'e2']);
  });

  it('matchCues finds exact and substring cue matches', () => {
    const g = buildGraph();
    expect(g.matchCues('Nate').map(c => c.id)).toEqual(['nate']);
    expect(g.matchCues('tourna').map(c => c.id)).toContain('tournament');
  });

  it('addTriple is idempotent and rejects unknown content', () => {
    const g = buildGraph();
    const before = g.stats().triples;
    g.addTriple('Nate', 'tournament win', 'e1'); // duplicate
    expect(g.stats().triples).toBe(before);
    expect(() => g.addTriple('X', 'y', 'missing')).toThrow();
  });

  it('round-trips through a snapshot', () => {
    const g = buildGraph();
    const restored = CueTagContentGraph.fromSnapshot(g.toSnapshot());
    expect(restored.stats()).toEqual(g.stats());
    expect(restored.contentsForCueTag('Caroline', 'new hobby').map(c => c.id)).toEqual(['e2']);
  });
});
