/**
 * Memory toolkit for controlled traversal of the Cue–Tag–Content graph.
 *
 * Implements the seven typed traversal operators of MRAgent (paper Table 4).
 * Each tool corresponds to a typed mapping between memory components, letting an
 * agent (LLM- or heuristic-driven) explicitly control the direction and
 * granularity of memory access rather than retrieving a fixed similarity set.
 *
 * @module agent/reconstruction/MemoryToolkit
 * @experimental
 */

import type { ContentNode, TagNode } from '../../types/reconstruction.js';
import { CueTagContentGraph } from './CueTagContentGraph.js';

/** Result of the keyword/context introspection tools. */
export interface EventKeywords {
  cues: string[];
  tags: string[];
}

/**
 * The MRAgent traversal toolkit. Stateless over the graph — each call is a pure
 * mapping operator invocation, which keeps memory access interpretable.
 */
export class MemoryToolkit {
  constructor(private readonly graph: CueTagContentGraph) {}

  /**
   * `query_tag_events` — φ_{(c,g)→e}: retrieve episodic events associated with a
   * cue–tag pair. The workhorse for multi-hop questions (paper Table 6).
   */
  queryTagEvents(cue: string, tag: string): ContentNode[] {
    return this.graph.contentsForCueTag(cue, tag, 'episodic');
  }

  /**
   * `query_conversation_time` — φ_{e→t}: return the conversation timestamp of an
   * episodic event. Primary operator for temporal questions.
   */
  queryConversationTime(eventId: string): string | undefined {
    const node = this.graph.getContent(eventId);
    return node?.layer === 'episodic' ? node.timestamp : undefined;
  }

  /**
   * `query_event_keywords` — φ_{e→(c,g)}: extract the cues and tags associated
   * with an episodic event (reverse traversal to discover new retrieval paths).
   */
  queryEventKeywords(eventId: string): EventKeywords {
    const pairs = this.graph.cueTagsForContent(eventId);
    const cues = new Set<string>();
    const tags = new Set<string>();
    for (const { cue, tag } of pairs) {
      cues.add(cue.text);
      tags.add(tag.text);
    }
    return { cues: [...cues], tags: [...tags] };
  }

  /**
   * `query_event_context` — φ_{e→ctx}: retrieve the textual context surrounding
   * an episodic event (the event's own text plus its temporal neighbours on the
   * unified timeline).
   */
  queryEventContext(eventId: string, window = 1): string {
    const node = this.graph.getContent(eventId);
    if (!node || node.layer !== 'episodic') return '';
    const timeline = this.graph.contentsByLayer('episodic');
    const idx = timeline.findIndex(e => e.id === eventId);
    if (idx === -1) return node.text;
    const start = Math.max(0, idx - window);
    const end = Math.min(timeline.length, idx + window + 1);
    return timeline
      .slice(start, end)
      .map(e => (e.timestamp ? `[${e.timestamp}] ${e.text}` : e.text))
      .join('\n');
  }

  /**
   * `query_personal_information` — φ_{cs→gs}: return the semantic aspects (tags)
   * associated with a person entity, e.g. `preference`, `occupation`.
   */
  queryPersonalInformation(person: string): TagNode[] {
    // Aspects are tags that route to semantic content for this entity cue.
    const aspects: TagNode[] = [];
    for (const tag of this.graph.tagsForCue(person)) {
      if (this.graph.contentsForCueTag(person, tag.text, 'semantic').length > 0) {
        aspects.push(tag);
      }
    }
    return aspects;
  }

  /**
   * `query_personal_aspect` — φ_{(cs,gs)→vs}: retrieve the semantic content for a
   * `(person, aspect)` pair without scanning long episodic histories.
   */
  queryPersonalAspect(person: string, aspect: string): ContentNode[] {
    return this.graph.contentsForCueTag(person, aspect, 'semantic');
  }

  /**
   * `query_topic_events` — φ_{τ→e}: retrieve episodic events associated with a
   * topic node, enabling efficient top-down localisation.
   */
  queryTopicEvents(topicId: string): ContentNode[] {
    return this.graph.episodesForTopic(topicId);
  }
}
