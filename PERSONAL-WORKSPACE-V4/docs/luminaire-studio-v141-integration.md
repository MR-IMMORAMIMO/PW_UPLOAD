# Luminaire Studio 1.4.1 — V4 HTML review

This delivery integrates the owner's supplied **Luminaire_Studio_Portable_v1_4_1/Luminaire_Studio** source. The original folder is untouched. Its 24 reference files are preserved under `tools/luminaire-studio-v1.4.1`; `source-manifest.json` records their hashes. The build adapter applies the V4 persistence, navigation and theme boundaries to copies at build time.

## Pages and workflow

The Technical Workspace exposes Luminaires, Lighting Systems, System Accessories, Output Studio and Studio Datasheets. Existing Datasheets & Images and Technical Check remain in place. Studio's independent Project/New/Open workflow is replaced by the current canonical Project UUID and metadata. The Library tools action opens the retained advanced luminaire workspace; previous Schedule/BOQ composition targets and recovery contracts remain available.

Luminaires project into the existing canonical rows. Systems, accessories, custom fields, specification-sheet choices and output layout persist in append-only project document versions in the existing SQLite app_state store. Shared templates persist in their own versioned catalog. Local selection and unsaved form drafts remain transient UI state; IndexedDB and localStorage are not Studio record authorities.

Saves use expected versions, canonical fingerprints and operation UUIDs. Removed canonical luminaires require explicit deleted identities. Library snapshots retain their existing protections. Uploaded images/PDFs enter the canonical managed AssetVersion history. Nested savepoints keep assets and project changes atomic. Backend authorization remains owner-only in Personal mode.

PDF and XLSX use the supplied JavaScript export engines, including Studio specification sheets and separate datasheet workbooks. Each artifact is registered against a canonical Revision with a SHA-256 hash and frozen Studio input. Separate workbook downloads are grouped into a convenience ZIP by the browser; each workbook remains independently registered. BOQ remains non-priced. Retrying an interrupted Studio output reuses the same Revision and frozen data through the existing recovery actions. Existing files are never overwritten during recovery.

## Presentation

All six Settings accent choices reach the parent and embedded Studio controls. Light/Dark changes propagate to native Studio dialogs; semantic status colors stay independent. Original Studio tables/settings paginate to the available height. Document preview fitting scales the paper only, not the application. Shared typography, surfaces and trigger-based dialog motion adapt the source to V4. Reduced motion remains respected.

## Preserved capabilities

Library Compare/Update, Project-to-Library promotion, imports, advanced asset/edit dialogs, old Revision composition and recovery remain available through retained paths. Files and Document Review retain their existing UI. Team/Microsoft 365 adapters and the old exporter are not removed. Their possible future visual redesign is not required for this integration.

## Validation evidence

Evidence is in `review-radio-station/studio`.

- V4: 123 files / 1156 tests passed.
- Domain/API full run: 192 files passed; two new Studio tests exposed nested transaction handling and were fixed. The subsequent 50-test Studio/asset/work-session run passed, including rollback and fault-injected recovery. Three OS-dependent tests remain skipped. This is a full run plus focused corrected rechecks, not a claim that the first run was green.
- Desktop: 42 tests passed.
- V4 Playwright: 15 scenarios passed initially; the Library scenario was updated to enter through Studio's Library tools button and passed on recheck. All 16 scenario contracts are retained.
- Real browser: all six accents, both dialog themes, exact UUID deep link, shared template save/reload, ten systems/accessories, actual Export Excel control, six PDF/XLSX document combinations, separate workbooks and idempotent output replay passed.
- Electron: actual main/preload/production API/V4, disposable data, five embedded Studio page interiors, three window sizes, source/build/served asset hashes, persisted work sessions, Revision output generation and Package issue/reload. The final root-build evidence is `electron-root-build/electron-validation.json`.
- Root production build, TypeScript checks, ESLint and Prettier passed. Local Teams manifest structure and ZIP packaging passed; no tenant validation/deployment is claimed.

The first Electron interior check exposed a resource-root lookup based on the process working directory. It was corrected to use the API module location, then revalidated in real Electron. Earlier screenshots or validation files are historical evidence, not the current acceptance result.

## Open the review

Run `review-radio-station/Open Review.cmd`, or open the running review at:

http://127.0.0.1:4317/v4/projects/a1c70d3f-98c3-4e01-a6ad-efc9a0b7cd1a/luminaires

The launcher starts the real local API if required. Keep the review folder to retain its synthetic Radio Station data. HTML review requires that local server; it is not a disconnected mock HTML export. The data is isolated from existing Personal/business/Golden workspaces.

Application version is 3.2.2 with Studio 1.4.1; `apps/web-v4/dist/build-info.json` identifies the exact source hash and build time. No new portable executable, commit or push was produced. Packaging Studio's new renderer/resources into a portable remains a later release step, as requested. The older portable does not contain this integration.
