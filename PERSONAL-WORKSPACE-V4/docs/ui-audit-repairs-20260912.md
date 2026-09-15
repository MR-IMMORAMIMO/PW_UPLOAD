# UI audit repairs — 12 September 2026

The owner authorized fixing all 19 findings in `test-results/ui-deep-audit-20260912/findings.json`, including related defects found during repair. All 19 now have mapped before/after evidence in `test-results/ui-audit-fixes-20260912/report.html` and machine-readable closure in `findings-closure.json` beside it.

## Delivered build

- Executable: `release/ui-audit-fixed-20260912/win-unpacked/SCT Workspace.exe`.
- Renderer fingerprint: `2b2d34f3f8579196d1e7b16a41a1c0451e7ee68f4e302914b2e125c828a79da3`.
- `Open-Reviewed-Workspace.cmd` now opens this executable using the isolated repair-audit profile and data. The previous review package and data remain available.
- Packaged Electron, served build metadata and DOM fingerprint matched. No renderer JavaScript errors were observed in this packaged verification.

This delivery supersedes the executable link in `approved-ui-completion.md` for review of these fixes. It does not replace historical evidence in that document.

## Repairs

Contacts cards and tables now use the theme consistently. Custom column widths retain the available table width, wrap content, and reset independently. Global search uses the existing authorized search API and opens canonical Project routes, with loading, empty, error and retry states.

Meetings and Technical Check menus anchor to their controls. Reports detail panes and work-session tables, action text editors, category colours, project-edit fields, manufacturer forms, desktop integrations and unsaved-draft confirmations have corrected spacing and sizing. Library filters have an accessible toggle; the redundant dead filter was removed.

Dark surfaces and accent text were corrected, including embedded Studio dialog headers. Eighteen measurements cover six accent colours on three dark surfaces, with a minimum accent-text contrast of 5.97:1. This is a bounded accent-token measurement, not a claim that every semantic colour in the application meets that ratio.

Timeline and Technical Check filters expose empty states and recovery. Library and Datasheets hide a selection excluded by filters. Dashboard bulk review is disabled when there are no items.

Category SVG meanings were corrected for document text, ruler, target and layers; CSV import evidence no longer uses the PDF symbol. Smart Import Inspect and Apply retain row previews and review navigation without weakening Apply eligibility. Studio pagination levels now have visible and accessible labels.

Related repairs include the outer Meetings filter panel, the manufacturer save label and explanation, reference-picker content padding, contact-group colour typing, and the Smart Import test assertion for a row preview coexisting with a terminal result.

## Validation

| Check                  | Result                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Domain/API             | 205 files, 3116 passed, 3 skipped                                                                                                         |
| V4 components          | 133 files, 1187 passed; final Library affected run 6 passed                                                                               |
| Desktop                | 47 passed                                                                                                                                 |
| Shared web components  | 47 passed                                                                                                                                 |
| Mock browser           | 8 passed                                                                                                                                  |
| V4 browser             | Broad run: 22 passed and one locator ambiguity. After correction, all 3 Smart Import cases passed on rerun, including the remaining case. |
| TypeScript             | Full workspace passed after the final group-type correction                                                                               |
| ESLint                 | Full run passed; final affected files passed                                                                                              |
| Formatting             | Full workspace passed                                                                                                                     |
| Build                  | API, V4 and legacy production build passed; final V4 rebuilt                                                                              |
| Windows package        | Built and verified as packaged Electron against disposable data                                                                           |
| Microsoft app artifact | Agents Toolkit local schema/package validation and package generation passed                                                              |

Logs, 57 selected after-images, geometry checks, contrast measurements and packaged provenance are linked from the repair report. Earlier failed test-harness attempts remain in the raw ledger; only mapped, inspected captures and successful final reruns support closure. The earlier full audit's 1243 actions were not all repeated in this repair pass.

## Boundaries

No live business data, restore, tenant deployment, external desktop-tool launch, commit or push occurred. Missing-PDF requests in the disposable reference-image case returned 404 and produced the intended attach-first message; image use remained disabled. Existing large-bundle and default-executable-icon build warnings remain. Unrelated pre-existing worktree changes were preserved; turn-specific file hashes are recorded in `changed-files.json`.
