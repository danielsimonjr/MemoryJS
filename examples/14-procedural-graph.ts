/**
 * 14 - Procedural graph: a self-describing execution graph with guidance per step.
 *
 * Run: bun run examples/14-procedural-graph.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext, type PGEdge, type PGNode } from '../src/index.js';

const nodes: PGNode[] = [
  { id: 'cart', type: 'STATE', description: 'Cart has items' },
  { id: 'pay', type: 'ACTION', description: 'Charge the card', actionName: 'pay' },
  { id: 'receipt', type: 'STATE', description: 'Receipt sent' },
];

const edges: PGEdge[] = [
  { source: 'cart', relation: 'LEADS_TO', target: 'pay', condition: null, guidance: 'Confirm the total first', pitfalls: 'Do not charge twice' },
  { source: 'pay', relation: 'LEADS_TO', target: 'receipt', condition: 'payment succeeded', guidance: null, pitfalls: null },
];

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  // The memory backing needs no files; a jsonl or sqlite backing persists beside storagePath.
  const ctx = new ManagerContext(storagePath);
  try {
    const graphs = await ctx.createProceduralGraph({ backing: { type: 'memory' } });
    const created = await graphs.createGraph({ graphId: 'checkout', nodes, edges, entryNodeId: 'cart' });

    // A session carries the task and the tool catalog; guidance is looked up per query.
    const session = await graphs.openSession('checkout', {
      taskDescription: 'Complete checkout',
      toolCatalog: ['pay'],
      guidanceMode: 'attributes-only',
    });
    const guidance = session ? await session.guidance('what next?') : undefined;
    const stats = await graphs.stats('checkout');

    return {
      created: created.ok,
      sessionOpened: session !== undefined,
      guidanceStatus: guidance?.status ?? null,
      nodeCount: stats?.nodeCount ?? 0,
      edgeCount: stats?.edgeCount ?? 0,
      headVersion: stats?.headVersion ?? 0,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-14-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
