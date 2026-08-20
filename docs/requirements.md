# Requirements baseline — M0

**Status:** approved for implementation baseline
**Source:** supplied PRD (version 1.0 Draft, normalized without private paths)
**Scope:** v1.0 local-first desktop application for macOS and Windows

## 1. Product outcome

MyWorkbench lets a user authorize read-only access to local work evidence—Obsidian, Git repositories, and supported agent tools—and view a traceable, cross-source project timeline. It is not a task manager, sync service, or replacement for the source tools.

A successful first release lets a new user install the app, understand precisely what will be read, authorize individual sources, scan locally, and trace a project to at least two kinds of evidence within ten minutes.

## 2. Non-negotiable privacy and safety rules

1. **Authorization precedes every scan.** No directory or file is read without an explicit grant.
2. **Metadata only is the default.** Notes and agent conversation bodies require a separate grant for each source instance.
3. **No implicit escalation.** A migration, product update, or new field must not enable body collection.
4. **Raw sources stay read-only.** MyWorkbench must never modify source repositories, notes, exports, or agent histories.
5. **Git source bodies are excluded from v1.0.** Git commit metadata and aggregate change counts are allowed; file contents are not.
6. **All work data stays local by default.** GitHub distributes source and releases only.
7. **Derived data is revocable.** Revoking stops future scans. Deleting a source index removes only MyWorkbench-derived records for that source.
8. **No sensitive material in repository artifacts.** Do not commit user paths, exports, sessions, databases, logs, credentials, or diagnostic bundles.
9. **Protected-source policy.** Any user-designated Obsidian vault and export directory is always an external read-only source; it is never an application data location or a write target.
10. **Control API security.** A local browser page must not gain scan, grant, pause, revoke, or delete authority merely because it can reach loopback.

## 3. In-scope sources

| Source | v1.0 metadata baseline | Body opt-in | Required notes |
|---|---|---:|---|
| Obsidian | file name, user-approved relative path, modified time, tags, links, size | Markdown body | multiple vaults and exclusions |
| Git | repository identity, branch, commit id/time/author, change stats | never | no source code indexing |
| Codex | session id, time, cwd/workspace, model/tool counts | yes | version-aware JSONL parsing |
| Claude | session id, time, project/cwd, tool counts | yes | native adapter, not exports-only |
| iFlow | session id, time, workspace, record type | yes | user-configurable path |
| ZCode | session/plan id, time, project path | yes | global and project records |
| Kimi Code | session, workspace, time, state | yes | distinct from desktop client |
| Gemini | session, time, workspace, model metadata | yes | version-aware parser |
| Hermes | session, time, workspace, tool events | yes | manual location fallback |
| OpenClaw | session, time, workspace, tool events | yes | manual location fallback |
| Exports compatibility | imported project/event/content/quality records | source-defined | visibly labeled as upstream import |

A candidate path is only a discovery hint. It is not a product contract and must be editable by the user.

## 4. Functional requirements

### FR-01 Source centre

Display every adapter as undiscovered, awaiting authorization, ready, scanning, partial, blocked, or unsupported. Show permission scope, selected paths, adapter version, last successful scan, count, and actionable diagnostics. Support discover, preview, grant, rescan, pause, revoke, and delete derived index.

### FR-02 Authorization and preview

The onboarding flow is: privacy promise → discovery → candidate path review → field/scope review → scan preview → explicit authorize-and-scan. Preview may inspect only enough metadata to estimate files, time range, record types, exclusions, and risk; it must not persist business records.

### FR-03 Scan and processing

Scanning is incremental, cancelable, resumable, rate-limited, and idempotent. Every scan records `success`, `partial`, `blocked`, or `cancelled`. A source, file, or record failure is isolated and diagnosable.

### FR-04 Evidence dashboard

Provide 30/90-day indicators, work groups, fixed-slot project card rack, activity timeline, and a right-side evidence detail surface. Counts and project states disclose their basis; suggestions are never shown as facts.

### FR-05 Timeline, projects, content, quality

Retain these read API semantics:

```text
GET /api/dashboard
GET /api/heatmap
GET /api/events
GET /api/projects
GET /api/content
GET /api/quality
```

Content search includes only titles, source, and explicitly authorized bodies. When no project relation exists, use a truthful source/workspace category instead of inventing a relation.

### FR-06 Control API

Provide source, grant, scan, diagnostic, and settings operations. Bind only to loopback and protect all state-changing routes with an installation-scoped secret, strict Origin checks, CSRF validation, and least-privilege response payloads.

### FR-07 OLED cockpit UI

Use a near-black OLED material system, restrained green for positive/current selection, true dark-glass depth, left navigation, central workspace, and dynamic evidence detail. The project rack uses fixed slots: selecting a card animates only the departing and arriving cards; other cards do not reorder. Drag, wheel, click, and keyboard selection are all supported. Reduced-motion users receive state changes without parallax or large movement.

### FR-08 Lifecycle

Support platform-appropriate launch-at-login, scan frequency, data directory, diagnostics export, index rebuild, update migration, and uninstall instructions. Uninstall must not touch source directories.

## 5. Domain facts and inference levels

- `observed`: directly read fact, such as a commit timestamp.
- `derived`: deterministic computation, such as a 30-day commit total.
- `suggested`: heuristic relation or status; always carries evidence, confidence, and review state.
- `confirmed`: a local user confirmation; never writes back to sources.

## 6. Acceptance and quality gates

- All adapters implement the versioned protocol and pass anonymous fixture contract tests.
- Security tests cover path traversal, out-of-grant symlinks, malicious Markdown, CSRF, loopback cross-origin control calls, and log redaction.
- Regression tests cover the six read APIs, five primary views, and exports compatibility.
- Validate desktop widths 1440 and target wide screen; responsive widths 320, 375, 768, and 1024.
- Validate keyboard controls, focus, text scaling, high contrast, reduced motion, empty/loading/error states, long text, and no page-level horizontal overflow.
- A stage cannot be reported complete if tests required by that stage fail.

## 7. Desktop authorization UI security (M2 amendment)

When running inside the desktop shell, authorization controls must use a narrow, validated IPC bridge. The renderer may request a native folder selection, but it must not receive raw control credentials or a general filesystem capability. A selected folder is represented by an opaque, short-lived handle until the user explicitly confirms the source and metadata/body scope. Browser development mode remains read-only for source control unless a separate secure development bridge is added.
