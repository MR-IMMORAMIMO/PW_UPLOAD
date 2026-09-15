# Versioned migration contract: v16-v19

This document records the closed Phase 2 migration boundary through schema v19. The current target
is v20; the unchanged historical v16-v19 chain described here remains its required source history.
See `phase-4a-integration-foundation.md` for the additive v19-to-v20 contract.

## Supported late-version upgrades

- v15 to v16 rebuilds `revision_document_snapshots` so each snapshot is sourced by exactly one
  `ProjectDocument` or immutable `LuminaireAssetVersion`. Existing document and ManagedArtifact
  provenance is copied without inference.
- v16 to v17 additively creates the durable Safe Revision Delete operation/tombstone authority.
- v17 to v18 additively adds the five-field Revision-number reuse provenance tuple and its partial
  unique index.
- v18 to v19 additively adds independently nullable `TEXT` Purpose and Internal Note fields with no
  defaults or historical backfill.

The complete migration registry remains the only authority for an upgrade. A versioned database
must have an exact, contiguous migration history whose IDs, version pairs, order, and checksums
match that registry.

## Fail-closed structural validation

Before each v15-v19 mutation commits, the migration validates the exact cumulative source/target
structure. An already-current v19 database is validated before startup returns `up-to-date`.
Validation covers:

- every production-owned table, explicit index, trigger, declared column, SQL constraint, foreign
  key, and indexed expression through a locked per-version structural fingerprint;
- SQLite `integrity_check` and `foreign_key_check` with foreign-key enforcement enabled;
- the exact v16 snapshot source XOR and provenance foreign keys;
- the complete v17 delete-operation contract;
- the exact nullable v18 reuse columns and partial unique index;
- v19 Purpose/Internal Note as independently nullable `TEXT` columns with no defaults; and
- reuse data where all five fields are either NULL, or all five are populated on a `COMPLETED`
  tombstone.

A mismatch is refused. The application does not complete a partial target structure, rebuild an
unknown schema, synthesize migration history, or treat `integrity_check` alone as sufficient.

## Preservation rules

- Historical `luminaire_asset_versions.file_hash = NULL` remains `NULL` and means the historical
  bytes were never verified. No filename, path, timestamp, or opportunistically available file is
  used to derive a hash.
- Existing ProjectDocument, AssetVersion, ManagedArtifact, Revision, Output, Package, member, and
  project bindings remain exact across the late migration chain.
- Delete-operation/tombstone rows and valid reuse tuples remain complete and immutable through v19.
- Historical Revision Purpose and Internal Note remain `NULL`; compatibility summary/change-log
  text is not semantic authority for either field.

## Failure, backup, and retry

Each migration executes inside its own `BEGIN IMMEDIATE` transaction. Schema/data changes,
migration-history insertion, and `user_version` advancement commit atomically. A failing late step
rolls back that step while earlier committed steps remain authoritative.

Exactly one verified backup is created before the first pending migration transaction. A failure
retains that backup and leaves the database at the last committed version. Restore and retry are
explicit operator actions: there is no automatic restore, repair, or retry.

## Operational boundary

P2C-12 tests use only synthetic file-backed SQLite fixtures. Running migration or validation
against a real Personal, Golden, TEST, or other user database requires separate owner authority and
the guarded production runbook. No live-data operation is part of this implementation slice.
