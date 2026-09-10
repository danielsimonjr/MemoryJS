/**
 * CFO Generation D walk: Month_Start → recall_notes → check_cash_in_bank.
 */

import { describe, it, expect } from 'vitest';
import { ProceduralGraph } from '../../src/agent/procedural/graph/ProceduralGraph.js';
import { ProceduralGraphSession } from '../../src/agent/procedural/graph/ProceduralGraphSession.js';
import {
  CFO_GENERATION_D_SNAPSHOT,
  CFO_GENERATION_D_TOOLS,
} from '../unit/agent/procedural/graph/fixtures/cfo-generation-d.js';

describe('procedural graph guidance (CFO fixture)', () => {
  it('walks Month_Start → recall_notes → check_cash_in_bank and hop-2 includes save_note', async () => {
    const session = new ProceduralGraphSession(
      ProceduralGraph.fromSnapshot(CFO_GENERATION_D_SNAPSHOT),
      {
        taskDescription: 'CFO month-start capital decision',
        toolCatalog: [...CFO_GENERATION_D_TOOLS],
        paperCompatible: true,
        guidanceMode: 'attributes-only',
      },
    );

    session.recordStep({ action: 'Month_Start' });
    const monthStart = await session.guidance('begin month');
    expect(monthStart.status).toBe('ok');
    if (monthStart.status === 'ok') {
      expect(monthStart.localization.matched).toBe(true);
      expect(monthStart.localization.nodeId).toBe('Month_Start');
      expect(monthStart.localization.usedFullGraph).toBe(false);
    }

    session.recordStep({ action: 'recall_notes' });
    const recall = await session.guidance('recall prior notes');
    expect(recall.status).toBe('ok');
    if (recall.status === 'ok') {
      expect(recall.localization.matched).toBe(true);
      expect(recall.localization.nodeId).toBe('recall_notes');
      expect(recall.localization.usedFullGraph).toBe(false);
    }

    session.recordStep({ action: 'check_cash_in_bank' });
    const cash = await session.guidance('audit cash');
    expect(cash.status).toBe('ok');
    if (cash.status === 'ok') {
      expect(cash.localization.matched).toBe(true);
      expect(cash.localization.nodeId).toBe('check_cash_in_bank');
      expect(cash.localization.usedFullGraph).toBe(false);
      const hop2 = cash.localization.hops.find((group) => group.hop === 2);
      expect(hop2).toBeDefined();
      expect(hop2?.edges.some((edge) => edge.target === 'save_note')).toBe(true);
      expect(hop2?.edges.some((edge) => edge.source === 'cash_flow_forecast_calculation')).toBe(true);
    }
  });
});
