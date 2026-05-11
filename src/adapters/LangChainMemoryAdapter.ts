/**
 * LangChain Memory Adapter
 *
 * Phase 4 step 44 (§12.6) — adapter that maps the MemoryJS
 * `MemoryEngine` onto LangChain's `BaseChatMemory` shape so callers
 * can drop MemoryJS in as a LangChain memory backend.
 *
 * **No `langchain` dep.** We match the LangChain contract structurally;
 * downstream callers wire this into their LangChain chain themselves
 * (the duck-typed shape works because LangChain's memory contract is
 * structural).
 *
 * @module adapters/LangChainMemoryAdapter
 * @experimental Structural match against LangChain's `BaseChatMemory`
 *   may need updates if their contract changes; the role-encoding
 *   convention in observations may evolve.
 */

import type { ManagerContext } from '../core/ManagerContext.js';
import type { MemoryEngine } from '../agent/MemoryEngine.js';
import type { AgentEntity } from '../types/agent-memory.js';

/** Subset of LangChain's `BaseMessage` we need on output. */
export interface ChatMessage {
  /** `'user'` / `'assistant'` / `'system'`. */
  role: string;
  /** Plain-text content. */
  content: string;
}

/** Input shape for `saveContext` — mirrors LangChain's call site. */
export interface MemoryInputs {
  /** The user's input keyed by configurable name (default: `'input'`). */
  [key: string]: unknown;
}

/** Output shape for `loadMemoryVariables` — mirrors LangChain's contract. */
export interface MemoryVariables {
  [key: string]: ChatMessage[] | string;
}

/** Adapter options. */
export interface LangChainMemoryAdapterOptions {
  /** Session id under which turns are persisted. Default: `'langchain'`. */
  sessionId?: string;
  /** Key the user's input is read from. Default: `'input'`. */
  inputKey?: string;
  /** Key the assistant output is written under. Default: `'output'`. */
  outputKey?: string;
  /** Memory variable key returned to LangChain. Default: `'history'`. */
  memoryKey?: string;
  /** Return history as a single string instead of `ChatMessage[]`. Default: `false`. */
  returnString?: boolean;
  /** Cap on how many recent turns to surface. Default: `20`. */
  maxTurns?: number;
}

/**
 * Bridge from LangChain's chat-memory protocol to the MemoryJS
 * `MemoryEngine`. Each `saveContext` call appends a user turn and an
 * assistant turn (in that order) to the session; `loadMemoryVariables`
 * surfaces the most recent turns as `ChatMessage[]` or a joined
 * string, matching LangChain's `returnMessages` switch.
 *
 * Use the adapter as if it were a `BaseChatMemory`:
 *
 * ```typescript
 * const adapter = new LangChainMemoryAdapter(ctx, { sessionId: 'chat-42' });
 * await adapter.saveContext({ input: 'hello' }, { output: 'hi there' });
 * const { history } = await adapter.loadMemoryVariables({});
 * ```
 *
 * For full LangChain integration, callers can subclass
 * `BaseChatMemory` and forward the methods to this adapter — keeps
 * the adapter and the `langchain` package decoupled.
 */
export class LangChainMemoryAdapter {
  private readonly engine: MemoryEngine;
  private readonly sessionId: string;
  private readonly inputKey: string;
  private readonly outputKey: string;
  private readonly memoryKey: string;
  private readonly returnString: boolean;
  private readonly maxTurns: number;

  constructor(ctx: ManagerContext, options: LangChainMemoryAdapterOptions = {}) {
    this.engine = ctx.memoryEngine;
    this.sessionId = options.sessionId ?? 'langchain';
    this.inputKey = options.inputKey ?? 'input';
    this.outputKey = options.outputKey ?? 'output';
    this.memoryKey = options.memoryKey ?? 'history';
    this.returnString = options.returnString ?? false;
    this.maxTurns = options.maxTurns ?? 20;
  }

  /** Memory variable keys this adapter writes back into LangChain's chain. */
  get memoryKeys(): string[] {
    return [this.memoryKey];
  }

  /**
   * Read the most recent turns for the configured session. Returns
   * `{ [memoryKey]: ChatMessage[] | string }` based on the
   * `returnString` flag — matches LangChain's `returnMessages`
   * behaviour.
   */
  async loadMemoryVariables(_values: Record<string, unknown> = {}): Promise<MemoryVariables> {
    const turns = await this.engine.getSessionTurns(this.sessionId, { limit: this.maxTurns });
    // Defensive re-sort: `MemoryEngine.getSessionTurns` is documented
    // chronological, but explicitly sorting here protects against
    // future changes to the engine's internal ordering.
    const sorted = [...turns].sort((a, b) => {
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aT - bT;
    });
    const messages: ChatMessage[] = sorted.map((t) => extractRoleAndContent(t));
    if (this.returnString) {
      const joined = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
      return { [this.memoryKey]: joined };
    }
    return { [this.memoryKey]: messages };
  }

  /**
   * Save a single (user input, assistant output) pair. LangChain's
   * `BaseChatMemory.saveContext` calls this once per turn pair.
   */
  async saveContext(
    inputs: MemoryInputs,
    outputs: Record<string, unknown>,
  ): Promise<void> {
    const userText = stringifyValue(inputs[this.inputKey]);
    const assistantText = stringifyValue(outputs[this.outputKey]);
    if (userText) {
      await this.engine.addTurn(userText, { sessionId: this.sessionId, role: 'user' });
    }
    if (assistantText) {
      await this.engine.addTurn(assistantText, {
        sessionId: this.sessionId,
        role: 'assistant',
      });
    }
  }

  /**
   * Drop every turn for the configured session — matches LangChain's
   * `BaseChatMemory.clear()`.
   */
  async clear(): Promise<void> {
    await this.engine.deleteSession(this.sessionId);
  }
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * Pull `role` and `content` out of an `AgentEntity` turn. The
 * `MemoryEngine.addTurn` path encodes the role inline as
 * `[role=user]` / `[role=assistant]` at the head of the first
 * observation; we strip that prefix when present and return the
 * canonical message shape.
 */
function extractRoleAndContent(entity: AgentEntity): ChatMessage {
  const first = entity.observations[0] ?? '';
  const match = first.match(/^\[role=(user|assistant|system)\]\s*(.*)$/s);
  if (match) {
    return { role: match[1]!, content: match[2] ?? '' };
  }
  // Fallback: an entity without the `[role=...]` prefix is foreign
  // to the MemoryEngine encoding. Label it `'unknown'` so downstream
  // prompt-building code can decide how to handle it — silently
  // relabelling foreign turns as `user` would distort prompts.
  return { role: 'unknown', content: first };
}
