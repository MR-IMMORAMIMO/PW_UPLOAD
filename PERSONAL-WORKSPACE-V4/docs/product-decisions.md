# SCLI Lighting Project Workspace — Locked Product Decisions

> **Current as of:** 2026-08-05
> **Status:** These decisions are locked. Changes require an explicit documented exception approved by the repository owner.
>
> This document records every material product decision made during the v3 planning and implementation. It is the single source of truth for product scope, identity, and behavior. When a decision here conflicts with an older document, this document prevails.

---

## Project Identity

### D1 — UUID is the Immutable Relational Key

**Decision:** `Project.id` (UUID) is the immutable internal identifier. It is never exposed as a display value and never used in URLs or user-facing labels.

**Rationale:** UUIDs survive merges, renames, and migrations without collision. Display names and project codes can change; the relational identity must not.

**Locked:** 2026-08-04

### D2 — Project Code is Visible and Editable

**Decision:** Project Code is a human-readable, server-generated identifier. It is visible in the UI and may be edited by authorized users, but it must never be used as a relational key.

**Rationale:** Users need a meaningful project reference. Making it editable supports corrections and organizational changes. Keeping it separate from the relational key prevents cascade updates.

**Locked:** 2026-08-04

### D3 — SCT is the Default Configurable Prefix

**Decision:** The default project code prefix is `SCT`. This is configurable per deployment. Default format: `###_SCTYYMMDD_PROJECT_NAME`.

**Rationale:** `SCT` reflects the Scientechnic brand. Configurability supports future organizational changes without code changes.

**Locked:** 2026-08-04

### D4 — CRM Reference Remains Separate

**Decision:** CRM Reference is a separate, searchable field. It is never concatenated into or derived from the project code. CRM history is preserved.

**Rationale:** CRM systems have their own identity schemes. Keeping the reference separate avoids coupling and allows independent updates.

**Locked:** 2026-08-04

### D5 — Legacy SCLI Code Remains Searchable

**Decision:** After migration to the new code format, legacy SCLI codes remain stored and searchable. They are never used as relational keys. Project-code history is preserved.

**Rationale:** Historical references must remain discoverable. Users searching by old codes must find the correct project.

**Locked:** 2026-08-04

---

## File Operations

### D6 — Received Files are Never Renamed or Changed Silently

**Decision:** External source files and datasheet originals are never renamed, modified, or transformed without explicit user action and audit trail. Only package copies may be renamed according to approved settings.

**Rationale:** Data integrity requires that received artifacts remain traceable to their source. Silent changes break audit chains and create liability.

**Locked:** 2026-08-04

### D7 — Package Copies May Be Renamed After Explicit Configuration

**Decision:** Package copies (revision packages, exports) may be renamed according to configured naming conventions. The original source file is never affected.

**Rationale:** Output files need meaningful names for recipients. The distinction between source and copy preserves traceability.

**Locked:** 2026-08-04

### D8 — File Operations Require Preview, Validation, Journal, and Rollback

**Decision:** Every file mutation must support: preview of the intended change, validation before execution, an audit journal entry, and rollback/compensation where practical. Locked, missing, conflict, junction, and path-length handling must be enforced.

**Rationale:** File operations are destructive by nature. A consistent safety workflow prevents data loss and supports recovery.

**Locked:** 2026-08-04

---

## Project Metadata

### D9 — .scli/project.manifest.json is the Application Source of Truth

**Decision:** The machine-readable manifest at `.scli/project.manifest.json` is the authoritative project metadata store. All application logic reads and writes through the manifest.

**Rationale:** A structured, versioned manifest enables programmatic access, migration, and validation. It is the single source of truth.

**Locked:** 2026-08-04

### D10 — PROJECT_INFO.txt is Human-Readable Only

**Decision:** `PROJECT_INFO.txt` is a human-readable summary. Manual edits to this file never update the manifest automatically.

**Rationale:** The text file is a convenience for users browsing the filesystem. It must not become an alternate data entry point that could conflict with the manifest.

**Locked:** 2026-08-04

---

## Workflow

### D11 — Issue/Revision Cycles are Repeatable

**Decision:** Projects support repeatable issue/revision cycles. Each cycle produces a new revision with an incremented revision number. Configurable scopes, folders, deliverables, and workflow are supported. Custom fields, template snapshots, and project overrides are supported. Versioned configuration export/import is supported.

**Rationale:** Lighting projects routinely go through multiple revision rounds. The system must support this natively with full configurability.

**Locked:** 2026-08-04

### D12 — Existing Issued Packages are Immutable

**Decision:** Once a revision package is issued, its contents cannot be modified. Any change requires a new revision with a new identity.

**Rationale:** Immutability of issued packages is essential for audit, compliance, and recipient trust.

**Locked:** 2026-08-04

### D13 — Reissued Packages Receive New Identities

**Decision:** Reissuing a package creates a new Issue/Revision identity. The original package identity is never reused.

**Rationale:** Clear identity progression prevents confusion about which version a recipient has.

**Locked:** 2026-08-04

---

## UI and Design

### D14 — Preserve the Planner-Inspired Projects Board

**Decision:** The primary project view is a Planner-inspired board. Board, List, and Compact views are all supported. Five project navigation groups are defined.

**Rationale:** The board view is the established mental model for project tracking. Multiple views support different workflows and screen sizes.

**Locked:** 2026-08-04

### D15 — Use Scientechnic Identity

**Decision:** The UI uses the official Scientechnic logo and the approved cyan/navy/light visual direction with a premium desktop-app character. Fluent UI primitives are heavily customized so the product does not resemble a default admin or SharePoint page. Production colors must be verified against an official Brand Guide when available. `SCIENTECHNIC_SLC_UI_CONCEPT_V1` is an approved external reference package that is not yet inside the repository. It will be copied into the repository only when UI implementation starts. Mockup-generated logos or text must not be used as production assets. Production uses the official logo.

**Rationale:** Brand consistency and professional presentation are requirements from the product brief. The official logo and approved visual direction are locked. Exact production color values are not claimed as officially verified until an official brand guide or approved color specification exists.

**Locked:** 2026-08-04

### D16 — Restrained Animation with Reduced Motion Support

**Decision:** Normal motion is 180–240 ms. `prefers-reduced-motion` is respected. Animation is never the sole carrier of information. No animation may delay input.

**Rationale:** Accessibility and professional presentation require motion that enhances rather than distracts.

**Locked:** 2026-08-04

### D17 — Full Keyboard Navigation

**Decision:** Every action is keyboard-reachable with a visible focus state. Drag-and-drop has a keyboard-accessible alternative using the same server transition validation.

**Rationale:** Keyboard accessibility is a non-negotiable requirement for professional software.

**Locked:** 2026-08-04

### D18 — Color is Never the Sole Status Indicator

**Decision:** Status, validation, and state are never communicated by color alone. Text, icons, and patterns provide redundant indicators.

**Rationale:** Accessibility standards require multiple channels for critical information.

**Locked:** 2026-08-04

---

## Reports

### D19 — PDF is a Real Document, Not a Screenshot

**Decision:** PDF output is generated as a proper document with structured content, searchable/selectable text, and vector graphics. It is never an application screenshot, a rasterized page-only output, or an unrelated print fallback. PDF includes official logo, corporate header/footer, A4 portrait/landscape and A3 where required, repeated table headers, page numbers, correct page breaks, project metadata, SCT, CRM where relevant, Issue/Revision, and Prepared By / Checked By.

**Rationale:** Professional deliverables require real documents that can be printed, searched, and archived.

**Locked:** 2026-08-04

### D20 — CSV Uses Invariant Machine-Readable Dates and UTF-8

**Decision:** CSV export uses ISO 8601 UTC dates and UTF-8 encoding. UI display dates use the configured company timezone. XLSX is not part of V1 but may be added later where justified.

**Rationale:** Machine-readable formats enable reliable downstream processing. Display formatting is a separate concern.

**Locked:** 2026-08-04

### D21 — Structured Data is the Source of Truth for Reports

**Decision:** All reports are generated from structured data (the database and manifest). Reports are never generated by scraping the UI or reading rendered HTML.

**Rationale:** Data integrity requires a single, validated source. UI-scraped reports are fragile and unreliable.

**Locked:** 2026-08-04

### D22 — Preview and Final Output Use the Same Pipeline

**Decision:** Report preview and final output use the identical rendering pipeline, report model, template, filters, grouping, and calculations. The only difference is the output destination (screen vs. file).

**Rationale:** What you preview is what you get. Separate pipelines create divergence and bugs.

**Locked:** 2026-08-04

### D23 — Report Templates are Versioned

**Decision:** Report templates carry a template ID and version identifier. Templates include page size, orientation, header/footer, logo, typography, columns, order, width, visibility, grouping, sorting, image settings, cover settings, and notes. Historical outputs remain reproducible by referencing the template version used at generation time. V1 is a controlled settings editor, not a complex WYSIWYG document editor. Duplicate template, reset to company default, and project-specific override are supported.

**Rationale:** Regulatory and audit requirements demand reproducible historical outputs. A controlled editor is safer and more maintainable than a WYSIWYG editor for V1.

**Locked:** 2026-08-04

---

## BOQ (Bill of Quantities)

### D24 — Non-Priced BOQ Only

**Decision:** The BOQ module supports item descriptions and quantities only (Non-Priced Quantity Take-Off). It explicitly excludes: Rate, Amount, Currency, VAT, and any financial totals or subtotals. This restriction applies across the report model, template, preview, PDF, CSV, and validation layers. The report model itself must not contain pricing fields. Validation must detect unexpected pricing-related fields. Schedule and BOQ quantities must reconcile. BOQ template settings control presentation only and never mutate quantities, tags, technical data, datasheet links, Issue Package records, or historical issued outputs.

**Rationale:** The product is a lighting project workspace, not a commercial or pricing system. Financial calculations belong in dedicated accounting software.

**Locked:** 2026-08-04

---

## Migration and Safety

### D25 — STEP ATOMICITY, Not Full-Upgrade Atomicity

**Decision:** Each migration step runs in its own `BEGIN IMMEDIATE` transaction. If step N commits and step N+1 fails, the database remains at the valid intermediate version N. The framework does not claim full-upgrade atomicity.

**Rationale:** Full-upgrade atomicity across multiple schema changes is impractical in SQLite without snapshot isolation. Step atomicity is the honest, safe guarantee.

**Locked:** 2026-08-04

### D26 — Verified Backup Before Any Mutation

**Decision:** Every upgrade run creates exactly one verified backup before any database mutation. The backup is verified through `PRAGMA integrity_check` before migration proceeds.

**Rationale:** A verified backup is the only reliable recovery path. Creating it before any mutation ensures it captures the known-good state.

**Locked:** 2026-08-04

### D27 — Minimal Safe Restore Before Product Migrations

**Decision:** The Minimal Safe Restore capability is an early safety sub-phase in Phase 1. It must be implemented and tested before any real product-data migration runs. The Phase 1 restore foundation provides: closed database connections, backup verification, safety backup, WAL/SHM handling, staging, safe replacement, restart, recovery report, and compatibility check. Full scheduled backup, retention, backup history UI, daily backups, backup on close, and OneDrive snapshots remain in Phase 9.

**Rationale:** The ability to restore is useless if it is not available when needed. Building it before migrations ensures it exists when the first real migration runs.

**Locked:** 2026-08-04

### D28 — Startup Integration Blocked Until Journal and Recovery Exist

**Decision:** SchemaMigrationRunner must not be integrated into application startup until the persistent external MigrationJournal and interrupted-run reconciliation are implemented.

**Rationale:** Without external journaling, a crashed upgrade cannot be safely discovered or resumed. An already-committed intermediate step may be left behind with no detection mechanism.

**Locked:** 2026-08-04

---

## Background Jobs

### D29 — Background Jobs in Phase 7

**Decision:** Background job infrastructure is implemented in Phase 7 (Long-Running Jobs, OCR, and Technical Quality), not in the foundation or data model phases. It is not required for SchemaMigrationRunner startup execution. Blocking startup migrations must not run as a background job. Production-scale long-running operations (large Issue Package generation, large datasheet collection, large PDF generation, image standardization batches, OCR, large imports, large revision comparisons, and OneDrive snapshot copy) must remain gated until the job foundation is implemented. The foundation includes progress, safe cancellation, safe retry, failure details, and restart recovery where practical. Small focused tests and isolated render/package foundations may be built earlier.

**Rationale:** Background jobs are an operational concern that depends on the full application stack being in place. Premature implementation creates coupling to incomplete systems. No feature may silently run a long synchronous task on the renderer thread.

**Locked:** 2026-08-04

---

## Product Scope Boundaries

### D30 — No Chatbot or Generative AI in Current Roadmap

**Decision:** The current product roadmap does not include a built-in chatbot, bundled LLM, or generative-AI product dependency inside the application. This restriction governs the application itself and does not govern external development tools used to build the software. Optional future AI integrations are DEFERRED and require explicit product approval before implementation.

**Rationale:** AI features are outside the current scope and would introduce complexity, cost, and reliability concerns unrelated to the core lighting-project workflow. This does not permanently prohibit optional future integrations; it defers them pending explicit approval. External development tools (such as code assistants or AI-powered development environments) are not governed by this decision.

**Locked:** 2026-08-04

### D31 — No Commercial Pricing System

**Decision:** The product does not include commercial pricing, cost calculation, invoicing, or financial reporting.

**Rationale:** Financial systems belong in dedicated accounting software. The workspace focuses on project tracking, not commerce.

**Locked:** 2026-08-04

### D32 — Current Application Language is English (PROVISIONAL)

**Decision:** The current application UI language is English. Localization timing is not yet approved by the owner. Adding another UI language requires a future explicit product decision. Technical data fields, project names, and imported content must continue to support Unicode regardless of UI language.

**Status:** PROVISIONAL — This decision is not irreversible. Localization timing and scope require explicit owner approval before being locked.

**Rationale:** The initial user base is English-speaking. Localization adds significant complexity and testing burden. Unicode support for data fields is a technical requirement, not a localization decision.

**Provisional:** 2026-08-05

### D33 — Personal Local-First Roadmap Priority

**Decision:** The Personal local-first roadmap is the active product priority. Local mock mode must remain fully functional without a Microsoft tenant. Production Microsoft 365 capabilities are isolated behind adapters. Existing Teams-related code and build variants must not be broken. Teams expansion or synchronization is not part of the current roadmap unless explicitly approved. A future Teams upgrade is not committed.

**Rationale:** The product must work for users without Microsoft 365 access. The current roadmap focuses on the personal/standalone experience. Teams integration remains available but is not the primary focus of this roadmap.

**Locked:** 2026-08-04

### D34 — SLC and AutoCAD Ownership Boundaries

**Decision:** SLC owns technical data, tags, BOQ, datasheets, Schedule, packages, and revisions. AutoCAD owns geometry, placement, block graphics, hatch, linework, rotation, and CAD legend. Missing data from one CAD export must never trigger silent deletion.

**Rationale:** Clear ownership boundaries prevent data corruption and accidental deletion. Each system is responsible for its own domain.

**Locked:** 2026-08-04

---

## Master Luminaire Library and Manufacturer Identity

### D35 — Master Luminaire Commercial Identity

**Decision:** Every manufacturer has an immutable internal `manufacturerId`. Every approved Master Luminaire Library product has an immutable internal `productId`. The unique commercial identity of a luminaire product is `manufacturerId + manufacturerReferenceNormalized`.

The future normalized database must enforce a uniqueness rule equivalent to:

```sql
UNIQUE (
  manufacturer_id,
  manufacturer_reference_normalized
)
```

The same manufacturer reference number may exist under different manufacturers. Valid examples:

- ERCO + `B009945`
- VENUS + `B009945`

The same normalized reference must not be duplicated under the same manufacturer.

Product family and model name are grouping fields, display fields, and search fields. They are not unique identifiers. Different manufacturer references under the same manufacturer and family are separate exact products or variants. Example:

- ERCO / Jilly / `B009945`
- ERCO / Jilly / `Y99742654`

Manufacturer Reference is a product-level field. It is unrelated to and must never be confused with the SCT project reference, the CRM reference number, the project code (`projectCode`), or a luminaire tag used in one project.

Store both `manufacturerReferenceRaw` and `manufacturerReferenceNormalized`. `manufacturerReferenceRaw` preserves the manufacturer-supplied visible value. `manufacturerReferenceNormalized` is used for lookup, exact matching, and composite uniqueness.

Reference normalization must be conservative: trim leading and trailing whitespace; normalize letter casing for lookup; normalize repeated whitespace; normalize equivalent Unicode forms where safe; do not remove meaningful hyphens, dots, or slashes; do not remove punctuation by default. Manufacturer-specific normalization rules may be added later only when explicitly validated against that manufacturer's catalogue behavior.

Manufacturer aliases may support search and import, but aliases are not part of product uniqueness. Product identity always uses `manufacturerId`, never the typed or displayed manufacturer name.

The following values are duplicate-detection evidence only and are not product identity: datasheet hash, product image, family name, model name, description, IES filename, LDT filename, and technical similarity. Two products must never be merged automatically based only on similar names, images, technical values, or shared datasheets.

**Rationale:** A manufacturer reference is only meaningful inside that manufacturer's catalogue, so commercial identity must be composite (`manufacturerId` plus normalized reference) rather than the reference number alone. Raw values must be preserved for display and traceability while normalized values provide deterministic matching. Conservative normalization and explicit duplicate review prevent accidental merges and data loss.

**Status:** LOCKED

**Locked:** 2026-08-05

### Manufacturer Reference Classification

Manufacturer references are classified by type:

- EXACT_ORDERING_CODE.
- BASE_PRODUCT_CODE.
- FAMILY_REFERENCE.
- CUSTOM_INTERNAL_REFERENCE.

Default reference type: EXACT_ORDERING_CODE.

- An Exact Ordering Code normally represents the purchasable technical configuration.
- Catalogue structure may differ by manufacturer; the application must not assume every manufacturer follows the same reference system.
- BASE_PRODUCT_CODE or FAMILY_REFERENCE must not automatically be treated as an exact purchasable variant.
- CUSTOM_INTERNAL_REFERENCE must not impersonate a manufacturer ordering code.

### Manufacturer Data Model Foundation

Future Manufacturer entity fields:

- manufacturerId (immutable internal identifier).
- officialName.
- normalizedName.
- aliases.
- logoReference (optional).
- website (optional).
- country (optional).
- activeStatus.
- createdAt.
- updatedAt.

Rules:

- manufacturerId is immutable.
- Aliases resolve to the same manufacturerId and are not part of product uniqueness.
- Product identity does not depend on a typed or displayed manufacturer name.
- Manufacturers with referenced products should normally be archived rather than physically deleted.
- Historical project luminaire snapshots survive manufacturer archiving, renaming, or reference changes.

### Product Family Model

Product Family is an optional grouping entity with fields:

- familyId.
- manufacturerId.
- familyName.
- normalizedFamilyName.
- category.
- description.
- activeStatus.

Rules:

- Product Family is not product identity and must never replace the Manufacturer Reference.
- Product Family must never silently merge different exact references.
- One family may contain many exact manufacturer references.
- A product may temporarily exist without a family.
- Renaming or moving a family does not change product commercial identity.

### Project-Only Draft Luminaires

A project may temporarily contain a luminaire without a manufacturer reference. Such a product is classified as PROJECT_ONLY_DRAFT.

Rules:

- It receives an internal UUID.
- It is limited to project use and may omit the Manufacturer Reference temporarily.
- It must not receive a fake manufacturer commercial reference.
- It may contain incomplete technical data.
- It is not automatically promoted to the Master Library.
- Promotion to an approved Master Library product requires the manufacturer, the manufacturer reference, completed duplicate matching, required technical validation, and explicit user action.
- Promotion must not silently replace or merge another Master Product.

### Project Luminaire Snapshot

Adding a Master Library product to a project creates an independent project luminaire snapshot containing at least:

- projectLuminaireId.
- projectId.
- sourceMasterProductId.
- sourceLibraryVersion.
- manufacturerId.
- manufacturerNameSnapshot.
- manufacturerReferenceRawSnapshot.
- manufacturerReferenceNormalizedSnapshot.
- familyNameSnapshot.
- modelNameSnapshot.
- technicalDataSnapshot.
- datasheet relationships or immutable snapshot references.
- image reference where applicable.
- createdAt.
- updatedAt.

Rules:

- sourceMasterProductId is traceability metadata, not a live mutable dependency.
- Future Master Library edits never modify an existing project silently.
- A project may show that a newer library version exists.
- Updating from the library requires preview and explicit approval.
- Issued Schedule data remains reproducible.
- Issued non-priced BOQ data remains reproducible.
- Issued Datasheets and Issue Packages remain reproducible.
- Product discontinuation or archiving does not invalidate historical projects.

### Duplicate and Matching Behavior

Matching priority:

1. Exact manufacturerId + manufacturerReferenceNormalized.
2. Manufacturer alias resolution to manufacturerId.
3. Same family/model with a different manufacturer reference.
4. Datasheet hash or technical similarity as duplicate evidence only.

Matching outcomes:

- EXACT_PRODUCT_MATCH.
- POSSIBLE_DUPLICATE.
- NEW_REFERENCE_IN_EXISTING_FAMILY.
- NEW_PRODUCT.
- PROJECT_ONLY_DRAFT.

Rules:

- EXACT_PRODUCT_MATCH may offer adding the existing Master Product.
- POSSIBLE_DUPLICATE requires user review.
- NEW_REFERENCE_IN_EXISTING_FAMILY creates a separate product/reference.
- Similar product names never create an automatic exact match.
- Shared datasheet PDF never proves identical commercial identity.
- A single datasheet may contain several exact references.
- Two products are never merged automatically based only on similar names, images, technical properties, datasheet hashes, shared PDFs, or IES/LDT filenames.

---

### D36 — Project Type Is Historical Classification Metadata

**Status:** LOCKED

Each configured Project Type has a catalogue UUID for catalogue-entry identity, but a project stores the selected Project Type name as a historical metadata snapshot. The stored value is not a foreign key and is not part of project identity.

Renaming or deactivating a catalogue entry must not rewrite existing projects. An unchanged inactive or missing historical value remains valid during unrelated project edits. When a user explicitly replaces the value, the authoritative update boundary must require an exact currently active catalogue name; the UI selector alone is not a security or integrity boundary.

---

## Open Decisions

The following decisions are not yet resolved. They do not block the current safety-foundation work unless they are direct dependencies.

### O1 — Future Localization Requirements

**Status:** OPEN

**Question:** Which additional UI languages will be needed, and what is the target timeline?

**Context:** The current application language is English. Localization timing is PROVISIONAL (D32). Technical data fields, project names, and imported content already support Unicode.

### O2 — Exact Final Production Brand Color Values

**Status:** OPEN

**Question:** What are the exact final production brand color values?

**Context:** The approved cyan/navy/light visual direction is locked (D15). Final production values must be validated against an official brand guide when available. No official brand guide or approved color specification is currently in the repository.

### O3 — XLSX Export for Selected Reports

**Status:** OPEN

**Question:** Will selected reports later need XLSX export in addition to PDF and CSV?

**Context:** Phase 5 establishes PDF and CSV foundations. XLSX is not part of V1 but may be needed for reports that users import into spreadsheets.

### O4 — Issue Package PDF Format

**Status:** OPEN

**Question:** Should the Issue Package generate individual renamed PDFs, one merged PDF, or both?

**Context:** Phase 6 implements Issue output layouts. The exact packaging format needs a product decision before implementation.

### O5 — Complex Visual Template Editor

**Status:** OPEN

**Question:** Will a complex visual template editor ever be required after the controlled V1 settings editor?

**Context:** Phase 5 provides versioned templates with a controlled settings editor (D23). A full visual drag-and-drop template editor would be a significant scope expansion.

### O6 — Future Teams-Specific Roadmap

**Status:** DEFERRED

**Question:** What Teams-specific features, if any, are planned beyond the current integration?

**Context:** The Personal local-first roadmap is the active product priority (D33). Teams expansion or synchronization is not part of the current roadmap unless explicitly approved.

### O7 — Future Optional AI Integration

**Status:** DEFERRED

**Question:** What AI integrations, if any, may be useful in the future?

**Context:** No built-in chatbot, bundled LLM, or generative-AI product dependency is in the current product roadmap (D30). Optional future integrations are DEFERRED and require explicit product approval. This does not govern external development tools.

### O8 — Security Review Scope

**Status:** OPEN

**Question:** What is the exact security review scope for the application?

**Context:** Security review is proportional to a local personal application. It does not imply enterprise security architecture, encryption platform, or complex role system. Focus areas: file/path safety, local data integrity, secret leakage, unsafe imports, package integrity, IPC boundaries, backup/restore safety.

---

## References

- Master roadmap: [docs/master-roadmap-v3.md](docs/master-roadmap-v3.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Assumptions: [docs/assumptions.md](docs/assumptions.md)
- Repository rules: [docs/repository-rules.md](docs/repository-rules.md)
