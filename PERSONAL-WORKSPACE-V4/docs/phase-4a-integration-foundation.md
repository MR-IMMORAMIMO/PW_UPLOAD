# Phase 4A integration and automation foundation

Phase 4A establishes durable, UUID-bound external-tool context and a narrow Windows desktop launch
boundary for AutoCAD and DIALux. It does not detect, classify, name, copy, move, or attach outputs.
Those routing behaviors remain P4B; workflow UI remains P4C.

## Schema v20

Migration `production-19-20-automation-revision-binding-audit` is strictly additive:

- `tool_contexts`: nullable `target_revision_id`, `source_document_id`.
- `capture_ledger`: nullable `target_revision_id`, `routing_decision`, `routing_reason`,
  `decided_at`, `decided_by_id`, `decided_by_name`.
- index `capture_ledger(project_id, target_revision_id, state)`.

There is no historical backfill. Revision and source-Document values are immutable UUID snapshots,
not foreign keys: deletion or Revision-number reuse must not erase or redirect historical audit
truth. The only routing decisions are `AUTO_APPROVED`, `USER_CONFIRMED`, and `REJECTED`.
`USER_CONFIRMED` requires decision time plus actor ID/name snapshots; a system-owned decision may
omit a human actor. Decisions are write-once.

Production startup uses the existing migration runner. It must create and verify a v19 backup
before the v20 transaction. Forward validation checks the exact v20 structural fingerprint,
integrity, foreign keys, and decision provenance. A fault rolls the complete v20 DDL transaction
back to v19. A current v20 database is structurally revalidated before an up-to-date return.

## Context lifecycle and API

The Personal API provides authenticated Project-authorized context lifecycle endpoints:

- `GET|POST /api/personal/projects/:projectId/automation-contexts`
- `POST /api/personal/automation-contexts/:toolContextId/expire`
- `POST /api/personal/automation-contexts/:toolContextId/rebind`
- `POST /api/personal/automation-contexts/:toolContextId/close`

Opening accepts only `AUTOCAD` or `DIALUX`, an expected artifact type, and optional exact Revision
and source-Document UUIDs. The API validates both optional identities against the selected Project.
Multiple Projects may have independent contexts. API restart expires every `LIVE`/`REBOUND`
context; rebind is explicit and revalidates the original UUID snapshots. A deleted Revision is
therefore stale even when its display sequence is later reused.

## Desktop security boundary

The preload exposes bounded integration actions, never `exec(command)` or `shell(command)`:

- report AutoCAD/DIALux installation status;
- configure one validated executable path per supported application;
- prepare a UUID-owned session inbox under the application data root;
- launch the supported application, optionally with an application-specific source extension.

Executable discovery is bounded to configured paths and known Windows vendor directories. Multiple
AutoCAD versions are discovered without binding the data model to a year. Manual configuration is
accepted only after the Desktop-owned Windows file picker returns a supported executable name; the
renderer cannot submit an arbitrary executable path. Configuration is a
machine-local atomic JSON file under the desktop data root, not project or domain state. Launch uses
direct process arguments with no shell. Before opening a source file, Desktop re-checks the exact
Project UUID in the root `.scli-project.json` marker, canonical path containment, and non-symlink
file identity. The dedicated inbox is only a context handoff in P4A; no watcher trusts or routes
its contents yet.

## Validation and operational boundary

All automated tests use disposable SQLite databases, temp directories, and fake executable files.
No Golden, MADAM, configured Personal database, business Project root, or live application process
is opened. Real-machine launch and export UAT belongs to the later owner-authorized workflow slice.
