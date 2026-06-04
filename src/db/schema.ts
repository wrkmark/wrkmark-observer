/**
 * schema.ts
 * 
 * Database schema definition for wrkmark-observer.
 * Defines the SQL queries used to create the required SQLite tables.
 * 
 * What this file does NOT do:
 * - Does NOT perform any database connections or execution of commands.
 * - Does NOT validate signal values or session statuses.
 */

/**
 * SQL statement to create the raw_signals table.
 * Stores individual anonymized signals captured during active observation.
 */
export const CREATE_RAW_SIGNALS_TABLE = `
  CREATE TABLE IF NOT EXISTS raw_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collected_at INTEGER NOT NULL,
    app_name TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    signal_value REAL,
    session_id TEXT NOT NULL,
    transmitted INTEGER NOT NULL DEFAULT 0
  );
`;

/**
 * SQL statement to create the local_sessions table.
 * Tracks discrete user observation work sessions.
 */
export const CREATE_LOCAL_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS local_sessions (
    id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    signal_count INTEGER NOT NULL DEFAULT 0,
    features_extracted INTEGER NOT NULL DEFAULT 0,
    synced_to_server INTEGER NOT NULL DEFAULT 0
  );
`;

/**
 * SQL statement to create the feature_vectors table.
 * Stores behavioral feature vectors computed locally from session data.
 */
export const CREATE_FEATURE_VECTORS_TABLE = `
  CREATE TABLE IF NOT EXISTS feature_vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES local_sessions(id),
    computed_at INTEGER NOT NULL,
    focus_component REAL,
    revision_intensity_component REAL,
    ai_dependency_component REAL,
    relative_velocity_component REAL,
    synced_to_server INTEGER NOT NULL DEFAULT 0
  );
`;
