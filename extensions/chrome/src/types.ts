/**
 * types.ts
 *
 * TypeScript interface definitions for the Wrkmark Observer Chrome Extension.
 * Enforces strict typing boundaries on messages sent from the extension to the
 * native host applications.
 *
 * What this does NOT do: It does not define core engine types like ActiveSession,
 * CompletedSession, etc. (those belong in wrkmark-observer package).
 */

/** Message sent from extension to native host */
export interface WrkmarkMessage {
  type: 'AI_TOOL_DETECTED';
  hostname: string;      // e.g. "claude.ai" — never full URL
  timestamp: number;     // Unix ms
}

/** Result of checking if a hostname is an AI tool */
export interface AIToolCheckResult {
  isAITool: boolean;
  hostname: string;
}
