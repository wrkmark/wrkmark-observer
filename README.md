<div align="center">
  <h1>wrkmark-observer</h1>
  <p><strong>Open-source behavioral observation engine for Wrkmark</strong></p>
  <p>
    <a href="https://github.com/wrkmark-hq/wrkmark-observer/actions">
      <img src="https://github.com/wrkmark-hq/wrkmark-observer/actions/workflows/test.yml/badge.svg" alt="Tests">
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
    </a>
    <img src="https://img.shields.io/badge/privacy-on--device-green" alt="On-device">
  </p>
</div>

---

## What this is

This is the complete, open-source observation engine that powers
[Wrkmark](https://wrkmark.com) — a platform that helps professionals
prove their authentic skills in the AI age.

Every line of code that touches user behavior lives in this repo.
Nothing hidden. Nothing elsewhere. Fully auditable by anyone.

## What it observes

See [WHAT_WE_SEE.md](./WHAT_WE_SEE.md) for the complete, human-readable list.

**Short version:** typing rhythm patterns, session timing, pause events,
undo frequency, and whether AI tools were open during a session.

**Never:** content of any file, actual keystrokes, URLs, passwords,
personal app activity, microphone, camera, or screenshots.

## How privacy is enforced

1. **Allowlist validation** — only 8 approved signal types can pass through
2. **Content stripping** — all string values are stripped; only numbers survive
3. **On-device processing** — raw signals never leave your machine
4. **Tamper-evident audit log** — every observation creates a hash-chained record
5. **Open source** — you are reading the enforcement code right now

## Run the tests yourself

```bash
git clone https://github.com/wrkmark-hq/wrkmark-observer
cd wrkmark-observer
pnpm install
pnpm test
```

Every privacy constraint has a corresponding test.
If the tests pass, the constraints are enforced.

## Architecture
RawSignal
↓
SignalAnonymizer.validate()   ← rejects anything not on approved list
↓
SignalAnonymizer.anonymize()  ← strips all string content, keeps numbers only
↓
AuditLog.record()             ← tamper-evident hash chain entry
↓
SQLite (local, encrypted)     ← never transmitted raw
↓
FeatureVector (aggregated)    ← only this reaches Wrkmark servers

## Contributing

Read [AGENTS.md](./AGENTS.md) before contributing anything.
All PRs require passing tests + privacy CI check.
Privacy-critical files require founder review (see CODEOWNERS).

## License

MIT — use this code however you like.