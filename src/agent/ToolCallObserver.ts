/**
 * ToolCallObserver — Phase Tool B producer pipeline.
 *
 * The canonical caller for `ToolAffordanceManager`. External systems
 * (MCP server, agent wrapper, custom runtime) call
 * `observeStart(toolName)` before running a tool and
 * `observeComplete` / `observeError` / `observePartial` after. The
 * observer computes `durationMs`, threads through to the manager, and
 * emits events for any external telemetry subscribers.
 *
 * @module agent/ToolCallObserver
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { RecordOutcomeInput, ToolAffordanceManager } from './ToolAffordanceManager.js';
import type { InteractionLog } from './harness/InteractionLog.js';

interface InFlightCall {
  toolName: string;
  startedAtMs: number;
  args?: Record<string, unknown>;
}

/**
 * Names of the events that `ToolCallObserver.events` emits.
 */
export type ToolCallEvent =
  | 'toolCall:start'
  | 'toolCall:complete'
  | 'toolCall:error'
  | 'toolCall:partial';

/**
 * Times tool calls and records their outcomes in `ToolAffordanceManager`.
 *
 * Call `observeStart` before a tool runs. Call one of the completion methods after the tool ends. The observer also emits an event for each step.
 */
export class ToolCallObserver {
  /** Public event emitter — subscribe for `toolCall:start|complete|error|partial`. */
  public readonly events = new EventEmitter();

  private readonly manager: ToolAffordanceManager;
  private readonly inFlight: Map<string, InFlightCall> = new Map();
  private interactionLog?: Pick<InteractionLog, 'append'>;
  private interactionSessionId = 'tool-call-observer';
  /**
   * Attach or detach (no argument) the InteractionLog that receives tool_call / tool_output
   * records. Off by default. Appends are fire-and-forget: they never delay `toolCall:*` events.
   *
   * @param log - Log to append to, or undefined to detach
   * @param sessionId - Session id written on each record (default `tool-call-observer`)
   */
  setInteractionLog(log?: Pick<InteractionLog, 'append'>, sessionId = 'tool-call-observer'): void {
    this.interactionLog = log;
    this.interactionSessionId = sessionId;
  }

  constructor(manager: ToolAffordanceManager) {
    this.manager = manager;
  }

  /**
   * Begin observing a tool call. Returns a call id the caller threads
   * through to one of `observeComplete` / `observeError` /
   * `observePartial` / `cancel`. Emits `toolCall:start`.
   */
  observeStart(toolName: string, args?: Record<string, unknown>): string {
    if (typeof toolName !== 'string' || toolName.trim().length === 0) {
      throw new Error(
        `ToolCallObserver.observeStart: toolName must be a non-empty string`,
      );
    }
    const callId = `call-${randomUUID()}`;
    const entry: InFlightCall = {
      toolName,
      startedAtMs: Date.now(),
      args,
    };
    this.inFlight.set(callId, entry);
    this.events.emit('toolCall:start', { callId, toolName, args });
    void this.recordInteraction('tool_call', toolName, { args });
    return callId;
  }

  /**
   * Record successful completion. No-op when `callId` is unknown
   * (defensive — callers may double-call or pass stale ids; we don't
   * pollute the affordance stats with phantom successes).
   */
  async observeComplete(callId: string, meta?: { result?: string }): Promise<void> {
    await this.finish(callId, 'toolCall:complete', () => ({
      outcome: { outcome: 'success' },
      eventFields: () => ({ result: meta?.result }),
    }));
  }

  /**
   * Record a failure. `error` may be an `Error` instance or a plain
   * string; the message is stored in `errorMessage` for the manager's
   * `commonFailureModes` ranking. No-op on unknown `callId`.
   */
  async observeError(callId: string, error: Error | string): Promise<void> {
    await this.finish(callId, 'toolCall:error', () => {
      const message = error instanceof Error ? error.message : String(error);
      return {
        outcome: { outcome: 'failure', errorMessage: message },
        eventFields: () => ({ errorMessage: message }),
      };
    });
  }

  /**
   * Record a partial outcome — the tool returned a usable but
   * incomplete result. `reason` is stored as the `errorMessage`
   * so it surfaces in `commonFailureModes`. No-op on unknown
   * `callId`.
   */
  async observePartial(callId: string, reason: string): Promise<void> {
    await this.finish(callId, 'toolCall:partial', () => ({
      outcome: { outcome: 'partial', errorMessage: reason },
      eventFields: () => ({ reason }),
    }));
  }

  /**
   * Close an in-flight call. Does nothing when `callId` is unknown, and
   * then `describe` does not run. Otherwise the steps run in this order:
   * remove the call, measure its duration, run `describe`, record the
   * outcome with the duration, run `eventFields`, emit `eventName`.
   *
   * @internal
   */
  private async finish(
    callId: string,
    eventName: string,
    describe: () => {
      outcome: Omit<RecordOutcomeInput, 'durationMs'>;
      eventFields: () => Record<string, unknown>;
    },
  ): Promise<void> {
    const entry = this.inFlight.get(callId);
    if (!entry) return;
    this.inFlight.delete(callId);
    const durationMs = Date.now() - entry.startedAtMs;
    const { outcome, eventFields } = describe();
    await this.manager.recordOutcome(entry.toolName, { ...outcome, durationMs });
    const fields = eventFields();
    void this.recordInteraction('tool_output', entry.toolName, { outcome: outcome.outcome, durationMs, errorMessage: outcome.errorMessage, result: fields.result });
    this.events.emit(eventName, {
      callId,
      toolName: entry.toolName,
      durationMs,
      ...fields,
    });
  }

  /** Append one interaction record. Never throws or rejects. @internal */
  private async recordInteraction(kind: 'tool_call' | 'tool_output', toolName: string, payload: unknown): Promise<void> {
    try {
      const content = JSON.stringify(payload, (_k, v: unknown) => (v instanceof Error ? String(v) : v)) ?? '';
      await this.interactionLog?.append({ sessionId: this.interactionSessionId, kind, tag: toolName, content });
    } catch { /* ignored */ }
  }

  /**
   * Drop an in-flight observation without recording — e.g. the user
   * cancelled the tool call before it completed. No-op on unknown
   * `callId`.
   */
  cancel(callId: string): void {
    this.inFlight.delete(callId);
  }

  /** Number of in-flight (started but not yet completed) calls. */
  inFlightCount(): number {
    return this.inFlight.size;
  }
}
