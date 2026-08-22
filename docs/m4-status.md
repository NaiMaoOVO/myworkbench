# M4 status — OLED cockpit and project rack

**Updated:** August 22, 2026
**Status:** real-runtime acceptance passed (32/32 checks); depth-entry behavior and cross-platform packaging remain.

## Implemented

- The dashboard reads the existing local `/api/projects` and `/api/events` endpoints; no static project list or UI mock is used.
- Projects occupy fixed overlapping rack slots. Selecting a project does not reorder the collection.
- Click, keyboard arrows/Home/End, wheel input, and left/right drag gestures change the selected project.
- Only the newly selected card moves forward and the previously selected card returns to its slot. Other cards retain their fixed transforms.
- The selected card changes to green glass material; project event detail appears in the existing right-side evidence surface.
- A bottom activity track reads real `/api/heatmap` and `/api/events` data, supports date selection, and lists observed source evidence for the selected date.
- The primary navigation now switches between overview, content, data quality, and source-centre views instead of acting as page anchors.
- The content view reads `/api/content`, searches only returned metadata fields, and never implies that unauthorized bodies were indexed.
- The data-quality view reads `/api/quality` and `/api/scans`, separating successful, partial, and blocked scan outcomes from safe diagnostics.
- The rack includes `listbox`/`option` semantics, visible focus handling, and a `prefers-reduced-motion` path that removes perspective and large movement.
- Existing 320/375/768/1024/1440 responsive constraints remain in the shared layout; the rack collapses its detail and card geometry on smaller widths.

## Real-runtime acceptance (August 22, 2026)

A real Electron runtime harness (`scripts/acceptance/`) launched the packaged desktop shell against a loopback static build of `dist-web`, seeded through the genuine authorization + scan pipeline (claude/codex partial scans plus an exports-compat success scan with intentional malformed-line diagnostics).

Result: **32 of 32 checks pass**, covering empty/loading/error surfaces, five viewport widths with zero page-level overflow, keyboard arrows/Home/End, wheel, pointer drag, reduced-motion geometry removal, long-text evidence, all four primary views at 1440 and 320 widths, content no-results state, and seeded-database readback. Screenshots and pixel statistics land in `.mw-local/acceptance/` (ignored).

The acceptance run surfaced and fixed four real desktop-only defects:

1. `package.json` pointed `main` at a non-existent `dist-electron/main.js`; the compiled entry lives at `dist-electron/apps/desktop/main.js`. The shell silently idled before this fix.
2. The sandboxed preload was emitted as ESM, which sandboxed preloads cannot load; it now compiles separately as CommonJS (`tsconfig.preload.json`) so the source-authorisation bridge works.
3. React registers wheel listeners passively, so the rack's wheel selection never fired in a real browser; it now uses a native non-passive listener.
4. An empty database showed "Current evidence" with zeros instead of the no-indexed-evidence guidance because the derived `dataState` field counted as observed data; empty state is now detected explicitly.

Programmatic palette comparison against the supplied reference: dark background share matches closely (reference ≈0.85, cockpit ≈0.89), while green accent coverage is higher in the app (~0.037 vs ~0.003 sampled). A human or image-capable review should confirm whether the selected-card glass and heat colours need restraint; screenshots are preserved locally for that review.

## Real installed-tool verification (August 22, 2026)

The machine running this repository has real local data for one of the six newly covered tools: ZCode CLI keeps per-session model I/O logs under `~/.zcode/cli/rollout/`. The adapter was rewritten against the observed real format (multi-file JSONL rollouts, `startedAt`/`completedAt` columns, nested model descriptors, exchange bodies under `response.text`; project paths are absent from this format and workspace stays unset rather than guessed), the anonymous fixture was reshaped to match, and the full contract suite plus an end-to-end grant → preview → scan against the genuine directory passed: 45 records parsed with zero failures spanning a month of activity, metadata-only by default, bodies only after a separate grant. `.gemini`, `.iflow`, `.hermes`, and `.openclaw` exist locally but contain no session logs to verify against.

## Packaging and desktop lifecycle (M5, August 22, 2026)

- The packaged shell now hosts the built UI itself: `LocalApiServer` optionally serves `dist-web` on the same loopback origin as the API (`uiRoot` option), with path-traversal rejection, strict CSP, and hashed-asset caching. Dev mode keeps the explicit loopback UI URL, and `MYWORKBENCH_UI_URL` remains a test override.
- electron-builder config (`electron-builder.yml`) produces an arm64 DMG and a Windows NSIS installer; `react`/`react-dom` moved to devDependencies so the installer ships only the built bundles; an afterPack hook strips file-provider metadata and re-signs the bundle ad hoc so Apple Silicon launches it.
- Local verification on this machine: the packaged app launched in self-hosted mode (UI and API on one loopback origin), read the seeded database (11 events / 3 projects), kept the full source inventory (11 sources, six new adapters `awaiting_authorization`), survived a full stop/relaunch with identical data (restart recovery), and uninstalled cleanly with no workspace leftovers. The sandboxed Chromium flags used by the harness are environment accommodations, not product requirements.
- `hdiutil` is denied inside this sandbox, so the DMG itself is produced by `.github/workflows/build.yml` (macOS DMG + Windows NSIS on tag push, tests gate the build). Local equivalent: `npm run dist:mac -c.directories.output=/tmp/myworkbench-release`.

## Gap-closure round (August 22, 2026)

A line-by-line comparison against the source PRD surfaced and closed the following gaps:

- **Settings**: persisted `app_setting` table with real GET/PATCH on `/api/settings`, a new 设置 view (scan frequency, language, telemetry-off statement, data directory, config export), and desktop-bridge settings channels.
- **Discovery**: version-tolerant candidate directories per agent tool (`src/platform/discover.ts`), exposed through `/api/sources/discover` and a 来源中心 discovery entry; existing candidates can be authorized in one click from the desktop shell.
- **Insights**: the dashboard now computes 30/90-day event counts, commits, content activity, active projects (14-day window), and an estimated-work-minutes figure with its 口径说明 printed inline; work groups split delivery / creation / AI sessions by source.
- **Projects view**: lifecycle filters (活跃 ≤14 天 / 待复核 15–60 天 / 归档 >60 天) labelled as rule inference, plus per-source distribution.
- **Body search**: `/api/content` returns bodies only for sources whose grant scope includes them, supports `?q=` across title/source/time/body, and labels each row 含已授权正文 / 仅元数据.
- **Pause semantics**: scans can be cancelled mid-run (`sources:cancel-scan`, status `cancelled`); resuming is an idempotent re-scan.
- **Incremental scanning**: a shared JSONL scanner skips unchanged files via a `scan_file_state` table, deletes-and-replaces changed ones, prunes removed ones; scope changes and index deletion invalidate state. Verified against real ZCode data — full scan 300–380 ms for 45 records, incremental rescan ~9 ms.
- **Visual/UX**: pointer-tracked glass highlight on metric and group cards, staggered card entrance plus new-project depth entry, mobile bottom navigation with a detail drawer, dynamic window title.
- **Compliance**: MIT LICENSE, CHANGELOG, CI artifact checksums.

## Remaining work

1. Human/image-model visual review of materials and lighting against the reference image.
2. Verify Gemini/iFlow/Hermes/Kimi Code/OpenClaw adapters against real installed-tool data as it becomes available.
3. Windows clean-machine install verification (CI builds NSIS; a real Windows host is needed for the lifecycle test).
4. Signing/notarization for public distribution (requires developer certificates).
5. Performance at PRD scale: verified — 100k-record synthetic database benchmarked via `scripts/perf-check.mjs` (in-process dispatcher, 120 samples per endpoint). With the new occurred_at/source/locator/workspace indexes, a single-pass SQL dashboard (now also aggregating real session durations), and server-side heatmap day-bucketing, the slowest endpoint p95 is 66.4 ms (target ≤200 ms), events p95 0.2 ms, RSS 191 MB (target ≤500 MB). Bulk insert of 100k rows takes ~1.9 s inside transactions.
6. Real work minutes: ZCode rollout rows carry `durationMs`, now persisted per event (`duration_ms` column, guarded migration) and aggregated by the dashboard — measured durations take precedence over the per-session 5-minute estimate, and the 口径 label states which source was used.
7. 200% zoom reflow verified in the packaged runtime via a 720 px CSS viewport (the standard 1280-window equivalent): no horizontal overflow; symlink escape is already covered by tests/path-policy.test.ts.
6. 200% zoom reflow verified in the packaged runtime via a 720 px CSS viewport (the standard 1280-window equivalent): no horizontal overflow; symlink escape is already covered by tests/path-policy.test.ts.

## Agent adapter coverage (M3, August 22, 2026)

iFlow, ZCode, Kimi Code, Gemini, Hermes, and OpenClaw now ship as native adapters instead of `unsupported` inventory placeholders. Each parses its `<sourceId>.jsonl` session log inside the granted folder, tolerates the column-name variants its tool has shipped (version-aware time/session keys), isolates malformed lines into safe diagnostics, and exposes bodies only under a per-source body grant. Kimi Code keeps an explicit product name so it never merges with Kimi desktop data; Hermes and OpenClaw keep tool names inside the record type; ZCode distinguishes session and plan records. All eight agent adapters share one anonymous contract suite (40 cases): no default discovery, preview/scan parity on valid and corrupt lines, metadata-only redaction, body-grant exposure, and no corrupt-content leakage into diagnostics.

## Verification note

Latest typecheck, production build, diff check, and full Vitest suite pass: 27 tests across 7 files. Local API integration tests use the same production dispatcher in process. The real HTTP listener is now exercised end-to-end by the Electron acceptance harness described above; cross-platform release smoke tests remain open until packaging.
