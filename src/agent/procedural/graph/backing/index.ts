/**
 * Procedural Graph backing public surface (Section 4.7).
 *
 * @module agent/procedural/graph/backing
 * @experimental
 */

export type {
  IProceduralGraphBacking,
  PGCommitInput,
  PGCommitResult,
} from './IProceduralGraphBacking.js';
export { createProceduralGraphBacking } from './IProceduralGraphBacking.js';
export { InMemoryProceduralGraphBacking } from './InMemoryProceduralGraphBacking.js';
export { JsonlProceduralGraphBacking } from './JsonlProceduralGraphBacking.js';
export { SqliteProceduralGraphBacking } from './SqliteProceduralGraphBacking.js';
