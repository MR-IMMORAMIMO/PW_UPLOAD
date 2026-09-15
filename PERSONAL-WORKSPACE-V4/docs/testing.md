# Testing

## P5B-B Project Apply

Project Apply acceptance and its disposable Owner workflow are documented in [phase-5b-project-apply.md](./phase-5b-project-apply.md). The focused suites are `ImportProjectApply.test.ts`, `ImportProjectApplyPerformance.test.ts`, `ImportBackupRestore.test.ts`, `ProjectLuminaireWriteStore.test.ts`, the v25 migration tests, `SmartImportCenterPage.test.tsx`, and `tests/v4-e2e/p5b-smart-import.spec.ts`.

- Phase 3B shared interaction coverage is documented in `phase-3b-interaction-motion.md`. Run the
  disposable V4 motion acceptance with `pnpm test:e2e:v4`; it uses a temporary Personal database
  authority and does not open Golden, MADAM, or the configured live Personal database.

## Test layers

- Domain/contract tests cover project-code formatting, unsafe input, workload thresholds, transitions, authorization, reporting and concurrent allocation.
- API/service tests cover on-behalf audit, forged owner denial, capacity override, direct URL access, Lighting Designer assignment denial, collaborator access, stale-version conflicts, completed-project locking, typed errors, one-active-timer enforcement, paused-time exclusion, audited corrections, and timesheet approval/return.
- Standalone integration tests use temporary SQLite databases to verify signed local sessions, Admin-created accounts, password hashing, and persistence across provider restarts.
- Startup-safety tests use temporary directories and synthetic databases to verify the database-scoped startup lock (real child-process rejection, crash release, path-alias identity, hard-link fail-closed behavior) and the workspace startup coordinator (lock-before-gate ordering, migration-before-provider ordering, recovery-required gating with no automatic reconciliation, runtime ownership, and idempotent shutdown).
- Canonical output-registry migration tests use only temporary SQLite databases. They cover fresh and version-3 upgrades, deterministic built-in Template registration, conservative legacy provenance classification, UUID-aware Revision snapshots, additive Output rows, relocation-safe locators, immutable resolved Template snapshots, and same-Revision package foreign keys. They never open the user/UAT database or Project folders.
- Canonical generation/recovery tests use in-memory databases and disposable OS temp Project roots. They cover one shared server-sequenced Revision across Schedule/BOQ outputs, per-Output hashes and controlled temp-to-final moves, renderer and multi-output failures, identity-preserving retry, final-path collision protection, interrupted-state reconciliation and repeatability, finalized-file integrity alerts, canonical package manifests/reissues, mixed/unfinalized/missing/tampered package rejection, immutable Template snapshots, and Luminaire UUID continuity across Tag renames. The suite never opens the configured standalone/UAT database or a real Project folder.
- Issue Record Audit tests (V4-ISSUE-A0) prove the server-derived Issue authority: Issued packages receive the authenticated actor snapshot and ONE server timestamp consistently across the canonical record, the `ProjectWorkspace.revisionPackages` read projection, and the package manifest; Draft packages persist nulls and their manifests do not claim an Issue event; client payloads cannot spoof `issuedAt`/`issuedBy`; the API route propagates the authenticated actor; `FAILED_RECOVERABLE` retry preserves the original Issue audit even when performed by another actor; reissue mints its own new Issue audit values; pre-migration rows remain readable with nulls and no fabricated history; and no Submission or IssueHistory entity/table is introduced.
- P2C-07 Revision metadata tests prove v18-to-v19 additive NULL migration/restart behavior, no legacy summary/changeLog fabrication, optional create normalization, exact Project/Revision UUID updates, PREPARING-only mutation, FINALIZED/FAILED_RECOVERABLE/legacy immutability, fresh reuse NULL metadata, server-side record authorization, Purpose-only Package/Issue History context, and Internal Note exclusion from those contracts and screens.
- Versioned migration reality tests build deterministic, populated v15-v19 databases with two isolated projects. They prove exact ProjectDocument, AssetVersion, ManagedArtifact, Revision, Output, Package/member, tombstone, and reuse preservation through v20; legacy NULL hashes remain NULL; historical Purpose/Internal Note and automation audit fields remain NULL; malformed late structures and partial provenance tuples are refused; migration faults roll back to the unchanged source marker/history and succeed only on an explicit retry; and a v20 restart preserves the canonical digest. Every fixture is a disposable synthetic database and no configured Personal, Golden, or TEST database is opened.
- Phase 4A tests prove the mandatory verified v19 backup gate, forward and rollback behavior, populated-fixture preservation, exact v20 structural validation, restart-safe context expiry, stale Revision UUID refusal, immutable Revision/source snapshots, bounded routing decisions, and complete actor evidence for `USER_CONFIRMED`. Desktop tests use disposable fake executables and prove allow-listed application identities, UUID-owned inboxes, extension-specific source validation, and shell-free spawn arguments.
- Production-Personal bootstrap tests (P2-FND-A2-01) prove that every supported production Personal entrypoint resolves to ONE canonical bootstrap: they assert the actual `pnpm start` package scripts, verify `server.ts` routes only `APP_MODE=standalone` + `WORKSPACE_VARIANT=personal` + `NODE_ENV=production` to the shared canonical Personal production server, spawn the real `server.ts` against a disposable temp database to confirm it reaches schema v20 with the canonical registry and final structural validation, drive a canonical Revision through the wired app, assert production Personal fails closed (never builds a legacy-writer runtime) when a CANONICAL registry is absent, and verify restart idempotence against the same temp database. All databases and project roots are disposable OS temp locations.
- Legacy-onboarding tests use temporary project roots and SQLite databases to verify folder-name parsing, template exclusion, metadata classification, exact-code retention, sequence advancement, safe archive/restore/removal, and unchanged physical folders.
- SharePoint adapter tests mock Graph and prove a `412` ETag conflict causes a fresh read and retry.
- React Testing Library covers simplified Sales/Manager project intake, lighting-template application, assignment override, action visibility, workload/Admin controls, submitted-time approval, and loading/error behavior.
- Playwright covers eight team-mode journeys plus two personal-workspace journeys, including legacy import and safe removal.

## Commands

```powershell
pnpm test
pnpm test:components
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:personal
```

Run all non-E2E tests with `pnpm test:all`. Run the entire release gate with `pnpm check`.

## E2E isolation

Playwright waits separately for API health and the Vite URL. It uses one worker because the in-memory seed is shared, resets before each test through the guarded route, and never contacts Microsoft 365. Tests use accessible labels/roles for UI behavior and API calls only where a deny/concurrency boundary itself is under test.

The eight scenarios are:

1. Sales create → Manager assign → Lighting Designer update/time track/submit → Manager approve → Sales verify.
2. Manager on-behalf creation and dual-identity audit.
3. Manager adds a collaborator → collaborator edits shared lighting content → Sales verifies.
4. Unrelated Sales direct-URL denial.
5. Lighting Designer assignment denial.
6. Explicit unavailable-Lighting-Designer override.
7. Optimistic board update rollback after server rejection.
8. Unique codes under concurrent HTTP creation.

Personal-mode Playwright additionally verifies the full V3.1 lighting workspace and the preview â†’ inspect â†’ import â†’ remove-from-app legacy flow while asserting that the source folder and file still exist.

## CI

`.github/workflows/ci.yml` installs the locked workspace on Node 24/pnpm 11, runs format/lint/typecheck/unit/component/build/manifest/package gates, installs Chromium with OS dependencies, and runs Playwright. Tests are tenant-free and require no secrets.

## Live tenant acceptance still required

Standalone and mock tests require no tenant. They cannot prove tenant SSO consent, `Sites.Selected` grant, real list mappings, SharePoint throttling behavior, Teams framing, catalog policy, bot installation or proactive delivery. Those checks apply only to a future `m365` pilot and must use test accounts for all four roles while preserving correlation IDs without recording access tokens.

# Phase 4B capture tests

P4B focused coverage includes exact capability/extension policy, Windows-safe naming, direct-child realpath containment, event/content dedupe, idempotent ArtifactVersion allocation, bounded factory defaults, and cross-project filesystem isolation. Full gates remain the repository lint, unit/component suites, TypeScript, production builds, Personal/V4 E2E, Teams validation/package, and `git diff --check`.

## P4D output-presentation tests

P4D focused coverage verifies the v20-to-v21 family rebuild and historical Template byte
preservation; resolved Technical Schedule, Presentation 2/3/4 density, UUID-safe BOQ rows and
Datasheet Register warnings; Preview-fingerprint freshness; exact Revision UUID/output binding;
searchable PDF page structure; native XLSX row/metadata/print parity; V4 FloatingWorkspace
Preview-first behavior; Issue Package ordered composition Preview; and the existing
`INTERNAL_GENERATED`/`PACKAGE_OUTPUT` capture-loop exclusions. Disposable Project roots are used for
physical artifact tests. Golden, MADAM, Personal business Projects, and live external tools are not
used.

## Phase 5B-A Smart Import tests and Owner UAT

Focused tests cover schema v23-to-v24/fresh migration, restart/no replay, partial-schema refusal,
rollback, foreign keys, adapter precedence, DIALux two-row headers, CSV delimiter/encoding/quoted
records, XLSX multi-sheet/hidden/title/header ambiguity, output metadata exclusion, formula safety,
mapping conflicts, normalization evidence, admission/hash/containment/cleanup, optimistic mapping
concurrency, server filtering/pagination, authorization, history reopen, and the absence of Apply.
The canonical `BackupManager` and `RestoreManager` test proves sessions, tables, mappings, raw rows,
normalization, validation, and History survive restore without source bytes. A synthetic probe
reports parse, approximate persistence, 50-row query time, and SQLite size at 100, 1,000, 5,000,
and 10,000 rows; the UI never renders all source rows at once.

Create the three disposable Owner sources in a non-business temporary folder:

```powershell
pnpm --filter @scli/api exec tsx src/scripts/create-smart-import-uat-fixtures.ts C:\Temp\scli-p5b-owner-uat
```

Use `01-dialux-native-semicolon.csv`, `02-generic-pagination.tsv`, and
`03-manufacturer-multi-sheet.xlsx` only against a disposable local profile. Verify detection,
worksheet/header selection, suggested and corrected mappings, W versus W/m and lm versus lm/m,
raw/normalized comparison, blocked and warning filters, History, process restart, and reopening the
same session. Confirm Project and Master Library counts/content remain unchanged. Do not use a live
Personal database, Golden database, business Project root, or external application.

The required P5B-A checks are the focused import/migration/API/backup/UI suites, root and Web V4
typechecks, lint, full Web V4 tests, the V4 Playwright journey, API/Web V4 production builds,
changed-file Prettier, and `git diff --check`. Rendered acceptance records Light and Dark at
1440×900, 1920×1080 coverage, a compact desktop width, keyboard focus/Escape, and document-level
horizontal overflow.

## Phase 5C document intelligence tests

Focused gates cover v26 migration/convergence/rollback refusal, atomic source admission, durable
retry/interruption/manual OCR, native-before-OCR processing, A–L synthetic fixtures, actual bundled
OCR confidence/regions, lighting extraction, association ambiguity/conflict, duplicate/revision
relationships, quality, exact source-set consistency fingerprints, routing revalidation/no-replace,
backup/restore, opaque Desktop handoff, contracts, Review Center behavior, and stale CAS errors.
Release gates additionally require full root/API and Web V4 tests, established Phase 4/P5A/P5B
regressions, V4 Playwright, root and Web V4 typechecks, lint/format, API/Web/Desktop builds, Teams
validation/package, both OCR smokes, rendered Light/Dark geometry at 1080/1440/1920, and clean diff
checks. All fixtures and runtime roots must be disposable and task-owned.
