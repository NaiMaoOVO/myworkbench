# Open-source options — initial evaluation

**Checked:** 2026-08-19, public GitHub repository metadata only.
**Selection principle:** reuse mature, local-first components without outsourcing user data or weakening authorization boundaries.

| Candidate | Use | Decision | Reason |
|---|---|---|---|
| `tauri-apps/tauri` | desktop packaging and native runtime | future alternative | Apache-2.0 and a strong technical fit, but deferred because the required Rust toolchain is unavailable in the current environment. |
| `tauri-apps/plugins-workspace` (mirrored as individual `tauri-plugin-*` repositories) | dialog, autostart, store and supported OS integrations | do not add in M1 | relevant only if a later Tauri migration is approved. |
| `electron/electron` | desktop runtime and platform integration | adopt | mature MIT shell that works with the currently available Node toolchain; renderer hardening is a release gate. |
| `WiseLibs/better-sqlite3` | synchronous Node SQLite | do not add initially | Node 24 includes `node:sqlite`; use the built-in library to minimize native dependency build risk. |
| `microsoft/playwright` | UI end-to-end and visual verification | adopt for webview test layer | Apache-2.0; suitable for responsive, keyboard, and reduced-motion verification. Desktop install flows still need native platform testing. |

## Boundaries for any dependency

- No telemetry or cloud account is enabled by default.
- No dependency receives raw sessions, note bodies, credentials, or user paths outside the local process.
- Dependencies are locked and reviewed before release.
- Scanner policy, redaction, authorization checks, and index deletion remain first-party core logic; they are not delegated to a generic plugin.
- A plugin cannot turn a discovered path into an authorized path.

## Follow-up before adding packages

1. Verify exact supported versions against official documentation.
2. Add a minimal proof of integration and a security test.
3. Record license, update policy, and why the dependency is needed.
4. Generate an SBOM in the release stage.
