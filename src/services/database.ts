/**
 * Database abstraction layer for Waterfowl.
 * All persistent storage goes through this module.
 * Uses SQLite via tauri-plugin-sql.
 */

import Database from "@tauri-apps/plugin-sql";

const DB_NAME = "sqlite:waterfowl.db";

let db: Database | null = null;

/**
 * Get the database instance, initializing if needed.
 */
export async function getDatabase(): Promise<Database> {
  if (!db) {
    console.log("intializing db with migrations")
    db = await Database.load(DB_NAME);
    await runMigrations(db);
  }
  return db;
}

/**
 * Run database migrations.
 * Migrations are idempotent (safe to run multiple times).
 */
async function runMigrations(database: Database): Promise<void> {
  // Create migrations table if not exists
  await database.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Run each migration if not already applied
  for (const migration of MIGRATIONS) {
    const applied = await database.select<{ name: string }[]>(
      "SELECT name FROM _migrations WHERE name = ?",
      [migration.name]
    );

    if (applied.length === 0) {
      console.log(`Running migration: ${migration.name}`);
      await database.execute(migration.sql);
      await database.execute(
        "INSERT INTO _migrations (name) VALUES (?)",
        [migration.name]
      );
    }
  }
}

/**
 * Migration definitions.
 * Each migration has a unique name and SQL to execute.
 * Migrations are run in order and tracked to avoid re-running.
 */
const MIGRATIONS = [
  {
    name: "001_initial_schema",
    sql: `
      -- Connections table
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT,
        database_name TEXT NOT NULL,
        driver TEXT NOT NULL DEFAULT 'postgres',
        default_schema TEXT NOT NULL DEFAULT 'public',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Connection usage tracking (for recent connections)
      CREATE TABLE IF NOT EXISTS connection_usage (
        connection_id TEXT PRIMARY KEY,
        last_used_at TEXT NOT NULL,
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
      );
    `,
  },
];
