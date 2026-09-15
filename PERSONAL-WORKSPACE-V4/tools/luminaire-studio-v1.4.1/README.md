# Luminaire Studio — Portable 1.0

A local, offline manual lighting schedule and BOQ generator. No installation, account, server or Excel license is required to enter data or generate an XLSX. Open **START.html** in Microsoft Edge, Chrome or another modern desktop browser after extracting the complete folder.

## ابدأ في دقيقة

1. فك ضغط الملف كاملًا، ثم افتح **START.html**.
2. افتح **Project** وأدخل بيانات المشروع والشعار.
3. من **Systems** عرّف أنظمة التراك أو الشرائط، إن وجدت.
4. أضف الوحدات من **Luminaires**؛ كل مواصفة لها خانة منفصلة.
5. أضف مكونات الأنظمة من **Accessories** واربطها بالنظام الصحيح.
6. من **Output studio** اختر جدول الإضاءة أو جدول الكميات، والأعمدة المطلوبة وترتيبها وعرضها.
7. ترتيب التجميع الافتراضي: **Indoor/Outdoor → Floor → Type**. يمكنك تغييره، وكل مستوى يظهر كصف عنوان داخل الجدول.
8. **Export Excel** ينشئ ملف إكسيل حقيقيًا. **PDF / Print** يفتح نافذة الطباعة: اختر حفظ كـPDF، والمقاس الصحيح، وأوقف عناوين المتصفح وتذييلاته.

## وحدات تلقائية

- اكتب `3000` لدرجة اللون؛ يظهر `3000 K`.
- اكتب `36` لزاوية الشعاع؛ يظهر `36°`. الأوصاف مثل `Asymmetric` أو `Diffuse` تظل نصًا.
- القدرة واللومن يظهران بـ`W` و`lm`، أو `W/m` و`lm/m` عندما تكون الكمية بالمتر.
- اكتب كمية رقمية؛ تظهر الوحدة حسب أساس الكمية (`pcs`, `m`, `set`). شريط الإضاءة يختار المتر تلقائيًا عند تغيير نوع الوحدة؛ ويمكنك تغيير الاختيار.
- الأبعاد وفتحة التركيب يظهر معهما `mm`. أدخل قياسًا واحدًا أو مجموعة أبعاد مثل `90 × 100`.
- اكتب `67` في الحماية فتظهر `IP67`، أو `8` للصدمات فتظهر `IK08`.
- قيم الإكسيل الرقمية تظل أرقامًا؛ الوحدات تُضاف بالتنسيق، وليست نصًا يمنع الحساب.

## Projects and backups

The browser keeps local drafts using IndexedDB when available. **Save project** downloads a full snapshot containing records, images, attached PDFs, custom fields and output settings. Use **Open** to restore that snapshot or move it to another computer. Saving creates a new downloaded file; it does not overwrite your original file directly.

Save a snapshot before clearing browser data, changing browser profiles, or moving the application folder. Local browser storage is a convenience, not the only backup. The Projects menu lists local drafts. Sample projects open separately from your current project.

## Scope

- Manual project, luminaire, system and accessory entry; edit, duplicate, reorder and delete.
- Product photos and PDF attachments stored with the project; images are centred on a white square to preserve proportions in exports.
- Independent fields for photometry, driver/control, finish, dimensions and quantities.
- Configurable columns: include/exclude, rename, width, order, and custom text/number fields with optional unit suffixes.
- Grouping by environment, floor, area, luminaire type or system; scope filters apply to both output formats.
- Luminaire schedule, optional accessory schedule and BOQ. Rate and amount columns are optional; the default BOQ is unpriced.
- Separate track piece length and quantity, with optional total-length column.
- Completeness reminders, duplicate-ID checks and linked-system deletion protection.
- Native XLSX output with group rows, image embedding, numeric formats, repeating headings and print setup.
- Browser print layout for PDF. Long content can create additional physical pages; review the actual print dialog before issue.

## Deliberate limits

- This is a portable browser application, **not a Windows EXE**.
- It does not calculate lighting, select products, infer connector counts or approve electrical/system compatibility.
- Driver rated capacity is a specification and is not added to lighting consumption. Rows entered on an LED-load basis exclude upstream driver losses.
- Data is entered here; there is no import from arbitrary Excel files, manufacturer scraping or OCR.
- Excel edits do not sync back to the project. Project data is the source of truth. Exported summary strings describe the export at that time; regenerate after editing project quantities.
- PDF uses the browser print dialog rather than a separate embedded PDF engine.
- The application and export logic have been checked with automated domain/export tests and an independent office conversion of generated Excel. No Windows-native UI test was performed in this environment.

## Files and future integration

- `core.js`: serializable data model, automatic units, grouping, filtering, totals and validation.
- `export.js`: framework-independent Excel and printable-HTML output from project data.
- `app.js`: local browser UI and device storage; replaceable later.
- `style.css`: the approved monochrome visual language.
- `vendor/jszip.min.js`: bundled offline ZIP dependency; its license is included.
- `INTEGRATION.md`: contract for adapting this generator to the existing Workspace later.

All runtime files are local. There are no analytics, remote fonts, CDN dependencies, API keys or hosted backend.


## Version 1.1 changes
- Optional total length under Output studio: 3 m per piece × 90 pcs = 270 m. Quantity remains 90 pcs. Metre-based quantities are not multiplied again. Excel includes a recalculating length formula when piece length, unit and quantity columns are visible; otherwise the exported length is a snapshot.
- Auto-fit widths follows visible records and headers, with a cap for long text. Disable Auto-fit or edit a width for manual sizing. Choose left / center / right per column; choices apply to preview, PDF and Excel and are saved in the project.
- Print layouts request exact background colours. Enable **Background graphics** in the browser print dialog; browser/user settings can override document styling.
- Website typography: Roboto body text and Montserrat headings, verified from https://www.scientechnic.com/wp-content/themes/Scientechnic/assets/css/style.css?=v=1.1.1 on 2026-09-08. This is the website typography, not a claim about an unpublished brand manual. Font files and their OFL licenses are included. PDF and browser preview work offline. For the same fonts in Excel, select the TTF files inside fonts and choose Install on Windows. XLSX does not embed font files.
- Open your saved .luminaire.json project in this version. Existing schemaVersion 1 projects remain compatible. Save project before moving folders.

التعديلات: من Output studio فعّل إجمالي طول التراك وAuto-fit، واختر محاذاة كل عمود. عند طباعة PDF فعّل Background graphics. ثبّت ملفات الخطوط الموجودة في مجلد fonts لو هتفتح الإكسيل بنفس الخط. ملف مشروعك القديم يفتح عادي؛ احفظه قبل نقل البرنامج.


## Version 1.2
Output studio now includes:
- **Output templates:** Save current, Apply, Delete, Export and Import. Saved templates are available to other projects in this browser. Export/import template JSON to move between computers or folders. Templates include column choices/order/width/alignment, document type, page options, grouping and custom field definitions. They never contain product records, images or project/client details; current location filters stay unchanged when applying a template. Existing custom field data is preserved.
- **Combine identical items in BOQ:** optional and off by default. Filters are applied first; then exact matching specifications, manufacturer, ordering code and units are combined across locations. Different unit rates, technical fields, notes or custom values remain separate. Missing manufacturer/order code/quantity prevents merging. Tags, locations and system references are retained as comma-separated references. This affects exports only, not original records. Consolidated BOQ uses type headings (component type for accessories), so location page breaks do not apply in that mode. Switch back to Schedule for location detail.
- **New page for each environment / floor:** optional, off by default, for detailed documents. PDF preview and Excel use the same section boundaries, with headings repeated on continuation pages. PDF keeps each group heading chain with its first item. Very long text or excessive columns may still affect physical pagination; check the print dialog before issuing.

من صفحة الإخراج: احفظ قالب باسم، وطبّقه على أي مشروع. لتجميع الكميات اختر Bill of quantities ثم Combine identical items in BOQ. فصل الصفحات حسب البيئة أو الدور يعمل في الإخراج التفصيلي. يظل ملف المشروع القديم متوافقًا.


## v1.3 — Project datasheet generator

A new **Datasheets** workspace uses the existing luminaire records. The previous schedule, BOQ, grouping, accessories and track-length options remain available.

- A4 portrait technical sheet with aligned four-column specification tables and a fixed **60 × 60 mm** product-image frame directly beneath the tag.
- All fields in the approved reference layout are represented. Missing values and absent images show an em dash; numeric zero is retained. Fields are never inferred from a product photograph or manufacturer name.
- Fields already present in the schedule populate the sheet. Additional technical fields can be completed under Technical fields and are available as hidden, optional schedule columns.
- Technical edits in this workspace update the same luminaire record. Source power and system power follow the existing Power basis: System input maps Power to system power, LED load maps Power to source power. The other value must be entered separately if known. Efficacy is not inferred automatically.
- Per-metre power and lumen units follow the record's existing Unit. The user remains responsible for entering compatible values.
- Product images are shared with the schedule. Datasheet crop, image-fit and margins affect the datasheet only. Replacement retains the frame configuration. Image uploads on this new page have no fixed 20 MB rejection; they are resized to a maximum of 3000 px. Actual upload capacity depends on browser memory. The original schedule image editor retains its existing behavior.
- Reference images: choose 1, 2 or 3. Reducing the count does not delete the hidden slots. Each has upload/replace/clear, order arrows, optional caption, contain/cover, margin, zoom and horizontal/vertical crop position.
- Generate summary is an offline rule-based English description using only entered values. It requests confirmation before replacing existing text. Manual edits are retained. If relevant technical fields change, a reminder appears. Use schedule description restores the live schedule description as the source.
- Select one or more luminaires for PDF/print. For an individual PDF, select just that tag. Excel selected creates one editable workbook with one sheet per selected luminaire. Separate Excel files creates a ZIP of individual workbooks.
- HTML/PDF long text is referenced on continuation pages, preserving complete text rather than silently cutting it. Excel retains the full values with wrapping; unusually long technical values may require row-height adjustments in Excel before printing. Text and cells are editable; image crop is baked into each embedded image.
- Company logo, project name, revision, date and document reference are taken from Project. Without an uploaded logo, the sheet uses a typographic Scientechnic placeholder.
- Layout is a fixed approved document template. The configurable lower image region is supported; this is not the free-form presentation editor.
- Datasheets apply to records under Luminaires, including track heads and linear/strip luminaires. Existing Systems and Accessories schedules remain in their own output workflow.

### Validation for v1.3

Verified with program-level tests: v1.2 project preservation, blank/zero handling, automatic unit suffixes, power-basis mapping, unchanged manual description and stale detection, reference-image persistence, save/import roundtrip, continuation pages and original schedule export. Generated XLSX was opened independently with openpyxl and LibreOffice; HTML was rendered independently to A4 PDF for layout inspection. Main image dimensions are explicitly 60 mm square. No browser interaction or Windows desktop UAT was performed in this environment. Browser print results can differ slightly; check print preview before client issue.


## v1.3.1 — logo sizing
Logo uploads now retain their natural aspect ratio and remove blank white/transparent margins. Existing project logos are fitted when opening the project; the original is retained in logoOriginal. Datasheet, schedule and BOQ exports allocate a larger logo area. Excel schedule/BOQ reserves two header columns where available and preserves the fitted ratio. Reupload the original high-resolution logo if an earlier upload already lost detail.


## v1.4 — Page fill, footer and borders

In **Output studio → Page fill & borders**:

- **Fill page automatically** is on by default for both new and imported projects. The preview and print document measure the rendered rows after fonts/images load and fit as many records as the selected page size allows. Group headings repeat with the associated rows. Explicit environment/floor breaks are respected.
- Turn automatic filling off to use the existing Rows per page control as a maximum. A page may contain fewer rows when the content is taller than the available area.
- **Minimum row height (mm)** accepts 6–50 mm. Product images resize within that height. Longer text increases a row's height to avoid forcing it into a clipped fixed cell.
- **Cell borders**: None / Horizontal lines / Full grid, applied to schedule and BOQ PDF and XLSX exports. Colour and thickness are configurable. Excel maps line thickness to its supported thin/medium styles.
- **Page frame** applies to PDF/Print and follows the configured border colour/thickness. It does not insert a frame into an Excel physical page; Excel retains its native page footer.
- The PDF footer is positioned at the bottom printable margin, independent of the number of rows on the last page. A partially filled final page can still have blank space above the footer.
- Excel automatic mode leaves pagination to Excel using row heights, with manual breaks only for requested environment/floor boundaries. Its page footer remains native and repeated. Manual mode retains row-count breaks.
- Print using the same paper size/orientation as the application. Browser headers/footers should be off and background graphics on. Choosing a different print paper size or manual scaling can change the layout.
- An exceptionally large single row or document note may need additional physical print space. The document allows it to continue instead of clipping it; inspect the print preview for such cases.

Verified automatic/manual packing, row-height effects, no lost/duplicate records, floor boundaries and XLSX border/footer settings. Independently rendered A4 PDF confirmed identical bottom footer positions on first and last pages. The production browser reflow routine and controls have not undergone Windows/browser interaction UAT here.


## v1.4.1 — Full-page preview and responsive pagination

- Output studio keeps the document preview fixed on desktop (850 px and wider). Only the settings pane scrolls, and its position is retained when changing settings.
- The preview fits both the available width and height. Previous / Next switches between complete pages for A3/A4 in either orientation.
- Rows per page is always editable. Changing it automatically selects manual pagination and reduces the minimum row height where needed, down to 6 mm. Content and explicit group breaks can still require fewer rows.
- Choose row count automatically fits the maximum number of rows using their measured content heights. Changing Minimum row height selects this mode.
- Expand rows to fill page is enabled by default. It distributes remaining vertical space among item rows, including on the last page, while keeping the footer at the bottom margin. Turn it off to retain compact rows on a short last page. This full-page expansion applies to PDF/Print and its preview; Excel retains native pagination.
- Existing borders, logos, project data and datasheet exports remain supported.

Validation: pagination and mode switching, preserving all records, page-fit calculations for A3/A4 and both orientations, row expansion arithmetic, and prior datasheet/logo/Excel regression checks passed. Browser interaction and Windows print UAT have not been performed here.
