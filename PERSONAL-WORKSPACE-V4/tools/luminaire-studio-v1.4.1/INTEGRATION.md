# Integration contract — v1

The existing Windows Workspace repository was not available in this environment. This is a standalone implementation, not a verified integration or replacement for existing Workspace output code. Review that code before merging. Preserve the approved Workspace UI and adapt this generator behind it.

## Boundary

`core.js` exposes `LS` and has no DOM dependency. `export.js` exposes `LSExport`; its XLSX method depends only on the bundled `JSZip`. `app.js` owns dialogs, file pickers, IndexedDB and downloads.

```js
const project = LS.validateImport(json);
const bytes = await LSExport.xlsx(project); // Uint8Array
const documentHTML = LSExport.printHTML(project); // standalone print HTML
```

Use an adapter from Workspace data to this contract. Do not change Workspace schemas or approved screens merely to match the temporary UI.

## Project schema

- `schemaVersion: 1`, `id: string`, optional `updatedAt` ISO timestamp.
- `meta`: project/client/company/document/revision/date/purpose/prepared/checked/approved/currency/notes/logo.
- `luminaires[]`: unique `id`, unique `tag`; scope/floor/area/type/systemId; independent product, photometry, control and quantity fields defined in `LS.fields`.
- `systems[]`: `id`, unique `code`, type, scope, floor, area, manufacturer, family, voltage, mounting, notes.
- `accessories[]`: unique `id`, unique `ref`, `systemId` foreign reference, component/description/specification/supply/quantity fields in `LS.accessoryFields`.
- Images are PNG/JPEG data URIs. UI photo import centres the original on a square white canvas; source aspect ratio is retained.
- Optional attachment: `{name, data}` with a PDF data URI.
- `customFields[]`: `{key, label, type, unit, target}`; values live on the record by `key`.
- `output`: kind (`schedule`/`boq`), filters, grouping, pageSize, orientation, fontSize, rowsPerPage, includeAccessories, showEmpty, and ordered column arrays.

## Invariants

1. Each output field has an independent cell; omitted values do not shift other values.
2. Quantity and power values are numbers or an explicit blank; never parse a suffix as part of the number.
3. Numeric beam values receive a degree symbol; textual optics remain text.
4. Power and lumen units depend on the quantity basis; metre-based rows are W/m and lm/m.
5. A powered component belongs in luminaires once. Accessory driver ratings do not add consumption.
6. Group rows are derived at export, not stored as fake product records.
7. Hiding columns never deletes source data. Column width and label are presentation settings.
8. Images and attachments are persisted in snapshots, not only as transient object URLs.
9. Export is local and has no external network requirement.

## Tests and validation

Domain tests cover numeric units, text optics, total power, length, grouping, scope filters, snapshots, custom columns and image-inclusive XLSX generation. Exported package XML was parsed and its numeric style references checked. An independent office engine opened and converted generated schedules. Add Windows browser interaction tests and adapter-specific tests when integrating into Workspace.

Version 1.1: output.autoFit (boolean, default true), output.fontFamily (string, default Roboto), and column.align (left/center/right) extend schemaVersion 1. C.outputColumns resolves content widths and alignment without changing stored manual widths. Optional accessory totalLength uses rowValue and is exported with a formula when required inputs are visible. Load fonts.js before export.js for self-contained offline print fonts.

Version 1.2 keeps schemaVersion 1 and adds output.aggregateBOQ, pageBreakScope and pageBreakFloor (default false). LS.aggregate is a pure exact-match operation over enriched, filtered records. LS.makeTemplate / applyTemplate expose templateVersion 1 with output and customFields; applying preserves records and current filters. LSExport.chunks is shared by PDF pagination and XLSX manual breaks. Templates are cached at ls-output-templates and portable via JSON export/import.


## v1.3 datasheet additions

New modules: datasheet.js (field schema, binding, units, summary, HTML), datasheet-xlsx.js (editable XLSX), datasheet-ui.js and datasheet-ui.css. Data remains schemaVersion 1 with additive optional fields on each luminaire. `specSheet` contains reference slots, photo layout, presentation description and generation fingerprint. Save/Open includes those fields automatically. `specSheet` is excluded from BOQ technical aggregation identity because it contains document formatting. New technical fields remain part of technical identity. Core voltage enrichment preserves a record-specific voltage before falling back to its linked system.
