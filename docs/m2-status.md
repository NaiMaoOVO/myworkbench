# M2 status — first source adapters and source inventory

**Updated:** August 20, 2026
**Status:** partial; not ready to claim full M2 completion.

## Implemented and verified with anonymous fixtures

- Source inventory includes Obsidian, Git, Codex, Claude, exports compatibility, and the remaining planned agent sources.
- Obsidian adapter scans user-granted Markdown trees, skips symlinks and excluded implementation folders, and reads Markdown bodies only with a body grant.
- Git adapter reads commit metadata through the local `git` executable and never reads source file bodies or diffs.
- Codex and Claude adapters parse a constrained, documented anonymous JSONL compatibility shape; each keeps bodies out of metadata-only scans and isolates malformed records.
- The exports compatibility adapter remains available and visibly separate from native sources.
- iFlow, ZCode, Kimi Code, Gemini, Hermes, and OpenClaw are visible as `unsupported`; the API does not imply that they are working adapters.
- Source state inventory is displayed from the real `/api/sources` response in browser mode and from the restricted desktop IPC source inventory in the Electron shell.
- The desktop source centre implements native folder selection → opaque handle → preview → explicit authorization → scan/revoke/delete-derived-index. Browser mode remains read-only. The compatibility control API separately supports grant, preview, scan, revoke, and delete-derived-index operations, with exact Origin, installation secret, and CSRF requirements.

## Intentionally not yet complete

- A secure Electron IPC bridge is implemented: the native folder picker returns only an opaque, one-time handle; preview/grant/scan/revoke/delete-index operations run in the main process. Secrets and selected paths are not returned from a public loopback endpoint, placed in URLs, or exposed to the renderer. The Electron runtime itself is not yet end-to-end smoke-tested in this environment.
- No real user source directory has been authorized or scanned during automated verification. Tests use temporary directories and anonymous fixtures only.
- Default-path discovery is intentionally disabled until per-tool format and candidate-path rules are researched and validated; no current-machine path is treated as product behavior.
- iFlow, ZCode, Kimi Code, Gemini, Hermes, and OpenClaw require dedicated parsers, fixtures, and contract tests.
- Windows installation, startup recovery, and uninstall have not been tested.
- Electron runtime download/smoke validation is blocked in this environment; TypeScript compilation passes, but a packaged desktop runtime is not yet claimed working.

## M2 acceptance remaining

1. Run an Electron-runtime smoke test for the IPC bridge, including trusted sender rejection and native folder-dialog behavior.
2. Run one user-supervised real-data scan per first-wave adapter, outside the test fixtures and only after explicit path selection.
3. Add the six remaining adapter implementations and source-specific anonymous fixture contracts.
4. Validate Windows installation, startup recovery, and uninstall.
