/**
 * session-manager.test.ts
 *
 * Unit tests for the SessionManager coordinator.
 * Verifies session lifecycles, signal dispatching, state transitioning,
 * and strict local database and privacy assertions.
 *
 * What this is NOT: integration testing for electron IPC or remote sync.
 * Pure local lifecycle verification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { AuditLog } from '../src/privacy/audit-log.js';
import { SignalAnonymizer } from '../src/processor/anonymizer.js';
import { SignalExtractor } from '../src/processor/signal-extractor.js';
import { SessionManager } from '../src/session-manager.js';
import { WrkmarkObserverError } from '../src/types/index.js';
import type { RawSignal } from '../src/types/index.js';

describe('SessionManager — Work Observation Lifecycle and Coordination', () => {
  let db: ReturnType<typeof createDatabase>;
  let auditLog: AuditLog;
  let anonymizer: SignalAnonymizer;
  let extractor: SignalExtractor;
  let manager: SessionManager;

  beforeEach(() => {
    db = createDatabase(':memory:');
    auditLog = new AuditLog(db.rawDb);
    anonymizer = new SignalAnonymizer(auditLog);
    extractor = new SignalExtractor(db);
    manager = new SessionManager(db, auditLog, anonymizer, extractor);
  });

  const makeRawSignal = (overrides: Partial<RawSignal> = {}): RawSignal => {
    return {
      app_name: 'VS Code',
      signal_type: 'typing_rhythm_bucket',
      numeric_value: 12,
      timestamp: Date.now(),
      session_id: '',
      ...overrides,
    };
  };

  it('remembers which app the session belongs to', () => {
    manager.startSession('Chrome');
    const state = manager.getState();

    expect(state.status).toBe('active');
    expect(state.active_session).toBeDefined();
    expect(state.active_session!.app_name).toBe('Chrome');
    expect(state.current_app).toBe('Chrome');
    expect(state.active_session!.signal_count).toBe(0);
    expect(state.active_session!.ai_tool_opened).toBe(false);
  });

  it('prevents starting a new session if one is already active', () => {
    manager.startSession('VS Code');

    expect(() => {
      manager.startSession('Chrome');
    }).toThrow(WrkmarkObserverError);

    // Verify error code is SESSION_ALREADY_ACTIVE
    try {
      manager.startSession('Chrome');
    } catch (err) {
      expect((err as WrkmarkObserverError).code).toBe('SESSION_ALREADY_ACTIVE');
    }
  });

  it('successfully processes and logs valid incoming signals', () => {
    manager.startSession('VS Code');
    const signal = makeRawSignal({ session_id: manager.getState().active_session!.id });

    expect(() => {
      manager.recordSignal(signal);
    }).not.toThrow();

    // Verify signal is written to DB
    const signals = db.signals.getBySession(manager.getState().active_session!.id);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.app_name).toBe('VS Code');
    expect(signals[0]!.signal_type).toBe('typing_rhythm_bucket');
  });

  it('refuses to record signals with no session running', () => {
    const signal = makeRawSignal();

    expect(() => {
      manager.recordSignal(signal);
    }).toThrow(WrkmarkObserverError);

    try {
      manager.recordSignal(signal);
    } catch (err) {
      expect((err as WrkmarkObserverError).code).toBe('NO_ACTIVE_SESSION');
    }
  });

  it('silently discards signals while observation is paused', () => {
    manager.startSession('VS Code');
    const sessionId = manager.getState().active_session!.id;
    manager.pause();

    const signal = makeRawSignal({ session_id: sessionId });
    expect(() => {
      manager.recordSignal(signal);
    }).not.toThrow();

    // Verify no signal gets written
    const signals = db.signals.getBySession(sessionId);
    expect(signals).toHaveLength(0);
  });

  it('accumulates signal counts in the active session structure', () => {
    manager.startSession('VS Code');
    const sessionId = manager.getState().active_session!.id;

    manager.recordSignal(makeRawSignal({ session_id: sessionId }));
    manager.recordSignal(makeRawSignal({ session_id: sessionId }));

    const state = manager.getState();
    expect(state.active_session!.signal_count).toBe(2);
  });

  it('flags the session when an AI tool is opened mid-work', () => {
    manager.startSession('VS Code');
    const sessionId = manager.getState().active_session!.id;

    manager.recordSignal(
      makeRawSignal({
        session_id: sessionId,
        signal_type: 'ai_tool_opened',
        numeric_value: 1,
      })
    );

    const state = manager.getState();
    expect(state.active_session!.ai_tool_opened).toBe(true);
  });

  it('returns the finalized CompletedSession containing accurate start and end metrics', () => {
    manager.startSession('VS Code');
    const active = manager.getState().active_session!;
    
    // Simulate some work duration
    const completed = manager.endSession();

    expect(completed.id).toBe(active.id);
    expect(completed.app_name).toBe(active.app_name);
    expect(completed.started_at).toBe(active.started_at);
    expect(completed.ended_at).toBeGreaterThanOrEqual(active.started_at);
    expect(completed.duration_ms).toBe(completed.ended_at - completed.started_at);
    expect(completed.synced_to_server).toBe(false);

    // Verify manager state resets
    const state = manager.getState();
    expect(state.status).toBe('stopped');
    expect(state.active_session).toBeNull();
  });

  it('refuses to end a session when no session is running', () => {
    expect(() => {
      manager.endSession();
    }).toThrow(WrkmarkObserverError);

    try {
      manager.endSession();
    } catch (err) {
      expect((err as WrkmarkObserverError).code).toBe('NO_ACTIVE_SESSION');
    }
  });

  it('locally extracts and persists behavioral feature vectors on session termination', () => {
    manager.startSession('VS Code');
    const sessionId = manager.getState().active_session!.id;

    // Must insert typing signals to satisfy minimum duration focus ratio logic if needed
    manager.recordSignal(makeRawSignal({ session_id: sessionId }));

    manager.endSession();

    // Verify feature vector is created and inserted into SQLite
    const pendingFeatures = db.features.getPending();
    expect(pendingFeatures).toHaveLength(1);
    expect(pendingFeatures[0]!.session_id).toBe(sessionId);
    expect(pendingFeatures[0]!.relative_velocity_component).toBe(1.0); // MVP default
  });

  it('transitions state to paused to stop tracking', () => {
    manager.startSession('VS Code');
    manager.pause();

    const state = manager.getState();
    expect(state.status).toBe('paused');

    // Verify audit log record for pause exists
    const recentLogs = auditLog.getRecent(5);
    expect(recentLogs.some((log) => log.event_type === 'observation_paused')).toBe(true);
  });

  it('allows resuming active observation from a paused state', () => {
    manager.startSession('VS Code');
    manager.pause();
    manager.resume();

    const state = manager.getState();
    expect(state.status).toBe('active');

    // Verify audit log record for resume exists
    const recentLogs = auditLog.getRecent(5);
    expect(recentLogs.some((log) => log.event_type === 'observation_resumed')).toBe(true);
  });

  it('returns a correct, complete local ObserverState block', () => {
    // Check initial stopped state
    let state = manager.getState();
    expect(state.status).toBe('stopped');
    expect(state.sessions_today).toBe(0);
    expect(state.hours_today).toBe(0);

    // Start a session
    manager.startSession('Chrome');
    state = manager.getState();
    expect(state.sessions_today).toBe(1);

    // End session
    manager.endSession();
    state = manager.getState();
    expect(state.sessions_today).toBe(1);
    expect(state.status).toBe('stopped');
  });

  it('refuses to record and sanitizes signals with string values as a strict privacy boundary', () => {
    manager.startSession('VS Code');
    const sessionId = manager.getState().active_session!.id;

    // Inject a string value using type coercion to simulate hostile input
    const badSignal = makeRawSignal({
      session_id: sessionId,
      numeric_value: 'stolen_credentials_or_data' as any,
    });

    expect(() => {
      manager.recordSignal(badSignal);
    }).toThrow(WrkmarkObserverError);

    // Verify database is untouched by this signal
    const signals = db.signals.getBySession(sessionId);
    expect(signals).toHaveLength(0);

    // Verify that the error event was saved in the append-only audit log
    const recentLogs = auditLog.getRecent(5);
    expect(recentLogs.some((log) => log.event_type === 'error')).toBe(true);
  });
});
