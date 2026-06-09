/**
 * database.test.ts
 * 
 * Unit tests for the database layer (`src/db/database.ts`).
 * Validates SQLite initialization, WAL mode status, foreign key constraint handling,
 * prepared statement logic, and privacy rules rejecting string inputs.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../../src/db/database.js';
import { WrkmarkObserverError } from '../../src/types/index.js';
import type { AnonymizedSignal, ActiveSession, FeatureVector } from '../../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Database Layer — SQLite wrapper and helpers', () => {
  it('creates database successfully with correct schema', () => {
    const db = createDatabase(':memory:');
    expect(db).toBeDefined();

    // Verify that the tables exist in the SQLite master table
    const tables = db.rawDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('raw_signals', 'local_sessions', 'feature_vectors')
    `).all() as { name: string }[];

    expect(tables).toHaveLength(3);
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('raw_signals');
    expect(tableNames).toContain('local_sessions');
    expect(tableNames).toContain('feature_vectors');
  });

  it('WAL mode is enabled after creation', () => {
    const tempDbPath = path.join(__dirname, 'temp-test-wal.db');
    try {
      const db = createDatabase(tempDbPath);
      const journalMode = db.rawDb.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');
      db.rawDb.close();
    } finally {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      const walPath = `${tempDbPath}-wal`;
      const shmPath = `${tempDbPath}-shm`;
      if (fs.existsSync(walPath)) {
        fs.unlinkSync(walPath);
      }
      if (fs.existsSync(shmPath)) {
        fs.unlinkSync(shmPath);
      }
    }
  });

  it('foreign keys are enabled', () => {
    const db = createDatabase(':memory:');
    const foreignKeys = db.rawDb.pragma('foreign_keys', { simple: true });
    expect(Number(foreignKeys)).toBe(1);
  });

  it('signals.insert() works correctly', () => {
    const db = createDatabase(':memory:');

    const signal: AnonymizedSignal = {
      timestamp: 1625097600000,
      app_name: 'VS Code',
      signal_type: 'typing_rhythm_bucket',
      numeric_value: 12,
      session_id: 'sess-abc-123',
    };

    db.signals.insert(signal, 'sess-abc-123');

    const signals = db.signals.getBySession('sess-abc-123');
    expect(signals).toHaveLength(1);
    const row = signals[0]!;
    expect(row.collected_at).toBe(1625097600000);
    expect(row.app_name).toBe('VS Code');
    expect(row.signal_type).toBe('typing_rhythm_bucket');
    expect(row.signal_value).toBe(12);
    expect(row.session_id).toBe('sess-abc-123');
    expect(row.transmitted).toBe(0);
  });

  it('signals.insert() rejects string values (privacy test)', () => {
    const db = createDatabase(':memory:');

    // Type coercion bypass to test privacy boundary
    const invalidSignal = {
      timestamp: 1625097600000,
      app_name: 'VS Code',
      signal_type: 'typing_rhythm_bucket',
      numeric_value: 'dangerous_user_typed_string',
      session_id: 'sess-abc-123',
    } as unknown as AnonymizedSignal;

    let errorThrown: WrkmarkObserverError | null = null;
    try {
      db.signals.insert(invalidSignal, 'sess-abc-123');
    } catch (err) {
      errorThrown = err as WrkmarkObserverError;
    }

    expect(errorThrown).toBeInstanceOf(WrkmarkObserverError);
    expect(errorThrown!.code).toBe('DB_WRITE_FAILED');

    // Ensure database remains clean of the bad signal
    const signals = db.signals.getBySession('sess-abc-123');
    expect(signals).toHaveLength(0);
  });

  it('sessions.insert() and sessions.end() work correctly', () => {
    const db = createDatabase(':memory:');

    const session: ActiveSession = {
      id: 'session-uuid-999',
      app_name: 'Chrome',
      started_at: 1625097600000,
      signal_count: 0,
      ai_tool_opened: false,
    };

    // Insert active session
    db.sessions.insert(session);

    const rowBeforeEnd = db.sessions.getById('session-uuid-999');
    expect(rowBeforeEnd).toBeDefined();
    expect(rowBeforeEnd!.id).toBe('session-uuid-999');
    expect(rowBeforeEnd!.app_name).toBe('Chrome');
    expect(rowBeforeEnd!.started_at).toBe(1625097600000);
    expect(rowBeforeEnd!.ended_at).toBeNull();
    expect(rowBeforeEnd!.signal_count).toBe(0);
    expect(rowBeforeEnd!.features_extracted).toBe(0);
    expect(rowBeforeEnd!.synced_to_server).toBe(0);

    // End active session
    db.sessions.end('session-uuid-999', 1625098600000);

    const rowAfterEnd = db.sessions.getById('session-uuid-999');
    expect(rowAfterEnd!.ended_at).toBe(1625098600000);
  });

  it('features.insert() works correctly', () => {
    const db = createDatabase(':memory:');

    // Insert referencing session first
    const session: ActiveSession = {
      id: 'session-uuid-feat',
      app_name: 'VS Code',
      started_at: 1625097600000,
      signal_count: 5,
      ai_tool_opened: true,
    };
    db.sessions.insert(session);

    const vector: FeatureVector = {
      session_id: 'session-uuid-feat',
      computed_at: 1625099000000,
      duration_minutes: 20,
      focus_ratio: 0.85,
      revision_intensity: 0.45,
      used_ai_tools: true,
      relative_velocity: 1.2,
      synced_to_server: false,
    };

    db.features.insert(vector);

    const pending = db.features.getPending();
    expect(pending).toHaveLength(1);
    const row = pending[0]!;
    expect(row.session_id).toBe('session-uuid-feat');
    expect(row.computed_at).toBe(1625099000000);
    expect(row.focus_component).toBe(0.85);
    expect(row.revision_intensity_component).toBe(0.45);
    expect(row.ai_dependency_component).toBe(1); // represented as numeric 1
    expect(row.relative_velocity_component).toBe(1.2);
    expect(row.synced_to_server).toBe(0);
  });

  it('sessions.getPending() returns only unsynced sessions', () => {
    const db = createDatabase(':memory:');

    const sessionSynced: ActiveSession = {
      id: 'session-synced',
      app_name: 'VS Code',
      started_at: 1625097600000,
      signal_count: 5,
      ai_tool_opened: false,
    };
    const sessionUnsynced: ActiveSession = {
      id: 'session-unsynced',
      app_name: 'VS Code',
      started_at: 1625098600000,
      signal_count: 10,
      ai_tool_opened: true,
    };

    db.sessions.insert(sessionSynced);
    db.sessions.insert(sessionUnsynced);

    // Manually transition one session to synced_to_server = 1 to test filter
    db.rawDb.prepare('UPDATE local_sessions SET synced_to_server = 1 WHERE id = ?').run('session-synced');

    const pending = db.sessions.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('session-unsynced');
  });

  it('enforces foreign key constraints for feature vectors', () => {
    const db = createDatabase(':memory:');

    const invalidVector: FeatureVector = {
      session_id: 'non-existent-session-id',
      computed_at: 1625099000000,
      duration_minutes: 20,
      focus_ratio: 0.85,
      revision_intensity: 0.45,
      used_ai_tools: true,
      relative_velocity: 1.2,
      synced_to_server: false,
    };

    expect(() => {
      db.features.insert(invalidVector);
    }).toThrow(WrkmarkObserverError);
  });
});
