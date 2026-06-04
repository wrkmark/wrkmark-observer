/**
 * audit-log.ts
 * 
 * Tamper-evident, append-only audit log for all Wrkmark observation events.
 * Every signal capture, transmission, and privacy event is recorded here.
 * 
 * Technical guarantee: Records form a hash chain (like a blockchain).
 * Any modification to historical records breaks the chain and is detectable.
 * 
 * This file is open source. Users can verify we enforce our own rules.
 */

import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AuditEntry, AuditEventType, AuditRecipient } from '../types/index.js'

export class AuditLog {
  private db: Database.Database
  private lastHash: string | null = null

  constructor(db: Database.Database) {
    this.db = db
    this.init()
    this.loadLastHash()
  }

  /**
   * Create the audit log table if it doesn't exist.
   * The schema is intentionally simple and append-only.
   */
  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        app_name TEXT,
        signal_type TEXT,
        bytes_transmitted INTEGER NOT NULL DEFAULT 0,
        recipient TEXT NOT NULL,
        details TEXT,
        prev_hash TEXT,
        record_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp 
        ON audit_log(timestamp DESC);
    `)
  }

  /** Load the hash of the most recent entry to continue the chain */
  private loadLastHash(): void {
    const row = this.db.prepare(`
      SELECT record_hash FROM audit_log ORDER BY id DESC LIMIT 1
    `).get() as { record_hash: string } | undefined

    this.lastHash = row?.record_hash ?? null
  }

  /**
   * Record an audit event.
   * This is called automatically by every part of the observer.
   * Users should never need to call this directly.
   */
  record(
    event_type: AuditEventType,
    options: {
      app_name?: string
      signal_type?: string
      bytes_transmitted?: number
      recipient?: AuditRecipient
      details?: string
    } = {}
  ): void {
    const timestamp = Date.now()
    const {
      app_name = null,
      signal_type = null,
      bytes_transmitted = 0,
      recipient = 'local_only',
      details = null,
    } = options

    // Build the content string that gets hashed
    const content = [
      timestamp,
      event_type,
      app_name,
      signal_type,
      bytes_transmitted,
      recipient,
      details,
      this.lastHash,
    ].join('|')

    const record_hash = createHash('sha256').update(content).digest('hex')

    const entry: Omit<AuditEntry, 'id'> = {
      timestamp,
      event_type,
      app_name,
      signal_type,
      bytes_transmitted,
      recipient,
      details: details ? details.substring(0, 200) : null, // max 200 chars
      prev_hash: this.lastHash,
      record_hash,
    }

    this.db.prepare(`
      INSERT INTO audit_log 
        (timestamp, event_type, app_name, signal_type, 
         bytes_transmitted, recipient, details, prev_hash, record_hash)
      VALUES 
        (@timestamp, @event_type, @app_name, @signal_type,
         @bytes_transmitted, @recipient, @details, @prev_hash, @record_hash)
    `).run(entry)

    this.lastHash = record_hash
  }

  /**
   * Verify the integrity of the entire audit chain.
   * Returns { valid: true } if intact, or { valid: false, broken_at: id } if tampered.
   * 
   * This can be called by the user from the Privacy Dashboard to prove
   * that no historical records have been modified.
   */
  verifyChain(): { valid: boolean; broken_at?: number; total_records: number } {
    const rows = this.db.prepare(`
      SELECT * FROM audit_log ORDER BY id ASC
    `).all() as AuditEntry[]

    let prevHash: string | null = null

    for (const row of rows) {
      const content = [
        row.timestamp,
        row.event_type,
        row.app_name,
        row.signal_type,
        row.bytes_transmitted,
        row.recipient,
        row.details,
        prevHash,
      ].join('|')

      const expectedHash = createHash('sha256').update(content).digest('hex')

      if (expectedHash !== row.record_hash) {
        return { valid: false, broken_at: row.id, total_records: rows.length }
      }

      prevHash = row.record_hash
    }

    return { valid: true, total_records: rows.length }
  }

  /**
   * Get recent audit entries for display in the Privacy Dashboard.
   * Returns the most recent N entries, newest first.
   */
  getRecent(limit = 100): AuditEntry[] {
    return this.db.prepare(`
      SELECT * FROM audit_log ORDER BY id DESC LIMIT ?
    `).all(limit) as AuditEntry[]
  }

  /**
   * Export all audit entries as JSON for user download.
   * This is their complete activity record.
   */
  exportAll(): AuditEntry[] {
    return this.db.prepare(`
      SELECT * FROM audit_log ORDER BY id ASC
    `).all() as AuditEntry[]
  }
}