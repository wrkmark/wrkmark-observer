/**
 * session-manager.ts
 *
 * The central orchestrator. Everything in wrkmark-observer
 * flows through here — signals come in, sessions get tracked,
 * features get extracted when a session ends.
 *
 * What this is NOT: a data pipeline, a sync engine, or anything
 * that touches the network. Pure local state management.
 */

import crypto from 'node:crypto';
import type { 
  RawSignal, 
  ActiveSession, 
  CompletedSession, 
  ObserverState, 
  ObserverStatus 
} from './types/index.js';
import { WrkmarkObserverError } from './types/index.js';
import type { WrkmarkDb } from './db/database.js';
import type { AuditLog } from './privacy/audit-log.js';
import type { SignalAnonymizer } from './processor/anonymizer.js';
import type { SignalExtractor } from './processor/signal-extractor.js';

export class SessionManager {
  private status: ObserverStatus = 'stopped';
  private activeSession: ActiveSession | null = null;
  private lastError: string | null = null;

  /**
   * Constructs a new SessionManager instance.
   *
   * All dependencies are injected externally to keep the coordinator testable
   * and clean of environment-specific side-effects.
   *
   * @param db - Local SQLite database wrapper.
   * @param auditLog - Hash-chained audit logger.
   * @param anonymizer - Signal validation and filtering engine.
   * @param extractor - On-device features calculator.
   */
  constructor(
    private readonly db: WrkmarkDb,
    private readonly auditLog: AuditLog,
    private readonly anonymizer: SignalAnonymizer,
    private readonly extractor: SignalExtractor
  ) {}

  /**
   * Retrieves the current local ObserverState.
   *
   * Re-queries the local database on demand to compute up-to-date metrics
   * like sessions today and accumulated work hours in the local timezone.
   *
   * @returns Comprehensive ObserverState.
   */
  getState(): ObserverState {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    // Query database for sessions started today to compute daily statistics.
    // Privacy guarantee: This query only retrieves started_at and ended_at timestamps.
    const sessionsToday = this.db.sessions.getSince(startOfTodayMs);
    const sessions_today = sessionsToday.length;

    let totalDurationMs = 0;
    for (const s of sessionsToday) {
      if (s.ended_at !== null) {
        totalDurationMs += (s.ended_at - s.started_at);
      } else if (this.activeSession && s.id === this.activeSession.id) {
        // Compute running duration up to the current millisecond for active sessions.
        totalDurationMs += (Date.now() - s.started_at);
      }
    }

    const hours_today = Math.round((totalDurationMs / 3600000) * 100) / 100;

    return {
      status: this.status,
      active_session: this.activeSession,
      current_app: this.activeSession?.app_name ?? null,
      sessions_today,
      hours_today,
      last_error: this.lastError,
    };
  }

  /**
   * Starts watching a new work session for the given app.
   *
   * One session at a time — calling this while a session is
   * already active throws rather than silently replacing it.
   * We'd rather be loud about state mistakes than hide them.
   *
   * @param appName - Active application name, trimmed to 100 chars.
   * @throws WrkmarkObserverError SESSION_ALREADY_ACTIVE if busy.
   */
  startSession(appName: string): void {
    try {
      if (this.activeSession) {
        throw new WrkmarkObserverError(
          'Cannot start a new session — one is already running. Call endSession() first, or check getState().status.',
          'SESSION_ALREADY_ACTIVE'
        );
      }

      const trimmedAppName = appName.trim().substring(0, 100);

      // Using crypto.randomUUID() here instead of a sequential ID
      // because session IDs occasionally appear in audit logs
      // that users can export. Random UUIDs give no timing info.
      const sessionId = crypto.randomUUID();

      const session: ActiveSession = {
        id: sessionId,
        app_name: trimmedAppName,
        started_at: Date.now(),
        signal_count: 0,
        ai_tool_opened: false,
      };

      this.db.sessions.insert(session);
      this.auditLog.record('session_started', { app_name: trimmedAppName });

      this.status = 'active';
      this.activeSession = session;
      this.lastError = null;
    } catch (err) {
      this.logAndPropagateError(err);
    }
  }

  /**
   * Evaluates and records a raw behavioral signal during an active session.
   *
   * Automatically validates, filters, and anonymizes the raw event, storing
   * the numeric results in the database and updating the active session stats.
   *
   * @param raw - Raw unvalidated behavior signal.
   * @throws WrkmarkObserverError NO_ACTIVE_SESSION if no session is running.
   */
  recordSignal(raw: RawSignal): void {
    try {
      // Paused sessions keep their session alive — signals
      // are just dropped. This lets users resume without
      // losing their session context.
      if (this.status === 'paused') {
        return;
      }

      if (this.status === 'stopped' || !this.activeSession) {
        throw new WrkmarkObserverError(
          'No session is currently active. Call startSession(appName) before recording signals.',
          'NO_ACTIVE_SESSION'
        );
      }

      // Privacy guarantee: We count signals here, never read their content.
      // We reject any string values to ensure no raw user typed content can bypass typescript checks.
      if (typeof raw.numeric_value === 'string') {
        throw new WrkmarkObserverError(
          'Privacy violation: signal value cannot be a string.',
          'STRING_VALUE_REJECTED'
        );
      }

      // Privacy guarantee: We count signals here, never read their content.
      // signal_value stays in the database — this method only cares that the signal happened, not what it said.
      const anonymized = this.anonymizer.anonymize(raw);

      this.db.signals.insert(anonymized, this.activeSession.id);
      this.activeSession.signal_count += 1;

      if (anonymized.signal_type === 'ai_tool_opened') {
        this.activeSession.ai_tool_opened = true;
      }

      this.auditLog.record('signal_captured', {
        signal_type: anonymized.signal_type,
        app_name: anonymized.app_name,
      });
    } catch (err) {
      this.logAndPropagateError(err);
    }
  }

  /**
   * Finalizes tracking on the active session, calculates features on-device,
   * and saves the results to the database.
   *
   * @returns The fully calculated and finalized CompletedSession.
   * @throws WrkmarkObserverError NO_ACTIVE_SESSION if no active session is found.
   */
  endSession(): CompletedSession {
    try {
      if (!this.activeSession) {
        throw new WrkmarkObserverError(
          'No session is currently active. Call startSession(appName) before recording signals.',
          'NO_ACTIVE_SESSION'
        );
      }

      const endedAt = Date.now();
      const sessionId = this.activeSession.id;

      this.db.sessions.end(sessionId, endedAt);

      const completedSession: CompletedSession = {
        id: this.activeSession.id,
        app_name: this.activeSession.app_name,
        started_at: this.activeSession.started_at,
        ended_at: endedAt,
        duration_ms: endedAt - this.activeSession.started_at,
        signal_count: this.activeSession.signal_count,
        ai_tool_opened: this.activeSession.ai_tool_opened,
        synced_to_server: false,
      };

      // Extract behavioral vectors locally.
      // Privacy guarantee: FeatureExtractor reads counts, not string content.
      const features = this.extractor.extractFeatures(completedSession);
      this.db.features.insert(features);

      this.auditLog.record('session_ended', { app_name: completedSession.app_name });

      this.activeSession = null;
      this.status = 'stopped';

      return completedSession;
    } catch (err) {
      this.logAndPropagateError(err);
      throw err; // TypeScript type analysis requires explicit throw or return here.
    }
  }

  /**
   * Pauses the active observation without discarding session context.
   *
   * Signals recorded during a paused state are silently ignored.
   */
  pause(): void {
    if (this.status === 'active') {
      this.status = 'paused';
      this.auditLog.record('observation_paused');
    }
  }

  /**
   * Resumes active observation of a paused work session.
   */
  resume(): void {
    if (this.status === 'paused') {
      this.status = 'active';
      this.auditLog.record('observation_resumed');
    }
  }

  /**
   * Registers error state locally and records it to the tamper-evident audit log.
   */
  private logAndPropagateError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    this.lastError = message;

    this.auditLog.record('error', {
      details: message.substring(0, 200),
    });

    throw err;
  }
}
