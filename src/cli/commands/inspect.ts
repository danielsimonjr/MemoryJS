/**
 * Inspection CLI commands.
 *
 *   memory show <entity>      verbose snapshot of one entity (observations,
 *                             relations in/out, tags, hierarchy, importance,
 *                             timestamps)
 *   memory tree [root]        ASCII hierarchy tree; with `--json`, structured
 *                             nested form
 *   memory neighbors <entity> incoming + outgoing relations of one entity
 *   memory size               graph size + storage footprint summary
 *
 * Designed to make "what does the graph actually look like" answerable in
 * a single command instead of stringing several together.
 *
 * @module cli/commands/inspect
 */

import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { ManagerContext } from '../../core/ManagerContext.js';
import type { Relation, ReadonlyKnowledgeGraph } from '../../types/types.js';
import { getOptions, createContext, createLogger } from './helpers.js';
import { formatError } from '../formatters.js';

interface EntitySnapshot {
  name: string;
  entityType: string;
  observations: string[];
  tags?: string[];
  importance?: number;
  createdAt?: string;
  lastModified?: string;
  parentId?: string;
  children: string[];
  ancestors: string[];
  relations: {
    outgoing: Array<{ to: string; type: string }>;
    incoming: Array<{ from: string; type: string }>;
  };
}

async function snapshotEntity(ctx: ManagerContext, name: string): Promise<EntitySnapshot> {
  // `getEntityByName` reads the in-memory nameIndex which is only hydrated by
  // `loadGraph()`. Call loadGraph first so the lookup hits a populated cache.
  const graph = await ctx.storage.loadGraph();
  const entity = ctx.storage.getEntityByName(name);
  if (!entity) throw new Error(`entity not found: ${name}`);

  const observations = await ctx.observationManager.getObservationsFor(name);

  const outgoing = graph.relations
    .filter((r: Relation) => r.from === name)
    .map((r) => ({ to: r.to, type: r.relationType }));
  const incoming = graph.relations
    .filter((r: Relation) => r.to === name)
    .map((r) => ({ from: r.from, type: r.relationType }));

  const children = (await ctx.hierarchyManager.getChildren(name)).map((c) => c.name);
  const ancestors = (await ctx.hierarchyManager.getAncestors(name)).map((a) => a.name);

  return {
    name: entity.name,
    entityType: entity.entityType,
    observations,
    tags: entity.tags,
    importance: entity.importance,
    createdAt: entity.createdAt,
    lastModified: entity.lastModified,
    parentId: entity.parentId,
    children,
    ancestors,
    relations: { outgoing, incoming },
  };
}

interface TreeNode {
  name: string;
  entityType: string;
  children: TreeNode[];
}

async function buildTree(ctx: ManagerContext, root: string): Promise<TreeNode> {
  // Hydrate nameIndex before looking up the root.
  await ctx.storage.loadGraph();
  const rootEntity = ctx.storage.getEntityByName(root);
  if (!rootEntity) throw new Error(`entity not found: ${root}`);

  async function walk(name: string): Promise<TreeNode> {
    const entity = ctx.storage.getEntityByName(name);
    const children = await ctx.hierarchyManager.getChildren(name);
    const childNodes: TreeNode[] = [];
    for (const c of children) {
      childNodes.push(await walk(c.name));
    }
    return {
      name,
      entityType: entity?.entityType ?? 'unknown',
      children: childNodes,
    };
  }

  return walk(root);
}

function renderTreeAscii(node: TreeNode, prefix = '', isRoot = true, isLast = true): string {
  // Root prints with no connector; descendants get ├── / └── markers.
  const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
  let out = `${prefix}${connector}${node.name} (${node.entityType})\n`;
  // Children of the root start with no inherited prefix; deeper levels carry
  // the │ / spacer continuation from the parent's branch decision.
  const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
  for (let i = 0; i < node.children.length; i++) {
    out += renderTreeAscii(node.children[i], childPrefix, false, i === node.children.length - 1);
  }
  return out;
}

interface SizeReport {
  graph: {
    entities: number;
    relations: number;
    observations: number;
    distinctTags: number;
    avgObservationsPerEntity: number;
  };
  storage: {
    path: string;
    exists: boolean;
    sizeBytes: number;
    lineCount: number;
  };
}

async function buildSizeReport(ctx: ManagerContext, storagePath: string): Promise<SizeReport> {
  const graph = await ctx.storage.loadGraph();

  let observationCount = 0;
  const tagSet = new Set<string>();
  for (const e of graph.entities) {
    observationCount += e.observations.length;
    if (e.tags) for (const t of e.tags) tagSet.add(t);
  }

  let exists = false;
  let sizeBytes = 0;
  let lineCount = 0;
  try {
    const stat = await fs.stat(storagePath);
    exists = true;
    sizeBytes = stat.size;
    if (sizeBytes > 0) {
      // Line count via stream-friendly read; for very large files this is the
      // dominant cost. Capped read is fine for a CLI inspection command.
      const content = await fs.readFile(storagePath, 'utf8');
      lineCount = content.split('\n').filter((l) => l.length > 0).length;
    }
  } catch { /* file may not exist */ }

  return {
    graph: {
      entities: graph.entities.length,
      relations: graph.relations.length,
      observations: observationCount,
      distinctTags: tagSet.size,
      avgObservationsPerEntity: graph.entities.length === 0
        ? 0
        : Number((observationCount / graph.entities.length).toFixed(2)),
    },
    storage: {
      path: storagePath,
      exists,
      sizeBytes,
      lineCount,
    },
  };
}

interface NeighborReport {
  entity: string;
  outgoing: Array<{ to: string; type: string }>;
  incoming: Array<{ from: string; type: string }>;
  outDegree: number;
  inDegree: number;
}

async function neighbors(ctx: ManagerContext, name: string): Promise<NeighborReport> {
  const graph: ReadonlyKnowledgeGraph = await ctx.storage.loadGraph();
  const entity = ctx.storage.getEntityByName(name);
  if (!entity) throw new Error(`entity not found: ${name}`);
  const outgoing = graph.relations
    .filter((r) => r.from === name)
    .map((r) => ({ to: r.to, type: r.relationType }));
  const incoming = graph.relations
    .filter((r) => r.to === name)
    .map((r) => ({ from: r.from, type: r.relationType }));
  return {
    entity: name,
    outgoing,
    incoming,
    outDegree: outgoing.length,
    inDegree: incoming.length,
  };
}

export function registerInspectCommands(program: Command): void {
  program
    .command('show <entity>')
    .description('Verbose snapshot of one entity (observations, relations in/out, tags, hierarchy, timestamps)')
    .action(async (entity: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const snap = await snapshotEntity(ctx, entity);
        console.log(JSON.stringify(snap, null, 2));
      } catch (e) {
        logger.error(formatError((e as Error).message));
        process.exit(1);
      }
    });

  program
    .command('tree [root]')
    .description('Hierarchy tree from a root entity (or all roots when omitted)')
    .option('--ascii', 'Render as ASCII tree instead of JSON (overrides --output-format)')
    .action(async (root: string | undefined, opts: { ascii?: boolean }) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        let trees: TreeNode[];
        if (root) {
          trees = [await buildTree(ctx, root)];
        } else {
          const roots = await ctx.hierarchyManager.getRootEntities();
          trees = await Promise.all(roots.map((r) => buildTree(ctx, r.name)));
        }
        if (opts.ascii) {
          for (const t of trees) {
            process.stdout.write(renderTreeAscii(t));
          }
        } else {
          console.log(JSON.stringify(trees, null, 2));
        }
      } catch (e) {
        logger.error(formatError((e as Error).message));
        process.exit(1);
      }
    });

  program
    .command('neighbors <entity>')
    .description('Incoming + outgoing relations of one entity (with in/out degree counts)')
    .action(async (entity: string) => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const report = await neighbors(ctx, entity);
        console.log(JSON.stringify(report, null, 2));
      } catch (e) {
        logger.error(formatError((e as Error).message));
        process.exit(1);
      }
    });

  program
    .command('size')
    .description('Graph size + storage footprint summary (entity/relation/observation counts, file bytes, line count)')
    .action(async () => {
      const options = getOptions(program);
      const logger = createLogger(options);
      const ctx = createContext(options);
      try {
        const report = await buildSizeReport(ctx, options.storage);
        console.log(JSON.stringify(report, null, 2));
      } catch (e) {
        logger.error(formatError((e as Error).message));
        process.exit(1);
      }
    });
}

// Re-export internals for the REPL bridge.
export { snapshotEntity, buildTree, renderTreeAscii, neighbors, buildSizeReport };
export type { EntitySnapshot, TreeNode, SizeReport, NeighborReport };
