# Architecture and design — M0

**Status:** implementation baseline
**Architecture:** local modular monolith with versioned source adapters

## 1. Technology decision

Build the desktop product with **Tauri v2 + React + TypeScript** and a Rust local core.

Why this is the smallest suitable option:

- One desktop application can package a local UI, native filesystem policy, SQLite, scheduling, and platform integration without a cloud backend.
- Rust makes canonical path, symlink, and grant-boundary enforcement explicit at the scan boundary.
- Tauri’s maintained plugins cover OS file dialogs, persistent non-sensitive UI settings, and launch-at-login.
- The app can run a loopback-only HTTP server for compatibility APIs while keeping privileged operations in the native core.

Rejected for the initial implementation:

- Microservices: unnecessary deployment, upgrade, and privacy complexity.
- Browser-only application: cannot safely own local permissions, background lifecycle, and install experience.
- Electron: viable fallback, but selected only if Tauri packaging blocks v1.0; it has a larger distribution/runtime footprint for this local utility.

## 2. Module boundaries

```text
apps/desktop/                 Tauri shell and React UI
crates/core/                  domain model, authorization, scanner orchestration
crates/adapters/              versioned source adapters and contract harness
crates/storage/               SQLite schema, migrations, repositories
crates/local-api/             loopback read/control API and request protections
crates/platform/              paths, launch lifecycle, OS abstractions
fixtures/anonymous/           synthetic adapter fixtures only
tests/                        integration, security, API, UI checks
docs/                         requirements, design, release and support docs
```

The UI depends on API-facing view models, not adapter internals. Adapters depend on core contracts, not the UI or SQLite implementation.

## 3. Adapter contract

```rust
trait SourceAdapter {
  fn manifest(&self) -> AdapterManifest;
  fn discover(&self, platform: &PlatformContext) -> Vec<CandidateLocation>;
  fn preview(&self, grant: &AuthorizationGrant) -> Result<ScanPreview, AdapterError>;
  fn scan(&self, grant: &AuthorizationGrant, cursor: Option<ScanCursor>) -> ScanStream;
  fn normalize(&self, raw: RawRecord) -> Result<NormalizedRecord, AdapterError>;
  fn redact(&self, record: NormalizedRecord, scope: ContentScope) -> NormalizedRecord;
  fn health(&self) -> AdapterHealth;
  fn migrate(&self, from_version: AdapterVersion) -> Result<(), AdapterError>;
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
