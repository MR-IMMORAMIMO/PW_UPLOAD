# Local Intelligence

SCLI Workspace 3.2 adds a free, deterministic analysis layer to the personal project workspace. It does not use generative AI, OpenAI, a cloud API, an account, or a paid subscription. Project data and linked PDFs remain on the device.

## User workflow

1. Create or import the Luminaire Schedule as usual.
2. Link the official product PDF to each luminaire in **Datasheets & Images**.
3. Open **AI Check** and run the datasheet analysis.
4. Review Schedule and Datasheet values side by side, including page evidence and confidence.
5. Check only the unambiguous values that should be copied, then select **Apply selected**.

No value is applied automatically. Mismatches are not selected by default. Missing schedule values with strong, unambiguous evidence may be preselected in the review form, but still require the designer's approval.

## Supported comparisons

- Manufacturer and model when explicitly labelled.
- Connected wattage.
- Luminaire lumen output.
- CCT.
- CRI.
- Beam angle or named beam distribution.
- IP rating.
- Mounting.
- Cut-out and dimensions.
- Driver, control/dimming, emergency option, and body finish when explicitly labelled.

Product families that expose several values at the same confidence level are marked **Needs Review**. The engine does not guess a variant or recommend a brand.

## Project checks

AI Check also calculates a local issue-readiness score and a concise brief from existing project records. Checks include folder connection, schedule rows, datasheet coverage and file availability, required output-column values, blocking requirements, overdue actions, unresolved comments, exports, and project-file scan status.

The file classifier uses the existing folder index. For up to eight low-confidence PDF files per refresh, it can inspect the first two text pages locally and suggest a category. Suggestions do not rename, move, or recategorize physical files.

## Limits and safety

- Only local PDFs with selectable text are extracted in this release.
- Scanned/image-only or protected PDFs are marked for manual review; OCR is not bundled.
- Web URLs are not fetched. Save the official PDF locally before analysis.
- Datasheet analysis is limited to 100 MB and the first 40 pages.
- Content classification is limited to 25 MB and the first two pages.
- The result is a design-quality aid, not a replacement for the designer's technical approval.
