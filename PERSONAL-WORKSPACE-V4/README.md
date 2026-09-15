# SCT Workspace 3.2

A local-first personal workspace for a lighting designer. It manages the complete project record from folder creation and brief capture through lighting deliverables, revisions, client comments, meeting notes, technical BOQ, luminaire schedule, datasheets, and controlled issue files.

The portable Windows build is the primary product. It runs locally for one user, stores project-management data in SQLite, and lets the designer choose the project root for every project (normally a OneDrive-synced folder). The personal workspace has no email, calendar, tenant-consent, or cloud-account dependency.

## Personal workspace features

- Fully customizable project-folder profiles, including nested folders and independent output destinations for Schedule, BOQ, PDFs, and datasheets.
- Lighting-specific services: Layout, Design, DIALux calculation/report, 3D visualization, presentation, luminaire schedule, technical BOQ, and datasheets.
- Scope-driven checklist plus custom checks for each project.
- Missing-information register with impact, requester, due date, and status.
- Action register with priorities, ownership, deadlines, and overdue alerts.
- Local meeting notes with agenda, attendees, discussion, decisions, and related actions.
- Client-comment/review register linked to rooms, luminaire tags, drawings, sources, and revisions.
- Revision lifecycle from Draft through Issued/Superseded, plus a document and deliverables register.
- Locked issued revisions, numbered reissues, revision comparison, manifest hashes, and selectable Folder/ZIP issue packages.
- Luminaire Schedule and quantity-only technical BOQ with manual, AutoCAD CSV, or DIALux CSV input; no prices or commercial totals.
- Preview-first Import Center with Added/Changed/Duplicate decisions and an automatic safety backup before commit.
- Project-specific Datasheet & Image Center with no fixed luminaire brand library.
- Free, on-device **AI Check** for schedule-versus-datasheet comparison, page evidence, missing-information checks, project briefs, and smart file classification. It uses no cloud API, key, subscription, or automatic brand recommendations.
- Excel and PDF lighting outputs saved to the configured folders inside the project structure.
- Sales Directory, salesperson grouping, follow-up visibility, and date-range activity reports in Excel/PDF.
- Preview-first onboarding for existing `000_SCLIYYMMDD_PROJECT` folders, including duplicate detection, editable project details, historical/archive defaults, and safe in-place linking.
- Metadata-only folder indexing for drawings, DIALux files, renders, schedules, technical BOQ, datasheets, and meeting minutes. Indexed files become selectable revision-package sources without copying them.
- Archive, restore, and **Remove from App** controls. Physical project folders and files are never removed by these actions.
- Stable, coordinated pastel identity colors for Sales contacts plus restrained red warnings in both light and dark themes.
- File Center health, OneDrive-path awareness, retained backups, validated restore, light/dark toggle, and customizable dashboard sections.
- Modern Scientechnic project-readiness, meeting-notes, and revision-register PDF reports.
- Global search, project-health score, activity history, reports, and a notification center for blocking information and overdue work.
- Local project contacts and meeting records without an external mail or calendar connection.

## Local data and portability

The portable executable creates a sibling `SCLI Workspace Data` folder containing `scli-workspace.sqlite`. Project files remain in the project root selected by the designer; the app does not force a fixed drive or brand library.

AI Check is a deterministic local analysis engine. Linked PDFs are read only when the designer presses Analyze, values are never changed without explicit checkbox selection and approval, and ambiguous product-family options are marked **Needs Review**. Image-only/scanned PDFs remain available for manual review because this release does not bundle OCR. See `docs/local-intelligence.md`.

Version 3.1 upgrades the existing V3 database in place. Schema upgrades are additive and the application creates a timestamped `SCLI_PRE_V3_1` SQLite backup before adding the folder index to a populated database. Every legacy import and permanent **Remove from App** action also creates a safety backup. Do not remove the sibling `SCLI Workspace Data` folder when replacing or moving the portable executable.

## Development

Prerequisites: Node.js 24.x and pnpm 11.9.x.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173`. Personal mode can be enabled through the environment values documented in `.env.example`; the packaged desktop build sets them automatically.

Production/standalone startup (`pnpm build` then `pnpm start`) uses the same canonical Personal
production bootstrap as the desktop app: with `APP_MODE=standalone`, `WORKSPACE_VARIANT=personal`,
and `NODE_ENV=production` it migrates through the versioned registry to schema v29 and runs under explicit CANONICAL authority, and
it fails closed if the canonical registry is not present. See `docs/standalone-deployment.md`.

Build the Windows portable application:

```powershell
pnpm desktop:portable
```

Build the separate local Team-workflow preview with role-based sign-in:

```powershell
pnpm desktop:team-portable
```

The Team preview stores its local database beside its executable in `SCLI Team Workspace Data`.
It is for reviewing the team workflow on one computer; shared access still requires an HTTPS host
or the documented Microsoft 365 deployment path.

Build the original seeded Team demo used to review the Sales → Line Manager → Lighting Designer
workflow and switch between test roles without creating accounts:

```powershell
pnpm desktop:original-team
```

The Team workspace now includes:

- A role-specific **Today** page and navigation for Sales, Line Manager/Admin, and Lighting Designers.
- Quick project intake with reusable lighting templates and optional technical details.
- One live timer per Lighting Designer, project time categories, editable draft entries, project timesheets, and manager approval/return.
- Quick project views, Lighting Designer filters, locally saved filter views, and a focused notification center.

The seeded original Team demo keeps these features in memory for review and resets when the app
restarts. The separate standalone Team build persists projects, timer events, approvals, and
notifications in its local SQLite database. No Microsoft tenant is required for either local mode.

## Final V4 desktop

Run `pnpm desktop:run` from this source directory. The root build produces the API,
Final V4 renderer, and the preserved legacy renderer; Personal Electron selects V4
by default. `SCT_UI_VARIANT=legacy` is an explicit compatibility override, so remove
that override when opening Final V4. No live workspace migration is required for
an isolated verification profile.

The rendered document exposes `data-sct-build` on its root element. Compare it to
`apps/web-v4/dist/build-info.json` and `/v4/build-info.json` from the running API.
The build metadata records version, build time, and a SHA-256 of the source/build
inputs. `node scripts/electron-v4-validation.mjs <absolute-evidence-directory>`
launches the real desktop entry point with disposable data and validates this
provenance, served asset bytes, persisted workflows, and multiple window sizes. An optional
third argument selects an absolute packaged Electron executable path for the same
isolated verification against the packaged application.

`pnpm test:all` includes `pnpm test:desktop`; Node's native desktop tests run in
their own runner rather than being collected as empty Vitest suites.

## Quality gates

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:all
pnpm test:e2e
pnpm test:e2e:personal
pnpm test:e2e:v4
pnpm build
pnpm teams:validate
pnpm teams:package
```

`pnpm check` runs the complete repository gate. The legacy team/Microsoft 365 adapter and Teams package remain isolated and testable, but they are not used by the personal portable application.

## Repository map

- `apps/web-v4` - approved Final V4 Personal desktop renderer.
- `apps/web` - preserved legacy renderer and optional Team/Microsoft 365 UI.
- `apps/api` - Fastify API, local SQLite stores, folder/export services, and the isolated optional team adapter.
- `desktop` - Electron portable host and secure local PDF/file dialogs.
- `packages/domain` - lighting/project entities, policies, health checks, and reports.
- `packages/contracts` - Zod request and integration trust-boundary schemas.
- `tools/luminaire-exporter` - bundled Schedule/BOQ/Datasheet output application.
- `docs` - architecture, security, testing, and optional team deployment notes.

No live Microsoft tenant connection is claimed by the repository tests. Tenant consent and account-policy validation must be completed against the intended work account.

# Separate local AI trial

The optional local-only Technical Verification trial is documented in [Local AI trial](docs/local-ai-trial.md). Its executable and data directory are separate from stable Portable 3.2.3.
