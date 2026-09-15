# Phase 5C — Document Intelligence

Phase 5C adds a standalone-first, Owner-governed PDF intelligence system. It admits immutable PDF
bytes or an existing immutable Phase 4 Artifact Version, extracts bounded evidence, performs local
OCR only where native text is deficient, and exposes one global Review Center at `/documents`.
It never creates or mutates a canonical Revision.

## Authority and identity

- `document_sources` owns immutable source identity: a server-computed SHA-256 over managed bytes,
  or the exact immutable Artifact Version UUID. Filenames, paths, Project Codes, and extracted text
  are evidence, never identity.
- `intelligence_documents` owns review lifecycle, classification, confirmed Project UUID,
  comparison eligibility, and optimistic row version.
- `document_versions` preserves immutable admission provenance and source lineage. Reprocessing
  creates attempts and derived evidence; it does not rewrite source identity.
- `document_owner_decisions` is append-only and records actor UUID/name snapshot, UTC time, reason,
  before/after projection, expected row version, target identity, and relevant fingerprint.
- Schema v26 is additive. Empty pre-release rollback is supported with foreign keys enabled;
  rollback refuses populated v26 tables so document records cannot be silently erased.

## Admission firewall

The renderer receives an opaque `SELECT_DOCUMENT_PDF` handoff only. Desktop revalidates a single
regular, non-link `.pdf` of at most 50 MiB and copies it into the exact UUID-owned staging inbox.
The API repeats signature, size, containment, and regular-file checks, computes SHA-256, and uses an
exclusive no-replace copy into `document-store/objects/<prefix>/<sha256>.pdf`. Concurrent duplicate
admissions converge on the verified object. Internal absolute paths never enter API read models.

Existing Phase 4 Artifact Versions are linked by UUID and hash without copying. Their Project
authority is rechecked before admission and evidence preview.

## Durable processing

Processing states are persisted in `document_processing_attempts`: validation, native extraction,
targeted OCR, classification, association, structured extraction, relationship generation, and
quality. Startup marks abandoned active attempts `INTERRUPTED`; Owner retry uses an idempotency key.
Attempt values are replaced transactionally, so replay cannot duplicate evidence.

Bounds are 50 MiB, 200 native pages, 20 automatic OCR pages per attempt, 10 manual pages per
request, 40 OCR pages over a version lifetime, 30 seconds per OCR page, and approximately six
minutes per attempt. Preview is one page at about 200 DPI and is capped at 1800×2500 and 5 MP.
Incomplete bounded results remain explicit and require Owner acceptance.

## Offline OCR

The API production build packages pinned `tesseract.js`, `tesseract.js-core`, WebAssembly,
dependencies, and the English trained-data file under `dist/ocr-runtime`. The package manifest
contains SHA-256 checksums. The packaged worker replaces `fetch` with a fail-closed network guard;
OCR initialization and recognition therefore use bundled assets only.

Run:

```powershell
pnpm ocr:package-smoke
pnpm ocr:runtime-smoke
```

The first command verifies required assets and pinned checksums. The second starts and terminates
the packaged worker with network access disabled. Either failure blocks Phase 5C readiness.

## Evidence, association, and consistency

Native PDF text is attempted before OCR. Extracted values retain page, bounded region, raw and
normalized values, unit/basis, method, confidence, adapter ID/version, and warnings. Deterministic
classifiers cover DIALux reports, layouts, schedules, BOQ/QTO, datasheets, submittals, markups,
reference/meeting/commercial/revision/transmittal/cover/rendering documents, and Unknown.

Project association is never inferred into authority. Controlled Project context/UUID is strong;
exact normalized Project name or client plus site is medium; Project Code alone is weak. Conflicts
and ambiguity remain review states until an Owner confirms the Project UUID.

Consistency checks include only accepted, comparison-enabled documents for the same confirmed
Project. They are capped at 500 documents or 50,000 values. Values are grouped by Tag and field,
units and technical bases must be compatible, every source value remains evidence, and the engine
never selects a winner. Each run has an exact source-set fingerprint; a changed source set
supersedes prior generated findings without deleting their history.

## Owner review and governed routing

The Review Center provides server-backed queue filters/pagination, bounded evidence, quality and
consistency findings, relationships, decision history, and routing proposals. Owner actions use
compare-and-swap row versions; stale actions fail explicitly. Classification, Project association,
relationships, acceptance/exclusion, comparison inclusion, finding lifecycle, supersession,
incomplete acceptance, retry/cancel, and routing controls remain separate explicit actions.

Routing eligibility requires available verified source bytes, confirmed Project, settled
classification and relationships, no blocking routing finding, and an enabled UUID-owned folder
mapping beneath a verified Project root. Approval records the exact eligibility fingerprint.
Execution recomputes source hash, Project marker/root, folder configuration, association,
classification, relationships, and proposal row version, then performs a no-replace managed copy
and creates the established Project Document/Managed Artifact/Artifact Version links. It never
creates a Revision or replaces an existing destination file.

## Backup, restore, and disposable acceptance

Personal backup asset roots include `document-store/objects`. The manifest records every managed
object and its hash; restore verifies database integrity, v26 foreign keys and relationships, and
restores exact immutable bytes. Tests corrupt a backed document deliberately, restore, and verify
the source hash, retryable attempt, duplicate-source convergence, and database relationships.

Synthetic fixtures A–L are generated only under task-owned temporary roots. They cover native
DIALux evidence, image-only OCR, conflict/ambiguity, revision and exact duplicate cases,
incompatible quantities/bases, related documents, weak Project Code, malformed PDF recovery, and
reference documents. Golden, MADAM, live Personal data, business Projects, and real external tools
must not be used for Phase 5C acceptance.

## Legacy Luminaire Datasheet adoption

Technical Check detects current `LEGACY_PATH` Datasheet AssetVersions before document processing.
It reports `LEGACY_DATASHEET_REQUIRES_ADOPTION`; it does not attempt native extraction or OCR.
The Owner action accepts only Project, Luminaire, and current AssetVersion UUIDs. The server
re-resolves the persisted legacy path and requires the existing Project storage authority to be
`CONNECTED` with its matching marker before inspecting the external source.

One verified Personal workspace backup is required before the first mutation in an adoption
batch. Each exact source must be a regular non-link PDF within the existing size bound, with PDF
magic, stable size, and a server-computed SHA-256. A populated historical hash must match; a null
historical hash is allowed only for the exact current attachment and remains null on the old row.
Exact bytes are copied through the existing staged, no-replace Project Luminaire Asset storage.
Only after the final size/hash check does a transaction create the next `DATA_ROOT_RELATIVE`
AssetVersion, update the current attachment projection, and append
`LEGACY_DATASHEET_ADOPTED` provenance linking the old/new UUIDs and backup ID. The old AssetVersion
and external file are never rewritten or deleted.

Replay returns `ALREADY_MANAGED`; it creates no duplicate AssetVersion, P5C source, document-store
object, or OCR attempt. Technical Check returns one typed outcome per Luminaire so managed successes,
legacy adoption needs, missing Datasheets, verification failures, and unverified comparisons remain
visible together instead of collapsing the response on the first failure. This compatibility path
ends at AssetVersion adoption; normal v27 `LUMINAIRE_ASSET_VERSION` processing remains the only P5C
handoff.

## Deferred non-goals

No PDF editing, annotation, reordering, authoring, cloud OCR, AI/generative classification,
filesystem scanning, filename-owned Project binding, Project Revision creation, automatic conflict
winner, Microsoft tenant claim, or live external-application automation is included.
