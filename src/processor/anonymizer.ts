/**
 * anonymizer.ts
 * 
 * The privacy enforcement layer. Every signal passes through here.
 * 
 * This is the most important file in the open-source codebase.
 * It enforces what Wrkmark can and cannot observe.
 * 
 * If this file says we don't collect something,
 * we structurally cannot collect it — it's filtered here.
 */

import type { RawSignal, AnonymizedSignal, SignalType } from '../types/index.js'
import { WrkmarkObserverError } from '../types/index.js'
import type { AuditLog } from '../privacy/audit-log.js'

/** 
 * The complete list of allowed signal types.
 * This is the source of truth for what Wrkmark collects.
 * Adding a new signal type here requires a public AGENTS.md update
 * and a major version bump of wrkmark-observer.
 */
const ALLOWED_SIGNAL_TYPES = new Set<SignalType>([
  'session_start',
  'session_end',
  'typing_rhythm_bucket',
  'pause_event',
  'undo_event',
  'file_switch',
  'ai_tool_opened',
  'build_run',
])

/**
 * Maximum length of app_name string.
 * App names are never more than 100 chars.
 * This also prevents injection of long strings via app_name.
 */
const MAX_APP_NAME_LENGTH = 100

export class SignalAnonymizer {
  constructor(private readonly auditLog: AuditLog) {}

  /**
   * Validate a raw signal from a collector.
   * Returns the validated signal type or throws if invalid.
   * 
   * Every rejection is recorded in the audit log so users can see
   * that we are enforcing our own rules.
   */
  validate(signal: RawSignal): SignalType {
    // Check signal type is in allowed list
    if (!ALLOWED_SIGNAL_TYPES.has(signal.signal_type as SignalType)) {
      this.auditLog.record('signal_rejected', {
        signal_type: signal.signal_type,
        app_name: signal.app_name,
        details: `Rejected: unknown signal type "${signal.signal_type}"`,
      })
      throw new WrkmarkObserverError(
        `Signal type "${signal.signal_type}" is not in the approved list`,
        'INVALID_SIGNAL_TYPE',
        { signal_type: signal.signal_type }
      )
    }

    return signal.signal_type as SignalType
  }

  /**
   * Anonymize a validated raw signal.
   * Strips all string content, keeps only numeric values and metadata.
   * 
   * This is where content protection is enforced structurally:
   * there is no field in AnonymizedSignal that can hold text content.
   */
  anonymize(signal: RawSignal): AnonymizedSignal {
    const signal_type = this.validate(signal)

    // Truncate app_name to safe length
    const app_name = signal.app_name
      .substring(0, MAX_APP_NAME_LENGTH)
      .trim()

    // numeric_value is the ONLY value field — no string content can survive
    const numeric_value = signal.numeric_value !== null
      ? this.sanitizeNumericValue(signal.numeric_value, signal_type)
      : null

    return {
      app_name,
      signal_type,
      numeric_value,
      timestamp: signal.timestamp,
      session_id: signal.session_id,
    }
  }

  /**
   * Sanitize numeric values to prevent encoded content.
   * Applies signal-type-specific range checks.
   */
  private sanitizeNumericValue(value: number, signal_type: SignalType): number {
    // Reject NaN and Infinity
    if (!isFinite(value)) return 0

    // Signal-specific range validation
    switch (signal_type) {
      case 'typing_rhythm_bucket':
        // Bucket index: 0-50 (representing 0-5000ms intervals)
        return Math.max(0, Math.min(50, Math.round(value)))
      
      case 'pause_event':
        // Pause duration in seconds: 10 to 3600 (max 1 hour pause)
        return Math.max(10, Math.min(3600, Math.round(value)))
      
      case 'undo_event':
      case 'file_switch':
      case 'build_run':
        // Count: 0 to 10000
        return Math.max(0, Math.min(10000, Math.round(value)))
      
      case 'ai_tool_opened':
        // Boolean as number: 0 or 1 only
        return value > 0 ? 1 : 0
      
      default:
        // For session_start/end: timestamp in ms (large number, but valid)
        return Math.round(value)
    }
  }
}