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
  AccessContext,
} from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import type { AccessTracker } from '../agent/AccessTracker.js';
import { checkCancellation } from '../utils/index.js';

/**
 * Extended traversal options with access tracking support.
 */
export interface TraversalOptionsWithTracking extends TraversalOptions {
  /** Enable access tracking for visited nodes */
  trackAccess?: boolean;
  /** Session ID for access context */
  sessionId?: string;
  /** Task ID for access context */
  taskId?: string;
}

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
  private accessTracker?: AccessTracker;

  constructor(private storage: GraphStorage) {}

  /**
   * Set the AccessTracker for optional access tracking.
   * When set, traversal methods can track access to visited entities.
   *
   * @param tracker - AccessTracker instance
   */
  setAccessTracker(tracker: AccessTracker): void {
    this.accessTracker = tracker;
  }

  /**
   * Track access for visited nodes during traversal.
   * @internal
   */
  private async trackTraversalAccess(
    nodes: string[],
    options: TraversalOptionsWithTracking
  ): Promise<void> {
    if (!this.accessTracker || nodes.length === 0) return;

    const context: AccessContext = {
      sessionId: options.sessionId,
      taskId: options.taskId,
      retrievalMethod: 'traversal',
    };

    // Batch record all visited nodes
    await Promise.all(
      nodes.map((name) => this.accessTracker!.recordAccess(name, context))
    );
  }

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
   * @param options - Traversal options (including optional access tracking)
   * @returns PathResult if path exists, null otherwise
   */
  async findShortestPath(
    source: string,
    target: string,
    options: TraversalOptionsWithTracking = {}
  ): Promise<PathResult | null> {
    // Ensure graph is loaded to populate indexes
    await this.storage.loadGraph();

    // Validate entities exist
    if (!this.storage.hasEntity(source) || !this.storage.hasEntity(target)) {
      return null;
    }

    // Same source and target
    if (source === target) {
      const result = { path: [source], length: 0, relations: [] };
      // Track access if enabled
      if (options.trackAccess && this.accessTracker) {
        await this.trackTraversalAccess(result.path, options);
      }
      return result;
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
        const result = this.reconstructPath(source, target, parents);
        // Track access if enabled
        if (options.trackAccess && this.accessTracker) {
          await this.trackTraversalAccess(result.path, options);
        }
        return result;
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
   * @param options - Traversal options (includes signal for cancellation and access tracking)
   * @returns Array of PathResult objects for all found paths
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   */
  async findAllPaths(
    source: string,
    target: string,
    maxDepth: number = 5,
    options: TraversalOptionsWithTracking & { signal?: AbortSignal } = {}
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

    // Track access if enabled - collect unique nodes from all paths
    if (options.trackAccess && this.accessTracker && allPaths.length > 0) {
      const uniqueNodes = new Set<string>();
      for (const pathResult of allPaths) {
        for (const node of pathResult.path) {
          uniqueNodes.add(node);
        }
      }
      await this.trackTraversalAccess(Array.from(uniqueNodes), options);
    }

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

    // Build outgoing and incoming links maps once. Pre-computing inLinks
    // (mirrors the pattern in calculateHITS) avoids an O(n) getRelationsTo()
    // call per entity on every power-iteration step.
    const outLinks = new Map<string, string[]>();
    const inLinks = new Map<string, string[]>();
    for (const entity of graph.entities) {
      const outgoing = this.storage.getRelationsFrom(entity.name);
      outLinks.set(entity.name, outgoing.map(r => r.to));
      inLinks.set(entity.name, this.storage.getRelationsTo(entity.name).map(r => r.from));
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
        const incoming = inLinks.get(entity.name)!;

        for (const source of incoming) {
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
   * Calculate HITS (Hyperlink-Induced Topic Search) hub and authority scores.
   *
   * Kleinberg's algorithm: a node has a high authority score when it is
   * pointed to by many high-hub nodes; it has a high hub score when it
   * points to many high-authority nodes. Reaches a fixed point via power
   * iteration with L2-norm normalisation each step.
   *
   * Useful for distinguishing "connector" entities (hubs) from "expert"
   * entities (authorities) — graphs where degree centrality conflates the
   * two will show different rankings between `hubs` and `authorities`.
   *
   * @param maxIter - Maximum iterations (default: 100)
   * @param tolerance - L2 convergence tolerance (default: 1e-6)
   * @param topN - Number of top entities to return per result (default: 10)
   * @returns `{ hubs, authorities, iterations, converged }`
   */
  async calculateHITS(
    maxIter: number = 100,
    tolerance: number = 1e-6,
    topN: number = 10,
  ): Promise<{
    hubs: CentralityResult;
    authorities: CentralityResult;
    iterations: number;
    converged: boolean;
  }> {
    const graph = await this.storage.loadGraph();
    const n = graph.entities.length;

    if (n === 0) {
      return {
        hubs: { scores: new Map(), topEntities: [], algorithm: 'hits-hubs' },
        authorities: { scores: new Map(), topEntities: [], algorithm: 'hits-authorities' },
        iterations: 0,
        converged: true,
      };
    }

    // Pre-compute incoming and outgoing neighbour lists once.
    const inNeighbours = new Map<string, string[]>();
    const outNeighbours = new Map<string, string[]>();
    for (const entity of graph.entities) {
      inNeighbours.set(entity.name, this.storage.getRelationsTo(entity.name).map(r => r.from));
      outNeighbours.set(entity.name, this.storage.getRelationsFrom(entity.name).map(r => r.to));
    }

    let hub = new Map<string, number>();
    let auth = new Map<string, number>();
    const initial = 1 / Math.sqrt(n);
    for (const entity of graph.entities) {
      hub.set(entity.name, initial);
      auth.set(entity.name, initial);
    }

    let converged = false;
    let iterations = 0;
    for (let iter = 0; iter < maxIter; iter++) {
      iterations = iter + 1;

      // Authority update: sum of hub scores of nodes pointing to this node.
      const newAuth = new Map<string, number>();
      let authNormSq = 0;
      for (const entity of graph.entities) {
        let score = 0;
        for (const src of inNeighbours.get(entity.name)!) {
          score += hub.get(src) ?? 0;
        }
        newAuth.set(entity.name, score);
        authNormSq += score * score;
      }

      // Hub update uses the *new* authority scores.
      const newHub = new Map<string, number>();
      let hubNormSq = 0;
      for (const entity of graph.entities) {
        let score = 0;
        for (const dst of outNeighbours.get(entity.name)!) {
          score += newAuth.get(dst) ?? 0;
        }
        newHub.set(entity.name, score);
        hubNormSq += score * score;
      }

      // Normalise both vectors to unit L2 norm.
      const authNorm = Math.sqrt(authNormSq) || 1;
      const hubNorm = Math.sqrt(hubNormSq) || 1;
      for (const entity of graph.entities) {
        newAuth.set(entity.name, newAuth.get(entity.name)! / authNorm);
        newHub.set(entity.name, newHub.get(entity.name)! / hubNorm);
      }

      // Convergence check (sum of absolute deltas across both vectors).
      let delta = 0;
      for (const entity of graph.entities) {
        delta += Math.abs(newHub.get(entity.name)! - hub.get(entity.name)!);
        delta += Math.abs(newAuth.get(entity.name)! - auth.get(entity.name)!);
      }

      hub = newHub;
      auth = newAuth;

      if (delta < tolerance) {
        converged = true;
        break;
      }
    }

    return {
      hubs: { scores: hub, topEntities: this.getTopEntities(hub, topN), algorithm: 'hits-hubs' },
      authorities: {
        scores: auth,
        topEntities: this.getTopEntities(auth, topN),
        algorithm: 'hits-authorities',
      },
      iterations,
      converged,
    };
  }

  /**
   * Find all maximal cliques in the (undirected projection of the) graph
   * via the Bron-Kerbosch algorithm with pivot selection.
   *
   * A clique is a set of entities where every pair is connected (the
   * undirected projection ignores edge direction — A→B or B→A both count).
   * "Maximal" means the set cannot be extended by adding another entity.
   *
   * @param options.minSize - Skip cliques smaller than this (default: 3)
   * @param options.maxCliques - Cap the result count (default: 1000)
   * @returns Array of cliques (each a sorted entity-name array), longest first
   */
  async findCliques(
    options: { minSize?: number; maxCliques?: number } = {},
  ): Promise<string[][]> {
    const minSize = options.minSize ?? 3;
    const maxCliques = options.maxCliques ?? 1000;

    const graph = await this.storage.loadGraph();
    if (graph.entities.length === 0) return [];

    // Build undirected adjacency: A neighbours B if there's any edge between them.
    const adj = new Map<string, Set<string>>();
    for (const entity of graph.entities) {
      adj.set(entity.name, new Set());
    }
    for (const relation of graph.relations) {
      adj.get(relation.from)?.add(relation.to);
      adj.get(relation.to)?.add(relation.from);
    }

    const cliques: string[][] = [];
    const stop = { reached: false };

    const bronKerbosch = (R: Set<string>, P: Set<string>, X: Set<string>): void => {
      if (stop.reached) return;
      if (P.size === 0 && X.size === 0) {
        if (R.size >= minSize) {
          cliques.push([...R].sort());
          if (cliques.length >= maxCliques) stop.reached = true;
        }
        return;
      }

      // Pivot: pick the vertex in P ∪ X with the most connections in P.
      // Vertices in P that are NOT neighbours of pivot are the only ones
      // we need to recurse on (Tomita-Tanaka-Takahashi optimisation).
      let pivot: string | null = null;
      let pivotCount = -1;
      for (const v of [...P, ...X]) {
        const count = [...P].filter(u => adj.get(v)?.has(u)).length;
        if (count > pivotCount) {
          pivotCount = count;
          pivot = v;
        }
      }
      const pivotNeighbours = pivot !== null ? adj.get(pivot)! : new Set<string>();

      for (const v of [...P]) {
        if (pivotNeighbours.has(v)) continue;
        const vNeighbours = adj.get(v)!;
        const newR = new Set(R).add(v);
        const newP = new Set([...P].filter(u => vNeighbours.has(u)));
        const newX = new Set([...X].filter(u => vNeighbours.has(u)));
        bronKerbosch(newR, newP, newX);
        if (stop.reached) return;
        P.delete(v);
        X.add(v);
      }
    };

    const allVertices = new Set(graph.entities.map(e => e.name));
    bronKerbosch(new Set(), allVertices, new Set());

    cliques.sort((a, b) => b.length - a.length);
    return cliques;
  }

  /**
   * Detect communities via the Louvain method (modularity maximisation).
   *
   * Operates on the undirected projection of the graph. Each entity ends
   * up assigned to a community ID; the modularity score Q ∈ [-1, 1]
   * indicates how well the partition separates densely-connected groups
   * from each other (Q > 0.3 is typically considered a meaningful cluster
   * structure).
   *
   * The implementation is the classic two-phase Louvain: phase 1 greedily
   * moves nodes to neighbouring communities while modularity gains are
   * positive; phase 2 contracts each community into a super-node and
   * repeats. Iterates until no further phase-1 improvement is possible.
   *
   * @param options.maxIter - Cap on phase-1 sweeps per level (default: 50)
   * @param options.tolerance - Stop a phase-1 sweep when the gain falls
   *   below this threshold (default: 1e-6)
   * @returns `{ communities, modularity, levels }` — `communities` maps
   *   each entity name to its final community ID; `levels` is the number
   *   of phase-1/phase-2 levels traversed.
   */
  async findCommunities(
    options: { maxIter?: number; tolerance?: number } = {},
  ): Promise<{
    communities: Map<string, number>;
    modularity: number;
    levels: number;
  }> {
    const maxIter = options.maxIter ?? 50;
    const tolerance = options.tolerance ?? 1e-6;

    const graph = await this.storage.loadGraph();
    if (graph.entities.length === 0) {
      return { communities: new Map(), modularity: 0, levels: 0 };
    }

    // Build a node-id <-> name map for cheap integer keys.
    const names = graph.entities.map(e => e.name);
    const idOf = new Map<string, number>(names.map((n, i) => [n, i]));

    // Adjacency as a list of (neighbourId, weight) per node.
    type Edge = { to: number; weight: number };
    let adj: Edge[][] = names.map(() => []);
    let totalWeight = 0;
    for (const relation of graph.relations) {
      const u = idOf.get(relation.from);
      const v = idOf.get(relation.to);
      if (u === undefined || v === undefined) continue;
      // Push every undirected edge twice (once per endpoint) so the
      // phase-2 contraction's `w / 2` halving for self-loops produces
      // the correct super-node weight.
      adj[u]!.push({ to: v, weight: 1 });
      adj[v]!.push({ to: u, weight: 1 });
      totalWeight += 1;
    }
    if (totalWeight === 0) {
      // No edges: each node is its own community, modularity = 0.
      const communities = new Map<string, number>(names.map((n, i) => [n, i]));
      return { communities, modularity: 0, levels: 0 };
    }

    // Final mapping from node-id-at-level-0 to its current community.
    let nodeCommunity: number[] = names.map((_, i) => i);
    let levels = 0;
    const m2 = 2 * totalWeight; // 2m for modularity formula

    // Run Louvain levels until no improvement.
    for (;;) {
      // Phase 1: greedy local moves at the current level.
      const nLocal = adj.length;
      const community = Array.from({ length: nLocal }, (_, i) => i);
      const degree = adj.map(es => es.reduce((s, e) => s + e.weight, 0));
      const communityDegree = degree.slice();

      let improved = false;
      for (let sweep = 0; sweep < maxIter; sweep++) {
        let sweepGain = 0;
        for (let v = 0; v < nLocal; v++) {
          // Tally weight from v to each neighbouring community.
          const weightToComm = new Map<number, number>();
          let weightToOwn = 0;
          for (const e of adj[v]!) {
            const c = community[e.to]!;
            if (e.to === v) continue; // self-loop handled separately
            if (c === community[v]) {
              weightToOwn += e.weight;
            } else {
              weightToComm.set(c, (weightToComm.get(c) ?? 0) + e.weight);
            }
          }

          // Removing v from its current community.
          const vCurrent = community[v]!;
          const kV = degree[v]!;
          communityDegree[vCurrent] = communityDegree[vCurrent]! - kV;

          // Pick the best community to join (including staying put).
          let best = vCurrent;
          let bestGain = 0; // gain relative to "stay solo" baseline
          for (const [c, k_iC] of weightToComm) {
            const gain = k_iC - (communityDegree[c]! * kV) / m2;
            if (gain > bestGain) {
              bestGain = gain;
              best = c;
            }
          }
          // Also consider the original community.
          const stayGain = weightToOwn - (communityDegree[vCurrent]! * kV) / m2;
          if (stayGain > bestGain) {
            bestGain = stayGain;
            best = vCurrent;
          }

          community[v] = best;
          communityDegree[best] = communityDegree[best]! + kV;
          if (best !== vCurrent) {
            sweepGain += bestGain - stayGain;
            improved = true;
          }
        }
        if (Math.abs(sweepGain) < tolerance) break;
      }

      // Project current-level community ids back through nodeCommunity.
      const seen = new Map<number, number>();
      let nextId = 0;
      for (let i = 0; i < nodeCommunity.length; i++) {
        const localNode = nodeCommunity[i]!;
        const localComm = community[localNode]!;
        let renamed = seen.get(localComm);
        if (renamed === undefined) {
          renamed = nextId++;
          seen.set(localComm, renamed);
        }
        nodeCommunity[i] = renamed;
      }

      levels++;
      if (!improved) break;

      // Phase 2: contract communities into super-nodes.
      const newSize = nextId;
      const newAdj: Edge[][] = Array.from({ length: newSize }, () => []);
      const edgeAccum = new Map<number, Map<number, number>>();
      for (let v = 0; v < nLocal; v++) {
        const cv = community[v]!;
        const projected = seen.get(cv)!;
        for (const e of adj[v]!) {
          const cu = community[e.to]!;
          const projectedU = seen.get(cu)!;
          if (!edgeAccum.has(projected)) edgeAccum.set(projected, new Map());
          const inner = edgeAccum.get(projected)!;
          inner.set(projectedU, (inner.get(projectedU) ?? 0) + e.weight);
        }
      }
      for (const [from, inner] of edgeAccum) {
        for (const [to, w] of inner) {
          // Each undirected edge appears twice in our directed accumulation;
          // when from === to (self-loop on contracted super-node) we keep
          // it as-is (it already contains the doubled weight).
          newAdj[from]!.push({ to, weight: from === to ? w / 2 : w });
        }
      }
      adj = newAdj;
    }

    // Compute final modularity Q = sum_c [ (in_c / 2m) - (deg_c / 2m)^2 ]
    // using the original (level-0) graph.
    const finalCommunity = new Map<string, number>();
    for (let i = 0; i < names.length; i++) {
      finalCommunity.set(names[i]!, nodeCommunity[i]!);
    }
    const inWeight = new Map<number, number>();
    const degByComm = new Map<number, number>();
    for (const relation of graph.relations) {
      const cu = finalCommunity.get(relation.from);
      const cv = finalCommunity.get(relation.to);
      if (cu === undefined || cv === undefined) continue;
      degByComm.set(cu, (degByComm.get(cu) ?? 0) + 1);
      degByComm.set(cv, (degByComm.get(cv) ?? 0) + 1);
      if (cu === cv) {
        inWeight.set(cu, (inWeight.get(cu) ?? 0) + 2); // undirected double-count
      }
    }
    let modularity = 0;
    for (const [c, inW] of inWeight) {
      const dc = degByComm.get(c) ?? 0;
      modularity += inW / m2 - (dc / m2) ** 2;
    }
    // Communities with zero internal weight still contribute -(deg/2m)^2.
    for (const [c, dc] of degByComm) {
      if (!inWeight.has(c)) modularity -= (dc / m2) ** 2;
    }

    return { communities: finalCommunity, modularity, levels };
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
