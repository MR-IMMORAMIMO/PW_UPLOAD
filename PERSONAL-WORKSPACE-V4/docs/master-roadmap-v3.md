# SCLI Lighting Project Workspace — Master Product and Implementation Roadmap v3

> **Current as of:** 2026-08-06
> **Current HEAD:** ebfe2b8
> **Branch:** feature/v3.3-migration-foundation
>
> This document is the consolidated master roadmap for the SCLI Lighting Project Workspace v3 product line. It supersedes the original Prompt 00–27 implementation sequence for planning purposes while preserving every original Prompt reference for traceability.

The original `docs/roadmap-v3.3.md` retains the historical Prompt 00–27 numbering as the authoritative implementation reference. This master roadmap adds consolidated phase ordering, quality gates, approved product decisions, and current implementation status.

## Prompt-to-Phase Mapping Table

| Original Prompt | Original Feature Name                              | Consolidated Phase                                                                                       | Current Status | Dependencies                                | Scope Change                                           |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------- | ------------------------------------------------------ |
| Prompt 00       | Repository Governance Baseline                     | Phase 0 — Governance and Clean Baseline                                                                  | COMPLETED      | None                                        | Unchanged                                              |
| Prompt 01       | v3.3 Migration Foundation Scope                    | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | IN PROGRESS    | Phase 0                                     | Unchanged                                              |
| Prompt 02       | PathResolverService                                | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | COMPLETED      | Phase 0                                     | Unchanged                                              |
| Prompt 03       | BackupManager                                      | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | COMPLETED      | Phase 0, PathResolverService                | Unchanged                                              |
| Prompt 04       | SchemaMigrationRunner                              | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | COMPLETED      | Phase 0, PathResolverService, BackupManager | Unchanged                                              |
| Prompt 05       | MigrationJournal (External)                        | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | PLANNED        | SchemaMigrationRunner                       | Unchanged                                              |
| Prompt 06       | LegacyDetector                                     | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | PLANNED        | SchemaMigrationRunner                       | Unchanged                                              |
| Prompt 07       | Minimal Safe Restore                               | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | PLANNED        | BackupManager, MigrationJournal             | Early safety sub-phase of Prompt 26                    |
| Prompt 08       | Real Product Migrations (v3.2.2 → v3.3)            | Phase 2 — Project Identity, SCT Naming, CRM, Workflow, and Configurability                               | PLANNED        | Phase 1 complete                            | Unchanged                                              |
| Prompt 09       | Immutable Project IDs (UUID)                       | Phase 2 — Project Identity, SCT Naming, CRM, Workflow, and Configurability                               | PLANNED        | Phase 1 complete                            | Unchanged                                              |
| Prompt 10       | Project Manifest (.scli/project.manifest.json)     | Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation                                      | PLANNED        | Immutable Project IDs                       | Moved to Phase 1 (manifest foundation)                 |
| Prompt 11       | Project Code Format (SCT prefix)                   | Phase 2 — Project Identity, SCT Naming, CRM, Workflow, and Configurability                               | PLANNED        | Immutable Project IDs                       | Unchanged                                              |
| Prompt 12       | CRM Reference Field                                | Phase 2 — Project Identity, SCT Naming, CRM, Workflow, and Configurability                               | PLANNED        | Immutable Project IDs                       | Unchanged                                              |
| Prompt 13       | Legacy SCLI Code Search                            | Phase 2 — Project Identity, SCT Naming, CRM, Workflow, and Configurability                               | PLANNED        | Project Code Format                         | Unchanged                                              |
| Prompt 14       | File Operations (preview, validate, journal)       | Phase 3 — Normalized Technical Data, Datasheets, and Issue Package Foundation                            | PLANNED        | Phase 2 complete                            | Unchanged                                              |
| Prompt 15       | Revision Packages (immutable, reissue)             | Phase 3 — Normalized Technical Data, Datasheets, and Issue Package Foundation                            | PLANNED        | File Operations                             | Unchanged                                              |
| Prompt 16       | PDF Report Foundation                              | Phase 5 — Unified Reports, PDF, CSV, and Versioned Template Foundation                                   | PLANNED        | Phase 2 complete                            | Unchanged                                              |
| Prompt 17       | CSV Export Foundation                              | Phase 5 — Unified Reports, PDF, CSV, and Versioned Template Foundation                                   | PLANNED        | Phase 2 complete                            | Unchanged                                              |
| Prompt 18       | Versioned Report Templates                         | Phase 5 — Unified Reports, PDF, CSV, and Versioned Template Foundation                                   | PLANNED        | PDF Report Foundation                       | Unchanged                                              |
| Prompt 19       | Non-Priced BOQ                                     | Phase 6 — Technical Schedule, Presentation Schedule, Non-Priced BOQ, Live Preview, and Pre-Issue Outputs | PLANNED        | Phase 5 complete                            | Unchanged                                              |
| Prompt 20       | UI Design System (Scientechnic)                    | Phase 4 — Scientechnic Design System and UI Foundation                                                   | PLANNED        | Phase 2 complete                            | Unchanged                                              |
| Prompt 21       | Board/List/Compact Views                           | Phase 4 — Scientechnic Design System and UI Foundation                                                   | PLANNED        | UI Design System                            | Unchanged                                              |
| Prompt 22       | Accessibility and Keyboard Navigation              | Phase 4 — Scientechnic Design System and UI Foundation                                                   | PLANNED        | UI Design System                            | Unchanged                                              |
| Prompt 23       | Reduced Motion and Animation                       | Phase 4 — Scientechnic Design System and UI Foundation                                                   | PLANNED        | UI Design System                            | Unchanged                                              |
| Prompt 24       | Background Jobs                                    | Phase 7 — Long-Running Jobs, OCR, and Technical Quality                                                  | DEFERRED       | Phase 5 complete                            | Moved to Phase 7                                       |
| Prompt 25       | Productivity, Library, Import, AutoCAD, and Search | Phase 8 — Productivity, Library, Import, AutoCAD, Revision Comparison, Search, and Similar Project       | PLANNED        | Phase 5 complete                            | Unchanged                                              |
| Prompt 26       | Operational Backup                                 | Phase 9 — Operational Backup, Restore UI, Retention, and Optional OneDrive Snapshots                     | PLANNED        | Phase 1 complete (Minimal Safe Restore)     | Full scope remains Phase 9; early sub-phase in Phase 1 |
| Prompt 27       | Final Hardening                                    | Phase 10 — Final Hardening, Upgrade Verification, and Portable Release                                   | PLANNED        | All prior phases complete                   | Unchanged                                              |

---

## Phase 0 — Governance and Clean Baseline

**Status:** COMPLETED

**Goal:** Establish repository governance, architecture documentation, coding standards, and a clean format/lint/typecheck/test/build/E2E baseline before any feature work begins.

**Dependencies:** None (foundational phase).

**Scope:**

- Repository governance documentation (`AGENTS.md`, `docs/repository-rules.md`).
- Architecture documentation (`docs/architecture.md`).
- Coding standards (`docs/coding-standards.md`).
- Assumptions documentation (`docs/assumptions.md`).
- Security documentation (`docs/security.md`).
- Testing documentation (`docs/testing.md`).
- Windows Git/Node/pnpm development environment verification.
- Clean format, lint, typecheck, test, build, and E2E baseline.

**Explicit Exclusions:**

- No application source code changes.
- No database modifications.
- No feature implementation.
- No implication that application features were delivered in Phase 0.

**Main Deliverables:**

- Governance commit `d0b459e`.
- All `docs/*.md` files created and consistent.
- `pnpm check` passing from a clean repository state.

**Acceptance Criteria:**

- `pnpm format:check` passes.
- `pnpm lint` passes with zero warnings.
- `pnpm typecheck` passes across all packages.
- `pnpm test:all` passes.
- `pnpm build` succeeds.
- `pnpm test:e2e` and `pnpm test:e2e:personal` pass.
- `pnpm teams:validate` and `pnpm teams:package` succeed.

**Test Requirements:**

- All existing tests pass without modification.

**User Approval Checkpoint:** Not applicable (governance phase).

**Commit Boundary:** `d0b459e`

**Original Prompt References:** Prompt 00

---

## Phase 1 — Migration, Recovery, Manifest, and File-Safety Foundation

**Status:** IN PROGRESS

**Goal:** Build the complete migration safety infrastructure — path resolution, verified backups, schema migration runner, external journal, legacy detection, minimal safe restore, project manifest, stable IDs, path migration, file-operation journal, and foundation regression — before any product data migration touches a real database.

**Dependencies:** Phase 0 complete.

**Scope:**

### P1.1 — PathResolverService

**Status:** COMPLETED | **Commit:** `0729c9f`

- Portable relative-path resolution.
- Windows path normalization and validation.
- Lexical traversal protection (`..` rejection).
- Long-path diagnostics for MAX_PATH awareness.
- 41 focused tests.

### P1.2 — BackupManager

**Status:** COMPLETED | **Commit:** `7bb97dc`

- `node:sqlite` online `backup()` API.
- WAL-safe open-database backups.
- Staging and promotion workflow.
- `PRAGMA integrity_check` verification.
- SHA-256 checksum and strict metadata.
- Source-handle/path matching.
- Symlink/junction protection.
- No personal absolute-path leakage.
- 53 focused tests (2 skipped for platform-specific behavior).

### P1.3 — SchemaMigrationRunner

**Status:** COMPLETED | **Commit:** `7a1cc0d`

- `PRAGMA user_version` as authoritative schema version.
- `schema_migrations` table as successful committed history only.
- Verified backup before any mutation (one per upgrade run).
- `BEGIN IMMEDIATE` transaction per migration step.
- STEP ATOMICITY guarantee (not full-upgrade atomicity).
- External journal port for attempt lifecycle recording.
- Post-commit independent read-only validation.
- Populated unversioned-database protection.
- Source-version-aware backup factory input.
- Explicit startup-integration blocker until persistent journal and interrupted-attempt recovery exist.
- 84 focused tests.

### P1.4 — Persistent External MigrationJournal

**Status:** PLANNED

- Persistent external journal for migration attempt lifecycle.
- Survives SQLite transaction rollback.
- Enables interrupted-run detection and reconciliation.

### P1.5 — Interrupted-Attempt Detection and Reconciliation

**Status:** PLANNED

- Detects partially completed upgrade runs.
- Reconciles committed intermediate steps with external journal state.
- Required before startup integration of SchemaMigrationRunner.

### P1.6 — Representative v3.2.2 Fixture Builder

**Status:** PLANNED

- Deterministic fixture builder for v3.2.2 database states.
- Supports empty, valid, unknown/partial, and future-version databases.
- Required for migration and recovery testing.

### P1.7 — Legacy v3.2.2 Detector

**Status:** PLANNED

- Detects pre-v3.3 database formats.
- Classifies database state (empty, v3.2.x, corrupted, unknown).
- Provides structured detection result for migration orchestration.

### P1.8 — Atomic Baseline Stamping

**Status:** PLANNED

- `schema_migrations` table creation for existing databases.
- Approved baseline history row insertion.
- `PRAGMA user_version` alignment.
- Ensures existing databases are correctly stamped before upgrade.

### P1.8B — Database Startup Lock and Workspace Startup Coordinator Core

**Status:** IMPLEMENTED (core only; production wiring deferred)

- Database-scoped cross-process startup lock held as a live SQLite `BEGIN EXCLUSIVE`
  transaction on a dedicated sibling lock database (rollback-journal mode, bounded busy
  timeout, no PID stale-marker deletion, crash-released by the OS).
- Canonical lock identity from the real parent directory plus the Windows-normalized database
  filename, hashed with SHA-256; path casing, `.`/`..` segments, separator variants, and
  parent-directory junction aliases map to one lock; multiple-hard-link targets fail closed.
- `WorkspaceStartupCoordinator` ordering: lock, pending-restore gate, read-only
  interrupted-attempt gate, schema migration runner, then provider and personal-store
  factories; the coordinator owns runtime resources and releases them on shutdown.
- No automatic reconciliation: unresolved, corrupt, or stale journal states return
  `RECOVERY_REQUIRED` with `manualActionRequired=true`; no resolution sidecar is ever written.
- Production startup entry points (Electron main, personal/team servers, app assembly,
  provider factory, provider/store constructors) are NOT wired yet; wiring is a separate task.

### P1.9 — Startup Integration Gate

**Status:** PLANNED

- Gate before long-lived SQLite connections.
- Ensures journal and reconciliation exist before startup integration.
- Personal and existing Team startup consistency.

### P1.10 — Minimal Safe Restore Coordinator

**Status:** PLANNED

- Restore from a verified backup with integrity verification.
- Closed database connections before restore.
- WAL/SHM file handling.
- Staging and safe replacement workflow.
- Restart and recovery report.
- Compatibility check.
- Must exist before SCT/CRM/product-data migrations.

### P1.11 — Project Manifest

**Status:** PLANNED

- `.scli/project.manifest.json` as the application source of truth.
- Human-readable `PROJECT_INFO.txt` (manual edits never update manifest automatically).
- Manifest read/write service foundation.

### P1.12 — Stable Configurable-Entity IDs

**Status:** PLANNED

- Stable IDs for configurable entities (scopes, folders, deliverables, workflow stages, custom fields).
- Prevents ID drift when configuration changes.

### P1.13 — Existing Absolute-to-Relative Stored-Path Migration

**Status:** PLANNED

- Migrates existing stored absolute paths to relative paths.
- Uses PathResolverService for safe conversion.

### P1.14 — File-Operation Planner and Journal

**Status:** PLANNED

- File-operation planner for preview before action.
- File-operation journal for all file mutations.
- Locked, missing, conflict, junction, and path-length handling.

### P1.15 — Foundation Regression and Recovery Testing

**Status:** PLANNED

- End-to-end regression tests for the complete foundation.
- Recovery testing from simulated failures.
- Concurrency tests for sequence and backup operations.

**Locked Safety Decisions:**

- STEP ATOMICITY (not full-upgrade atomicity).
- One verified backup before upgrade mutation.
- Startup integration blocked until persistent journal and interrupted-run reconciliation exist.
- Minimal restore must exist before SCT/CRM/product-data migrations.
- Full scheduled backup/retention/OneDrive behavior remains in Phase 9.

**Explicit Exclusions:**

- No real product migrations (Phase 2).
- No UI, Electron, Teams, or documentation changes.
- No modification of providers, stores, or servers beyond foundation infrastructure.

**Main Deliverables:**

- PathResolverService (committed).
- BackupManager (committed).
- SchemaMigrationRunner (committed).
- External MigrationJournal (planned).
- Interrupted-attempt detection and reconciliation (planned).
- v3.2.2 fixture builder (planned).
- Legacy detector (planned).
- Atomic baseline stamping (planned).
- Startup integration gate (planned).
- Minimal Safe Restore Coordinator (planned).
- Project manifest (planned).
- Stable configurable-entity IDs (planned).
- Path migration (planned).
- File-operation planner and journal (planned).
- Foundation regression and recovery testing (planned).

**Acceptance Criteria:**

- All committed components pass their focused test suites.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:all`, `pnpm build`, and `pnpm test:e2e:personal` pass at each commit boundary.
- No existing functionality regresses.
- SchemaMigrationRunner explicitly blocks startup integration.
- Minimal Safe Restore exists before product-data migrations.

**Test Requirements:**

- Focused unit tests for each component.
- Concurrency tests for sequence and backup operations.
- Authorization-style tests for path traversal and backup protection.
- Migration tests with v3.2.2 fixture data.
- Recovery tests from simulated failures.
- Mock-mode E2E tests continue to pass.

**User Approval Checkpoint:** Required before Phase 2 (real product migrations).

**Commit Boundaries:** `0729c9f`, `7bb97dc`, `7a1cc0d` (completed); additional commits for P1.4–P1.15.

**Original Prompt References:** Prompts 01, 02, 03, 04, 05, 06, 07, 10

---

## Phase 2 — Project Identity, SCT Naming, CRM, Workflow, and Configurability

**Status:** PLANNED

**Goal:** Implement the v3.3 project identity, SCT naming, CRM reference, repeatable issue/revision cycles, and full configurability on top of the completed safety foundation, including real product migrations from v3.2.2 to v3.3.

**Dependencies:** Phase 1 complete (all safety components committed and tested, including Minimal Safe Restore and manifest foundation).

**Scope:**

- Immutable Project IDs (UUID) as the relational identity.
- Configurable SCT naming.
- Default format: `###_SCTYYMMDD_PROJECT_NAME`.
- SCT prefix remains configurable.
- SCLI-to-SCT migration wizard.
- Legacy Project Code preserved.
- Project-code history.
- Separate CRM Reference field.
- CRM history.
- CRM CSV migration.
- Repeatable Issue/Revision cycles.
- Configurable scopes.
- Configurable folders.
- Configurable deliverables.
- Configurable workflow.
- Custom fields.
- Template snapshots.
- Project overrides.
- Versioned configuration export/import.
- Real product migrations from v3.2.2 to v3.3.

**Explicit Exclusions:**

- No normalized technical data or datasheets (Phase 3).
- No report generation (Phase 5).
- No UI redesign (Phase 4).
- No schedule or BOQ outputs (Phase 6).

**Main Deliverables:**

- Migration scripts for v3.2.2 → v3.3.
- UUID-based project identity.
- SCT project code generation and formatting.
- SCLI-to-SCT migration wizard.
- Legacy code preservation and search.
- CRM reference field with history and CSV migration.
- Configurable scopes, folders, deliverables, and workflow.
- Custom fields support.
- Template snapshots and project overrides.
- Versioned configuration export/import.

**Acceptance Criteria:**

- Existing v3.2.2 databases upgrade successfully.
- Project codes follow the configurable SCT format.
- SCLI-to-SCT migration wizard converts legacy codes correctly.
- Legacy codes remain searchable.
- CRM reference is separate and searchable.
- Issue/Revision cycles are repeatable.
- Configuration is versioned and exportable.
- All quality gates pass.

**Test Requirements:**

- Migration tests with real v3.2.2 fixture data.
- UUID uniqueness and immutability tests.
- SCT code format and migration wizard tests.
- CRM reference and CSV migration tests.
- Configurable workflow and custom fields tests.
- Configuration export/import tests.

**User Approval Checkpoint:** Required before Phase 3.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompts 08, 09, 11, 12, 13

---

## Phase 3 — Normalized Technical Data, Datasheets, and Issue Package Foundation

**Status:** PLANNED

**Goal:** Implement normalized technical data structures, datasheet registry, file operations with preview/validation/journaling, immutable revision packages with reissue support, and the Issue Package Builder.

**Dependencies:** Phase 2 complete.

**Scope:**

- Product entity.
- Variant entity.
- Project Luminaire Snapshot.
- Tag.
- Area / Zone / Location.
- Quantity and CAD-instance relationship.
- Separation of CAD presentation from technical data.
- Datasheet Registry.
- Stable DS references.
- Many-to-many tag/datasheet links.
- File hashes.
- Datasheet revision history.
- File operations with preview, validation, journal, and rollback.
- Received files and datasheet originals remain unchanged.
- Only package copies may be renamed according to approved settings.
- Issue Package Builder.
- Package manifest and hashes.
- Output Registry.
- Immutable issued revision packages.
- Reissue creates new Issue/Revision identities.
- Manufacturer.
- Manufacturer aliases.
- Product Family.
- Master Luminaire Product.
- Manufacturer Reference.
- Raw and normalized manufacturer references.
- Product-reference type.
- Project-only draft luminaire.
- Project Luminaire Snapshot.
- Product revision/version.
- Duplicate-detection evidence.
- Composite uniqueness by manufacturer and normalized reference.

**Clarification:** Phase 3 builds the trusted normalized data model and identity rules. It does not build the complete Library user experience.

### Data Model Foundation — Manufacturer and Reference Identity

The locked commercial identity rule is `manufacturerId + manufacturerReferenceNormalized` (D35 — Master Luminaire Commercial Identity in [docs/product-decisions.md](docs/product-decisions.md)): every manufacturer and every approved Master Luminaire Product has an immutable internal ID; the same normalized reference under the same manufacturer is a duplicate, while the same reference under different manufacturers is allowed; family and model are grouping, display, and search fields, not unique identifiers. Manufacturer Reference is a product-level field and is unrelated to the SCT project reference, CRM reference number, project code, or project luminaire tags.

The Phase 3 data model foundation covers the Manufacturer Reference classifications, Manufacturer and Product Family entities, PROJECT_ONLY_DRAFT behavior, independent Project Luminaire Snapshots, and duplicate-detection evidence. The detailed rules live with the locked decision in docs/product-decisions.md and are not duplicated here.

**Explicit Exclusions:**

- No report generation (Phase 5).
- No UI redesign (Phase 4).
- No schedule or BOQ outputs (Phase 6).

**Main Deliverables:**

- Normalized technical data model (Product, Variant, Luminaire snapshot, Tag, Area/Zone/Location).
- Datasheet Registry with stable references and revision history.
- File operation service with preview, validation, journal, and rollback.
- Issue Package Builder with manifest and hashes.
- Output Registry.
- Revision package service with immutability guarantees.
- Reissue workflow.

**Acceptance Criteria:**

- Technical data is normalized and separated from CAD presentation.
- Datasheet Registry provides stable references with many-to-many tag links.
- File preview shows exact changes before application.
- Invalid file operations are rejected with clear errors.
- All file mutations produce audit records.
- Received files and datasheet originals are never modified.
- Issue Packages include manifest and hashes.
- Revision packages cannot be modified after issue.
- Reissue produces new identities.
- ERCO + B009945 is accepted.
- VENUS + B009945 is also accepted.
- A second ERCO + B009945 normalized reference is rejected.
- Raw reference remains unchanged for display.
- Conservative normalization does not merge meaningful punctuation.
- ERCO / Jilly / B009945 and ERCO / Jilly / Y99742654 remain separate.
- Manufacturer aliases resolve to one manufacturerId.
- Product Family is not used as a unique product key.
- Project-only drafts may exist without a manufacturer reference.
- Project-only drafts cannot be approved into the Master Library without manufacturer and reference.
- Datasheet hash alone never merges two products.
- Similar technical values never merge two references automatically.
- Adding from the Library creates an independent project snapshot.
- Updating a Master Product does not silently change an existing project.
- Issued Schedule remains reproducible.
- Issued non-priced BOQ remains reproducible.
- Import preview distinguishes exact match, possible duplicate, new reference and new product.
- Archived products remain visible in historical projects.

**Test Requirements:**

- Normalized data model tests.
- Datasheet Registry tests (stable references, many-to-many links, revision history).
- File operation tests (valid and invalid paths, types, sizes).
- Journal audit completeness tests.
- Issue Package Builder tests (manifest, hashes).
- Revision immutability tests.
- Reissue identity tests.
- Foundation integration regression tests.

**User Approval Checkpoint:** Required before Phase 4.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompts 14, 15

---

## Phase 4 — Scientechnic Design System and UI Foundation

**Status:** PLANNED

**Goal:** Apply the Scientechnic design direction with Board/List/Compact views, full accessibility, keyboard navigation, reduced-motion support, and a premium desktop-app character.

**Dependencies:** Phase 2 complete (data model). Phase 3 not required but recommended.

**Scope:**

- Official Scientechnic logo asset.
- Scientechnic cyan/navy/light direction.
- Production colors verified against official Brand Guide when available.
- Typography, spacing, borders, shadows, status colors, motion tokens.
- 180–240 ms restrained transitions.
- Reduced-motion behavior.
- Keyboard and focus requirements.
- Reusable UI components.
- Saved / Saving / Unsaved states.
- Planner-inspired Projects board.
- Board / List / Compact views.
- Collapsible sidebar.
- Right-side inspectors.
- Five project navigation groups.
- `SCIENTECHNIC_SLC_UI_CONCEPT_V1` is an approved external reference package that is not yet inside the repository. It will be copied into the repository only when UI implementation starts. Mockup-generated logos or text must not be used as production assets. Production uses the official logo.
- Semantic HTML and accessible primitives for dialogs, menus, comboboxes, tabs, and tooltips.
- Full keyboard navigation with visible focus states.
- `prefers-reduced-motion` support.
- Drag-and-drop with keyboard-accessible alternative.
- Charts with equivalent tabular data.
- Responsive layout preserving Teams safe areas, iframe constraints, and narrow/mobile layouts.
- Color is never the sole indicator of status or validation.

**Explicit Exclusions:**

- No chatbot or local LLM integration.
- No commercial pricing UI.
- No production report/schedule/BOQ outputs (Phase 6).
- No all-screen implementation before user approval checkpoint.

**Main Deliverables:**

- Design token system (Scientechnic palette, typography, spacing, borders, shadows, status colors, motion tokens).
- App shell with collapsible sidebar and right-side inspectors.
- Board/List/Compact view components.
- Five project navigation groups.
- Keyboard navigation system.
- Saved/Saving/Unsaved state indicators.
- Accessibility audit and remediation.
- Motion and animation system.

**Acceptance Criteria:**

- All views render correctly in Light, Dark, and System themes.
- Every action is keyboard-reachable.
- Color is never the sole indicator of status or validation.
- Reduced motion is respected.
- Drag-and-drop has keyboard alternative.
- Charts include tabular data equivalents.
- User approval is obtained after design tokens, app shell, Projects board, navigation size, card density, and motion behavior — before all screens are implemented.

**Test Requirements:**

- Visual regression tests for all themes.
- Keyboard navigation tests.
- Accessibility audit (axe-core or similar).
- Motion preference tests.
- Responsive layout tests.
- No clipped text.
- No animation delaying input.

**User Approval Checkpoint:** Required after design tokens, app shell, Projects board, navigation size, card density, and motion behavior. Do not implement all screens before this checkpoint.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompts 20, 21, 22, 23

---

## Phase 5 — Unified Reports, PDF, CSV, and Versioned Template Foundation

**Status:** PLANNED

**Goal:** Build the reusable reporting foundation — normalized report model, versioned templates, shared preview/final rendering pipeline, professional searchable/selectable-text PDF, structured CSV, and output registry — before Schedule and BOQ.

**Dependencies:** Phase 2 complete (data model). Phase 3 not required but recommended. Phase 4 not required but recommended.

**Scope:**

### Reporting Pipeline

Structured Source Data → Normalized Report Model → Versioned Template → Shared Preview/Final Renderer → PDF / CSV → Output Registry

### PDF Requirements

- Professional searchable/selectable-text PDF.
- Not an application screenshot, rasterized page-only output, or unrelated print fallback.
- Official logo.
- Corporate header/footer.
- A4 portrait, A4 landscape, A3 where required.
- Repeated table headers.
- Page numbers.
- Correct page breaks.
- Project metadata, SCT, CRM where relevant, Issue/Revision.
- Prepared By / Checked By.
- Current filtered view, full report, and selected rows/items where applicable.

### CSV Requirements

- Structured CSV with invariant machine-readable dates and UTF-8 encoding.
- XLSX only later where justified.

### Preview and Final Output Parity

Preview and final output must use the same:

- Report model.
- Template.
- Filters.
- Grouping.
- Calculations.
- Rendering pipeline.

### Versioned Templates

Templates must include:

- Template ID.
- Template version.
- Page size.
- Orientation.
- Header/footer.
- Logo.
- Typography.
- Columns, order, width, visibility.
- Grouping.
- Sorting.
- Image settings.
- Cover settings.
- Notes.
- Duplicate template.
- Reset to company default.
- Project-specific override.
- Historical output reproducibility.

V1 must be a controlled settings editor, not a complex WYSIWYG document editor.

### Output Registry

- Output registry for all generated outputs.
- Output hashes for integrity and reproducibility.
- Historical template reproducibility.
- Structured data as the source of truth for all reports.

**Explicit Exclusions:**

- No priced BOQ or financial calculations.
- No commercial pricing system.
- No BI/warehousing integration.
- No schedule, BOQ, or issue output layouts (Phase 6).
- No complex WYSIWYG template editor in V1.

**Main Deliverables:**

- Normalized report model and schema.
- PDF report service with template rendering.
- CSV export service.
- Template versioning system with full settings.
- Shared preview/final rendering pipeline.
- Output registry with hashes.

**Acceptance Criteria:**

- PDF output is a real document with searchable/selectable text, not a screenshot.
- PDF includes logo, header/footer, page numbers, correct page breaks, repeated table headers.
- CSV output uses UTF-8 and machine-readable dates.
- Templates are versioned and historically reproducible.
- Preview matches final output (same pipeline, model, template, filters, grouping, calculations).
- Output registry records all generated outputs with hashes.
- V1 is a controlled settings editor.

**Test Requirements:**

- PDF output verification tests (golden PDF comparison).
- CSV format and encoding tests.
- Template versioning and reproducibility tests.
- Preview/final output parity tests.
- Output registry and hash verification tests.

**User Approval Checkpoint:** Required before Phase 6.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompts 16, 17, 18

---

## Phase 6 — Technical Schedule, Presentation Schedule, Non-Priced BOQ, Live Preview, and Pre-Issue Outputs

**Status:** PLANNED

**Goal:** Implement the technical output layer — Technical Luminaire Schedule, Presentation Luminaire Schedule, Non-Priced Technical BOQ, Live Preview, Image standardization, Pre-Issue Validation, and Datasheet/Issue Package outputs — building on the Phase 5 report foundation.

**Dependencies:** Phase 5 complete (unified report foundation). Phase 3 complete (datasheets and issue packages).

**Scope:**

- Technical Luminaire Schedule.
- Presentation Luminaire Schedule.
- Technical BOQ (Non-Priced Quantity Take-Off only).
- Live Preview (using the shared Phase 5 rendering pipeline).
- Image standardization.
- Pre-Issue Validation.
- Datasheet and Issue Package outputs.

### Non-Priced BOQ Lock

The Technical BOQ is strictly NON-PRICED QUANTITY TAKE-OFF. It must not contain:

- Rate.
- Amount.
- Currency.
- VAT.
- Financial subtotal.
- Financial total.
- Commercial pricing fields.

The report model itself must not contain pricing fields. Validation must detect unexpected pricing-related fields. Schedule and BOQ quantities must reconcile. BOQ template settings control presentation only and never mutate:

- Quantities.
- Tags.
- Technical data.
- Datasheet links.
- Issue Package records.
- Historical issued outputs.

**Explicit Exclusions:**

- No priced BOQ or financial calculations.
- No Rate, Amount, Currency, VAT, or financial subtotals.
- No commercial total.
- No BI/warehousing integration.
- No BOQ template settings that mutate quantities or technical data.

**Main Deliverables:**

- Technical Luminaire Schedule generator.
- Presentation Luminaire Schedule generator.
- Non-Priced BOQ generator.
- Image standardization service.
- Pre-Issue Validation service.
- Datasheet and Issue Package output service.

**Acceptance Criteria:**

- Technical Schedule and Presentation Schedule produce correct output from structured data.
- BOQ contains no financial fields (no Rate, Amount, Currency, VAT, or financial subtotal).
- BOQ restriction applies across: report model, template, preview, PDF, CSV, and validation.
- Validation detects unexpected pricing-related fields.
- Schedule and BOQ quantities reconcile.
- Live Preview uses the same pipeline as final output.
- Pre-Issue Validation catches errors before issue.
- BOQ template settings control presentation only, never mutate data.
- Issue output layouts are correct and reproducible.

**Test Requirements:**

- Schedule generation tests with fixture data.
- BOQ field exclusion tests (verify no Rate, Amount, Currency, VAT, or financial total in model, template, preview, PDF, CSV, and validation).
- Schedule and BOQ quantity reconciliation tests.
- Pre-Issue Validation tests (positive and negative cases).
- Issue output layout tests.
- Golden PDF comparison for all output types.
- BOQ template mutation prevention tests.

**User Approval Checkpoint:** Required before Phase 7.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompt 19

---

## Phase 7 — Long-Running Jobs, OCR, and Technical Quality

**Status:** PLANNED

**Goal:** Implement the reusable Background Job foundation, local OCR, and Technical Quality Engine before production-scale long-running operations are enabled.

**Dependencies:** Phase 6 complete. Phase 5 complete.

**Scope:**

### Background Job Foundation

- Progress reporting.
- Safe cancellation.
- Safe retry.
- Failure details.
- Restart recovery where practical.

Background Job foundation must exist before:

- OCR.
- Large imports.
- Image processing.
- Package generation.
- Large PDF generation.
- OneDrive copy.

Blocking startup migrations must not run as a background job.

### Local OCR

- Local OCR processing.
- OCR evidence and review.
- OCR cache.

### Technical Quality Engine

- Ready-to-Issue score.
- Blocking issues.
- Warnings.
- Auditable accepted exceptions.

**Explicit Exclusions:**

- No feature may silently run a long synchronous task on the renderer thread.
- No production-scale long-running workflow is accepted until the background job foundation is implemented.
- Security review does not imply enterprise security architecture.

**Main Deliverables:**

- Background job runner with progress, cancellation, retry, and failure details.
- OCR integration with evidence, review, and cache.
- Technical Quality Engine with Ready-to-Issue score.
- Performance benchmark suite.
- Security review report.

**Acceptance Criteria:**

- Background jobs run without blocking the main process or UI.
- Long-running operations are cancellable and retryable.
- No feature silently runs a long synchronous task on the renderer thread.
- OCR produces evidence for review with caching.
- Quality Engine produces Ready-to-Issue score with blocking issues and warnings.
- Auditable accepted exceptions are recorded.
- Performance benchmarks meet defined targets.
- Security review passes (file/path safety, local data integrity, secret leakage, unsafe imports, package integrity, IPC boundaries, backup/restore safety).

**Test Requirements:**

- Background job execution, cancellation, retry, and failure tests.
- OCR accuracy tests with fixture data.
- OCR evidence and cache tests.
- Quality Engine tests (score, blocking issues, warnings, exceptions).
- Performance benchmark tests.
- Security review tests (file/path safety, local data integrity, secret leakage, unsafe imports, package integrity, IPC boundaries, backup/restore safety).

**User Approval Checkpoint:** Required before Phase 8.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompt 24

---

## Phase 8 — Productivity, Library, Import, AutoCAD, Revision Comparison, Search, and Similar Project

**Status:** PLANNED

**Goal:** Implement productivity features — Master Luminaire Library, project snapshots, Smart Import Center, AutoCAD exchange, revision comparison, full-text search, and Create Similar Project.

**Dependencies:** Phase 5 complete. Phase 7 recommended (background jobs for large imports).

**Scope:**

- Master Luminaire Library.
- Project snapshots.
- Smart Import Center.
- AutoCAD exchange contract.
- DIALux import.
- Vendor import.
- Consultant import.
- Preview and complete undo.
- Revision comparison.
- SQLite FTS5 full-text search.
- Create Similar Project.
- Master Luminaire Library screen.
- Manufacturer management.
- Manufacturer alias management.
- Product Family browsing.
- Search by manufacturer and exact reference.
- Search by family/model.
- Search by technical properties.
- Add from Master Library.
- Copy from Previous Project.
- Promote Project Luminaire to Library.
- Compare Project Snapshot with Library.
- Update Project Snapshot from Library.
- Duplicate as New Reference.
- Duplicate as New Variant.
- Merge only confirmed duplicates.
- Archive discontinued products.
- Show Projects Used In.
- Import preview matching.
- Exact-match and possible-duplicate review.
- Product revision history.

**Clarification:** Phase 8 consumes the data model established in Phase 3 and does not redefine commercial identity.

### Responsibility Lock

SLC owns technical data, tags, BOQ, datasheets, Schedule, packages, and revisions.

AutoCAD owns geometry, placement, block graphics, hatch, linework, rotation, and CAD legend.

Missing from one CAD export must never trigger silent deletion.

**Explicit Exclusions:**

- No production tenant provisioning (Phase 10).
- No live Graph access without tenant configuration.
- No silent deletion of data missing from a CAD export.
- No AutoCAD geometry ownership in SLC.

**Main Deliverables:**

- Master Luminaire Library service.
- Project snapshot service.
- Smart Import Center with preview and complete undo.
- AutoCAD exchange contract implementation.
- DIALux, vendor, and consultant import adapters.
- Revision comparison service.
- SQLite FTS5 search integration.
- Create Similar Project workflow.

**Acceptance Criteria:**

- Master Luminaire Library manages reusable luminaire data.
- Project snapshots capture and restore correctly.
- Smart Import Center provides preview and complete undo.
- AutoCAD exchange follows the responsibility lock (SLC owns technical data, AutoCAD owns geometry).
- Missing CAD data never triggers silent deletion.
- Revision comparison produces accurate diffs.
- FTS5 search returns correct results.
- Create Similar Project clones configuration correctly.

**Test Requirements:**

- Library management tests.
- Snapshot tests.
- Import tests (DIALux, vendor, consultant) with preview and undo.
- AutoCAD exchange contract tests (idempotency, missing data handling).
- Revision comparison tests.
- FTS5 search tests.
- Create Similar Project tests.
- Responsibility lock enforcement tests.

**User Approval Checkpoint:** Required before Phase 9.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompt 25

---

## Phase 9 — Operational Backup, Restore UI, Retention, and Optional OneDrive Snapshots

**Status:** PLANNED

**Goal:** Add operational backup scheduling, Restore Preview UI, retention policies, backup history, daily backups, backup on close, and optional OneDrive snapshot integration on top of the Phase 1 Minimal Safe Restore foundation.

**Dependencies:** Phase 1 complete (Minimal Safe Restore). Phase 4 recommended (Restore Preview UI). Phase 7 recommended (background-job retry for offline/unavailable OneDrive).

**Scope:**

- Scheduled local backup.
- Daily backup.
- Optional backup on close.
- Retention policies.
- Backup history.
- Restore Preview UI.
- Last successful local backup indicator.
- Optional verified OneDrive copies.
- Background-job retry for offline/unavailable OneDrive.
- Last successful OneDrive snapshot indicator.

### Rules

- Active SQLite remains local.
- Active SQLite is never run from OneDrive.
- Only completed verified backups are copied.
- OneDrive failure does not invalidate the successful local backup.

**Explicit Exclusions:**

- No replacement of the Phase 1 Minimal Safe Restore foundation.
- No active SQLite on OneDrive.
- No filesystem deletion as part of backup operations.
- No online-only file hydration without explicit user action.

**Main Deliverables:**

- Backup scheduler service.
- Retention policy engine.
- Backup history UI component.
- Restore Preview UI.
- OneDrive snapshot adapter (optional).
- Backup-on-close hook.

**Acceptance Criteria:**

- Scheduled backups run without user intervention.
- Retention policies are enforced.
- Backup history is visible and accurate.
- Restore Preview UI shows backup contents before restore.
- OneDrive snapshots are labeled and optional.
- OneDrive failure does not invalidate the local backup.
- Backup on close is configurable.
- Active SQLite never runs from OneDrive.

**Test Requirements:**

- Backup scheduler tests.
- Retention policy enforcement tests.
- Backup history UI tests.
- Restore Preview UI tests.
- OneDrive snapshot labeling and retry tests.
- Backup-on-close tests.
- OneDrive failure fallback tests.

**User Approval Checkpoint:** Required before Phase 10.

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompt 26

---

## Phase 10 — Final Hardening, Upgrade Verification, and Portable Release

**Status:** PLANNED

**Goal:** Complete final verification, production hardening, portable release packaging, and handoff to operations.

**Dependencies:** All prior phases complete.

**Scope:**

Complete final verification for:

- v3.2.2 upgrade.
- SCLI-to-SCT migration.
- Rollback and recovery.
- CRM.
- Multiple Issue/Revision cycles.
- Configurable templates/folders.
- Datasheet deduplication.
- Schedule and BOQ.
- PDF and CSV.
- Template reproducibility.
- OCR.
- Quality Engine.
- Library snapshots.
- Import undo.
- AutoCAD idempotency.
- Revision comparison.
- FTS5.
- Similar Project.
- Backup and Restore.
- OneDrive success/failure.
- No personal hard-coded paths.
- Portable Windows build without administrator rights.

### Release Blockers

Release remains blocked by critical failures in:

- Migration.
- Data loss.
- Rollback.
- Restore.
- Package integrity.
- Original-file protection.
- Schedule/BOQ reconciliation.
- Backup verification.

**Explicit Exclusions:**

- No feature development.
- No scope changes.
- No new product features.

**Main Deliverables:**

- Portable release package.
- Final upgrade verification report.
- Final security review report.
- Final performance test results.
- Complete operational documentation.

**Acceptance Criteria:**

- Portable release builds and runs correctly without administrator rights.
- All upgrade verification items pass.
- No personal hard-coded paths in the build.
- All quality gates pass.
- No critical release blockers remain.
- Documentation is complete and accurate.

**Test Requirements:**

- Complete upgrade verification suite.
- Production smoke tests.
- Full quality gate suite (format, lint, typecheck, test, build, E2E).
- Final security review.
- Final performance benchmarks.
- OneDrive success/failure handling tests.

**User Approval Checkpoint:** Final sign-off required (Final Portable build).

**Commit Boundary:** To be determined.

**Original Prompt References:** Prompt 27

---

## Cross-Cutting Quality Gates

Every phase must pass these gates before being marked complete:

| Gate             | Command                                      | Applies To                   |
| ---------------- | -------------------------------------------- | ---------------------------- |
| Formatting       | `pnpm format:check`                          | All phases                   |
| Linting          | `pnpm lint` (zero warnings)                  | All phases                   |
| Type Checking    | `pnpm typecheck`                             | All phases                   |
| Unit Tests       | `pnpm test`                                  | All phases                   |
| Component Tests  | `pnpm test:components`                       | Phases with UI changes       |
| E2E Tests        | `pnpm test:e2e` and `pnpm test:e2e:personal` | All phases                   |
| Build            | `pnpm build`                                 | All phases                   |
| Teams Validation | `pnpm teams:validate`                        | Phases with manifest changes |
| Teams Package    | `pnpm teams:package`                         | Phases with manifest changes |

### Representative Fixture Pack

| Fixture                                            | Phase   | Description                                         |
| -------------------------------------------------- | ------- | --------------------------------------------------- |
| Empty DB                                           | Phase 1 | Clean database with no data                         |
| Valid v3.2.2 DB                                    | Phase 1 | Realistic v3.2.2 database for migration testing     |
| Unknown/partial DB                                 | Phase 1 | Corrupted or partial database for detection testing |
| Future-version DB                                  | Phase 1 | Database with version ahead of current schema       |
| SCLI projects                                      | Phase 2 | Projects with legacy SCLI codes                     |
| Locked/missing/long paths                          | Phase 1 | Path edge cases for file-safety testing             |
| Text/scanned/rotated/multi-page/corrupt datasheets | Phase 3 | Datasheet variety for registry and OCR testing      |
| AutoCAD exports                                    | Phase 8 | AutoCAD exchange contract test data                 |
| DIALux/vendor/consultant imports                   | Phase 8 | Import source variety                               |
| Large project fixture                              | Phase 8 | Performance testing with large dataset              |
| Expected reports/PDFs                              | Phase 5 | Golden reference outputs for comparison             |

### Golden PDF Tests

- Selectable/searchable text.
- First-page structure.
- Headers and footers.
- Page count.
- Repeated table headers.
- Page breaks.
- Required metadata.
- BOQ contains no pricing.
- Quantity reconciliation.
- Template/version metadata.

### Visual and Accessibility Gates

- Keyboard navigation.
- Visible focus.
- Contrast.
- Reduced motion.
- Responsive layout.
- No clipped text.
- Visual regression.
- No animation delaying input.

### Performance Gates

| Benchmark          | Phase   | Description                               |
| ------------------ | ------- | ----------------------------------------- |
| Project board      | Phase 4 | Board renders smoothly with many projects |
| Luminaire Studio   | Phase 8 | Large luminaire list performs well        |
| Large Schedule/BOQ | Phase 6 | Schedule/BOQ generation is responsive     |
| Large package      | Phase 7 | Package generation completes in time      |
| Large search index | Phase 8 | FTS5 search is responsive                 |
| OCR                | Phase 7 | OCR processing completes in time          |
| Report generation  | Phase 5 | PDF/CSV generation is responsive          |

### User Approval Checkpoints

1. Projects Board (Phase 4).
2. Project Details shell (Phase 4).
3. Luminaire Studio (Phase 8).
4. Schedule PDF (Phase 6).
5. BOQ PDF (Phase 6).
6. Issue Package (Phase 6).
7. Final Portable build (Phase 10).

### Security Review Scope

Security review is proportional to a local personal application. It does not imply enterprise security architecture, encryption platform, or complex role system. Focus areas:

- File and path safety (traversal prevention, validation).
- Local data integrity (SQLite, manifest, journal).
- Secret leakage prevention (no tokens, secrets, or credentials in logs or client code).
- Unsafe import prevention (dependency audit, package integrity).
- IPC boundaries (Electron IPC validation).
- Backup and restore safety (verification, integrity checks, safe replacement).

---

## Background Job Execution Gate

The Background Job Foundation (Phase 7) is not required for blocking startup migrations. SchemaMigrationRunner startup execution does not depend on the background job system. Blocking startup migrations must not run as a background job.

However, the following operations may have their deterministic domain/report/package logic designed before the Background Job system exists, but large or cancellable production execution must remain gated until the job foundation is implemented:

- Large Issue Package generation.
- Large datasheet collection.
- Large PDF generation.
- Image standardization batches.
- OCR processing.
- Large imports.
- Large revision comparisons.
- OneDrive snapshot copy.

Clarifications:

- Small focused tests and isolated render/package foundations may be built earlier.
- Production-scale execution must not freeze the UI.
- No feature may silently run a long synchronous task on the renderer thread.
- Background Jobs must be implemented before acceptance of the first production-scale long-running workflow.
- Background Job foundation includes progress, safe cancellation, safe retry, failure details, and restart recovery where practical.

---

## Product Decision Lockbox

The following decisions are locked and recorded in `docs/product-decisions.md`. They must not be changed without an explicit documented exception:

- Project identity: UUID is the immutable relational key; projectCode is visible and editable.
- BOQ: Non-Priced Quantity Take-Off only. No Rate, Amount, Currency, VAT, or financial totals. This restriction applies to the report model, template, preview, PDF, CSV, and validation. BOQ template settings control presentation only and never mutate data.
- PDF: Real documents with searchable/selectable text, not screenshots. Template-driven and versioned. V1 is a controlled settings editor, not a complex WYSIWYG editor.
- Reports: Structured data is the source of truth. Preview and final output use the same pipeline, model, template, filters, grouping, and calculations.
- Files: Received files and datasheet originals are never renamed or changed silently. Only package copies may be renamed.
- UI: Scientechnic identity with official logo, cyan/navy/light direction, and Board/List/Compact views. `SCIENTECHNIC_SLC_UI_CONCEPT_V1` is an external approved reference package not yet inside the repository.
- Migration: STEP ATOMICITY. One verified backup before any mutation.
- Restore: Minimal Safe Restore is an early safety sub-phase in Phase 1. Full operational backup/retention/OneDrive scope remains in Phase 9.
- Background Jobs: Implemented in Phase 7 before production-scale long-running operations. Not required for SchemaMigrationRunner startup. Blocking startup migrations do not run as background jobs.
- AI scope: No built-in chatbot, bundled LLM, or generative-AI product dependency inside the application. This does not govern external development tools. Optional future integrations are DEFERRED and require explicit approval.
- Language: Current UI is English. Localization timing is PROVISIONAL, not locked.
- Teams scope: Personal local-first roadmap is the active product priority. Existing Teams-related code and build variants must not be broken. Teams expansion is not part of the current roadmap unless explicitly approved.
- Responsibility lock: SLC owns technical data, tags, BOQ, datasheets, Schedule, packages, and revisions. AutoCAD owns geometry, placement, block graphics, hatch, linework, rotation, and CAD legend. Missing from one CAD export never triggers silent deletion.
- Master Luminaire identity: Every manufacturer and every approved Master Luminaire Library product has an immutable internal ID; commercial product identity is `manufacturerId + manufacturerReferenceNormalized`; the same normalized reference under the same manufacturer is a duplicate; the same reference under different manufacturers is allowed; family and model are grouping/display/search fields, not unique identifiers; Manufacturer Reference is unrelated to project code, CRM reference, SCT reference, or project luminaire tags.

---

## Current Implementation Status Summary

| Component                               | Status    | Commit    | Tests                    |
| --------------------------------------- | --------- | --------- | ------------------------ |
| Repository Governance                   | COMPLETED | `d0b459e` | All existing pass        |
| PathResolverService                     | COMPLETED | `0729c9f` | 41 passed                |
| BackupManager                           | COMPLETED | `7bb97dc` | 53 passed, 2 skipped     |
| SchemaMigrationRunner                   | COMPLETED | `7a1cc0d` | 84 passed                |
| External MigrationJournal               | COMPLETED | `a652e01` | 180 passed               |
| Shared MigrationStateInspector          | COMPLETED | `9553992` | 66 passed                |
| Immutable Migration Resolution Sidecars | COMPLETED | `799f455` | 180 journal tests passed |
| Interrupted-Attempt Reconciliation      | PLANNED   | —         | —                        |
| v3.2.2 Fixture Builder                  | PLANNED   | —         | —                        |
| Legacy Detector                         | PLANNED   | —         | —                        |
| Atomic Baseline Stamping                | PLANNED   | —         | —                        |
| Startup Integration Gate                | PLANNED   | —         | —                        |
| Minimal Safe Restore Coordinator        | PLANNED   | —         | —                        |
| Project Manifest                        | PLANNED   | —         | —                        |
| Stable Configurable-Entity IDs          | PLANNED   | —         | —                        |
| Path Migration                          | PLANNED   | —         | —                        |
| File-Operation Planner and Journal      | PLANNED   | —         | —                        |
| Foundation Regression and Recovery      | PLANNED   | —         | —                        |
| Project Identity and SCT Naming         | PLANNED   | —         | —                        |
| Normalized Technical Data               | PLANNED   | —         | —                        |
| Scientechnic UI Foundation              | PLANNED   | —         | —                        |
| Report Foundation                       | PLANNED   | —         | —                        |
| Schedule, BOQ, and Issue Outputs        | PLANNED   | —         | —                        |
| Background Jobs and OCR                 | PLANNED   | —         | —                        |
| Productivity and Library                | PLANNED   | —         | —                        |
| Operational Backup                      | PLANNED   | —         | —                        |
| Final Hardening                         | PLANNED   | —         | —                        |

**Important:** SchemaMigrationRunner is NOT integrated into startup. Existing databases are NOT yet upgraded. Restore is NOT yet implemented. Legacy v3.2.2 detection does NOT yet exist. Resolution-aware classification, new-attempt permission, and startup integration are NOT yet implemented; resolved attempts still block new attempts until P1.5B2B. SCT and CRM migrations do NOT yet exist.

---

## Current Implementation Snapshot

> **Informational and non-contractual.** This snapshot describes the current repository state only. It is not a commitment to scope, schedule, or completion percentages.

**Completed foundation commits:**

- `9c5744b` Effective migration resolution inspection
- `bac5453` Resolution-aware migration retry permission
- `15fba61` Read-only interrupted migration reconciliation planning
- `84f9dc8` Verified migration reconciliation plans
- `fe771e6` Locked legacy v3.2.2 schema manifest
- `3bb2ba6` Deterministic legacy v3.2.2 fixture builder
- `ea29321` Read-only legacy v3.2.2 detection
- `412d43f` Verified legacy migration admission
- `ebfe2b8` Verified SQLite restore manager

- `d0b459e` — Governance baseline
- `0729c9f` — Portable PathResolverService
- `7bb97dc` — Verified SQLite BackupManager
- `7a1cc0d` — Transactional SchemaMigrationRunner
- `0e9c508` — Consolidated master roadmap
- `a652e01` — Persistent MigrationJournal
- `9553992` — Shared MigrationStateInspector
- `799f455` — Immutable migration resolution sidecars

**Completed capabilities:**

- Repository governance and clean baseline
- Portable path resolution
- Verified SQLite backups
- Transactional schema migration runner
- Persistent append-only migration journal
- Shared read-only migration state inspection
- Immutable migration resolution-sidecar storage
- Effective resolution inspection and resolution-aware retry permission
- Read-only interrupted migration reconciliation planning and verified application
- Legacy v3.2.2 fixture builder, detector, and verified migration admission
- Verified SQLite restore manager
- Database-scoped startup lock and workspace startup coordinator core (P1.8B)

**Current next implementation item:**

- Production startup wiring of the coordinator (Electron main, personal/team servers, app
  assembly, provider factory, and provider/store constructors)

**Still remaining in Phase 1:**

- Startup coordinator production wiring
- Project Manifest
- Stable configurable-entity IDs
- Existing stored-path migration
- File Operation Journal
- Foundation-wide regression and upgrade testing

**Later phases still pending:**

- Phase 2 SCT / CRM / Workflow / Configurability
- Phase 3 Normalized Technical Data and Datasheets
- Phase 4 Scientechnic Design System
- Phase 5 Reports and Templates
- Phase 6 Schedule and Non-Priced BOQ
- Phase 7 Background Jobs, OCR and Quality
- Phase 8 Master Luminaire Library and Productivity
- Phase 9 Operational Backup and OneDrive
- Phase 10 Final hardening and portable release

No exact overall completion percentage is used as a contractual metric. Qualitatively: the core safety foundation is materially advanced, and user-visible product functionality remains mostly ahead.

---

## Next Implementation Phase

**Next implementation phase:** Production startup wiring (Phase 1, P1.8B follow-up)

The database-scoped startup lock and workspace startup coordinator core are committed. The next
step is wiring the coordinator into the production startup entry points (Electron main,
personal/team servers, app assembly, provider factory, and provider/store constructors) so
migration and recovery gates run before any long-lived provider opens. Until that wiring lands,
production startup is not yet protected by the coordinator.

---

## References

- Original implementation roadmap: [docs/roadmap-v3.3.md](docs/roadmap-v3.3.md) (preserves Prompt 00–27 numbering)
- Locked product decisions: [docs/product-decisions.md](docs/product-decisions.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Repository rules: [docs/repository-rules.md](docs/repository-rules.md)
- Coding standards: [docs/coding-standards.md](docs/coding-standards.md)
- Assumptions: [docs/assumptions.md](docs/assumptions.md)
- Security: [docs/security.md](docs/security.md)
