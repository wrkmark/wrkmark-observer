/**
 * signal-extractor.ts
 * 
 * Computes high-level, aggregate behavioral feature vectors from the raw anonymized signals
 * of a completed work session on the user's local device.
 * 
 * What this file does NOT do:
 * - It does NOT read, inspect, or process string value content (e.g. signal_value as string).
 * - It does NOT perform direct database connections or raw SQLite queries.
 * - It does NOT transmit features or session data to any remote servers.
 * - It does NOT process unanonymized signal data.
 */

import type { 
  CompletedSession, 
  FeatureVector, 
  SignalType 
} from '../types/index.js';
import type { WrkmarkDb, RawSignalRow } from '../db/database.js';

export class SignalExtractor {
  /**
   * Constructs a new SignalExtractor instance.
   * 
   * @param db - The database instance injected for signal retrieval.
   */
  constructor(private readonly db: WrkmarkDb) {}

  /**
   * Extracts a behavioral FeatureVector from raw signals of a completed session.
   * 
   * @param session - The completed work session details.
   * @returns The computed behavioral FeatureVector.
   */
  extractFeatures(session: CompletedSession): FeatureVector {
    const signals = this.db.signals.getBySession(session.id);
    const duration_minutes = Math.round((session.duration_ms / 60000) * 100) / 100;

    // Privacy rule check: Confirm that we never read `signal_value` as a string.
    // All calculation blocks below only count signal occurrences or check for type existence.
    
    // Focus Ratio calculation:
    // Focus ratio is based on typing rhythm buckets. We divide typing signals by the expected buckets.
    // Privacy check: Computes using signal count only. Does not inspect signal_value contents.
    let focus_ratio = 0.0;
    if (!this.isSessionTooShort(session) && duration_minutes > 0) {
      const activeTypingSignals = this.countSignalType(signals, 'typing_rhythm_bucket');
      const expectedBuckets = duration_minutes / 0.5;
      focus_ratio = Math.min(1.0, activeTypingSignals / expectedBuckets);
    }

    // Revision Intensity calculation:
    // Proxy for thoughtful, iterative behavior using pause and undo count.
    // Privacy check: Computes using signal counts only. Does not inspect signal_value contents.
    let revision_intensity = 0.0;
    if (duration_minutes > 0) {
      const undoCount = this.countSignalType(signals, 'undo_event');
      const pauseCount = this.countSignalType(signals, 'pause_event');
      revision_intensity = Math.min(1.0, (undoCount + pauseCount) / duration_minutes / 10);
    }

    // Used AI Tools calculation:
    // Checks presence of any 'ai_tool_opened' signal.
    // Privacy check: Only checks the type field, never details or values.
    const used_ai_tools = signals.some(
      (sig) => sig.signal_type === 'ai_tool_opened'
    );

    // Relative Velocity:
    // Placeholder MVP logic (always 1.0) to be compared with baseline in Phase 2.
    // TODO: compare against 30-day baseline in Phase 2.
    // Privacy check: Constant value. Does not inspect signal_value contents.
    const relative_velocity = 1.0;

    return {
      session_id: session.id,
      computed_at: Date.now(),
      duration_minutes,
      focus_ratio,
      revision_intensity,
      used_ai_tools,
      relative_velocity,
      synced_to_server: false,
    };
  }

  /**
   * Helper to count signals of a specific type.
   * 
   * @param signals - Array of RawSignalRow records.
   * @param type - The signal type to filter and count.
   * @returns The count of signals of the specified type.
   */
  private countSignalType(signals: RawSignalRow[], type: SignalType): number {
    // Privacy check: Counts records matching signal_type without inspecting signal_value.
    return signals.filter((sig) => sig.signal_type === type).length;
  }

  /**
   * Helper to check if a session is too short to extract focus metrics.
   * 
   * @param session - The completed work session.
   * @returns True if session duration is less than 5 minutes (300,000 ms), otherwise false.
   */
  private isSessionTooShort(session: CompletedSession): boolean {
    return session.duration_ms < 300000;
  }
}
