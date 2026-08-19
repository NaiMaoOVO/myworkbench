# MyWorkbench

A **local-first personal work-evidence cockpit** for macOS and Windows.

MyWorkbench will only scan user-approved local directories, defaults to metadata-only collection, keeps derived indexes on the current device, and never writes to source data. GitHub is for source and release distribution only—not a user-data backend.

## Status

This repository was initialized from the supplied PRD and visual reference on **August 19, 2026**. The supplied material described an earlier implementation, but no source code was provided; this repository begins with the M0 requirements and design baseline.

## Development order

1. Requirements — [`docs/requirements.md`](docs/requirements.md)
2. Design — [`docs/design.md`](docs/design.md)
3. Gap matrix — [`docs/gap-matrix.md`](docs/gap-matrix.md)
4. Implementation plan — [`docs/implementation-plan.md`](docs/implementation-plan.md)
5. Open-source evaluation — [`docs/research/open-source-options.md`](docs/research/open-source-options.md)

## Privacy commitments

- No scan before explicit per-source authorization.
- Metadata only by default; note and session bodies require a separate source-specific opt-in.
- Git source bodies are out of scope for v1.0 indexing.
- Raw sources are strictly read-only.
- Derived indexes can be removed per source and rebuilt from authorized sources.
- User data, real paths, session bodies, exports, databases, and logs are never committed.
