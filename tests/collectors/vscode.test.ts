/**
 * vscode.test.ts
 *
 * Unit tests for the VSCodeCollector class.
 * Asserts correct translation of editor state events into behavior-safe signals,
 * timing bucket divisions, debounce functionality, and strict privacy boundaries.
 *
 * What this file does NOT do:
 * - Does NOT start a real VS Code editor runtime.
 * - Does NOT write signals to the database directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VSCodeCollector } from '../../src/collectors/vscode.js';
import type { ActiveSession, ObserverStatus } from '../../src/types/index.js';

describe('VSCodeCollector — VS Code Signal Harvesting', () => {
  let collector: VSCodeCollector;
  let mockSession: ActiveSession;
  let mockSessionManager: any;

  beforeEach(() => {
    vi.useFakeTimers();

    collector = new VSCodeCollector();

    mockSession = {
      id: 'test-session-id',
      app_name: 'VS Code',
      started_at: Date.now(),
      signal_count: 0,
      ai_tool_opened: false,
    };

    mockSessionManager = {
      getState: vi.fn(() => ({
        status: 'active' as ObserverStatus,
        activeSession: mockSession,
        current_app: 'VS Code',
        sessions_today: 1,
        hours_today: 0.5,
        last_error: null,
      })),
      recordSignal: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions to running state on start', () => {
    collector.start(mockSessionManager);
    expect(collector.isRunning()).toBe(true);
  });

  it('resets tracking and running flags on stop', () => {
    collector.start(mockSessionManager);
    collector.stop();
    expect(collector.isRunning()).toBe(false);
  });

  it('ignores typing events when not active', () => {
    collector.onKeystroke(1000);
    collector.onKeystroke(1500);

    expect(mockSessionManager.recordSignal).not.toHaveBeenCalled();
  });

  it('emits a typing rhythm bucket signal starting on the second keystroke', () => {
    collector.start(mockSessionManager);

    // First keystroke establishes baseline
    collector.onKeystroke(1000);
    expect(mockSessionManager.recordSignal).not.toHaveBeenCalled();

    // Second keystroke records interval (1500 - 1000 = 500ms -> bucket 5)
    collector.onKeystroke(1500);
    expect(mockSessionManager.recordSignal).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        app_name: 'VS Code',
        signal_type: 'typing_rhythm_bucket',
        numeric_value: 5,
        timestamp: 1500,
      })
    );
  });

  it('does not record a rhythm bucket on the first keystroke of a sequence', () => {
    collector.start(mockSessionManager);
    collector.onKeystroke(1000);
    expect(mockSessionManager.recordSignal).not.toHaveBeenCalled();
  });

  it('categorizes intervals into appropriate 100ms buckets', () => {
    collector.start(mockSessionManager);

    // 250ms interval -> Math.floor(250 / 100) = bucket 2
    collector.onKeystroke(1000);
    collector.onKeystroke(1250);
    expect(mockSessionManager.recordSignal).toHaveBeenLastCalledWith(
      expect.objectContaining({ numeric_value: 2 })
    );

    // 890ms interval -> Math.floor(890 / 100) = bucket 8
    collector.onKeystroke(2140);
    expect(mockSessionManager.recordSignal).toHaveBeenLastCalledWith(
      expect.objectContaining({ numeric_value: 8 })
    );
  });

  it('caps the rhythm bucket value at 50 for slow keystrokes', () => {
    collector.start(mockSessionManager);

    // 6000ms interval -> Math.floor(6000 / 100) = 60, capped at 50
    collector.onKeystroke(1000);
    collector.onKeystroke(7000);
    expect(mockSessionManager.recordSignal).toHaveBeenLastCalledWith(
      expect.objectContaining({ numeric_value: 50 })
    );
  });

  it('records a pause event with duration translated to seconds', () => {
    collector.start(mockSessionManager);
    collector.onKeystroke(1000);

    // Trigger pause after 15 seconds (15000ms -> 15 seconds)
    collector.onPause(16000);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'pause_event',
        numeric_value: 15,
        timestamp: 16000,
      })
    );
  });

  it('ignores pauses shorter than the 10-second threshold', () => {
    collector.start(mockSessionManager);
    collector.onKeystroke(1000);

    // 5 seconds pause (5000ms) is below 10-second (10000ms) threshold
    collector.onPause(6000);

    expect(mockSessionManager.recordSignal).not.toHaveBeenCalled();
  });

  it('captures user undo events as a count increment', () => {
    collector.start(mockSessionManager);
    collector.onUndo(2000);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'undo_event',
        numeric_value: 1,
        timestamp: 2000,
      })
    );
  });

  it('captures document file switches', () => {
    collector.start(mockSessionManager);
    collector.onFileSwitch(3000);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'file_switch',
        numeric_value: 1,
        timestamp: 3000,
      })
    );
  });

  it('debounces document switches occurring within the debounce limit', () => {
    collector.start(mockSessionManager);
    
    // First switch
    collector.onFileSwitch(3000);
    // Rapid second switch at 3200ms (200ms gap, below 500ms threshold)
    collector.onFileSwitch(3200);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledTimes(1);

    // Third switch at 3600ms (600ms gap from first switch, 400ms from second switch)
    // Wait! Debounce checks timestamp - lastFileSwitchTime.
    // If the second switch was ignored, lastFileSwitchTime is still 3000ms.
    // So 3600 - 3000 = 600ms, which is > 500ms. So it should succeed!
    collector.onFileSwitch(3600);
    expect(mockSessionManager.recordSignal).toHaveBeenCalledTimes(2);
  });

  it('captures AI helper usage signals', () => {
    collector.start(mockSessionManager);
    collector.onAIToolSwitch(4000);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'ai_tool_opened',
        numeric_value: 1,
        timestamp: 4000,
      })
    );
  });

  it('captures terminal build executions', () => {
    collector.start(mockSessionManager);
    collector.onBuildRun(5000);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'build_run',
        numeric_value: 1,
        timestamp: 5000,
      })
    );
  });

  it('tracks typing rhythm without caring what was typed', () => {
    collector.start(mockSessionManager);
    collector.onKeystroke(1000);
    collector.onKeystroke(1500);

    // Structural confirmation: the test confirms the call contains no string characters or keys.
    const recordedArgs = mockSessionManager.recordSignal.mock.calls[0][0];
    expect(recordedArgs.numeric_value).toBe(5);
    expect(recordedArgs).not.toHaveProperty('key');
    expect(recordedArgs).not.toHaveProperty('content');
  });

  it('silently ignores signals when no active session is found', () => {
    mockSessionManager.getState.mockReturnValueOnce({
      status: 'stopped',
      activeSession: null,
      current_app: null,
      sessions_today: 0,
      hours_today: 0,
      last_error: null,
    });

    collector.start(mockSessionManager);
    collector.onUndo(1000);

    expect(mockSessionManager.recordSignal).not.toHaveBeenCalled();
  });

  it('records a pause event automatically after the timeout fires', () => {
    collector.start(mockSessionManager);
    collector.onKeystroke(1000);

    // Advance time by 10 seconds to trigger the pause timeout
    vi.advanceTimersByTime(10000);

    expect(mockSessionManager.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'pause_event',
        numeric_value: 10,
      })
    );
  });
});
