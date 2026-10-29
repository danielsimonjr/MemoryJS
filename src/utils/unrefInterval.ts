export interface IntervalRunState {
  running: boolean;
  intervalId?: ReturnType<typeof setInterval>;
}

/** Starts the interval. Returns false when `state.running` was already true. */
export function beginUnrefInterval(
  state: IntervalRunState,
  intervalMs: number,
  tick: () => Promise<void> | void,
): boolean {
  if (state.running) {
    return false;
  }
  state.running = true;
  state.intervalId = setInterval(() => {
    void tick();
  }, intervalMs);
  state.intervalId.unref();
  return true;
}

export function stopUnrefInterval(state: IntervalRunState): void {
  if (state.intervalId !== undefined) {
    clearInterval(state.intervalId);
    state.intervalId = undefined;
  }
  state.running = false;
}
