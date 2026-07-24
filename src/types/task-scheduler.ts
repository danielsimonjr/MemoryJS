/**
 * Task Scheduler shared types (S10 — types-layer leaf).
 *
 * `TaskPriority` and `ProgressCallback` are referenced by both the types
 * layer (`types/types.ts` batch-operation options) and the implementation
 * (`utils/taskScheduler.ts`). They live here so `src/types/**` never imports
 * from implementation directories; `utils/taskScheduler.ts` re-exports them
 * from their original location for backwards compatibility.
 *
 * @module types/task-scheduler
 * @public
 */

/**
 * Task priority levels.
 * Higher priority tasks are executed first.
 */
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Progress callback for batch operations.
 */
export type ProgressCallback = (progress: {
  completed: number;
  total: number;
  percentage: number;
  currentTaskId?: string;
}) => void;
