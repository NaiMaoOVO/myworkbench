# Implementation plan and stage gates

## M0 — Freeze requirements and architecture

**Files:** requirements, design, gap matrix, plan, dependency research, repository hygiene.
**Gate:** documents agree on strict read-only/privacy rules; no real data in Git; baseline commit succeeds.

## M1 — Cross-platform core

**Deliver:** Electron shell skeleton, React UI shell, Node 24 local runtime, native SQLite index, platform path abstraction, grant model, scanner orchestration, adapter contract, exports compatibility adapter skeleton, six read API compatibility routes, protected local control API skeleton.
**Gate:** unit and security tests for grant boundaries, symlink escape, redaction, statuses, local API authorization; anonymous contract harness passes; app opens a real local health surface.

## M2 — First sources and lifecycle loop

**Deliver:** onboarding, source centre, preview/grant/revoke/delete-index loop; Obsidian, Git, Codex, Claude, and exports adapters; real scan and API integration.
**Gate:** each adapter has anonymous fixtures; integration flow passes; Git bodies excluded; revocation and deletion are verified against derived data only.

## M3 — Remaining source coverage

**Deliver:** iFlow, ZCode, Kimi Code, Gemini, Hermes, OpenClaw adapters and diagnostics.
**Gate:** every adapter supports manifest/discover/preview/scan/normalize/redact/health/migrate and malformed-record isolation.

## M4 — OLED cockpit

**Deliver:** dashboard, timeline, project, content, quality, sources, settings; real-data card rack and evidence detail; responsive and accessible behavior.
**Gate:** card-slot state tests, keyboard and reduced-motion checks, 320/375/768/1024/1440 layouts, real authorized data visual review.

## M5 — Release candidate

**Deliver:** signed/package-ready macOS and Windows builds, upgrade/rebuild/uninstall, diagnostics export, release docs, checksums, SBOM plan.
**Gate:** full test suite, `git diff --check`, security verification, clean-machine macOS and Windows flows, no unresolved partial runs represented as success.

## Delivery rules

Each stage follows `requirements → design → implementation → testing → commit → push`. A missing remote makes push blocked, not silently skipped. Each stage uses a focused commit that excludes user data and unrelated changes.
