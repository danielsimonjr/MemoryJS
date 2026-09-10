/**
 * Appendix F behavioral fixtures + per-step observation budget (plan 7.3).
 */

import { describe, it, expect } from 'vitest';
import { ProceduralGraph } from '../../../../../src/agent/procedural/graph/ProceduralGraph.js';
import {
  ProceduralGraphSession,
  type PGSessionOptions,
} from '../../../../../src/agent/procedural/graph/ProceduralGraphSession.js';
import type { PGSnapshot } from '../../../../../src/types/proceduralGraph.js';
import {
  BFCL_BOOKING_CONDITION,
  BFCL_QUOTE_ONLY_SNAPSHOT,
  BFCL_QUOTE_ONLY_TOOLS,
  BFCL_STOP_UNLESS_REQUESTED_GUIDANCE,
  MULTICHALLENGE_F2_PITFALLS,
  MULTICHALLENGE_F2_SNAPSHOT,
  MULTICHALLENGE_F2_TOOLS,
} from './fixtures/appendixF.js';

function openAttributesSession(
  snapshot: PGSnapshot,
  tools: readonly string[],
  overrides: Partial<PGSessionOptions> = {},
): ProceduralGraphSession {
  return new ProceduralGraphSession(
    ProceduralGraph.fromSnapshot(snapshot),
    {
      taskDescription: 'appendix-f fixture',
      toolCatalog: [...tools],
      paperCompatible: true,
      guidanceMode: 'attributes-only',
      ...overrides,
    },
  );
}

describe('Appendix F behavioral fixtures', () => {
  it('attributes-only guidance after get_flight_cost includes the stop-unless-requested guidance and the booking condition', async () => {
    const session = openAttributesSession(BFCL_QUOTE_ONLY_SNAPSHOT, BFCL_QUOTE_ONLY_TOOLS);
    session.recordStep({ action: 'get_flight_cost' });
    const result = await session.guidance('how much is the flight?');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.mode).toBe('attributes-only');
      expect(result.localization.nodeId).toBe('get_flight_cost');
      expect(result.localization.usedFullGraph).toBe(false);
      expect(result.guidance).toContain(BFCL_STOP_UNLESS_REQUESTED_GUIDANCE);
      expect(result.guidance).toContain(BFCL_BOOKING_CONDITION);
      expect(result.guidance).toContain('[get_flight_cost] → [Finish]');
      expect(result.guidance).toContain('[get_flight_cost] → [book_flight]');
    }
  });

  it('attributes-only guidance from AnalyzeTargetQuestion includes the verbatim pitfalls line', async () => {
    const session = openAttributesSession(MULTICHALLENGE_F2_SNAPSHOT, MULTICHALLENGE_F2_TOOLS);
    session.recordStep({ action: 'AnalyzeTargetQuestion' });
    const result = await session.guidance('what should I say next?');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.mode).toBe('attributes-only');
      expect(result.localization.nodeId).toBe('AnalyzeTargetQuestion');
      expect(result.localization.usedFullGraph).toBe(false);
      expect(result.guidance).toContain(MULTICHALLENGE_F2_PITFALLS);
      expect(MULTICHALLENGE_F2_PITFALLS).toBe(
        'Do NOT write a meta-evaluation or answer the target question directly.',
      );
    }
  });

  it('per-step observation over maxObservationChars is truncated with a marker in the trace, not silently', () => {
    const maxObservationChars = 32;
    const observation = `quoted-price=${'9'.repeat(80)}`;
    const session = openAttributesSession(BFCL_QUOTE_ONLY_SNAPSHOT, BFCL_QUOTE_ONLY_TOOLS, {
      maxObservationChars,
    });
    session.recordStep({ action: 'get_flight_cost', observation });

    const stored = session.trace[0]?.observation;
    expect(stored).toBeDefined();
    expect(stored).not.toBeUndefined();
    expect(stored).not.toBe(observation);
    expect(stored).not.toBe('');
    expect(stored).toContain('…[truncated]');
    expect(stored!.length).toBeLessThanOrEqual(maxObservationChars);
    expect(stored!.startsWith(observation.slice(0, 8))).toBe(true);
    expect(session.trace).toHaveLength(1);
    expect(session.toTrajectory('t', 1).steps[0]?.observation).toBe(stored);

    session.recordStep({ action: 'book_flight', observation: 'ok' });
    expect(session.trace[1]?.observation).toBe('ok');
  });
});
