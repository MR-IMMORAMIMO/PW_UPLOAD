# Release readiness and shared controls — 10 September 2026

## Verdict

The current Personal V4 is suitable for controlled internal UAT. **Final portable release is not yet accepted**, and **the current code is not yet a shared multi-user Team V4 product**. Functional tests and source-hosted Electron validation do not establish packaged release, external vulnerability clearance, or tenant acceptance.

No portable, commit, push, tenant modification, or production-data migration was performed in this review.

## Controls changed

- Replaced application-owned browser confirm/prompt calls with one themed asynchronous decision dialog, including Studio's original template/delete/rename actions, Technical Check adoption, settings deletion/discard and Library description override. Cancellation remains a negative decision; confirming is still required before the existing backend operation.
- Kept native dialog focus trapping, safe default Cancel focus, Escape cancellation, text-only rendering, single resolution and focus restoration. Escape/Tab do not bubble to an underlying V4 overlay.
- Unified decision, popup and Studio dialog timing to 300 ms and the same easing family. Decisions use the shared paper-unfold geometry; dropdowns retain an anchored opening. Reduced motion disables the effect.
- Styled native single-select pickers in supported Chromium and custom listboxes with the host surfaces, accent selection/checkmark/focus, rounded borders and the common timing. Native keyboard/form semantics remain. Older browsers retain the native fallback.
- Fixed remaining Studio dark-mode surfaces: output settings, form footers, table headers/hover, tabs, badges and toasts. Printed documents remain in their print palette. Semantic danger and warning colours remain separate from the accent.
- The existing shared button variants and the final page layout remain in place. This review is shared-component and workflow coverage, not a claim that every possible data combination or OS-owned file/security dialog can be restyled.

## Validation

Evidence: `review-radio-station/studio`.

- `controls-v4-full.log`: 123 files, 1156 component/workflow tests passed.
- `control-tests.log`: 38 focused settings, technical-check and dropdown tests passed.
- `controls-e2e.log`: 5 real API browser scenarios passed, including cancelling a Studio template prompt without changing its catalog, modal/drawer/inspector motion, settings, exact Datasheet field adoption and wrong-hash rejection.
- `control-validation.json`: Light/Dark dialog colours, 300 ms motion, actual native picker support/theme, Escape cancellation, default focus, reduced motion and text-only prompt input passed; no native browser confirm/prompt appeared.
- `electron-controls-final/electron-validation.json`: final-build real Electron evidence, 75 route/size checks, source/build/served artifact matching, project records, persisted work sessions, generated outputs, Revision finalization and Package issue/reload.
- V4 TypeScript, scoped ESLint, formatting and production V4 build passed. Backend code was unchanged in this controls slice; its preceding Studio/asset/work-session tests are recorded in the Studio integration report rather than represented as a newly repeated full backend run.
- External dependency audit was **not run**: automatic approval review rejected transmission of dependency/lockfile metadata to the vulnerability registry. No workaround or indirect submission was attempted. Owner approval is required to complete that check.

## Remaining release gates for Personal

1. Package the new Studio source and renderer helper into the portable. The current `package.json` resource list still carries the old exporter, while the Studio output service currently resolves the development Electron package and workspace helper. Packaged resource/executable resolution must be implemented and tested; copying only the HTML bundle is insufficient.
2. Validate the actual portable on a clean Windows machine without the repository or development tools: create/edit/reopen projects, attach assets, export all document families, recover interrupted exports, verify backup/restore and upgrade/rollback. Do not certify it from source-hosted Electron alone.
3. Complete the approved external dependency audit and triage its results. No statement of a clean vulnerability scan is supported yet.
4. Freeze a reviewed source version and release manifest/checksums after owner approval. Select installer/portable distribution, signing and manual/automatic update policy. No commit was authorized here.
5. Confirm release scope for intentionally disabled future destinations such as Smart Import File Queue, Mapping Rules and Data Sources. Existing Files/Document Review/advanced editors remain preserved; a new visual design for those is optional product work, not a reason to remove their functions.

## Team reality in this repository

| Area | What exists | Gap before shared Team V4 |
| --- | --- | --- |
| Desktop Team startup | Separate Team startup in `desktop/main.cjs` | Starts a local API and a per-device SQLite database; no shared team authority |
| Team renderer/package | `apps/api/src/team-server.ts` and `electron-builder.team.yml` | Serves/packages `apps/web`, not the current `apps/web-v4` and Studio resources |
| Login | Standalone password hashing, signed sessions and server-side actor resolution; Entra JWT validation also exists in `apps/api/src/auth.ts` | V4 production client currently sends no Bearer token and has no complete login/logout/session-expiry flow; must clear per-user cached data on account changes |
| Personal features | Studio, Library, document intelligence and other APIs have explicit Personal-owner gates | Team role/record policies and shared repositories must be implemented feature by feature; removing owner guards alone would be unsafe |
| Roles and identity | UUIDs, application roles and server authorization foundations | Agree membership/project access and test direct requests for every role across the expanded feature set |
| Storage | Local managed assets, immutable Revisions/Outputs, backup and recovery foundations | Shared managed files, permissions, download authority and migration of local paths/ownership |
| Bootstrap security | Team desktop currently embeds fixed bootstrap credentials/session material | Replace with deployment secrets and a controlled first-admin setup before any real team use |
| Microsoft 365 | Entra actor resolution and a SharePoint provider for core records | Does not establish that the full V4/Studio/Library/Revision model is shared or tenant-tested |

## Concrete Team implementation plan

1. Agree team size, roles, which projects/library data are shared, office-only versus remote access, offline expectations, allowed hosting and the IT operator. Choose company Microsoft sign-in or managed application accounts. Running inside Microsoft Teams is an additional integration decision.
2. Deploy one authoritative backend with shared persistent records and managed asset storage. Desktop/browser clients connect to it instead of starting independent Team databases. Select the database/storage platform with IT; preserve UUIDs, immutable audit and Revision identity.
3. Add V4 login/logout/session expiry and user-scoped cache resets; connect the existing `/api/me` identity to authenticated sessions. Implement secure transport, secrets/bootstrap setup and role/project authorization for every endpoint.
4. Move Personal-only Studio, templates, Library, imports, verification, work sessions and output services behind shared repositories with explicit Team policies. Keep existing technical snapshots and activity history during a backed-up, reversible migration.
5. Complete concurrent edit/version-conflict behavior, atomic sequences, duplicate-request protection, output job locking/recovery, shared template/catalog changes and update notification/refetch. Test simultaneous users rather than sequential local accounts alone.
6. Finish central backup/restore, monitoring, deployment/rollback, resource packaging and client update distribution. Exercise server restart/network failure and permission revocation.
7. Run a pilot with real authorized team accounts: multiple roles editing the same project, simultaneous imports/exports, cross-project access denial, history preservation and recovery. Microsoft 365 tenant checks require IT approval and actual tenant evidence.

Existing domain/contracts, V4 UI, import safeguards and canonical history can be reused. This is an extension of the product, but it is not presently just a login screen or a new executable name.
