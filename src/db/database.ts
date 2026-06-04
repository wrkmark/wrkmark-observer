/**
 * database.ts
 * 
 * The database wrapper and query interface for the local SQLite database.
 * This file handles database initialization, schema execution, prepared statement
 * caching, and exposes typed helpers for business logic to interact with persistence.
 * 
 * What this file does NOT do:
 * - It does NOT handle telemetry transmission to the Wrkmark server.
 * - It does NOT perform raw string query building in helper methods (all use prepared statements).
 * - It does NOT store unanonymized user content.
 */

import Database from 'better-sqlite3';
import { 
  CREATE_RAW_SIGNALS_TABLE, 
  CREATE_LOCAL_SESSIONS_TABLE, 
  CREATE_FEATURE_VECTORS_TABLE 
} from './schema.js';
import { 
  WrkmarkObserverError 
} from '../types/index.js';
import type { 
  AnonymizedSignal, 
  ActiveSession, 
  FeatureVector 
} from '../types/index.js';

/** Row structure for raw_signals table */
export interface RawSignalRow {
  id: number;
  collected_at: number;
  app_name: string;
  signal_type: string;
  signal_value: number | null;
  session_id: string;
  transmitted: number;
}

/** Row structure for local_sessions table */
export interface LocalSessionRow {
  id: string;
  app_name: string;
  started_at: number;
  ended_at: number | null;
  signal_count: number;
  features_extracted: number;
  synced_to_server: number;
}

/** Row structure for feature_vectors table */
export interface FeatureVectorRow {
  id: number;
  session_id: string;
  computed_at: number;
  focus_component: number | null;
  revision_intensity_component: number | null;
  ai_dependency_component: number | null;
  relative_velocity_component: number | null;
  synced_to_server: number;
}

/**
 * Return type interface of the createDatabase factory.
 * Exposes organized namespaces for signals, sessions, and features helpers.
 */
export interface WrkmarkDb {
  signals: {
    insert(signal: AnonymizedSignal, sessionId: string): void;
    getBySession(sessionId: string): RawSignalRow[];
  };
  sessions: {
    insert(session: ActiveSession): void;
    end(sessionId: string, endedAt: number): void;
    getById(sessionId: string): LocalSessionRow | undefined;
    getPending(): LocalSessionRow[];
  };
  features: {
    insert(vector: FeatureVector): void;
    getPending(): FeatureVectorRow[];
  };
  rawDb: Database.Database;
}

/**
 * Factory function that opens or creates a SQLite database and prepares statements.
 * Configures WAL mode and enables foreign keys automatically.
 * 
 * @param path - The filesystem path to the SQLite database file, or ':memory:' for transient storage.
 * @returns The initialized database interface with typed query helpers.
 * @throws WrkmarkObserverError if database connection or initialization fails.
 */
export function createDatabase(path: string): WrkmarkDb {
  let db: Database.Database;

  try {
    db = new Database(path);
  } catch (err) {
    throw new WrkmarkObserverError(
      `Failed to open database at "${path}": ${(err as Error).message}`,
      'DB_WRITE_FAILED',
      { path, error: String(err) }
    );
  }

  // 1. Enable WAL mode
  try {
    db.pragma('journal_mode = WAL');
  } catch (err) {
    throw new WrkmarkObserverError(
      `Failed to enable WAL mode: ${(err as Error).message}`,
      'DB_WRITE_FAILED',
      { error: String(err) }
    );
  }

  // 2. Enable Foreign Key Constraints
  try {
    db.pragma('foreign_keys = ON');
  } catch (err) {
    throw new WrkmarkObserverError(
      `Failed to enable foreign keys: ${(err as Error).message}`,
      'DB_WRITE_FAILED',
      { error: String(err) }
    );
  }

  // 3. Run all schema setup automatically
  try {
    db.exec(CREATE_RAW_SIGNALS_TABLE);
    db.exec(CREATE_LOCAL_SESSIONS_TABLE);
    db.exec(CREATE_FEATURE_VECTORS_TABLE);
  } catch (err) {
    throw new WrkmarkObserverError(
      `Failed to run database schema setup: ${(err as Error).message}`,
      'DB_WRITE_FAILED',
      { error: String(err) }
    );
  }

  // 4. Compile Prepared Statements for reuse
  let insertSignalStmt: Database.Statement;
  let getSignalsBySessionStmt: Database.Statement;
  let insertSessionStmt: Database.Statement;
  let endSessionStmt: Database.Statement;
  let getSessionByIdStmt: Database.Statement;
  let getPendingSessionsStmt: Database.Statement;
  let insertFeatureStmt: Database.Statement;
  let getPendingFeaturesStmt: Database.Statement;

  try {
    insertSignalStmt = db.prepare(`
      INSERT INTO raw_signals (collected_at, app_name, signal_type, signal_value, session_id, transmitted)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    getSignalsBySessionStmt = db.prepare(`
      SELECT id, collected_at, app_name, signal_type, signal_value, session_id, transmitted
      FROM raw_signals
      WHERE session_id = ?
    `);

    insertSessionStmt = db.prepare(`
      INSERT INTO local_sessions (id, app_name, started_at, ended_at, signal_count, features_extracted, synced_to_server)
      VALUES (?, ?, ?, NULL, ?, 0, 0)
    `);

    endSessionStmt = db.prepare(`
      UPDATE local_sessions
      SET ended_at = ?
      WHERE id = ?
    `);

    getSessionByIdStmt = db.prepare(`
      SELECT id, app_name, started_at, ended_at, signal_count, features_extracted, synced_to_server
      FROM local_sessions
      WHERE id = ?
    `);

    getPendingSessionsStmt = db.prepare(`
      SELECT id, app_name, started_at, ended_at, signal_count, features_extracted, synced_to_server
      FROM local_sessions
      WHERE synced_to_server = 0
    `);

    insertFeatureStmt = db.prepare(`
      INSERT INTO feature_vectors (
        session_id, 
        computed_at, 
        focus_component, 
        revision_intensity_component, 
        ai_dependency_component, 
        relative_velocity_component, 
        synced_to_server
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    getPendingFeaturesStmt = db.prepare(`
      SELECT 
        id, 
        session_id, 
        computed_at, 
        focus_component, 
        revision_intensity_component, 
        ai_dependency_component, 
        relative_velocity_component, 
        synced_to_server
      FROM feature_vectors
      WHERE synced_to_server = 0
    `);
  } catch (err) {
    throw new WrkmarkObserverError(
      `Failed to compile prepared statements: ${(err as Error).message}`,
      'DB_WRITE_FAILED',
      { error: String(err) }
    );
  }

  // 5. Build and return the WrkmarkDb implementation
  return {
    signals: {
      /**
       * Inserts a single anonymized signal into the database.
       * Enforces strict type checking to ensure signal_value is numeric or null.
       * 
       * @param signal - The anonymized signal.
       * @param sessionId - The ID of the session the signal belongs to.
       * @throws WrkmarkObserverError if signal_value is a string, or if insertion fails.
       */
      insert(signal: AnonymizedSignal, sessionId: string): void {
        // Enforce privacy constraint: validate that signal_value is numeric or null.
        // If a string is passed, throw WrkmarkObserverError with code 'DB_WRITE_FAILED'.
        if (typeof signal.numeric_value === 'string') {
          throw new WrkmarkObserverError(
            'Privacy violation: signal_value cannot be a string',
            'DB_WRITE_FAILED',
            { signal_value: signal.numeric_value }
          );
        }

        if (signal.numeric_value !== null && typeof signal.numeric_value !== 'number') {
          throw new WrkmarkObserverError(
            'Invalid type: signal_value must be a number or null',
            'DB_WRITE_FAILED',
            { signal_value: signal.numeric_value }
          );
        }

        try {
          insertSignalStmt.run(
            signal.timestamp,
            signal.app_name,
            signal.signal_type,
            signal.numeric_value,
            sessionId
          );
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to write signal to database: ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { signal, sessionId, error: String(err) }
          );
        }
      },

      /**
       * Gets all raw signals for a given session.
       * 
       * @param sessionId - The ID of the session.
       * @returns Array of signals associated with the session.
       * @throws WrkmarkObserverError if query execution fails.
       */
      getBySession(sessionId: string): RawSignalRow[] {
        try {
          return getSignalsBySessionStmt.all(sessionId) as RawSignalRow[];
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to fetch signals for session "${sessionId}": ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { sessionId, error: String(err) }
          );
        }
      }
    },

    sessions: {
      /**
       * Creates a new local work session record in the database.
       * 
       * @param session - The active session data to insert.
       * @throws WrkmarkObserverError if writing the session fails.
       */
      insert(session: ActiveSession): void {
        try {
          insertSessionStmt.run(
            session.id,
            session.app_name,
            session.started_at,
            session.signal_count
          );
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to write session to database: ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { session, error: String(err) }
          );
        }
      },

      /**
       * Marks a work session as ended by updating its end timestamp.
       * 
       * @param sessionId - The ID of the session.
       * @param endedAt - Unix ms timestamp when the session ended.
       * @throws WrkmarkObserverError if updating the session fails or session is not found.
       */
      end(sessionId: string, endedAt: number): void {
        try {
          const result = endSessionStmt.run(endedAt, sessionId);
          if (result.changes === 0) {
            throw new WrkmarkObserverError(
              `Session not found: ID "${sessionId}"`,
              'DB_WRITE_FAILED',
              { sessionId }
            );
          }
        } catch (err) {
          if (err instanceof WrkmarkObserverError) {
            throw err;
          }
          throw new WrkmarkObserverError(
            `Failed to end session "${sessionId}": ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { sessionId, endedAt, error: String(err) }
          );
        }
      },

      /**
       * Fetches a session record by its unique ID.
       * 
       * @param sessionId - The ID of the session.
       * @returns The session row if found, otherwise undefined.
       * @throws WrkmarkObserverError if reading the session fails.
       */
      getById(sessionId: string): LocalSessionRow | undefined {
        try {
          return getSessionByIdStmt.get(sessionId) as LocalSessionRow | undefined;
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to fetch session "${sessionId}": ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { sessionId, error: String(err) }
          );
        }
      },

      /**
       * Retrieves all session records that have not yet been synced to the server.
       * 
       * @returns Array of unsynced local sessions.
       * @throws WrkmarkObserverError if querying pending sessions fails.
       */
      getPending(): LocalSessionRow[] {
        try {
          return getPendingSessionsStmt.all() as LocalSessionRow[];
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to fetch pending sessions: ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { error: String(err) }
          );
        }
      }
    },

    features: {
      /**
       * Stores a computed feature vector in the database.
       * 
       * @param vector - The behavioral feature vector.
       * @throws WrkmarkObserverError if writing the feature vector fails.
       */
      insert(vector: FeatureVector): void {
        try {
          insertFeatureStmt.run(
            vector.session_id,
            vector.computed_at,
            vector.focus_ratio,
            vector.revision_intensity,
            vector.used_ai_tools ? 1 : 0,
            vector.relative_velocity,
            vector.synced_to_server ? 1 : 0
          );
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to write feature vector to database: ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { vector, error: String(err) }
          );
        }
      },

      /**
       * Retrieves all feature vector records that have not yet been synced to the server.
       * 
       * @returns Array of unsynced feature vector rows.
       * @throws WrkmarkObserverError if querying pending feature vectors fails.
       */
      getPending(): FeatureVectorRow[] {
        try {
          return getPendingFeaturesStmt.all() as FeatureVectorRow[];
        } catch (err) {
          throw new WrkmarkObserverError(
            `Failed to fetch pending feature vectors: ${(err as Error).message}`,
            'DB_WRITE_FAILED',
            { error: String(err) }
          );
        }
      }
    },
    rawDb: db
  };
}
