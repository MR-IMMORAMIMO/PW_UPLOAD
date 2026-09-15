# Revision duplication

The Final V4 Schedule action creates a new PREPARING composed Revision from a finalized canonical Revision. It preserves the source Project and Luminaire snapshots and copies Revision purpose and internal notes. The new Revision receives a new UUID, the next server-allocated sequence, and the current actor and timestamp.

Historical Generated Outputs and Document Snapshots remain owned by the source Revision. They are not relabeled, moved, deleted, or attached to the new draft. The composed-output workflow can generate fresh outputs from the copied Luminaire snapshot. Normal finalization requirements still apply.

`POST /api/projects/:id/revisions/:revisionId/duplicate` accepts only `requestId` (UUID) and `expectedSnapshotHash` (SHA-256). The API requires Project access and the Personal workspace owner permission. It rejects other-project sources, noncanonical or unfinished sources, missing snapshots, stale hashes, and additional input fields.

An immediate SQLite transaction covers source validation, request deduplication, sequence allocation, and insertion. The request UUID and source UUID/hash are stored in the new immutable Project snapshot. Retrying the same request returns the same Revision; reusing it for another source is a conflict. Sequence allocation includes deletion history, so duplication never reuses a reserved historical number.

The client retains the request UUID following an uncertain failure and clears it after success. This operation introduces no schema migration and makes no changes to source artifact files.

Validation covers preserved source records and deliverable ownership, new identity/sequence, idempotent replay, stale hashes, foreign Projects, and rejection of unfinished copies.
