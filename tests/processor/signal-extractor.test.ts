/**
 * signal-extractor.test.ts
 * 
 * Unit tests for the SignalExtractor class.
 * Validates feature extraction calculations (focus_ratio, revision_intensity, etc.),
 * boundary conditions (e.g. sessions under 5 minutes), and ensures compliance with
 * strict on-device privacy constraints.
 * 
 * What this file does NOT do:
 * - It does NOT test telemetry synchronization or remote networking logic.
 * - It does NOT write persistent files to the local disk.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { SignalExtractor } from '../../src/processor/signal-extractor.js';
import type { WrkmarkDb } from '../../src/db/database.js';
import type { CompletedSession, AnonymizedSignal } from '../../src/types/index.js';

describe('SignalExtractor — Behavioral Feature Vectors Extraction', () => {
  let db: WrkmarkDb;
  let extractor: SignalExtractor;

  beforeEach(() => {
    db = createDatabase(':memory:');
    extractor = new SignalExtractor(db);
  });

  const createTestSession = (overrides: Partial<CompletedSession> = {}): CompletedSession => {
    const session: CompletedSession = {
      id: 'session-123',
      app_name: 'VS Code',
      started_at: 1625097600000,
      ended_at: 1625098200000, // 10 minutes default
      duration_ms: 600000, // 10 minutes default
      signal_count: 0,
      ai_tool_opened: false,
      synced_to_server: false,
      ...overrides,
    };
    db.sessions.insert({
      id: session.id,
      app_name: session.app_name,
      started_at: session.started_at,
      signal_count: session.signal_count,
      ai_tool_opened: session.ai_tool_opened,
    });
    return session;
  };

  const insertSignalsHelper = (
    sessionId: string,
    type: 'typing_rhythm_bucket' | 'undo_event' | 'pause_event' | 'ai_tool_opened',
    count: number,
    numericValue: number | null = 1
  ) => {
    for (let i = 0; i < count; i++) {
      const signal: AnonymizedSignal = {
        timestamp: 1625097600000 + i * 1000,
        app_name: 'VS Code',
        signal_type: type,
        numeric_value: numericValue,
        session_id: sessionId,
      };
      db.signals.insert(signal, sessionId);
    }
  };

  it('extractFeatures() returns correct FeatureVector shape', () => {
    const session = createTestSession();
    insertSignalsHelper(session.id, 'typing_rhythm_bucket', 5);

    const vector = extractor.extractFeatures(session);
    expect(vector).toBeDefined();
    expect(vector.session_id).toBe(session.id);
    expect(typeof vector.computed_at).toBe('number');
    expect(vector.duration_minutes).toBe(10.0);
    expect(typeof vector.focus_ratio).toBe('number');
    expect(typeof vector.revision_intensity).toBe('number');
    expect(typeof vector.used_ai_tools).toBe('boolean');
    expect(vector.relative_velocity).toBe(1.0);
    expect(vector.synced_to_server).toBe(false);
  });

  it('focus_ratio is 0 for sessions under 5 minutes', () => {
    // 4 minutes session (240000 ms)
    const session = createTestSession({
      ended_at: 1625097840000,
      duration_ms: 240000,
    });
    // Even if signals exist, focus_ratio must be 0
    insertSignalsHelper(session.id, 'typing_rhythm_bucket', 10);

    const vector = extractor.extractFeatures(session);
    expect(vector.focus_ratio).toBe(0.0);
  });

  it('focus_ratio is capped at 1.0', () => {
    const session = createTestSession(); // 10 minutes -> expectedBuckets = 20
    // Insert 25 typing signals (would result in 25/20 = 1.25 focus ratio)
    insertSignalsHelper(session.id, 'typing_rhythm_bucket', 25);

    const vector = extractor.extractFeatures(session);
    expect(vector.focus_ratio).toBe(1.0);
  });

  it('revision_intensity is capped at 1.0', () => {
    const session = createTestSession(); // 10 minutes -> normalization factor is /10 /10 => /100
    // Insert 110 undo/pause events (110 / 10 / 10 = 1.1)
    insertSignalsHelper(session.id, 'undo_event', 60);
    insertSignalsHelper(session.id, 'pause_event', 50);

    const vector = extractor.extractFeatures(session);
    expect(vector.revision_intensity).toBe(1.0);
  });

  it('used_ai_tools is true when ai_tool_opened signal exists', () => {
    const session = createTestSession();
    insertSignalsHelper(session.id, 'ai_tool_opened', 1);

    const vector = extractor.extractFeatures(session);
    expect(vector.used_ai_tools).toBe(true);
  });

  it('used_ai_tools is false when no ai_tool_opened signal exists', () => {
    const session = createTestSession();

    const vector = extractor.extractFeatures(session);
    expect(vector.used_ai_tools).toBe(false);
  });

  it('relative_velocity is always 1.0 at MVP', () => {
    const session = createTestSession();
    const vector = extractor.extractFeatures(session);
    expect(vector.relative_velocity).toBe(1.0);
  });

  it('duration_minutes is correctly calculated', () => {
    // 7 minutes 30 seconds session (450000 ms) -> 7.5 minutes
    const session = createTestSession({
      ended_at: 1625098050000,
      duration_ms: 450000,
    });

    const vector = extractor.extractFeatures(session);
    expect(vector.duration_minutes).toBe(7.5);
  });

  it('Privacy: computations use signal counts not signal values', () => {
    const sessionNormal = createTestSession({ id: 'session-normal' });
    const sessionLarge = createTestSession({ id: 'session-large' });

    // Both sessions get the exact same signal counts (5 typing, 2 undo, 2 pause)
    // but the large session uses very large numeric values
    insertSignalsHelper(sessionNormal.id, 'typing_rhythm_bucket', 5, 2);
    insertSignalsHelper(sessionNormal.id, 'undo_event', 2, 1);
    insertSignalsHelper(sessionNormal.id, 'pause_event', 2, 12);

    insertSignalsHelper(sessionLarge.id, 'typing_rhythm_bucket', 5, 50);
    insertSignalsHelper(sessionLarge.id, 'undo_event', 2, 1000);
    insertSignalsHelper(sessionLarge.id, 'pause_event', 2, 3600);

    const vectorNormal = extractor.extractFeatures(sessionNormal);
    const vectorLarge = extractor.extractFeatures(sessionLarge);

    // Assert focus_ratio and revision_intensity are identical
    expect(vectorNormal.focus_ratio).toBe(vectorLarge.focus_ratio);
    expect(vectorNormal.revision_intensity).toBe(vectorLarge.revision_intensity);

    // Verify focus_ratio and revision_intensity calculations:
    // focus_ratio = 5 / (10 / 0.5) = 5 / 20 = 0.25
    expect(vectorNormal.focus_ratio).toBe(0.25);
    // revision_intensity = (2 + 2) / 10 / 10 = 4 / 100 = 0.04
    expect(vectorNormal.revision_intensity).toBe(0.04);
  });
});
