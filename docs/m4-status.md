# M4 status — OLED cockpit and project rack

**Updated:** August 22, 2026
**Status:** partial; source-driven cockpit views implemented, visual/runtime acceptance remains.

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

## Remaining visual and interaction acceptance

1. Run desktop visual tests against an actual Electron runtime at 320, 375, 768, 1024, 1440, and target-wide widths.
2. Verify pointer drag and wheel selection in the desktop shell, including trackpads and touch input.
3. Add new-project depth-entry behavior based on a real scan delta.
4. Compare real-data screenshots against the supplied reference image and refine the optical material layers.
5. Validate no page-level overflow, long-text behavior, empty/loading/error surfaces, high contrast, and 200% zoom in a browser/runtime capable of rendering the local app.

## Verification note

The latest typecheck, production build, diff check, and full Vitest suite pass: 27 tests across 7 files. Local API integration tests use the same production dispatcher in process because this sandbox forbids loopback binding; the real HTTP listener remains reserved for platform/release smoke tests. Visual/runtime and cross-platform acceptance remain open.
