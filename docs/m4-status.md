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

## Remaining work

1. Add new-project depth-entry behavior based on a real scan delta.
2. Human/image-model visual review of materials and lighting against the reference image; refine optical layers if the green accent coverage is judged excessive.
3. Implement the remaining source adapters: iFlow, ZCode, Kimi Code, Gemini, Hermes, OpenClaw.
4. macOS/Windows packaging, install, restart recovery, uninstall verification, and push.

## Verification note

Latest typecheck, production build, diff check, and full Vitest suite pass: 27 tests across 7 files. Local API integration tests use the same production dispatcher in process. The real HTTP listener is now exercised end-to-end by the Electron acceptance harness described above; cross-platform release smoke tests remain open until packaging.
