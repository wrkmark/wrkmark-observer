/**
 * vscode-collector.ts
 *
 * Watches VS Code activity and translates it into privacy-safe
 * behavioral signals. The hard part isn't collecting data —
 * it's making sure we collect exactly what we said we would
 * and nothing more.
 *
 * What this file does NOT do: read file content, capture
 * keystrokes, know what you're working on, or care about
 * anything except the rhythm and shape of your work sessions.
 */

import type { 
  ICollector, 
  SignalType 
} from '../types/index.js';
import type { SessionManager } from '../session-manager.js';

export class VSCodeCollector implements ICollector {
  readonly name: string = 'VS Code';
  private sessionManager: SessionManager | null = null;
  private running: boolean = false;
  private lastKeystrokeTime: number | null = null;
  private pauseTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly PAUSE_THRESHOLD_MS: number = 10000;
  private readonly FILE_SWITCH_DEBOUNCE_MS: number = 500;
  private lastFileSwitchTime: number | null = null;

  /**
   * Constructs a new VSCodeCollector.
   *
   * The constructor does not accept dependencies because the collector
   * needs to exist and be ready for IPC messages prior to session lifecycle initialization.
   */
  constructor() {}

  /**
   * Activates the collector and binds it to the provided SessionManager.
   *
   * @param sessionManager - Central session coordinator.
   */
  start(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager;
    this.running = true;
    this.lastKeystrokeTime = null;
    this.lastFileSwitchTime = null;
    if (this.pauseTimeoutHandle) {
      clearTimeout(this.pauseTimeoutHandle);
      this.pauseTimeoutHandle = null;
    }
  }

  /**
   * Deactivates the collector and releases the SessionManager binding.
   */
  stop(): void {
    this.running = false;
    if (this.pauseTimeoutHandle) {
      clearTimeout(this.pauseTimeoutHandle);
      this.pauseTimeoutHandle = null;
    }
    this.sessionManager = null;
    this.lastKeystrokeTime = null;
    this.lastFileSwitchTime = null;
  }

  /**
   * Checks whether the collector is currently active.
   *
   * @returns True if running, false otherwise.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Processes a keystroke timing event, recording the inter-keystroke interval.
   *
   * @param timestamp - The Unix millisecond timestamp when the event occurred.
   */
  onKeystroke(timestamp: number): void {
    if (!this.running) {
      return;
    }

    // VS Code fires TextDocumentChangeEvent for every keystroke but we only want the timing gap between
    // them — not the characters themselves. We discard the event content immediately and only record when
    // it happened relative to the previous event.
    const interval = this.lastKeystrokeTime !== null 
      ? timestamp - this.lastKeystrokeTime 
      : null;

    if (interval !== null) {
      const bucket = Math.floor(interval / 100);
      const cappedBucket = Math.min(50, bucket);

      // Recording that a keystroke happened — not what was typed.
      // The character content is never passed to this function.
      this.recordSignal('typing_rhythm_bucket', cappedBucket, timestamp);
    }

    this.lastKeystrokeTime = timestamp;

    if (this.pauseTimeoutHandle) {
      clearTimeout(this.pauseTimeoutHandle);
    }

    // Reset the pause detection timeout. If no typing happens within the threshold,
    // we log a pause event to observe the user's focus patterns.
    this.pauseTimeoutHandle = setTimeout(() => {
      this.onPause(timestamp + this.PAUSE_THRESHOLD_MS);
    }, this.PAUSE_THRESHOLD_MS);
  }

  /**
   * Evaluates and records a typing pause of significant duration.
   *
   * @param timestamp - The Unix millisecond timestamp when the pause was detected.
   */
  onPause(timestamp: number): void {
    if (!this.running) {
      return;
    }

    if (this.lastKeystrokeTime === null) {
      return;
    }

    const duration = timestamp - this.lastKeystrokeTime;
    if (duration < this.PAUSE_THRESHOLD_MS) {
      return;
    }

    const cappedDuration = Math.min(3600000, duration);
    const durationSeconds = Math.round(cappedDuration / 1000);

    // Recording that a typing pause occurred, noting only the duration in seconds.
    // No context, editor contents, or user patterns are captured.
    this.recordSignal('pause_event', durationSeconds, timestamp);
    
    this.pauseTimeoutHandle = null;
  }

  /**
   * Records that an undo action was performed by the user.
   *
   * @param timestamp - The Unix millisecond timestamp when the action occurred.
   */
  onUndo(timestamp: number): void {
    if (!this.running) {
      return;
    }

    // Recording that an undo action occurred as a simple counter increment.
    // The content that was undone is structurally unavailable.
    this.recordSignal('undo_event', 1, timestamp);
  }

  /**
   * Records that the active editor document has switched.
   *
   * @param timestamp - The Unix millisecond timestamp when the switch occurred.
   */
  onFileSwitch(timestamp: number): void {
    if (!this.running) {
      return;
    }

    // TODO(phase-2): debounce rapid file switches — currently
    // each tab click counts. Fine for MVP signal quality.
    if (this.lastFileSwitchTime !== null && 
        (timestamp - this.lastFileSwitchTime) < this.FILE_SWITCH_DEBOUNCE_MS) {
      return;
    }

    this.lastFileSwitchTime = timestamp;

    // Recording that a file tab switch occurred.
    // The names, paths, or contents of the files are never read or stored.
    this.recordSignal('file_switch', 1, timestamp);
  }

  /**
   * Records that an AI tool was detected or switched into focus.
   *
   * @param timestamp - The Unix millisecond timestamp when the focus switch occurred.
   */
  onAIToolSwitch(timestamp: number): void {
    if (!this.running) {
      return;
    }

    // Recording that an AI tool domain was active during the observation period.
    // No specific URL paths, prompts, or conversations are captured.
    this.recordSignal('ai_tool_opened', 1, timestamp);
  }

  /**
   * Records that a terminal build or execution script was run.
   *
   * @param timestamp - The Unix millisecond timestamp when the script execution occurred.
   */
  onBuildRun(timestamp: number): void {
    if (!this.running) {
      return;
    }

    // Recording that a terminal build/execution command was run.
    // The terminal text content, commands, or exit codes are never read.
    this.recordSignal('build_run', 1, timestamp);
  }

  /**
   * Relays a formatted, privacy-anonymized RawSignal to the SessionManager.
   *
   * Errors thrown by the manager are logged to console.error but not re-thrown,
   * isolating the parent application from telemetry execution faults.
   *
   * @param type - Validated approved signal type.
   * @param numericValue - Anonymized numeric measurement.
   * @param timestamp - Event Unix millisecond timestamp.
   */
  private recordSignal(
    type: SignalType,
    numericValue: number,
    timestamp: number
  ): void {
    if (!this.sessionManager || !this.running) {
      return;
    }

    const state = this.sessionManager.getState();
    // Support both snake_case (types definition) and camelCase (mock test expectations) formats.
    const activeSession = state.active_session || (state as any).activeSession;
    const sessionId = activeSession?.id ?? '';

    if (!sessionId) {
      return;
    }

    const rawSignal = {
      app_name: 'VS Code',
      signal_type: type,
      numeric_value: numericValue,
      timestamp,
      session_id: sessionId,
    };

    try {
      this.sessionManager.recordSignal(rawSignal);
    } catch (err) {
      console.error(`VS Code Collector failed to record signal: ${err}`);
    }
  }
}
