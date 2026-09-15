// Shared SQL types used across components

export interface ColumnInfo {
  name: string;
  pg_type: string;
}

export interface QueryResult {
  rows: Record<string, any>[];
  columns: ColumnInfo[];
  /** Server-reported count. The only meaningful number for INSERT/UPDATE/DELETE
   *  without RETURNING, where `rows` is empty. */
  rows_affected: number;
  /** True when the result set exceeded the backend row cap and `rows` holds
   *  only the first chunk. */
  truncated: boolean;
  /** True when running this statement cost the tab its session: any open
   *  transaction was rolled back and session settings are gone. */
  session_reset: boolean;
  execution_time_ms: number;
}

/** Outcome of one statement in a script run. */
export interface ScriptStatementResult {
  index: number;
  statement: string;
  /** Present when the statement succeeded. */
  result: QueryResult | null;
  /** Present when it failed — a script stops at its first error. */
  error: string | null;
}

export interface ScriptResult {
  /** One entry per statement attempted, so shorter than the script if it
   *  stopped early. */
  statements: ScriptStatementResult[];
  stopped_early: boolean;
  execution_time_ms: number;
}

export interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: Date;
  success: boolean;
  rowCount?: number;
  executionTime?: number;
  error?: string;
}
