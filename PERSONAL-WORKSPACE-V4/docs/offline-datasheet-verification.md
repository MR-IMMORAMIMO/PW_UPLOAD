# Offline datasheet reading

The standard Technical Check uses native PDF extraction and local Tesseract OCR. It does not call the experimental vision model, require an AI account, or send document pages to a service. Tesseract still uses its bundled English character-recognition data; it is not a general-purpose language/vision model.

## Reading and comparison

- Native technical text is retained when a letter-spaced disclaimer would otherwise distort the page quality score. Corrupt encoding, image-only pages, and unreadable content still require OCR.
- OCR darkens faint labels on a temporary raster and uses sparse text segmentation. Original PDFs and evidence coordinates remain unchanged.
- FLOS specification labels preserve separate source/system power and source/luminaire flux. Printed product codes, never file names or URL slugs, identify products. Accessory pages do not identify the attached luminaire.
- Catalogue variants retain printed row codes. Merged power/optic cells are not borrowed from adjacent rows. An unspecified flux basis cannot certify luminaire flux.
- Multiple driver choices and contradictory driver locations remain review items. Source power exceeding system power prevents automatic certification of the system-power value.
- Numeric OCR, OCR ordering codes, models, and IP values are capped below verified confidence. A confidently misread decimal point is possible, so OCR confidence is not treated as engineering certainty. Low-confidence ordering-code evidence cannot certify other fields through an assumed product identity.
- The extraction fingerprint changed. Rerun the existing Technical Check to process a document under the new rules; previously saved results are not silently rewritten.

## Nine-document local validation, 2026-09-10

The supplied PDFs were read through the production processing worker and its real native/OCR adapters, with a disposable in-memory database and isolated managed copies. The harness invokes the same luminaire semantic extractor at the structured-extraction stage. It does not exercise Electron or mutate live project/history data. Original file hashes are checked after each run. Private evidence stays in the ignored `release-ocr-review` directory and is not included in the source repository.

Observed improvements: the three ERCO sheets retain technical specifications without accessory identity pollution; the four encoded FLOS sheets recover substantially more labels and values; the native FLOS linear sheet avoids unnecessary OCR; the catalogue retains its separate white-light rows.

Known limitations remain visible rather than being called successful automatic verification:

- OCR reads system-power decimals in three sheets as integers (13.4 → 134, 4.7 → 47, 2.3 → 23). These candidates require visual review and cannot be automatically adopted.
- One diameter symbol in a product name is read as a digit. OCR model text remains unverified.
- Dimension drawings, highlighted catalogue selection, merged catalogue cells, and numerical annotations embedded in photometric graphics are not fully interpreted. In particular, the linear sheet's graph/table beam-angle discrepancy is not automatically recovered from the graph.
- Recognition completion means processing completed, not that every specification passed comparison.

## Offline Portable 3.3.1

The approved six enhancements are included in the separate `release-offline-3.3.1` package. The previous stable and experimental local-AI releases are preserved. `scliLocalAi` is false; no conversational model or model-server kit is required. Tesseract and its English OCR data are bundled, with worker network access disabled.

1. Numeric cells beside technical labels get a second, enlarged original-pixel reading with different segmentation. Up to 16 cells per page and a bounded 10-second secondary-reading budget keep work finite. Agreement never upgrades OCR to certified evidence; disagreement remains visible, and neither result silently replaces the other.
2. Spatial reconstruction supports repeated adjacent label/value pairs and keeps catalogue variants separate. Coordinate lookup uses whole values and positional context, never numeric substrings such as `1` for `134` or `123` for `23`. Ambiguous coordinates remain unavailable.
3. View Evidence displays the source page and a highlighted crop when a reliable region exists. Native-text geometry can be located with display-only OCR. If no unique region is found, the full page and quotation remain available with an explicit explanation. Screenshot location recovery never changes extracted values or confidence.
4. Confirm value from Datasheet saves a reviewed value, note, actor, time, exact AssetVersion and file hash. Open the current evidence, inspect the number, enter the reviewed value and note, then tick the confirmation and save. Project/Library values are unchanged; any subsequent Project adoption still uses the existing explicit action and its Library protections. Decisions are append-only versioned records in the existing app-state store; no schema migration is needed. Retries reuse operation identity. A replaced file does not inherit a prior confirmation, and stale fingerprints are rejected. Older app versions safely ignore these additional records.
5. Source power above system power, delivered flux above source flux, and disagreeing driver locations are review findings, not automatic corrections. Checks retain their product-row context.
6. Expanded deterministic tests cover decimal disagreement/agreement, exact crop geometry, adjacent table columns, false certification prevention, confirmation persistence/retry/version invalidation, and UI evidence prerequisites. Private PDF evidence remains outside tracked source.

### Measured PDF sample

On 37 manually checked core numeric fields across the supplied sheets: 33 correct, 3 incorrect decimal readings, 1 missing. None of those incorrect candidates had verification-level confidence. This measures a limited sample, not overall document accuracy or a guarantee of zero false matches. The focused second pass performed 49 reads (45 agreements, 4 disagreements), including `134` versus `13.4` and `23` versus `2.3`; `47` still agreed incorrectly with itself. All original file hashes stayed unchanged.

### Release verification

Full API/domain run: 3087 passed, 3 skipped. Full V4 component run: 1160 passed. Final technical-check UI suite: 30 passed, including two new confirmation tests. Final document-intelligence suite after coordinate hardening: 212 passed. Desktop tests: 43 passed. Mock workflow E2E: 8 passed. TypeScript, ESLint, formatting and production builds are checked separately. Local Teams manifest structure/package checks do not constitute Microsoft-tenant validation.

Packaged Electron acceptance exercises screenshot loading, reviewed-value persistence without Project mutation, light/dark rendering, product-image extraction, and the real FLOS OCR disagreement. Portable first-launch/restart acceptance uses disposable storage and compares served build metadata against the source build. Machine-readable evidence lives under `release-offline-3.3.1/validation` and `portable-validation`.

To run, place `SCT Workspace Portable v3.3.1.exe` in a writable folder and open it. For an isolated trial use a new folder; the app creates `SCLI Workspace Data` beside the executable. To use existing data later, close both versions and keep the complete data folder together; do not overwrite a running workspace. No installation, account, API key, or model download is required for technical checking.

## Validation commands

Run from the repository root:

```powershell
node node_modules/vitest/vitest.mjs run apps/api/src/infrastructure/document-intelligence
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json --pretty false
node node_modules/eslint/bin/eslint.js apps/api/src/infrastructure/document-intelligence --max-warnings 0
pnpm --filter @scli/api build
node scripts/verify-ocr-package.mjs
node scripts/smoke-offline-ocr.mjs
```
