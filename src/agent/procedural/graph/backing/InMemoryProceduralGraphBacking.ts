/**
 * Ephemeral procedural-graph backing. Lost on process exit; skipped by the
 * reopen contract case.
 *
 * @module agent/procedural/graph/backing/InMemoryProceduralGraphBacking
 * @experimental
 */

import { LockedProceduralGraphBacking } from './LockedProceduralGraphBacking.js';
import { ProceduralGraphState } from './ProceduralGraphState.js';

export class InMemoryProceduralGraphBacking extends LockedProceduralGraphBacking {
  readonly kind = 'memory' as const;

  constructor() {
    super(new ProceduralGraphState());
  }

  protected override async afterWrite(): Promise<void> {
    // In-memory only; drop the delta so the pending buffer stays empty.
    this.state.drainPendingLines();
  }
}
