# Architecture and design — M0

**Status:** implementation baseline
**Architecture:** local modular monolith with versioned source adapters

## 1. Technology decision

Build the product as a **TypeScript local modular monolith**: React UI, Node 24 local runtime, native `node:sqlite` derived store, and an Electron desktop shell.

Why this is the smallest suitable option:

- The current development environment has Node 24 and built-in SQLite support (`node:sqlite`), while Rust/Tauri is not installed.
- It keeps scanner policy, SQLite, local API, and platform shell in a single language/runtime, reducing initial delivery risk.
- Electron provides mature macOS/Windows packaging, native dialogs, login-item integration, and a preload isolation boundary for the local UI.
- The local runtime can preserve the required six read APIs and enforce the loopback control-API model without a cloud backend.

Rejected for the initial implementation:

- Microservices: unnecessary deployment, upgrade, and privacy complexity.
- Browser-only application: cannot safely own local permissions, background lifecycle, and install experience.
- Tauri: technically attractive and retained as a future migration option, but not selected for M1 because its Rust toolchain is not available in the current environment and would delay a verifiable core.

Electron security defaults are mandatory: context isolation on, sandbox on, Node integration off in renderer processes, navigation and window-open allowlists, and a narrow typed preload bridge.

## 2. Module boundaries

```text
apps/desktop/                 Electron main process, preload bridge, React UI
src/core/                     domain model, authorization, scanner orchestration
src/adapters/                 versioned source adapters and contract harness
src/storage/                  SQLite schema, migrations, repositories
src/local-api/                loopback read/control API and request protections
src/platform/                 paths, launch lifecycle, OS abstractions
fixtures/anonymous/           synthetic adapter fixtures only
tests/                        integration, security, API, UI checks
docs/                         requirements, design, release and support docs
```

The UI depends on API-facing view models, not adapter internals. Adapters depend on core contracts, not the UI or SQLite implementation.

## 3. Adapter contract

```ts
interface SourceAdapter {
  manifest(): AdapterManifest;
  discover(platform: PlatformContext): Promise<CandidateLocation[]>;
  preview(grant: AuthorizationGrant): Promise<ScanPreview>;
  scan(grant: AuthorizationGrant, cursor?: ScanCursor): AsyncIterable<ScanRecord>;
  normalize(raw: RawRecord): NormalizedRecord;
  redact(record: NormalizedRecord, scope: ContentScope): NormalizedRecord;
  health(): Promise<AdapterHealth>;
  migrate(fromVersion: AdapterVersion): Promise<void>;
}
```

`scan` emits individual record outcomes and source-level progress. The scanner catches adapter panics/errors at the source boundary; malformed records become diagnostics rather than ending the run.

## 4. Authorization and filesystem policy

Each source instance owns an `AuthorizationGrant`:

```text
source_id
canonical allowed roots
metadata-only | metadata-and-body scope
granted_at / revoked_at
last_used_at
```

The scanner must resolve each candidate path, resolve symlinks where supported, normalize platform path forms, and verify the final canonical path remains under a granted root before opening it. Windows drive and UNC semantics are abstracted behind `platform`.

No adapter is allowed to read a default path until the user grants it. Discovery checks installation markers/path existence only.

## 5. Derived storage and migrations

SQLite stores only derived records and local user confirmations. Core tables begin with:

```text
source, authorization_grant, scan_run, workspace, project, session,
event, artifact, evidence, assertion, coverage, diagnostic, scan_cursor
```

Body-derived data is stored in a source-specific partition so removing body permission or deleting a source index does not affect other sources. The application backs up configuration and authorization metadata before a schema upgrade. If an index migration cannot proceed, the index may be rebuilt from still-authorized sources; raw sources are untouched.

## 6. Source linking

Strong association signals, in priority order:

1. stable source IDs;
2. canonical workspace path / Git root;
3. Git remote identity;
4. session cwd or explicit project id.

Title similarity and temporal proximity produce a `suggested` relation only. They cannot produce a confirmed project fact.

## 7. Local API security model

The local API listens on `127.0.0.1` or `::1` only. The app chooses a conflict-free local port and passes its origin plus an installation-scoped secret to its own UI. State-changing requests require all of:

1. accepted loopback peer;
2. exact expected Origin;
3. secret in a non-URL request header;
4. CSRF token matched to the app session;
5. JSON content type and bounded body;
6. route-specific authorization.

Responses never return ungranted bodies. Logs store safe error codes and redacted locators; they do not store session content, usernames, or full paths by default.

## 8. UI direction and interaction model

**Direction:** quiet, technical OLED cockpit—not a generic admin dashboard. Near-black surfaces use physical glass cues: rear contour, absorption layer, limited refraction, a front reflection, thin silver edge light, and muted green only for selected/healthy states.

Desktop layout:

```text
left floating navigation (220–248px)
central operational workspace (search, metrics, card rack, timeline)
right evidence detail (300–340px)
```

For 768–1279px, evidence detail becomes a drawer. Under 768px, navigation becomes bottom navigation, the rack is horizontally navigated, and detail is a drawer.

The rack is a slot state machine, not a sortable grid:

```text
slots: fixed ordered positions
selected: one project
transition: previous selected -> slot, next selected -> raised green state
other slots: unchanged
input: click | keyboard arrows | wheel | horizontal drag
```

Only `previous` and `next` transition. New projects start from the far-right depth position. `prefers-reduced-motion` keeps a clear selection difference but disables perspective/parallax/large travel.

## 9. Test design

- Unit: path boundaries, redaction, normalization, dedupe, inference labels, time handling.
- Adapter contract: one anonymous fixture set per adapter, including unsupported versions and corrupted records.
- Integration: grant → preview → scan → API → revoke/delete index.
- Security: traversal, symlink escape, malicious markup, cross-origin loopback requests, token/CSRF rejection, redacted logs.
- UI: keyboard route, reduced-motion route, responsive screen sizes, stable card slots.
- Platform: macOS and Windows installation, scan, restart recovery, and uninstall checked with real authorized data before release.

## 10. Secure desktop authorization bridge (M2 amendment)

The desktop renderer must **not** receive the loopback installation secret, CSRF token, raw granted root, or an endpoint that can mint those values. Electron main owns the database, authorization grants, file-dialog interaction, and source-control calls.

The preload bridge exposes a narrow allowlist only to the trusted MyWorkbench renderer:

```text
sources.list()
sources.chooseDirectory(sourceId) -> opaque one-time selection handle
sources.grant(sourceId, selectionHandle, scope)
sources.preview(sourceId)
sources.scan(sourceId)
sources.revoke(sourceId)
sources.deleteIndex(sourceId)
```

`chooseDirectory` runs the native OS folder picker in the main process. It returns an opaque, short-lived selection handle—not a filesystem path. `grant` accepts a handle only when it belongs to the same supported source and has not expired. The main process canonicalizes the selected root before storing the grant. Every subsequent scan still performs path-boundary checks before file access.

Each IPC handler verifies the sender's origin against the application UI origin, validates source IDs against the registered adapter catalog, rejects unsupported sources, and returns safe messages. No generic IPC channel, `shell` bridge, filesystem bridge, or arbitrary command bridge is exposed. The app blocks webview attachment, denies uncontrolled navigation and new windows, and keeps context isolation, sandboxing, and Node integration restrictions enabled.

The loopback control API remains protected for compatibility clients. The desktop UI uses IPC for privileged operations; it does not use loopback credentials.
