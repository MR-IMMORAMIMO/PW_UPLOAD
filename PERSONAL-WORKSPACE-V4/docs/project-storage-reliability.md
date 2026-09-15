# Project storage reliability

Phase 3A keeps database-backed Project work available even when local storage is missing or unavailable. File-producing and filesystem-destructive operations use a separate verified-root guard and fail before mutation unless ownership is proven.

## Identity marker

Program-owned Project roots contain `.scli-project.json`:

```json
{
  "schemaVersion": 1,
  "projectId": "immutable-project-uuid",
  "createdAt": "UTC ISO timestamp",
  "projectCodeSnapshot": "informational project reference"
}
```

Only `projectId` is identity authority. The marker is parsed strictly and is never changed by health reads, startup, Project open, scanning, or passive reconciliation. It is created exclusively for a newly provisioned root, explicit legacy adoption, or explicit initial binding. A conflicting marker is never overwritten.

## Derived health

Storage health is runtime-derived and is not persisted:

- `CONNECTED`: both stored paths agree, the directory is readable and canonical, and the marker UUID equals the Project UUID.
- `LEGACY_UNVERIFIED`: both paths agree, the root is readable, no marker exists, and `PROJECT_INFO.txt` carries compatible historical evidence.
- `DISCONNECTED`: neither persisted path is configured.
- `UNAVAILABLE`: the agreed directory cannot be inspected (`NOT_FOUND`, `PERMISSION_DENIED`, or `IO_UNAVAILABLE`).
- `NEEDS_RECONNECTION`: path authorities disagree or marker/evidence validation fails.

`LEGACY_UNVERIFIED` is compatibility evidence, not verified ownership. Adoption is always explicit.

## Reconnect safety

Reconnect requests declare one intent: matching-marker reconnect, legacy adoption, or initial binding. The server canonicalizes the explicitly selected root, rejects filesystem-root/overlong paths and symlink/reparse escapes, validates marker identity, checks other Project bindings, and rejects unrelated non-empty unmarked folders. Program-created trees and all managed descendants retain their existing project-root containment checks.

Both `Project.projectFolderPath` and `project_workspaces.folder_path` are updated as one logical operation. In standalone Personal mode they share one SQLite transaction. If a newly created marker precedes a failed persistence step, compensation removes only that operation's matching marker; pre-existing markers are never removed.

## Verified-root boundary

The shared server guard is applied before representative current filesystem mutations: Document/Datasheet snapshot intake, generated Schedule/BOQ and package export, Package creation, and Revision delete/archive. Status, comments, actions, meetings, metadata, and other database-only reads/writes remain usable while storage is unavailable.
