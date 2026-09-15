# Final V4 integration and validation

The later Studio 1.4.1 HTML integration is documented in [the current Studio report](luminaire-studio-v141-integration.md). Portable results below describe the earlier release, which does not contain that integration.

The approved local reference is `SCT WORKSPACE FINAL UI (Copy).zip`, SHA-256
`bed696c808ca592c07f38c300920fc69321bac5399429f3d3fb31e522bb65b51`.
The reference components, tokens and motion remain the presentation authority.
The production Personal renderer reads and mutates the local API/SQLite stores;
test fixtures and the separate legacy mock mode remain available for testing.
Transient selection, filtering, modal state and unsaved form input remain local
UI state. They are not replacements for persisted project records.

## Connected surfaces

| Surface                    | Persisted behavior                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard / Projects       | Authorized projects, operations, filters, project status, actor-scoped preferences and navigation                                     |
| New Project                | Atomic project creation, server identity/code, scope/services, schedule milestones and folder structure                               |
| Summary / Timeline / Scope | Actual project metadata, activity chronology, scope and checklist records                                                             |
| Contacts                   | UUID-owned records, email/phone, primary contact and existing editor                                                                  |
| Comments                   | Threads, replies, resolution, linked records, attachments and existing advanced editors                                               |
| Meetings / Actions         | Meeting details, participants, agenda, notes, linked actions, action status and canonical relations                                   |
| Luminaires / Datasheets    | Project-owned luminaire records, immutable Library snapshots, linked assets and existing editors                                      |
| Library                    | Published technical snapshots, mutable draft editing, manufacturer/product/variant creation, publication, archive and deep links      |
| Smart Import               | Persistent inspection, mapping, owner reconciliation, guarded Apply, backups, replay and result history                               |
| Technical Check            | Explicit analysis, persisted results, evidence, stale-result rejection and single-field correction                                    |
| Intelligence               | Existing readiness, sources, canonical Revision comparison and action workflows                                                       |
| Revisions                  | Canonical UUID creation/composition/finalization, details, deletion eligibility, duplication and history                              |
| Schedule / BOQ             | Actual templates, preview, PDF/XLSX generation and canonical Revision targets; BOQ remains non-priced                                 |
| Packages                   | Selected finalized Revision, actual available deliverables and byte sizes, readiness, draft/issue, immutable audit, retry and reissue |
| Settings / Work Sessions   | Saved settings/catalogues/backups, existing restore confirmation, themes and durable start/pause/resume/stop                          |

## Backend additions and corrections

- Schema 29 adds Contact phone/primary state and Action area/Luminaire/comment
  relations. Versioned migration and rollback checks preserve previous history.
- Final Project setup persists scope, services, schedule and structure with
  creation rather than leaving wizard values in a prototype.
- Final UI preferences are persisted per actor and canonical target UUID;
  foreign-project and forged-payload checks remain server-owned.
- Technical results survive reload/restart. Changed source fingerprints prevent
  stale comparisons from being presented as current evidence.
- Revision duplication uses a canonical source UUID, expected fingerprint and
  retry identity. It creates a new preparing Revision without reattaching old
  output artifacts or rewriting the source Revision.
- Package catalogs accept an explicit finalized Revision UUID and reject foreign
  identities. Generated artifact sizes come from root-checked files; readiness
  uses canonical output availability rather than legacy export history.
- Action mutations retain rollback when the immutable activity append fails.
- The packaged API includes JSZip rather than resolving it from the development
  workspace. Packaged startup is validated separately from source-hosted Electron.
- Personal Electron defaults to Final V4. Build metadata joins source, renderer
  bundle, API-served files and the Electron document by SHA-256.

## Preserved features without a final destination

These capabilities are retained rather than deleted or added to the approved
navigation without a design decision:

- Files and Document Review retain their existing screens.
- Settings Integrations remains available at `/v4/settings?section=integrations`.
- Existing advanced Add/Edit dialogs, asset attachment, folder/catalogue editors,
  output preview and package builder are reused where required.
- Project-to-Library promotion, Library update/description-override comparison,
  older Revision output/recovery views and advanced legacy import/report flows
  retain their implementations and backend authority.
- The optional Team/Microsoft 365 renderer and adapters remain separate.
  Local validation is not a claim of tenant deployment or authentication testing.

## Remaining design decisions

The reference does not specify the contents/destinations of Library Compare,
Library auxiliary filter icons, board-column ellipsis, New Project Learn more,
View example, Browse all templates and the client-plus control. These reference
controls still need their destination/interaction defined; they are not reported
as completed features. No new product screens were invented for them.

The reference includes Edit beside a read-only Issue Audit. That control remains
disabled because issued actor/time/history are immutable. Editing them requires
an explicit product and data-history decision.

Backup retention uses the existing backend's count of retained backups. It does
not claim a days-based policy. Package recipients remain future-use/unconfigured.

## Verification and release

The evidence directory for this run is
`C:/Users/moham/.codex/visualizations/2026/09/09/01a0862e-873b-7393-a6c0-02d5ff53264e`.
It contains test logs, production build metadata, served-file hashes and actual
Electron screenshots. Disposable workspaces were used; existing Personal,
business and Golden data were not used for these mutations.

`scripts/electron-v4-validation.mjs` verifies real Electron startup, persisted
project/contact/comment/meeting/action/Luminaire workflows, saved technical
results, Revision creation, Work Session reload, generated Schedule/BOQ PDFs,
Revision finalization and an issued Package. It also checks all inspected routes
at 1366×900, 1920×1080 and 2400×1440 without whole-page scaling.

Validation results for this delivery:

| Check                                                           | Result                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Backend/domain suite                                            | 3024 passed; 3 skipped because Windows denied symlink creation                                 |
| Package catalog/deliverable rechecks after the final correction | 28 passed                                                                                      |
| Final V4 components                                             | 1149 passed                                                                                    |
| Preserved legacy components                                     | 47 passed                                                                                      |
| Native desktop tests                                            | 42 passed                                                                                      |
| V4 / mock / Personal E2E                                        | 16 / 8 / 6 passed                                                                              |
| Actual packaged Electron                                        | 63 route/size checks, 0 renderer errors; generation, issue and Work Session persistence passed |
| Packaged OCR runtime                                            | Initialized from ASAR with worker networking disabled                                          |
| Typecheck, production build, Teams validation/package           | Passed                                                                                         |

Three explicitly skipped tests concern OS-denied symlink creation; an additional
legacy test reports an unsupported intermediate-symlink subcase. No Windows
security setting was changed to make these checks pass. Tenant testing remains
outside local validation.

The packaged runtime has build source SHA-256
`10b993a8b9413d9f5b703f81b59c6e8c25e93dc82a1c9481695c9cf683ad664e`. The portable file's byte hash and the exact evidence
location are recorded in `release-final-v4-20260909/VALIDATION.json`.

Run `pnpm desktop:run` from the repository or open the portable executable in
`release-final-v4-20260909`. The portable executable uses its sibling
`SCLI Workspace Data` folder. Keep an existing data folder when replacing an old
executable; opening the new release in an empty directory starts a separate
workspace. No existing data folder was moved into the release directory.

No commit or push was made.
