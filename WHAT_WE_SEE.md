# What Wrkmark Sees — The Complete List

This document is the complete, authoritative list of every piece of 
information Wrkmark's observation engine can ever collect from your device.

If it's not on this list, we don't collect it.
The code that enforces this list is in src/processor/anonymizer.ts.
You can read and verify every line.

Last updated: May 2026 | Version: 1.0.0

---

## ✅ What Wrkmark observes

### 1. Which work app you're using
**What:** The name of the application in your foreground window
**Example:** "VS Code", "Chrome", "Figma"
**What we DON'T collect:** File names, window titles, document names

### 2. Typing rhythm pattern
**What:** The statistical pattern of time gaps between keypresses
**Example:** "User tends to type in short bursts with 2-3 second pauses"
**What we DON'T collect:** The actual keys you press. Ever.
**Technical detail:** We store a histogram of inter-keystroke intervals
in 100ms buckets. Bucket 3 = "there were N keypresses with 200-300ms gaps."
Your actual words are never known to us.

### 3. Pause events
**What:** When you stop typing for more than 10 seconds during a work session
**Example:** "User paused for 45 seconds at 14:32"
**Why:** Pauses during work suggest thinking/problem-solving

### 4. Undo frequency
**What:** How many times you pressed Undo in a session (count only)
**Example:** "12 undo events in this session"
**What we DON'T collect:** What was undone or what the text was

### 5. Tab/file switches
**What:** How many times you switched between files or tabs
**Example:** "23 file switches this session"
**What we DON'T collect:** Which files or what the file names were

### 6. AI tool usage
**What:** Whether an AI tool was open during your work session (yes/no only)
**AI tools we detect:** claude.ai, chatgpt.com, copilot.github.com, gemini.google.com
**What we DON'T collect:** What you typed into the AI tool. What it said back.

### 7. Build/run commands
**What:** How many times you ran a terminal command (count only)
**What we DON'T collect:** What the commands were

### 8. Session times
**What:** When your work session started and ended
**Example:** "Session: 14:15 to 16:42 (2h 27m)"

---

## ❌ What Wrkmark NEVER collects

- The content of any file you edit
- The content of any email, message, or document
- Your actual keystrokes or typed characters
- Passwords, API keys, or any credentials
- File names, folder names, or file paths
- Browser URLs or what websites you visit
- The content of your AI conversations
- Anything from personal apps (banking, social media, personal email)
- Audio or video from your microphone or camera
- Screenshots of your screen
- Clipboard contents
- Your location

---

## How to verify this yourself

1. This repo is 100% open source: github.com/wrkmark-hq/wrkmark-observer
2. The validation code is in: src/processor/anonymizer.ts
3. The audit log records every observation: open Privacy Dashboard → Audit Log
4. Independent privacy audit report: /audit/

---

## Your rights

- Pause observation instantly: click Wrkmark in menu bar → Pause
- See everything collected right now: Wrkmark → Privacy Dashboard
- Delete all your data: Wrkmark → Privacy Dashboard → Delete All Data
- Export your data: Wrkmark → Privacy Dashboard → Export
- Delete your account: Wrkmark → Settings → Delete Account