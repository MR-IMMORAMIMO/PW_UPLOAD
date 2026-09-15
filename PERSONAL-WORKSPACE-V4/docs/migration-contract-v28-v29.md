# Final UI relations migration: 1.0.0

The registered migration `production-28-29-final-ui-relations-1.0.0` advances
the Personal database from schema 28 to 29. The existing production migration
runner remains the startup authority; do not execute the helper against a live
database outside that runner or manually change its version/history.

## Added data

| Table              | Columns                                  | Existing-record values          |
| ------------------ | ---------------------------------------- | ------------------------------- |
| `project_contacts` | `phone`, `is_primary`                    | Empty phone; false primary flag |
| `project_actions`  | `area`, `luminaire_id`, `review_item_id` | Empty area; null links          |

No existing project, contact, action, revision, document, or asset identity is
replaced. Display tags and filenames are not link keys. New action links must
resolve to a record in the same project before storage accepts them. Unchanged
historical links do not prevent an unrelated edit when the target is no longer
available. The UI must describe an unavailable target without substituting a
different record.

Contact updates from older clients preserve omitted phone and primary values.
An explicit empty phone or false flag clears that value. Multiple contacts may
be primary; this flag does not define exclusive project ownership.

The final Actions editor uses the sparse, version-checked endpoint. Its editable
fields include owner role, category and the new context fields. Source provenance
is excluded from that contract. A legacy full-record update also advances the
row version, so a subsequent stale sparse update is rejected. Sparse updates
and their workspace activity append share a savepoint.

## Upgrade and recovery

Use the existing verified-backup and versioned-startup process. The source and
target schema fingerprints and registered history are validated by that process.
The helper is idempotent for a complete target and rejects a partially applied
schema. The surrounding migration transaction handles failure rollback.

The explicit reverse helper restores the schema-28 structure only while all five
new fields still contain their original default values. It refuses rollback when
new values exist, rather than discarding them. It is a tested recovery primitive,
not an automatic application downgrade command. Restoring a pre-upgrade backup
after further user work needs an owner-approved recovery plan that preserves that
new work; do not restore it silently.

Validation covers default values, retained identities, repeat application,
schema fingerprint restoration, partial-schema refusal, rollback refusal after
new data, cross-project link rejection, omission versus explicit clearing,
stale edits and over-posted source fields. Validation uses disposable databases.
