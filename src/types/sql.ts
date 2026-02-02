// Shared SQL types used across components

export interface ColumnInfo {
  name: string;
  pg_type: string;
}

export interface QueryResult {
  rows: Record<string, any>[];
  columns: ColumnInfo[];
  rows_affected: number;
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
