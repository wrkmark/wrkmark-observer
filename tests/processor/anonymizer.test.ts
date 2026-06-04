/**
 * Tests for the signal anonymizer.
 * These tests verify Wrkmark's core privacy guarantees.
 * If these tests pass, the privacy constraints are being enforced.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SignalAnonymizer } from '../../src/processor/anonymizer.js'
import { AuditLog } from '../../src/privacy/audit-log.js'
import { WrkmarkObserverError } from '../../src/types/index.js'
import type { RawSignal } from '../../src/types/index.js'

function makeSignal(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    app_name: 'VS Code',
    signal_type: 'typing_rhythm_bucket',
    numeric_value: 5,
    timestamp: Date.now(),
    session_id: 'test-session-001',
    ...overrides,
  }
}

describe('SignalAnonymizer — Privacy Guarantees', () => {
  let db: Database.Database
  let auditLog: AuditLog
  let anonymizer: SignalAnonymizer

  beforeEach(() => {
    db = new Database(':memory:')
    auditLog = new AuditLog(db)
    anonymizer = new SignalAnonymizer(auditLog)
  })

  // ─── Core Privacy Tests ──────────────────────────────────────────────────

  it('rejects unknown signal types', () => {
    expect(() =>
      anonymizer.validate(makeSignal({ signal_type: 'screen_capture' }))
    ).toThrow(WrkmarkObserverError)
  })

  it('rejects all disallowed signal types', () => {
    const disallowed = [
      'keystrokes', 'file_content', 'clipboard',
      'url_visited', 'screen_content', 'password', 'document_text'
    ]
    for (const signal_type of disallowed) {
      expect(() =>
        anonymizer.validate(makeSignal({ signal_type }))
      ).toThrow(WrkmarkObserverError)
    }
  })

  it('records every rejected signal in audit log', () => {
    try {
      anonymizer.validate(makeSignal({ signal_type: 'keystrokes' }))
    } catch { /* expected */ }

    const entries = auditLog.getRecent(10)
    expect(entries.some(e => e.event_type === 'signal_rejected')).toBe(true)
  })

  it('truncates app_name to max 100 chars', () => {
    const longName = 'A'.repeat(200)
    const result = anonymizer.anonymize(makeSignal({ app_name: longName }))
    expect(result.app_name.length).toBeLessThanOrEqual(100)
  })

  it('accepts all approved signal types', () => {
    const approved = [
      'session_start', 'session_end', 'typing_rhythm_bucket',
      'pause_event', 'undo_event', 'file_switch',
      'ai_tool_opened', 'build_run'
    ]
    for (const signal_type of approved) {
      expect(() =>
        anonymizer.validate(makeSignal({ signal_type }))
      ).not.toThrow()
    }
  })

  // ─── Numeric Sanitization ─────────────────────────────────────────────────

  it('clamps typing_rhythm_bucket to 0-50', () => {
    const high = anonymizer.anonymize(
      makeSignal({ signal_type: 'typing_rhythm_bucket', numeric_value: 999 })
    )
    const low = anonymizer.anonymize(
      makeSignal({ signal_type: 'typing_rhythm_bucket', numeric_value: -5 })
    )
    expect(high.numeric_value).toBe(50)
    expect(low.numeric_value).toBe(0)
  })

  it('rejects NaN and Infinity numeric values', () => {
    const nanResult = anonymizer.anonymize(makeSignal({ numeric_value: NaN }))
    const infResult = anonymizer.anonymize(makeSignal({ numeric_value: Infinity }))
    expect(nanResult.numeric_value).toBe(0)
    expect(infResult.numeric_value).toBe(0)
  })

  it('converts ai_tool_opened to 0 or 1 only', () => {
    const on = anonymizer.anonymize(
      makeSignal({ signal_type: 'ai_tool_opened', numeric_value: 42 })
    )
    const off = anonymizer.anonymize(
      makeSignal({ signal_type: 'ai_tool_opened', numeric_value: 0 })
    )
    expect(on.numeric_value).toBe(1)
    expect(off.numeric_value).toBe(0)
  })

  // ─── Output Shape ─────────────────────────────────────────────────────────

  it('output contains no content fields', () => {
    const result = anonymizer.anonymize(makeSignal())
    const keys = Object.keys(result)
    expect(keys).not.toContain('content')
    expect(keys).not.toContain('text')
    expect(keys).not.toContain('value_string')
    expect(keys).not.toContain('raw')
  })

  it('output contains exactly the allowed fields', () => {
    const result = anonymizer.anonymize(makeSignal())
    expect(result).toHaveProperty('app_name')
    expect(result).toHaveProperty('signal_type')
    expect(result).toHaveProperty('numeric_value')
    expect(result).toHaveProperty('timestamp')
    expect(result).toHaveProperty('session_id')
  })
})
