/**
 * Simple logging utility for the Memory MCP Server
 *
 * Provides consistent log formatting with levels: debug, info, warn, error
 *
 * IMPORTANT: All log output goes to stderr to avoid interfering with
 * JSON-RPC communication on stdout when running as an MCP server.
 */

export const logger = {
  /**
   * Debug level logging (verbose, for development)
   * Output: stderr (to avoid interfering with JSON-RPC)
   */
  debug: (msg: string, ...args: unknown[]): void => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.error(`[DEBUG] ${msg}`, ...args);
    }
  },

  /**
   * Info level logging (general informational messages)
   * Output: stderr (to avoid interfering with JSON-RPC)
   */
  info: (msg: string, ...args: unknown[]): void => {
    console.error(`[INFO] ${msg}`, ...args);
  },

  /**
   * Warning level logging (warnings that don't prevent operation)
   * Output: stderr (native console.warn behavior)
   */
  warn: (msg: string, ...args: unknown[]): void => {
    console.warn(`[WARN] ${msg}`, ...args);
  },

  /**
   * Error level logging (errors that affect functionality)
   * Output: stderr (native console.error behavior)
   */
  error: (msg: string, ...args: unknown[]): void => {
    console.error(`[ERROR] ${msg}`, ...args);
  },
};
