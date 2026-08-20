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
- Source state inventory is displayed from the real `/api/sources` response in the UI.
- The existing control API supports grant, preview, scan, revoke, and delete-derived-index operations for adapters registered by the local runtime. State-changing calls still require exact Origin, installation secret, and CSRF token.

## Intentionally not yet complete

- A secure Electron IPC bridge is specified in the architecture; implementation is the next M2 increment. Secrets are deliberately not returned from a public loopback endpoint or placed in page URLs.
- No real user source directory has been authorized or scanned during automated verification. Tests use temporary directories and anonymous fixtures only.
- Default-path discovery is intentionally disabled until per-tool format and candidate-path rules are researched and validated; no current-machine path is treated as product behavior.
- iFlow, ZCode, Kimi Code, Gemini, Hermes, and OpenClaw require dedicated parsers, fixtures, and contract tests.
- Windows installation, startup recovery, and uninstall have not been tested.
- Electron runtime download/smoke validation is blocked in this environment; TypeScript compilation passes, but a packaged desktop runtime is not yet claimed working.

## M2 acceptance remaining

1. Implement Electron IPC-backed directory selection and authorization controls without exposing control credentials to arbitrary web content.
2. Add end-to-end authorization flows for Obsidian, Git, Codex, and Claude, including revoke and index deletion in the UI.
3. Run one user-supervised real-data scan per first-wave adapter, outside the test fixtures and only after explicit path selection.
4. Add the six remaining adapter implementations and source-specific anonymous fixture contracts.
