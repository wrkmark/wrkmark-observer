# Wrkmark Observer — Agent Context
# Loaded into every Antigravity session automatically.
# Read completely before every task.

## WHAT THIS PROJECT IS
wrkmark-observer is the open-source, MIT-licensed behavioral observation
engine that powers Wrkmark (wrkmark.com). Every line of code in this repo
is publicly auditable. Our users' trust depends on this code being
exactly what we say it is.

## ABSOLUTE PRIVACY RULES — NEVER VIOLATE

### We ONLY capture these signals:
1. app_name — which work application is currently active (name string only)
2. typing_rhythm_bucket — inter-keystroke interval histogram bucket (integer)
   NOT the actual keys pressed — only the timing pattern as histogram
3. pause_event — a pause > 10 seconds occurred during typing (boolean + duration)
4. undo_event — an undo action was performed (count increment only)
5. file_switch — user switched files/tabs (count increment only)
6. ai_tool_opened — an AI tool domain was detected as active (boolean)
7. build_run — a terminal build command was run (count increment only)
8. session_start — work session began (timestamp only)
9. session_end — work session ended (timestamp + duration only)

### We NEVER capture:
- Content of ANY file, document, email, or message
- Actual keystrokes or typed characters
- File names, folder names, or file paths
- Browser URLs or page content (only AI tool domain detection)
- Passwords, API keys, tokens, or any credentials
- Personal application activity (banking, social, personal email)
- Microphone, camera, screen recording, or screenshots
- Clipboard contents
- Any string longer than 50 characters from any source

### If any code you write could capture something outside the ONLY list above:
STOP. Do not proceed. Ask the human to review before continuing.

## CODE STANDARDS

### TypeScript
- Strict mode always. Zero `any` types. Period.
- Every exported function: JSDoc comment with @param and @returns
- Every file: top comment explaining what it does and what it does NOT do
- Interfaces for all data shapes — no untyped objects
- Errors: never silent. Always throw typed errors or log to audit trail.

### Testing
- Testing framework: Vitest
- Minimum coverage: 90% on all files
- Privacy tests are MANDATORY for every collector:
  * Test that string values are stripped/rejected
  * Test that only approved signal types are emitted
  * Test that pause/resume correctly stops observation
  * Test that audit log entry is created for every signal

### File naming
- kebab-case for all files: signal-processor.ts not SignalProcessor.ts
- Index files only for re-exporting, not for logic
- One class/interface per file where practical

### Error handling
- Create typed error classes in src/types/errors.ts
- Never use generic Error() — always use typed errors
- Every catch block must either re-throw or log to audit trail
- Never swallow errors silently

## ARCHITECTURE RULES

### Signal flow (must follow this exactly):
RawSignal → validate() → anonymize() → audit_log.record() → SQLite

- Validate: check against approved signal type list
- Anonymize: strip all string content, keep only numeric values
- Audit: record to tamper-evident local log BEFORE storing
- Store: write to encrypted SQLite

### IPC (for when this is used inside Electron):
- All channels defined as typed constants in src/ipc/channels.ts
- No dynamic channel names ever
- All payloads fully typed — no raw strings

### Database:
- SQLite only (local, on user device)
- WAL mode enabled (PRAGMA journal_mode=WAL)
- All tables defined in src/db/schema.ts
- Never raw SQL strings in business logic — use typed query builders

## WHAT NOT TO BUILD IN THIS REPO
- No UI code (that lives in wrkmark-app)
- No network code (except the sync payload builder)
- No authentication
- No payment code
- No employer-facing features

## CURRENT TASK
Build the core types, audit log, signal validator, and first collector.
See the step-by-step task in the prompt.