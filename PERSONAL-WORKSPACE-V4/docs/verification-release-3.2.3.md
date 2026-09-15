# Portable 3.2.3 — Technical Verification and Library

Built 2026-09-10. This release implements the approved verification fixes and Project-to-Library action. CSV import was excluded at the owner's request. No commit or push was made.

## Using the changes

- In Project → Luminaires, use **Add to Library** on a luminaire. Review the existing draft dialog and supply its required product fields. This creates a Library draft through the existing backend; it does not publish automatically or change the original Project record. Project quantity, location and private project notes do not become catalog data.
- In Technical Verification, open a field and choose **View Evidence** to see the actual attached PDF page. The portable now includes the native canvas runtime required to render it.
- Choose **Product image from Datasheet**, select the PDF page and the correct embedded image, then **Use selected image**. Saving creates a managed ProductImage version. Previous assets remain in history. Stale Datasheet/image versions and forged image selections are rejected by the API.
- Technical Verification text, numerical values and action icons now remain visible in Light mode. The image picker uses the shared themed overlay and accent controls.
- Numeric comparison accepts exact values and compatible units. Ranges, alternatives, tolerances and qualified values are not collapsed to their first number and falsely marked as matching. Evidence pagination now reads beyond the first 100 extracted fields, with an explicit 5,000-field limit.

## Verified

All verification used disposable local data, not the owner's working projects.

| Check                                                | Result                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Domain/API suite                                     | 3,051 passed; 3 skipped                                                                                                        |
| V4 component suite                                   | 1,158 passed                                                                                                                   |
| Desktop tests                                        | 42 passed                                                                                                                      |
| Legacy component tests                               | 47 passed                                                                                                                      |
| Focused browser E2E                                  | 3 passed: exact Datasheet verification, hash rejection, Studio-to-Library promotion                                            |
| Formatting, ESLint, TypeScript                       | Passed                                                                                                                         |
| Production build and Windows portable packaging      | Passed                                                                                                                         |
| Local Teams manifest validation and package creation | Passed; no tenant validation/deployment claimed                                                                                |
| Packaged Electron                                    | 75 route/viewport checks; Studio PDF/XLSX exports; output/revision and restart persistence; no renderer errors                 |
| Packaged PDF/image workflow                          | Real PDF preview and embedded image extraction, explicit image selection and persisted asset; Light/Dark screenshots inspected |
| Actual portable launcher                             | Two successful launches with the same persisted user identity                                                                  |

The initial concurrent desktop test run collided with the running disposable Electron server's preferred port. After the Electron checks closed, all 42 desktop tests passed. A timing-sensitive UI test from an earlier run also passed in the final complete V4 run.

## Limits

This is not a guarantee of 100% extraction accuracy for every PDF. Ambiguous evidence remains Unverified and requires review. Embedded image extraction can include logos, diagrams or a scanned page; the owner must choose the correct model image. Vector-only drawings may need manual attachment. Existing Library snapshot protections remain enforced.

This is a standalone Windows x64 portable tested on this machine with isolated data. A separate clean Windows machine and Microsoft tenant were not tested. The executable is unsigned. Dependency advisory scanning was not completed because automatic approval review rejected sending package metadata to an external registry; it was not bypassed.

## Build and opening

- Executable: `release-v3.2.3/SCT Workspace Portable v3.2.3.exe`
- Version: **3.2.3**
- Built at: **2026-09-10T04:07:24.448Z**
- Source SHA-256: `8907cfc038ea449ea95a2151f2dd39b251c333ba998e9b38ac8c92a6c34c6fff`
- Executable SHA-256: `A401F7FD999AC35065E10B272A8287ED0C08AA515CDE8E0E3A10C9D81DDEE8D1`

Source provenance, built renderer, API-served build metadata and packaged Electron were checked for agreement. Evidence JSON and screenshots are in `release-v3.2.3/verification-evidence`, `electron-evidence` and `portable-evidence`.

Close the previous application before opening the new executable. For a fresh trial, place it in a writable folder and double-click it. To retain existing portable data, back up the existing `SCLI Workspace Data` folder while the old app is closed, then place the new executable beside that same data folder. Do not replace the data folder with test data.
