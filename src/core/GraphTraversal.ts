/**
 * Graph Traversal
 *
 * Phase 4 Sprints 6-8: Graph traversal algorithms for knowledge graph analysis.
 * Includes BFS, DFS, shortest path, all paths, connected components, and centrality.
 *
 * @module core/GraphTraversal
 */

import type {
  Entity,
  Relation,
  TraversalOptions,
  TraversalResult,
  PathResult,
  ConnectedComponentsResult,
  CentralityResult,
} from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import { checkCancellation } from '../utils/index.js';

/**
 * Phase 4 Sprint 6: Default traversal options.
 */
const DEFAULT_OPTIONS: Required<TraversalOptions> = {
  direction: 'both',
  maxDepth: Infinity,
  relationTypes: [],
  entityTypes: [],
};

/**
 * Graph traversal algorithms for knowledge graph analysis.
 *
 * Provides BFS, DFS, shortest path finding, connected component detection,
 * and centrality metrics for analyzing graph structure.
 */
export class GraphTraversal {
  constructor(private storage: GraphStorage) {}

  // ==================== Sprint 6: BFS and DFS Traversal ====================

  /**
   * Get neighbors of a node based on traversal direction and filters.
   *
   * @param entityName - Entity to get neighbors for
   * @param options - Traversal options
   * @returns Array of neighbor entity names with their relations
   */
  getNeighborsWithRelations(
    entityName: string,
    options: TraversalOptions = {}
  ): Array<{ neighbor: string; relation: Relation }> {
    // Filter out undefined values before merging with defaults
    const definedOptions = Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined)
    );
    const opts = { ...DEFAULT_OPTIONS, ...definedOptions };
    const neighbors: Array<{ neighbor: string; relation: Relation }> = [];

    // Get relations based on direction
    let relations: Relation[] = [];
    if (opts.direction === 'outgoing' || opts.direction === 'both') {
      relations = relations.concat(this.storage.getRelationsFrom(entityName));
    }
    if (opts.direction === 'incoming' || opts.direction === 'both') {
      relations = relations.concat(this.storage.getRelationsTo(entityName));
    }

    // Filter by relation types if specified
    if (opts.relationTypes && opts.relationTypes.length > 0) {
      const typeSet = new Set(opts.relationTypes.map(t => t.toLowerCase()));
      relations = relations.filter(r => typeSet.has(r.relationType.toLowerCase()));
    }

    // Process relations to get neighbors
    for (const relation of relations) {
      const neighbor = relation.from === entityName ? relation.to : relation.from;

      // Skip self-loops
      if (neighbor === entityName) continue;

      // Filter by entity types if specified
      if (opts.entityTypes && opts.entityTypes.length > 0) {
        const entity = this.storage.getEntityByName(neighbor);
        if (!entity) continue;
        const typeSet = new Set(opts.entityTypes.map(t => t.toLowerCase()));
        if (!typeSet.has(entity.entityType.toLowerCase())) continue;
      }

      neighbors.push({ neighbor, relation });
    }

    return neighbors;
  }

  /**
   * Breadth-First Search traversal starting from a given entity.
   *
   * @param startEntity - Entity name to start traversal from
   * @param options - Traversal options
   * @returns Traversal result with visited nodes, depths, and parent pointers
   */
  bfs(startEntity: string, options: TraversalOptions = {}): TraversalResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate start entity exists
    if (!this.storage.hasEntity(startEntity)) {
      return { nodes: [], depths: new Map(), parents: new Map() };
    }

    const visited = new Set<string>();
    const queue: Array<{ node: string; depth: number }> = [{ node: startEntity, depth: 0 }];
    const nodes: string[] = [];
    const depths = new Map<string, number>();
    const parents = new Map<string, string | null>();

    visited.add(startEntity);
    parents.set(startEntity, null);

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;

      // Respect maxDepth limit
      if (depth > opts.maxDepth) continue;

      nodes.push(node);
      depths.set(node, depth);

      // Get neighbors and add unvisited ones to queue
      const neighbors = this.getNeighborsWithRelations(node, opts);
      for (const { neighbor } of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ node: neighbor, depth: depth + 1 });
          parents.set(neighbor, node);
        }
      }
    }

    return { nodes, depths, parents };
  }

  /**
   * Depth-First Search traversal starting from a given entity.
   *
   * @param startEntity - Entity name to start traversal from
   * @param options - Traversal options
   * @returns Traversal result with visited nodes, depths, and parent pointers
   */
  dfs(startEntity: string, options: TraversalOptions = {}): TraversalResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate start entity exists
    if (!this.storage.hasEntity(startEntity)) {
      return { nodes: [], depths: new Map(), parents: new Map() };
    }

    const visited = new Set<string>();
    const stack: Array<{ node: string; depth: number }> = [{ node: startEntity, depth: 0 }];
    const nodes: string[] = [];
    const depths = new Map<string, number>();
    const parents = new Map<string, string | null>();

    parents.set(startEntity, null);

    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;

      // Skip if already visited
      if (visited.has(node)) continue;

      // Respect maxDepth limit
      if (depth > opts.maxDepth) continue;

      visited.add(node);
      nodes.push(node);
      depths.set(node, depth);

      // Get neighbors and add unvisited ones to stack
      const neighbors = this.getNeighborsWithRelations(node, opts);
      for (const { neighbor } of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push({ node: neighbor, depth: depth + 1 });
          if (!parents.has(neighbor)) {
            parents.set(neighbor, node);
          }
        }
      }
    }

    return { nodes, depths, parents };
  }

  // ==================== Sprint 7: Path Finding Algorithms ====================

  /**
   * Find the shortest path between two entities using BFS.
   *
   * @param source - Source entity name
   * @param target - Target entity name
   * @param options - Traversal options
   * @returns PathResult if path exists, null otherwise
   */
  async findShortestPath(
    source: string,
    target: string,
    options: TraversalOptions = {}
  ): Promise<PathResult | null> {
    // Ensure graph is loaded to populate indexes
    await this.storage.loadGraph();

    // Validate entities exist
    if (!this.storage.hasEntity(source) || !this.storage.hasEntity(target)) {
      return null;
    }

    // Same source and target
    if (source === target) {
      return { path: [source], length: 0, relations: [] };
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const visited = new Set<string>();
    const queue: string[] = [source];
    const parents = new Map<string, { parent: string; relation: Relation } | null>();

    visited.add(source);
    parents.set(source, null);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Found target, reconstruct path
      if (current === target) {
        return this.reconstructPath(source, target, parents);
      }

      // Get neighbors
      const neighbors = this.getNeighborsWithRelations(current, opts);
      for (const { neighbor, relation } of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
          parents.set(neighbor, { parent: current, relation });
        }
      }
    }

    // No path found
    return null;
  }

  /**
   * Reconstruct path from parent pointers.
   */
  private reconstructPath(
    _source: string,
    target: string,
    parents: Map<string, { parent: string; relation: Relation } | null>
  ): PathResult {
    const path: string[] = [];
    const relations: Relation[] = [];
    let current: string | null = target;

    while (current !== null) {
      path.unshift(current);
      const parentInfo = parents.get(current);
      if (parentInfo) {
        relations.unshift(parentInfo.relation);
        current = parentInfo.parent;
      } else {
        current = null;
      }
    }

    return {
      path,
      length: path.length - 1,
      relations,
    };
  }

  /**
   * Find all paths between two entities up to a maximum depth.
   *
   * Phase 9B: Supports cancellation via AbortSignal in options.
   *
   * @param source - Source entity name
   * @param target - Target entity name
   * @param maxDepth - Maximum path length (default: 5)
   * @param options - Traversal options (includes signal for cancellation)
   * @returns Array of PathResult objects for all found paths
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   */
  async findAllPaths(
    source: string,
    target: string,
    maxDepth: number = 5,
    options: TraversalOptions & { signal?: AbortSignal } = {}
  ): Promise<PathResult[]> {
    // Check for early cancellation
    const { signal, ...traversalOptions } = options;
    checkCancellation(signal, 'findAllPaths');

    // Ensure graph is loaded to populate indexes
    await this.storage.loadGraph();

    // Check for cancellation after load
    checkCancellation(signal, 'findAllPaths');

    // Validate entities exist
    if (!this.storage.hasEntity(source) || !this.storage.hasEntity(target)) {
      return [];
    }

    const opts = { ...DEFAULT_OPTIONS, ...traversalOptions };
    const allPaths: PathResult[] = [];
    const currentPath: string[] = [source];
    const currentRelations: Relation[] = [];
    const visited = new Set<string>([source]);

    // Track iterations for periodic cancellation checks
    let iterationCount = 0;
    const CANCELLATION_CHECK_INTERVAL = 100;

    const dfsAllPaths = (current: string, depth: number) => {
      // Periodic cancellation check
      iterationCount++;
      if (iterationCount % CANCELLATION_CHECK_INTERVAL === 0) {
        checkCancellation(signal, 'findAllPaths');
      }

      if (depth > maxDepth) return;

      if (current === target && depth > 0) {
        allPaths.push({
          path: [...currentPath],
          length: currentPath.length - 1,
          relations: [...currentRelations],
        });
        return;
      }

      const neighbors = this.getNeighborsWithRelations(current, opts);
      for (const { neighbor, relation } of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          currentPath.push(neighbor);
          currentRelations.push(relation);

          dfsAllPaths(neighbor, depth + 1);

          currentPath.pop();
          currentRelations.pop();
          visited.delete(neighbor);
        }
      }
    };

    dfsAllPaths(source, 0);
    return allPaths;
  }

  // ==================== Sprint 8: Connected Components ====================

  /**
   * Find all connected components in the graph.
   *
   * Uses BFS to find all weakly connected components (treating the graph as undirected).
   *
   * @returns ConnectedComponentsResult with all components
   */
  async findConnectedComponents(): Promise<ConnectedComponentsResult> {
    const graph = await this.storage.loadGraph();
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const entity of graph.entities) {
      if (!visited.has(entity.name)) {
        // BFS to find all nodes in this component
        const component: string[] = [];
        const queue: string[] = [entity.name];
        visited.add(entity.name);

        while (queue.length > 0) {
          const current = queue.shift()!;
          component.push(current);

          // Get all neighbors (both directions for weakly connected)
          const neighbors = this.getNeighborsWithRelations(current, { direction: 'both' });
          for (const { neighbor } of neighbors) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        components.push(component);
      }
    }

    // Sort components by size (largest first)
    components.sort((a, b) => b.length - a.length);

    return {
      components,
      count: components.length,
      largestComponentSize: components.length > 0 ? components[0].length : 0,
    };
  }

  // ==================== Sprint 8: Centrality Algorithms ====================

  /**
   * Calculate degree centrality for all entities.
   *
   * Degree centrality is the number of connections an entity has,
   * normalized by the maximum possible connections.
   *
   * @param direction - Direction to count: 'in', 'out', or 'both' (default)
   * @param topN - Number of top entities to return (default: 10)
   * @returns CentralityResult with scores and top entities
   */
  async calculateDegreeCentrality(
    direction: 'in' | 'out' | 'both' = 'both',
    topN: number = 10
  ): Promise<CentralityResult> {
    const graph = await this.storage.loadGraph();
    const scores = new Map<string, number>();
    const n = graph.entities.length;

    // Calculate degree for each entity
    for (const entity of graph.entities) {
      let degree = 0;

      if (direction === 'in' || direction === 'both') {
        degree += this.storage.getRelationsTo(entity.name).length;
      }
      if (direction === 'out' || direction === 'both') {
        degree += this.storage.getRelationsFrom(entity.name).length;
      }

      // Normalize by maximum possible degree
      const normalizedDegree = n > 1 ? degree / (n - 1) : 0;
      scores.set(entity.name, normalizedDegree);
    }

    // Get top N entities
    const topEntities = this.getTopEntities(scores, topN);

    return {
      scores,
      topEntities,
      algorithm: 'degree',
    };
  }

  /**
   * Calculate betweenness centrality for all entities.
   *
   * Betweenness centrality measures how often a node appears on shortest paths
   * between other nodes. Uses Brandes' algorithm for efficiency.
   *
   * @param options - Configuration options
   * @param options.topN - Number of top entities to return (default: 10)
   * @param options.chunkSize - Yield control every N vertices (default: 50)
   * @param options.onProgress - Progress callback (0.0 to 1.0)
   * @param options.approximate - Use approximation for faster results (default: false)
   * @param options.sampleRate - Sample rate for approximation (default: 0.2)
   * @returns CentralityResult with scores and top entities
   */
  async calculateBetweennessCentrality(
    options: {
      topN?: number;
      chunkSize?: number;
      onProgress?: (progress: number) => void;
      approximate?: boolean;
      sampleRate?: number;
    } = {}
  ): Promise<CentralityResult> {
    const { topN = 10, chunkSize = 50, onProgress, approximate = false, sampleRate = 0.2 } = options;
    const graph = await this.storage.loadGraph();
    const scores = new Map<string, number>();

    // Initialize scores
    for (const entity of graph.entities) {
      scores.set(entity.name, 0);
    }

    // Determine which sources to process (full or sampled)
    let sourcesToProcess = graph.entities;
    if (approximate && graph.entities.length > 100) {
      const sampleSize = Math.max(10, Math.floor(graph.entities.length * sampleRate));
      sourcesToProcess = this.sampleEntities(graph.entities, sampleSize);
    }

    // Brandes' algorithm with chunked processing
    let processed = 0;
    for (const source of sourcesToProcess) {
      const stack: string[] = [];
      const predecessors = new Map<string, string[]>();
      const sigma = new Map<string, number>(); // Number of shortest paths
      const distance = new Map<string, number>(); // Distance from source
      const delta = new Map<string, number>(); // Dependency

      // Initialize
      for (const entity of graph.entities) {
        predecessors.set(entity.name, []);
        sigma.set(entity.name, 0);
        distance.set(entity.name, -1);
        delta.set(entity.name, 0);
      }

      sigma.set(source.name, 1);
      distance.set(source.name, 0);

      // BFS
      const queue: string[] = [source.name];
      while (queue.length > 0) {
        const v = queue.shift()!;
        stack.push(v);

        const neighbors = this.getNeighborsWithRelations(v, { direction: 'both' });
        for (const { neighbor: w } of neighbors) {
          // First time w is discovered
          if (distance.get(w) === -1) {
            distance.set(w, distance.get(v)! + 1);
            queue.push(w);
          }

          // w is on a shortest path from source via v
          if (distance.get(w) === distance.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!);
            predecessors.get(w)!.push(v);
          }
        }
      }

      // Accumulation
      while (stack.length > 0) {
        const w = stack.pop()!;
        for (const v of predecessors.get(w)!) {
          const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
          delta.set(v, delta.get(v)! + contribution);
        }
        if (w !== source.name) {
          scores.set(w, scores.get(w)! + delta.get(w)!);
        }
      }

      // Yield control periodically to prevent blocking event loop
      processed++;
      if (processed % chunkSize === 0) {
        // Yield control to allow event loop to process other events
        await new Promise(resolve => setImmediate(resolve));

        // Report progress
        if (onProgress) {
          onProgress(processed / sourcesToProcess.length);
        }
      }
    }

    // Final progress update
    if (onProgress) {
      onProgress(1);
    }

    // Scale scores if using approximation
    if (approximate && sampleRate < 1.0) {
      const scaleFactor = 1 / sampleRate;
      for (const [entity, score] of scores) {
        scores.set(entity, score * scaleFactor);
      }
    }

    // Normalize scores
    const n = graph.entities.length;
    const normalization = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
    for (const [name, score] of scores) {
      scores.set(name, score * normalization);
    }

    const topEntities = this.getTopEntities(scores, topN);

    return {
      scores,
      topEntities,
      algorithm: 'betweenness',
    };
  }

  /**
   * Sample entities randomly for approximation algorithms.
   *
   * @param entities - Array of entities to sample from
   * @param sampleSize - Number of entities to sample
   * @returns Array of sampled entities
   */
  private sampleEntities(entities: readonly Entity[], sampleSize: number): Entity[] {
    const shuffled = [...entities];
    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, sampleSize);
  }

  /**
   * Calculate PageRank centrality for all entities.
   *
   * PageRank measures importance based on incoming connections from
   * other important nodes. Uses iterative power method.
   *
   * @param dampingFactor - Damping factor (default: 0.85)
   * @param maxIterations - Maximum iterations (default: 100)
   * @param tolerance - Convergence tolerance (default: 1e-6)
   * @param topN - Number of top entities to return (default: 10)
   * @returns CentralityResult with scores and top entities
   */
  async calculatePageRank(
    dampingFactor: number = 0.85,
    maxIterations: number = 100,
    tolerance: number = 1e-6,
    topN: number = 10
  ): Promise<CentralityResult> {
    const graph = await this.storage.loadGraph();
    const n = graph.entities.length;

    if (n === 0) {
      return { scores: new Map(), topEntities: [], algorithm: 'pagerank' };
    }

    // Initialize PageRank scores
    const scores = new Map<string, number>();
    const initialScore = 1 / n;
    for (const entity of graph.entities) {
      scores.set(entity.name, initialScore);
    }

    // Build outgoing links map
    const outLinks = new Map<string, string[]>();
    for (const entity of graph.entities) {
      const outgoing = this.storage.getRelationsFrom(entity.name);
      outLinks.set(entity.name, outgoing.map(r => r.to));
    }

    // Power iteration
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const newScores = new Map<string, number>();
      let totalDiff = 0;

      // Calculate dangling node contribution (nodes with no outgoing links)
      let danglingSum = 0;
      for (const entity of graph.entities) {
        if (outLinks.get(entity.name)!.length === 0) {
          danglingSum += scores.get(entity.name)!;
        }
      }
      const danglingContribution = (dampingFactor * danglingSum) / n;

      // Calculate new scores
      for (const entity of graph.entities) {
        let incomingScore = 0;
        const incoming = this.storage.getRelationsTo(entity.name);

        for (const relation of incoming) {
          const source = relation.from;
          const sourceOutCount = outLinks.get(source)?.length || 1;
          incomingScore += scores.get(source)! / sourceOutCount;
        }

        const newScore =
          (1 - dampingFactor) / n + dampingFactor * incomingScore + danglingContribution;

        newScores.set(entity.name, newScore);
        totalDiff += Math.abs(newScore - scores.get(entity.name)!);
      }

      // Update scores
      for (const [name, score] of newScores) {
        scores.set(name, score);
      }

      // Check convergence
      if (totalDiff < tolerance) {
        break;
      }
    }

    const topEntities = this.getTopEntities(scores, topN);

    return {
      scores,
      topEntities,
      algorithm: 'pagerank',
    };
  }

  /**
   * Get top N entities from a scores map.
   */
  private getTopEntities(
    scores: Map<string, number>,
    topN: number
  ): Array<{ name: string; score: number }> {
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([name, score]) => ({ name, score }));
  }
}
