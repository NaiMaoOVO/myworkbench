# Gap matrix — M0

This repository starts without source code. The supplied PRD describes a prior implementation, but that implementation was not provided. Therefore PRD claims are recorded as **unverified history**, not current capability.

| Area | Current verified state | Target | Gap | Stage |
|---|---|---|---|---|
| Git project | Initialized on 2026-08-19 | staged commits and remote delivery | no remote configured | M0/M5 |
| Requirements/design | M0 docs in repository | maintained decision baseline | update with implementation changes | M0+ |
| Desktop shell | absent | macOS + Windows app | complete | M1 |
| Data store | absent | local, rebuildable SQLite derived index | complete | M1 |
| Authorization | absent | per-source paths and content scopes | complete | M1 |
| Adapter runtime | absent | versioned protocol, isolation, fixtures | complete | M1 |
| Exports support | absent | compatibility adapter | complete | M1/M2 |
| Read APIs | absent | dashboard, heatmap, events, projects, content, quality | complete | M1 |
| Control APIs | secure loopback routes plus restricted Electron IPC grant/preview/scan/revoke/delete flow | sources/grants/scans/settings/diagnostics and persisted settings | partial: desktop runtime smoke test and settings persistence remain | M1/M2 |
| Obsidian/Git/Codex/Claude | metadata-capable adapters with anonymous contract tests | native adapters plus secure UI authorization | partial: no real-data verification or UI controls | M2 |
| Remaining agent tools | visible as explicit `unsupported` inventory entries | native adapters and diagnostics | complete parser/fixture work remains | M3 |
| OLED cockpit UI | OLED layout, real-data source centre, fixed-slot project rack and evidence detail | full visual/system/device acceptance | partial: timeline, visual reference comparison and runtime validation remain | M4 |
| Cross-platform packaging | absent | install/restart/uninstall workflows | complete | M5 |
| Automated verification | absent | unit, contract, integration, security, UI regression | complete | M1–M5 |

## Deliberate deferrals

- Cloud sync, team spaces, remote full-text search, and plugin marketplace are out of v1.0.
- Windows ARM64 is compatibility-tested, not a release guarantee, until M5 evidence exists.
- No user source data is available in this repository; anonymous fixtures will be created before each adapter is implemented.
