/**
 * Active memory reconstruction (MRAgent §4 / Algorithm 1).
 *
 * Rather than a one-shot "retrieve-then-reason" lookup, the reconstructor
 * formulates memory access as a stateful, multi-step process over the
 * Cue–Tag–Content graph. It maintains a reconstruction state `S(t) = (Z(t),
 * H(t))` — an active set of candidate elements `Z` and the accumulated
 * reconstructed context `H` — and iterates:
 *
 *   1. **Action selection** `f_select(x, H, Z)` — choose promising traversal
 *      directions (forward cue→tag / (cue,tag)→content, reverse content→(cue,tag),
 *      top-down topic→episode), reducing noise vs. exhaustive expansion.
 *   2. **Controlled traversal** — execute the selected actions to produce
 *      candidates `Z̃(t+1)`.
 *   3. **Routing + state update** `f_route(x, H, Z̃)` — keep the candidates most
 *      relevant to the query and prune the rest, then fold them into `H`.
 *   4. **Stopping** — terminate once accumulated evidence suffices.
 *
 * The default policy is a deterministic, embedding-free heuristic so the feature
 * works with zero configuration. When an {@link LLMProvider} is supplied the
 * final answer is synthesised by the LLM under the paper's QA prompt (Appendix E),
 * and routing is LLM-assisted; otherwise an extractive answer is returned.
 *
 * @module agent/reconstruction/MemoryReconstructor
 * @experimental
 */

import type { LLMProvider } from '../../search/LLMQueryPlanner.js';
import { KeywordExtractor } from '../../features/KeywordExtractor.js';
import type {
  ContentNode,
  CueNode,
  ReconstructionOptions,
  ReconstructionResult,
  TagNode,
  TraversalActionType,
  TraversalStep,
} from '../../types/reconstruction.js';
import { CueTagContentGraph } from './CueTagContentGraph.js';
import { MemoryToolkit } from './MemoryToolkit.js';
import { extractJson } from './MemoryDistiller.js';

/** The active set `Z(t)` — cues, tags and contents currently under consideration. */
interface ActiveSet {
  cues: CueNode[];
  pairs: Array<{ cue: CueNode; tag: TagNode }>;
  contents: ContentNode[];
}

const QA_PROMPT = `You are a question-answering agent with access to event-based memory.
Answer the question using ONLY the reconstructed evidence provided.
Answer Rules:
- Yes/No questions: output Yes, No, Likely yes, or Likely no.
- Location questions: answer with a specific place name.
- Counting questions: answer with the number of relevant items.
- Other questions: output the minimal concrete entity or phrase.
Output a single-line JSON object: {"answer":"...","confidence":0.0-1.0}`;

const DEFAULTS: Required<ReconstructionOptions> = {
  maxSteps: 8,
  perStepBudget: 10,
  evidenceTarget: 12,
};

export class MemoryReconstructor {
  private readonly toolkit: MemoryToolkit;
  private readonly keywords = new KeywordExtractor();

  constructor(
    private readonly graph: CueTagContentGraph,
    private readonly llm?: LLMProvider,
    /**
     * Optional semantic similarity in `[0, 1]` (e.g. `SemanticSearch`), used to
     * rank candidates during routing/answer when a live-store backing supplies
     * it. Falls back to lexical overlap when absent.
     */
    private readonly similarityFn?: (query: string, text: string) => Promise<number>,
  ) {
    this.toolkit = new MemoryToolkit(graph);
  }

  /** Run active reconstruction for a query (Algorithm 1). */
  async reconstruct(
    query: string,
    options: ReconstructionOptions = {},
  ): Promise<ReconstructionResult> {
    const opts = { ...DEFAULTS, ...options };
    const trajectory: TraversalStep[] = [];

    // EXTRACTCUES(x) + ACTIVESETINIT(C, G) — line 1-2.
    const initialCues = this.extractQueryCues(query);
    let active: ActiveSet = { cues: initialCues, pairs: [], contents: [] };

    // H(0) ← ∅ — line 3-4. Track seen content ids to keep H concise.
    const evidence: ContentNode[] = [];
    const seen = new Set<string>();
    let stoppedEarly = false;

    for (let step = 0; step < opts.maxSteps; step++) {
      // f_select — line 7.
      const actions = this.selectActions(active);
      if (actions.length === 0) break;

      // Controlled traversal — lines 9-12. Produces candidate set Z̃(t+1).
      const candidate = this.traverse(active, actions);

      // f_route + state update — lines 14-15.
      const routed = await this.route(query, candidate.contents, seen, opts.perStepBudget);
      for (const node of routed) {
        seen.add(node.id);
        evidence.push(node);
      }

      trajectory.push({
        step,
        actions,
        routed,
        rationale: describeActions(actions),
      });

      // The next active set carries forward newly discovered cues/tags plus the
      // routed contents, so subsequent steps can reason over accumulated evidence.
      active = {
        cues: dedupeCues([...active.cues, ...candidate.cues]),
        pairs: dedupePairs([...active.pairs, ...candidate.pairs]),
        contents: routed,
      };

      // STOP(x, H) — lines 16-18.
      if (this.shouldStop(evidence, routed, opts.evidenceTarget)) {
        stoppedEarly = true;
        break;
      }
    }

    // ŷ ← ANSWER_LLM(x, H) — line 20.
    const { answer, confidence } = await this.answer(query, evidence);

    return { query, answer, confidence, evidence, trajectory, stoppedEarly };
  }

  // ==================== EXTRACTCUES ====================

  private extractQueryCues(query: string): CueNode[] {
    const phrases = new Set<string>();
    // Capitalised entities are strong cues.
    for (const m of query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g) ?? []) {
      phrases.add(m);
    }
    for (const k of this.keywords.extractTop(query, 8)) phrases.add(k);

    const matched = new Map<string, CueNode>();
    for (const phrase of phrases) {
      for (const cue of this.graph.matchCues(phrase)) matched.set(cue.id, cue);
    }
    return [...matched.values()];
  }

  // ==================== f_select ====================

  /**
   * Select promising traversal directions from the current active set. The
   * heuristic prefers to advance cues → tags → content, expands retrieved
   * content both reverse (new cues/tags) and top-down (topic → episode).
   */
  private selectActions(active: ActiveSet): TraversalActionType[] {
    const actions: TraversalActionType[] = [];
    // Forward: active cues are advanced through tags to content within the same
    // turn (the paper allows multiple tool calls per reasoning turn).
    if (active.cues.length > 0) {
      actions.push('cue->tag');
      actions.push('cuetag->content');
    } else if (active.pairs.length > 0) {
      actions.push('cuetag->content');
    }
    if (active.contents.some(c => c.layer === 'topic')) actions.push('topic->episode');
    // Reverse: surface fresh cues/tags from episodic evidence to redirect search.
    if (active.contents.some(c => c.layer === 'episodic')) actions.push('content->cuetag');
    return actions;
  }

  // ==================== Controlled traversal ====================

  private traverse(active: ActiveSet, actions: TraversalActionType[]): ActiveSet {
    const out: ActiveSet = { cues: [], pairs: [], contents: [] };

    // Tags newly activated this turn are chained straight into content retrieval,
    // so a single turn can progress cue → tag → content (Eq. 8).
    const pairPool: Array<{ cue: CueNode; tag: TagNode }> = [...active.pairs];

    if (actions.includes('cue->tag')) {
      for (const cue of active.cues) {
        for (const tag of this.graph.tagsForCue(cue.text)) {
          const pair = { cue, tag };
          out.pairs.push(pair);
          pairPool.push(pair);
        }
      }
    }

    if (actions.includes('cuetag->content')) {
      for (const { cue, tag } of pairPool) {
        out.contents.push(...this.graph.contentsForCueTag(cue.text, tag.text));
      }
    }

    if (actions.includes('topic->episode')) {
      for (const topic of active.contents.filter(c => c.layer === 'topic')) {
        out.contents.push(...this.toolkit.queryTopicEvents(topic.id));
      }
    }

    if (actions.includes('content->cuetag')) {
      for (const content of active.contents.filter(c => c.layer === 'episodic')) {
        for (const { cue, tag } of this.graph.cueTagsForContent(content.id)) {
          out.cues.push(cue);
          out.pairs.push({ cue, tag });
        }
      }
    }

    out.cues = dedupeCues(out.cues);
    out.pairs = dedupePairs(out.pairs);
    return out;
  }

  // ==================== f_route ====================

  /**
   * Rank candidate content by lexical relevance to the query, drop already-seen
   * nodes, and keep the top `budget`. This is the noise-pruning step that keeps
   * the reconstructed context focused.
   */
  private async route(
    query: string,
    candidates: ContentNode[],
    seen: Set<string>,
    budget: number,
  ): Promise<ContentNode[]> {
    const queryTerms = new Set(this.keywords.extractTop(query, 12));
    const unique = new Map<string, ContentNode>();
    for (const node of candidates) {
      if (!seen.has(node.id)) unique.set(node.id, node);
    }

    const scored = await Promise.all(
      [...unique.values()].map(async node => ({
        node,
        score: await this.relevance(query, node, queryTerms),
      })),
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, budget)
      .map(s => s.node);
  }

  /**
   * Relevance of a candidate to the query. Uses semantic similarity when a
   * backing supplies it (embedding-based, captures paraphrase), otherwise falls
   * back to lexical keyword overlap.
   */
  private async relevance(
    query: string,
    node: ContentNode,
    queryTerms: Set<string>,
  ): Promise<number> {
    // Semantic facts are compact and high-value; give them a mild prior.
    const layerBonus = node.layer === 'semantic' ? 0.5 : 0;

    if (this.similarityFn) {
      try {
        const sim = await this.similarityFn(query, node.text);
        // Scale into a comparable range with the lexical path.
        return sim * 10 + layerBonus;
      } catch {
        // Fall through to lexical scoring.
      }
    }

    if (queryTerms.size === 0) return 1 + layerBonus;
    const nodeTerms = this.keywords.extract(node.text).map(k => k.keyword);
    let overlap = 0;
    for (const term of nodeTerms) if (queryTerms.has(term)) overlap++;
    return overlap + layerBonus;
  }

  // ==================== STOP ====================

  private shouldStop(
    evidence: ContentNode[],
    routedThisStep: ContentNode[],
    target: number,
  ): boolean {
    if (evidence.length >= target) return true;
    // No new evidence discovered this step → the trajectory is exhausted.
    return routedThisStep.length === 0;
  }

  // ==================== ANSWER ====================

  private async answer(
    query: string,
    evidence: ContentNode[],
  ): Promise<{ answer?: string; confidence?: number }> {
    if (evidence.length === 0) return { answer: undefined, confidence: 0 };

    if (this.llm) {
      try {
        const context = evidence
          .map((e, i) => `D${i + 1}: ${e.timestamp ? `[${e.timestamp}] ` : ''}${e.text}`)
          .join('\n');
        const raw = await this.llm.complete(
          `${QA_PROMPT}\n\nQuestion: ${query}\n\nReconstructed evidence:\n${context}`,
        );
        const parsed = extractJson<{ answer?: string; confidence?: number }>(raw);
        if (parsed?.answer) {
          return { answer: parsed.answer, confidence: parsed.confidence ?? 0.7 };
        }
      } catch {
        // Fall back to extractive answer below.
      }
    }

    // Extractive fallback: the highest-relevance evidence item.
    const queryTerms = new Set(this.keywords.extractTop(query, 12));
    const ranked = await Promise.all(
      evidence.map(async node => ({ node, score: await this.relevance(query, node, queryTerms) })),
    );
    const best = ranked.sort((a, b) => b.score - a.score)[0].node;
    return { answer: best.text, confidence: 0.4 };
  }
}

// ==================== Helpers ====================

function describeActions(actions: TraversalActionType[]): string {
  const labels: Record<TraversalActionType, string> = {
    'cue->tag': 'activate tags from cues',
    'cuetag->content': 'retrieve content for cue–tag pairs',
    'content->cuetag': 'surface new cues/tags from content',
    'topic->episode': 'descend topics to episodes',
  };
  return actions.map(a => labels[a]).join('; ');
}

function dedupeCues(cues: CueNode[]): CueNode[] {
  const map = new Map<string, CueNode>();
  for (const c of cues) map.set(c.id, c);
  return [...map.values()];
}

function dedupePairs(
  pairs: Array<{ cue: CueNode; tag: TagNode }>,
): Array<{ cue: CueNode; tag: TagNode }> {
  const map = new Map<string, { cue: CueNode; tag: TagNode }>();
  for (const p of pairs) map.set(`${p.cue.id} ${p.tag.id}`, p);
  return [...map.values()];
}
