import { describe, it, expect } from 'vitest';
import { CueTagContentGraph } from '../../../../src/agent/reconstruction/CueTagContentGraph.js';
import { MemoryToolkit } from '../../../../src/agent/reconstruction/MemoryToolkit.js';

function fixture(): MemoryToolkit {
  const g = new CueTagContentGraph();
  g.addContent({ id: 'e1', layer: 'episodic', text: 'Joanna submitted her first screenplay', timestamp: '2023-01-05', topicIds: ['t1'] });
  g.addContent({ id: 'e2', layer: 'episodic', text: 'A production company rejected the screenplay', timestamp: '2023-02-01', topicIds: ['t1'] });
  g.addContent({ id: 't1', layer: 'topic', text: 'Topic: screenplays' });
  g.addContent({ id: 's1', layer: 'semantic', text: 'Joanna prefers thriller genres', person: 'Joanna' });
  g.addTriple('Joanna', 'screenplay submission', 'e1');
  g.addTriple('screenplay', 'screenplay submission', 'e1');
  g.addTriple('Joanna', 'screenplay rejection', 'e2');
  g.addTriple('Joanna', 'preference', 's1');
  g.linkTopicEpisode('t1', 'e1');
  g.linkTopicEpisode('t1', 'e2');
  return new MemoryToolkit(g);
}

describe('MemoryToolkit (7 traversal operators, paper Table 4)', () => {
  it('query_tag_events retrieves episodic events for a cue–tag pair', () => {
    const tk = fixture();
    expect(tk.queryTagEvents('Joanna', 'screenplay submission').map(e => e.id)).toEqual(['e1']);
  });

  it('query_conversation_time returns the event timestamp', () => {
    const tk = fixture();
    expect(tk.queryConversationTime('e2')).toBe('2023-02-01');
    expect(tk.queryConversationTime('s1')).toBeUndefined(); // semantic has no timestamp
  });

  it('query_event_keywords surfaces cues and tags of an event', () => {
    const tk = fixture();
    const { cues, tags } = tk.queryEventKeywords('e1');
    expect(cues.sort()).toEqual(['Joanna', 'screenplay']);
    expect(tags).toContain('screenplay submission');
  });

  it('query_event_context returns surrounding timeline text', () => {
    const tk = fixture();
    const ctx = tk.queryEventContext('e1', 1);
    expect(ctx).toContain('Joanna submitted her first screenplay');
    expect(ctx).toContain('rejected'); // neighbour on the timeline
  });

  it('query_personal_information lists semantic aspects of a person', () => {
    const tk = fixture();
    expect(tk.queryPersonalInformation('Joanna').map(t => t.text)).toEqual(['preference']);
  });

  it('query_personal_aspect retrieves semantic content for (person, aspect)', () => {
    const tk = fixture();
    expect(tk.queryPersonalAspect('Joanna', 'preference').map(s => s.id)).toEqual(['s1']);
  });

  it('query_topic_events descends a topic to its episodes', () => {
    const tk = fixture();
    expect(tk.queryTopicEvents('t1').map(e => e.id).sort()).toEqual(['e1', 'e2']);
  });
});
