/**
 * Memory distillation pipeline — populates the Cue–Tag–Content graph from raw
 * dialogue (MRAgent §3.3 / Appendix B.1).
 *
 * The pipeline mirrors the paper's element-generation phase:
 *   1. **Rewrite** raw turns into self-contained sentences — pronoun resolution,
 *      temporal normalisation (`YYYY-MM-DD`), and episodic segmentation.
 *   2. **Tag** each episode with a short associative phrase (`T_LLM`).
 *   3. **Cue** extraction — fine-grained entities/attributes (`K_LLM`).
 *   4. **Semantic** extraction — person-anchored stable facts (`S_LLM`).
 *   5. **Topic** abstraction — recurring patterns across episodes (`A_LLM`).
 *
 * When an {@link LLMProvider} is supplied the pipeline uses the paper's prompts
 * (Appendix E); otherwise it falls back to deterministic heuristics so the
 * feature works with zero configuration — matching the LLM-optional pattern used
 * elsewhere in the codebase (e.g. `LLMQueryPlanner`).
 *
 * @module agent/reconstruction/MemoryDistiller
 * @experimental
 */

import type { LLMProvider } from '../../search/LLMQueryPlanner.js';
import { KeywordExtractor } from '../../features/KeywordExtractor.js';
import type {
  DialogueTurn,
  ConversationDistillationResult,
  DistilledSentence,
  PersonalFact,
} from '../../types/reconstruction.js';
import { CueTagContentGraph } from './CueTagContentGraph.js';

/** Prompt used for dialogue rewriting + topic/personal extraction (Appendix E). */
const DIALOGUE_PROMPT = `You are a dialogue processor. Only output valid JSON.
Task: For each sentence in the dialogue:
- Preserve every original sentence.
- Replace all pronouns with explicit entities or noun phrases from context.
- Do not modify verbs, adjectives, or other words.
- Assign a short concrete tag (at most two words).
- Normalize time to YYYY-MM-DD using conversation time.
- If a question is answered by the next sentence, merge them.
Topics: Derive at least ten concrete topics overall. Assign topic IDs (t1..tn); each sentence lists applicable topics or [].
PersonalInformation: Extract person-related facts into personal_sentences.
Output a single-line JSON object with keys: conversation_time, sentence[], topics{}, personal_sentences[].
Each sentence: {"id","text","tag","origin","topic":[],"time"}.
Each personal_sentence: {"id","text","tag","origin","person"}.`;

/** Prompt used for cue/keyword extraction (Appendix E). */
const KEYWORD_PROMPT = `You are an information extraction system. Only output valid JSON.
Task: For each input sentence, extract 2-30 keywords directly from the original text.
- Do not invent, paraphrase, or generalize keywords.
- Only include words or phrases that explicitly appear in the text.
- Extract entity, topic, verb, time, location, task, event, people keywords if present.
Output: {"sentence":[{"sentence_id":"...","keyword":["..."]}]}`;

/** Lightweight regexes for heuristic semantic-fact detection. */
const FACT_VERBS =
  /\b(is|are|was|were|likes?|loves?|prefers?|enjoys?|works?|lives?|owns?|has|have|studied|graduated|married|named)\b/i;

/** Heuristic relative-date → absolute-date normaliser. */
function normalizeDate(text: string, reference?: string): string | undefined {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  return reference;
}

export class MemoryDistiller {
  private readonly keywords = new KeywordExtractor();

  constructor(private readonly llm?: LLMProvider) {}

  /** Run the full distillation pipeline over a dialogue. */
  async distill(turns: DialogueTurn[]): Promise<ConversationDistillationResult> {
    if (this.llm) {
      try {
        return await this.distillWithLLM(turns);
      } catch {
        // Fall through to heuristics on malformed LLM output.
      }
    }
    return this.distillHeuristic(turns);
  }

  /**
   * Build (or extend) a {@link CueTagContentGraph} from a distillation result.
   * Episodic, semantic and topic layers are populated in one pass.
   */
  buildGraph(result: ConversationDistillationResult, graph = new CueTagContentGraph()): CueTagContentGraph {
    // Topic abstraction layer — create topic content nodes first so episodes can link.
    for (const [topicId, description] of Object.entries(result.topics)) {
      graph.addContent({ id: topicId, layer: 'topic', text: description });
    }

    // Episodic layer — Cue–Tag–Episode triples.
    for (const sentence of result.sentences) {
      const episodeId = sentence.id;
      graph.addContent({
        id: episodeId,
        layer: 'episodic',
        text: sentence.text,
        timestamp: sentence.time ?? result.conversationTime,
        topicIds: sentence.topics,
        origin: sentence.origin,
      });
      const cues = result.keywords[sentence.id] ?? [];
      for (const cue of cues) {
        graph.addTriple(cue, sentence.tag, episodeId);
      }
    }

    // Semantic layer — Cue(person)–Tag(aspect)–Semantic triples.
    for (const fact of result.personalFacts) {
      graph.addContent({
        id: fact.id,
        layer: 'semantic',
        text: fact.text,
        person: fact.person,
        origin: fact.origin,
      });
      graph.addTriple(fact.person, fact.tag, fact.id);
    }

    return graph;
  }

  // ==================== LLM path ====================

  private async distillWithLLM(turns: DialogueTurn[]): Promise<ConversationDistillationResult> {
    const dialogueText = turns
      .map(t => `${t.id}${t.speaker ? ` (${t.speaker})` : ''}: ${t.text}`)
      .join('\n');
    const refDate = turns.find(t => t.timestamp)?.timestamp;

    const dialogueRaw = await this.llm!.complete(
      `${DIALOGUE_PROMPT}\n\nConversation time: ${refDate ?? 'unknown'}\nDialogue:\n${dialogueText}`,
    );
    const parsed = extractJson<{
      conversation_time?: string;
      sentence?: Array<{
        id: string;
        text: string;
        tag?: string;
        origin?: string;
        topic?: string[];
        time?: string;
      }>;
      topics?: Record<string, string>;
      personal_sentences?: Array<{
        id: string;
        text: string;
        tag?: string;
        origin?: string;
        person?: string;
      }>;
    }>(dialogueRaw);
    if (!parsed?.sentence) throw new Error('LLM dialogue output missing sentences');

    const sentences: DistilledSentence[] = parsed.sentence.map(s => ({
      id: s.id,
      text: s.text,
      tag: s.tag?.trim() || 'event',
      origin: s.origin,
      topics: s.topic ?? [],
      time: s.time,
    }));

    // Keyword/cue extraction pass.
    const kwRaw = await this.llm!.complete(
      `${KEYWORD_PROMPT}\n\nTEXT:\n${JSON.stringify(
        sentences.map(s => ({ id: s.id, text: s.text })),
      )}`,
    );
    const kwParsed = extractJson<{
      sentence?: Array<{ sentence_id: string; keyword: string[] }>;
    }>(kwRaw);
    const keywords: Record<string, string[]> = {};
    for (const s of sentences) {
      const hit = kwParsed?.sentence?.find(k => k.sentence_id === s.id);
      keywords[s.id] = hit?.keyword?.length ? hit.keyword : this.keywords.extractTop(s.text, 6);
    }

    const personalFacts: PersonalFact[] = (parsed.personal_sentences ?? []).map((p, i) => ({
      id: p.id || `p${i + 1}`,
      text: p.text,
      tag: p.tag?.trim() || 'fact',
      person: p.person?.trim() || 'unknown',
      origin: p.origin,
    }));

    return {
      conversationTime: parsed.conversation_time ?? refDate,
      sentences,
      topics: parsed.topics ?? {},
      personalFacts,
      keywords,
    };
  }

  // ==================== Heuristic path ====================

  private distillHeuristic(turns: DialogueTurn[]): ConversationDistillationResult {
    const refDate = turns.find(t => t.timestamp)?.timestamp;
    const sentences: DistilledSentence[] = [];
    const keywords: Record<string, string[]> = {};
    const personalFacts: PersonalFact[] = [];

    for (const turn of turns) {
      const speaker = turn.speaker?.trim();
      const rawSentences = splitSentences(turn.text);
      rawSentences.forEach((raw, idx) => {
        const id = `${turn.id}-${idx + 1}`;
        const text = speaker ? resolvePronouns(raw, speaker) : raw;
        const scored = this.keywords.extract(text);
        const cues = dedupe([
          ...extractEntities(text),
          ...scored.slice(0, 6).map(k => k.keyword),
        ]);
        const tag = scored[0]?.keyword ?? 'event';
        sentences.push({
          id,
          text,
          tag,
          origin: turn.id,
          topics: [],
          time: normalizeDate(text, turn.timestamp ?? refDate),
        });
        keywords[id] = cues.length ? cues : [tag];

        // Semantic fact heuristic: a declarative statement about a known person.
        if (speaker && FACT_VERBS.test(raw)) {
          personalFacts.push({
            id: `p${personalFacts.length + 1}`,
            text,
            tag: classifyAspect(raw),
            person: speaker,
            origin: turn.id,
          });
        }
      });
    }

    const topics = this.deriveTopics(sentences, keywords);

    return {
      conversationTime: refDate,
      sentences,
      topics: topics.descriptions,
      personalFacts,
      keywords,
    };
  }

  /** Cluster episodes by their most salient shared cue into topic nodes. */
  private deriveTopics(
    sentences: DistilledSentence[],
    keywords: Record<string, string[]>,
  ): { descriptions: Record<string, string> } {
    const byCue = new Map<string, string[]>();
    for (const s of sentences) {
      const top = keywords[s.id]?.[0];
      if (!top) continue;
      const list = byCue.get(top) ?? [];
      list.push(s.id);
      byCue.set(top, list);
    }
    const descriptions: Record<string, string> = {};
    let ti = 1;
    for (const [cue, ids] of [...byCue.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (ids.length < 2) continue; // a topic must summarise ≥ 2 episodes
      const topicId = `t${ti++}`;
      descriptions[topicId] = `Topic: ${cue}`;
      for (const sid of ids) {
        const s = sentences.find(x => x.id === sid);
        if (s) s.topics = dedupe([...(s.topics ?? []), topicId]);
      }
    }
    return { descriptions };
  }
}

// ==================== Helpers ====================

/** Extract the first JSON object/array from a possibly noisy LLM completion. */
export function extractJson<T>(raw: string): T | undefined {
  if (!raw) return undefined;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.search(/[[{]/);
  if (start === -1) return undefined;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1)) as T;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Resolve first-person pronouns to the speaker (lightweight coreference). */
function resolvePronouns(text: string, speaker: string): string {
  return text
    .replace(/\bI'm\b/g, `${speaker} is`)
    .replace(/\bI've\b/g, `${speaker} has`)
    .replace(/\bI'll\b/g, `${speaker} will`)
    .replace(/\bI\b/g, speaker)
    .replace(/\b[Mm]y\b/g, `${speaker}'s`)
    .replace(/\b[Mm]e\b/g, speaker)
    .replace(/\b[Mm]yself\b/g, speaker);
}

/** Pull capitalised multi-word entities as cues. */
function extractEntities(text: string): string[] {
  const matches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g) ?? [];
  return matches.filter(m => m.length > 2);
}

/** Classify a personal fact into an aspect-level tag. */
function classifyAspect(text: string): string {
  const t = text.toLowerCase();
  if (/\b(likes?|loves?|prefers?|enjoys?|favorite|favourite)\b/.test(t)) return 'preference';
  if (/\b(works?|job|career|occupation|profession)\b/.test(t)) return 'occupation';
  if (/\b(lives?|located|from|based)\b/.test(t)) return 'location';
  if (/\b(studied|graduated|degree|university|school)\b/.test(t)) return 'education';
  if (/\b(married|wife|husband|family|brother|sister|son|daughter)\b/.test(t)) return 'relationship';
  return 'attribute';
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map(i => i.trim()).filter(Boolean))];
}
