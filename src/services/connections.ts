/**
 * Connections storage service.
 * Provides CRUD operations for database connections.
 * Uses the database abstraction layer.
 */

import { getDatabase } from "./database";

/**
 * Connection configuration stored in the database.
 */
export interface StoredConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  username: string;
  password: string | null;
  database_name: string;
  driver: string;
  default_schema: string;
  created_at: string;
  updated_at: string;
}

/**
 * Connection data for creating/updating (without timestamps).
 */
export interface ConnectionInput {
  id?: string;
  name: string;
  host: string;
  port: string;
  username: string;
  password?: string | null;
  database_name: string;
  driver: string;
  default_schema: string;
}

/**
 * Generate a UUID v4.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Save a connection (create or update).
 * Returns the connection ID.
 */
export async function saveConnection(input: ConnectionInput): Promise<string> {
  const db = await getDatabase();
  const id = input.id || generateId();
  const now = new Date().toISOString();

  // Check if exists for update vs insert
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM connections WHERE id = ?",
    [id]
  );

  if (existing.length > 0) {
    // Update
    await db.execute(
      `UPDATE connections SET
        name = ?, host = ?, port = ?, username = ?, password = ?,
        database_name = ?, driver = ?, default_schema = ?, updated_at = ?
      WHERE id = ?`,
      [
        input.name,
        input.host,
        input.port,
        input.username,
        input.password ?? null,
        input.database_name,
        input.driver,
        input.default_schema,
        now,
        id,
      ]
    );
  } else {
    // Insert
    await db.execute(
      `INSERT INTO connections 
        (id, name, host, port, username, password, database_name, driver, default_schema, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.host,
        input.port,
        input.username,
        input.password ?? null,
        input.database_name,
        input.driver,
        input.default_schema,
        now,
        now,
      ]
    );
  }

  return id;
}

/**
 * Get all connections, sorted by name.
 */
export async function getConnections(): Promise<StoredConnection[]> {
  const db = await getDatabase();
  const rows = await db.select<StoredConnection[]>(
    "SELECT * FROM connections ORDER BY name"
  );
  return rows;
}

/**
 * Get a single connection by ID.
 */
export async function getConnection(
  id: string
): Promise<StoredConnection | null> {
  const db = await getDatabase();
  const rows = await db.select<StoredConnection[]>(
    "SELECT * FROM connections WHERE id = ?",
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Delete a connection by ID.
 * Also removes usage tracking (via CASCADE).
 */
export async function deleteConnection(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM connections WHERE id = ?", [id]);
}

/**
 * Record that a connection was used (for recent connections).
 */
export async function recordConnectionUsage(connectionId: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  // Upsert: insert or update last_used_at
  await db.execute(
    `INSERT INTO connection_usage (connection_id, last_used_at)
     VALUES (?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET last_used_at = ?`,
    [connectionId, now, now]
  );
}

/**
 * Get recent connection IDs, sorted by most recently used.
 */
export async function getRecentConnectionIds(limit = 10): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.select<{ connection_id: string }[]>(
    `SELECT connection_id FROM connection_usage
     ORDER BY last_used_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => r.connection_id);
}
