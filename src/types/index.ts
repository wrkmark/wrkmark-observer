import type { SessionManager } from '../session-manager.js';

/**
 * Core types for wrkmark-observer.
 * These are the only data shapes that flow through the system.
 * 
 * Privacy guarantee: No type here contains free-form string fields
 * that could accidentally capture user content.
 */

// ─── Signal Types ────────────────────────────────────────────────────────────

/** Every signal type that wrkmark-observer is allowed to emit. Nothing else. */
export type SignalType =
  | 'session_start'
  | 'session_end'
  | 'typing_rhythm_bucket'
  | 'pause_event'
  | 'undo_event'
  | 'file_switch'
  | 'ai_tool_opened'
  | 'build_run'

/** 
 * A raw signal from a collector — not yet validated.
 * Note: string_value is intentionally limited and will be stripped
 * during anonymization if it contains unexpected content.
 */
export interface RawSignal {
  app_name: string          // e.g. "VS Code", "Chrome"
  signal_type: string       // unvalidated — validated in anonymizer
  numeric_value: number | null  // the signal's numeric content
  timestamp: number         // Unix ms
  session_id: string        // UUID of current session
}

/**
 * A validated, anonymized signal — safe to store.
 * Only exists after passing through the anonymizer.
 */
export interface AnonymizedSignal {
  app_name: string          // app name only, max 100 chars
  signal_type: SignalType   // validated against allowed list
  numeric_value: number | null
  timestamp: number
  session_id: string
}

// ─── Session Types ────────────────────────────────────────────────────────────

/** A work session being actively tracked */
export interface ActiveSession {
  id: string                // UUID
  app_name: string
  started_at: number        // Unix ms
  signal_count: number
  ai_tool_opened: boolean
}

/** A completed work session with all metrics */
export interface CompletedSession {
  id: string
  app_name: string
  started_at: number
  ended_at: number
  duration_ms: number
  signal_count: number
  ai_tool_opened: boolean
  synced_to_server: boolean
}

// ─── Feature Types ─────────────────────────────────────────────────────────

/**
 * Behavioral features derived from a completed session.
 * These are computed ON DEVICE from raw signals.
 * Only these (not raw signals) are ever transmitted to Wrkmark servers.
 */
export interface FeatureVector {
  session_id: string
  computed_at: number       // Unix ms
  duration_minutes: number
  
  /** 
   * Ratio of active typing time to total session time (0.0 - 1.0)
   * Higher = more focused, less distracted
   */
  focus_ratio: number

  /**
   * Normalised measure of undo/pause patterns (0.0 - 1.0)
   * Proxy for thoughtful revision behaviour
   */
  revision_intensity: number

  /**
   * Whether AI tools were used in this session
   * Stored as boolean — no detail about what was used
   */
  used_ai_tools: boolean

  /**
   * Velocity relative to user's own 30-day baseline (0.0 - 2.0)
   * 1.0 = exactly average. Never an absolute measure.
   */
  relative_velocity: number

  synced_to_server: boolean
}

// ─── Audit Types ──────────────────────────────────────────────────────────

/** Every observation produces an audit entry. These form a hash chain. */
export interface AuditEntry {
  id?: number               // auto-increment from SQLite
  timestamp: number         // Unix ms
  event_type: AuditEventType
  app_name: string | null
  signal_type: string | null
  bytes_transmitted: number // 0 if local-only operation
  recipient: AuditRecipient
  details: string | null    // max 200 chars, no user content
  prev_hash: string | null  // hash of previous audit entry
  record_hash: string       // SHA256 of this entry's content
}

export type AuditEventType =
  | 'signal_captured'
  | 'signal_rejected'
  | 'session_started'
  | 'session_ended'
  | 'features_extracted'
  | 'data_transmitted'
  | 'observation_paused'
  | 'observation_resumed'
  | 'data_deleted'
  | 'error'

export type AuditRecipient =
  | 'local_only'
  | 'mirror_server'
  | 'none'

// ─── Observer State ──────────────────────────────────────────────────────

export type ObserverStatus = 'active' | 'paused' | 'stopped' | 'error'

export interface ObserverState {
  status: ObserverStatus
  active_session: ActiveSession | null
  current_app: string | null
  sessions_today: number
  hours_today: number
  last_error: string | null
}

// ─── Errors ───────────────────────────────────────────────────────────────

export class WrkmarkObserverError extends Error {
  constructor(
    message: string,
    public readonly code: ObserverErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'WrkmarkObserverError'
  }
}

export type ObserverErrorCode =
  | 'INVALID_SIGNAL_TYPE'
  | 'STRING_VALUE_REJECTED'
  | 'AUDIT_CHAIN_BROKEN'
  | 'DB_WRITE_FAILED'
  | 'COLLECTOR_INIT_FAILED'
  | 'SESSION_ALREADY_ACTIVE'
  | 'NO_ACTIVE_SESSION'

// ─── Collectors ──────────────────────────────────────────────────────────

export interface ICollector {
  readonly name: string;
  start(sessionManager: SessionManager): void;
  stop(): void;
  isRunning(): boolean;
}