# Portable 3.3.2 — integrated review and local Library

The canonical Project Luminaires route now uses the V4 table and inspector. Managed ProductImage previews are hydrated from the existing authorized Studio projection; display data does not replace canonical asset locators. The embedded Studio retains automatic Project persistence while its separate branding/save toolbar is hidden.

Technical Check presents one row per Project luminaire UUID. Filters determine eligible luminaires; opening a row reviews all checks for that luminaire. Auto pagination expands with window height in Technical Check, Luminaires and the global Library. Manual page limits remain selectable.

Reviewed readings may explicitly accept a Datasheet identity mismatch for that field and immutable attachment version. This does not automatically validate other fields or the whole PDF. Actor, review note, file hash and confirmation time remain recorded. Adoption is still explicit, version checked and blocked for Library-owned technical snapshots.

The new technical-field endpoint accepts only one enumerated field, its value and the observed row version. It authorizes the owner, checks the Project and rejects stale writes and over-posting. It uses the existing Project mutation and Library protection rules. No Datasheet is required to correct a Project field.

Reference images can be selected from embedded PDF images or cropped from a bounded raster of an authorized attached PDF page. The result is saved in the existing Studio specification-sheet reference slots. ProductImage asset history is not changed. PDF page requests are bounded and accept Project/luminaire identities, never caller-supplied filesystem paths.

Global Library removal is logical archival. Archived entries are excluded from active selection; Project copies, published versions and history remain intact. No live customer data is seeded, migrated or deleted for validation.

Output Studio and Datasheets previews use available viewport height. Datasheet preview navigation preserves continuation pages. Draft fields and Project Files controls use consistent sizing and alignment.

The edition remains offline OCR, with local AI disabled and no bundled model. OCR readings still need human review; no accuracy guarantee is implied. No commit or push accompanies this release.
