/**
 * index.ts
 *
 * The public API of wrkmark-observer. If you're building
 * something on top of this engine — this is your entry point.
 *
 * We export only what you need to integrate the observer.
 * Internal implementation details stay internal — the less
 * surface area we expose, the harder it is to misuse.
 */

// ─── Core Types Re-exports ──────────────────────────────────────────────────
export type {
  SignalType,
  RawSignal,
  AnonymizedSignal,
  ActiveSession,
  CompletedSession,
  FeatureVector,
  ObserverStatus,
  ObserverState,
  ICollector,
  ObserverErrorCode,
} from './types/index.js';

export { WrkmarkObserverError } from './types/index.js';

// ─── Module Re-exports ──────────────────────────────────────────────────────
export { AuditLog } from './privacy/audit-log.js';
export { SignalAnonymizer } from './processor/anonymizer.js';
export { createDatabase } from './db/database.js';
export type { WrkmarkDb } from './db/database.js';
export { SignalExtractor } from './processor/signal-extractor.js';
export { SessionManager } from './session-manager.js';
export { VSCodeCollector } from './collectors/vscode.js';

// ─── Version Definitions ────────────────────────────────────────────────────
export const VERSION = '0.1.0';

import { createDatabase as internalCreateDatabase } from './db/database.js';
import { AuditLog as InternalAuditLog } from './privacy/audit-log.js';
import { SignalAnonymizer as InternalSignalAnonymizer } from './processor/anonymizer.js';
import { SignalExtractor as InternalSignalExtractor } from './processor/signal-extractor.js';
import { SessionManager as InternalSessionManager } from './session-manager.js';
import { VSCodeCollector as InternalVSCodeCollector } from './collectors/vscode.js';

/**
 * Wires together a fully configured observer system with sensible defaults.
 *
 * Most integrators do not need to wire dependencies manually. createObserver()
 * gives you a fully configured observer in one call with sane defaults.
 * If you need custom wiring — all the pieces are exported individually above.
 * Use what you need.
 *
 * @param dbPath - Filesystem path to the SQLite database file, or ':memory:' for transient storage.
 * @returns Fully constructed subsystem coordinates.
 */
export function createObserver(dbPath: string): {
  sessionManager: InternalSessionManager;
  collector: InternalVSCodeCollector;
  auditLog: InternalAuditLog;
  version: string;
} {
  const db = internalCreateDatabase(dbPath);
  const auditLog = new InternalAuditLog(db.rawDb);
  const anonymizer = new InternalSignalAnonymizer(auditLog);
  const extractor = new InternalSignalExtractor(db);
  const sessionManager = new InternalSessionManager(
    db,
    auditLog,
    anonymizer,
    extractor
  );
  const collector = new InternalVSCodeCollector();

  return {
    sessionManager,
    collector,
    auditLog,
    version: VERSION,
  };
}
