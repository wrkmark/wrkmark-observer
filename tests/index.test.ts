/**
 * index.test.ts
 *
 * Integration and sanity smoke tests for the public index entry point of wrkmark-observer.
 * Validates version exports, factory construction dependencies, lifecycle walkthroughs,
 * and selective API exposure.
 *
 * What this does NOT do: It does not verify deep internal database queries or
 * anonymizer buckets (those are covered by package unit tests).
 */

import { describe, it, expect } from 'vitest';
import { 
  VERSION, 
  createObserver, 
  WrkmarkObserverError, 
  AuditLog, 
  VSCodeCollector,
  SessionManager
} from '../src/index.js';

describe('index.ts — Public API and Bootstrap Integration', () => {

  it('exports the correct version identifier', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('exposes all expected fields in the observer layout', () => {
    const observer = createObserver(':memory:');
    expect(observer).toBeDefined();
    expect(observer.sessionManager).toBeDefined();
    expect(observer.collector).toBeDefined();
    expect(observer.auditLog).toBeDefined();
    expect(observer.db).toBeDefined();
    expect(observer.version).toBe('0.1.0');
  });

  it('correctly instantiates and wires session managers', () => {
    const observer = createObserver(':memory:');
    expect(observer.sessionManager).toBeInstanceOf(SessionManager);
  });

  it('correctly instantiates and wires VS Code collectors', () => {
    const observer = createObserver(':memory:');
    expect(observer.collector).toBeInstanceOf(VSCodeCollector);
  });

  it('correctly instantiates and wires audit log chains', () => {
    const observer = createObserver(':memory:');
    expect(observer.auditLog).toBeInstanceOf(AuditLog);
  });

  it('executes a clean observation lifecycle integration flow', () => {
    const { sessionManager, collector, auditLog } = createObserver(':memory:');

    // Start a new observation session
    sessionManager.startSession('VS Code');
    collector.start(sessionManager);

    // Verify state matches active observation
    expect(sessionManager.getState().status).toBe('active');
    expect(collector.isRunning()).toBe(true);

    const sessionId = sessionManager.getState().active_session!.id;

    // Simulate keystrokes and document actions
    // Privacy guarantee: No character content or paths are passed here.
    collector.onKeystroke(1000);
    collector.onKeystroke(1500); // Bucket 5
    collector.onFileSwitch(2000);

    // Conclude observation session
    const completed = sessionManager.endSession();
    collector.stop();

    // Verify session data was finalized
    expect(completed.id).toBe(sessionId);
    expect(completed.signal_count).toBe(2);
    expect(sessionManager.getState().status).toBe('stopped');
    expect(collector.isRunning()).toBe(false);

    // Verify audit log chain integrity remains unbroken
    const verifyResult = auditLog.verifyChain();
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.total_records).toBeGreaterThan(0);
  });

  it('supports transient memory database initialization', () => {
    expect(() => {
      createObserver(':memory:');
    }).not.toThrow();
  });

  it('exports the custom WrkmarkObserverError class', () => {
    const error = new WrkmarkObserverError('Test error message', 'INVALID_SIGNAL_TYPE');
    expect(error).toBeInstanceOf(WrkmarkObserverError);
    expect(error.code).toBe('INVALID_SIGNAL_TYPE');
  });

  it('exports the AuditLog class for direct custom configurations', () => {
    expect(AuditLog).toBeDefined();
  });

  it('exports the VSCodeCollector class for direct custom configurations', () => {
    expect(VSCodeCollector).toBeDefined();
  });
});
