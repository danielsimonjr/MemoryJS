/**
 * Returns the next ISO-8601 timestamp strictly after `lastTimestamp`.
 * When the clock has not advanced, bumps by one millisecond.
 */
export function nextMonotonicIsoTimestamp(lastTimestamp: string): {
  timestamp: string;
  lastTimestamp: string;
} {
  let ts = new Date().toISOString();
  if (lastTimestamp !== '' && ts <= lastTimestamp) {
    ts = new Date(Date.parse(lastTimestamp) + 1).toISOString();
  }
  return { timestamp: ts, lastTimestamp: ts };
}
