# SLC PORTABLE PERSONAL ROADMAP V5 — LOCKED

> **Status:** OWNER-APPROVED forward roadmap. **LOCKED.**
> Do not rewrite approved decisions. Changes require an explicit documented exception approved
> by the repository owner.
>
> This roadmap supersedes prior Personal/portable roadmap versions for **forward planning only**.
> Prior roadmap documents (`docs/master-roadmap-v3.md`, `docs/roadmap-v3.3.md`) remain as
> **historical** references and are not deleted.

---

## PHASE 2 — REMAINING

Sequence (default **SEQUENTIAL** — architectural independence does **not** authorize multiple
writers in the same worktree):

1. **P2-TIMER-FND-01** — True Pause / Resume Engine, Schema **v5**, **MUST NOW**.
2. **Resume P2-UX-02** — Work Session shell:
   - compact anchor
   - upward tray
   - persistent shell-level Top Glass Tracking Bar
   - Minimal running indicator
   - paused semantics
3. **P2-UX-03** — Dashboard Command Center structure.
4. **P2-UX-04A** — Summary + Stage Rail + Workflow Timeline.
5. **P2-UX-04B** — Scope + Actions + Meetings + Comments + Contacts.
6. **P2-UX-04C** — Luminaires + Datasheets & Images + Technical Check + Luminaire Schedule + Technical BOQ.
7. **P2-UX-04D** — Revisions & Outputs + Submission Cycle + Issue History + Issue Packages.
8. **P2-UX-04E** — Project Files + Document Register + Activity History.
9. Targeted real Desktop UAT.
10. **P2.10** Final Reality Gate.
11. Phase 2 closeout.

### P2-UX-02 LOCKED TIMER UX

**Compact Work Session anchor** above Profile.

Click opens an **upward lightweight tray**.

**RUNNING:**

```
Tracking
Project
Started
Elapsed
Open Project
Pause
Stop
```

**PAUSED:**

```
Paused
(same WorkSession)
frozen elapsed
Open Project
Resume
Stop
```

**Persistent Top Tracking Bar:**

- ONE shell-level strip across **MAIN WORKSPACE only**.
- Persists across routes and viewed Projects.
- Navigation alone never changes the active WorkSession Project.

**RUNNING bar:**

- Red recording indicator + Tracking + Project + elapsed + Open / Pause / Stop.

**PAUSED bar:**

- No pulsing red recording semantic + Paused + frozen duration + Open / Resume / Stop.

**Minimal RUNNING:**

- Small red recording dot above Profile.
- Gentle pulse 1.5–2 s.
- Reduced motion: steady.

**Minimal PAUSED:**

- No false recording pulse.

### P2-UX-03 DASHBOARD

Approved structure:

```
Header
Compact KPI Snapshot
Need Your Attention
Project Pipeline
Active Projects (dense table/list)
Upcoming
Recent Activity
Technical Readiness — only when real data supports it
```

No fake metrics / progress.

### P2-UX-04 PROJECT WORKSPACE

Approved high-fidelity owner-supplied screens are product targets.

**Compact project metadata header:**

```
Project Code
Project Name
Client
Project Type
Stage
Due Date
Edit Project
overflow
```

No repeated oversized hero dominating technical pages.

**Pages / patterns:**

- **Summary:** Stage Rail + Attention + Snapshot + Next Action + Recent Activity.
- **Workflow:** chronological journey + contextual details.
- **Scope:** side-by-side Scope / Deliverables / Requirements / Exclusions.
- **Actions:** dense list + inspector.
- **Meetings:** Upcoming / Past + inspector.
- **Comments:** thread / feed + linked context + inspector.
- **Contacts:** role groups.
- **Luminaires:** maximum-width dense table + right inspector.
- **Datasheets & Images:** completion / missing workspace.
- **Technical Check:** Critical / Warnings / Ready + deterministic issues + inspector.
- **Schedule:** full-width live technical table + toolbar + temporary config drawer.
- **Technical BOQ:** separate full-width, strictly non-priced.
- **Revisions:** grouped / collapsible immutable history.
- **Issue Package:** built FROM selected Revision.
- **Files / Register / Activity:** real traceability pages.

**Primary CTA rule:** one dominant action per page where practical.

**Branded in-app dialogs:** no generic Windows-looking app confirms / errors.

### VISUAL LANGUAGE

- Primary reference: **Scientechnic SLC UI Concept — Version 1**.
- Owner-approved high-fidelity images are target references.
- Deep navy / near-black sidebar.
- Light technical workspace white / soft gray.
- Dark graphite / navy.
- Primary cyan ~`#04B4CC`.
- Professional outline icon family; consistent strokes; functional icons.
- Labels Extended; Tooltips Minimal.
- **Final exact tokens: Phase 3.**

---

## PHASE 3 — LOCKED DIRECTION

**No navigation redesign.**

Final:

- design tokens
- Light/Dark fidelity
- typography / icons / spacing
- interactions / states
- final Dashboard
- final Projects
- final Project Workspace
- final Stage Rail
- Luminaire Studio
- P-07 Keyboard / Bulk Luminaire Editing
- Technical Modern Schedule
- Classic Grid Pro Full
- Consultant
- Compact
- Presentation Schedule
- Technical BOQ
- Classic Grid Pro BOQ
- template UX
- global defaults + project overrides
- configurable optional sections
- WYSIWYG / live preview
- image standardization
- Ready-to-Issue presentation
- Datasheet Registry / versioning implementation

**P-11:** Phase 3 presentation / workflow. **Do NOT move into Phase 2.**

P-06 may be leveraged if appropriate, but approved roadmap placement remains **future** unless
explicitly resequenced by the owner.

---

## PHASE 4

Local-first technical intelligence.

- Native PDF text first.
- OCR fallback.
- **Evidence → Confidence → User Review → Accept.**
- Never silently overwrite curated data.
- Deterministic Quality Engine.
- P-11 deeper technical checks.

---

## PHASE 5

Master Luminaire Library, Smart Import 2.0, AutoCAD synchronization, Revision Comparison, local
FTS, Create Similar Project, verified user-facing local / OneDrive backup snapshots.

**Approved in Phase 5:**

- P-04 Revision Impact Summary
- P-05 Comment → Action → Revision
- P-06 Meeting → Action
- P-10 AutoCAD / DIALux Source Freshness
- P-12 Project Closeout Pack

Make clear: **foundation-ready does NOT mean implemented.**

---

## PHASE 6

Release hardening only. **No new feature expansion.**

Startup, packaging, migration chain, old DB upgrade, recovery, legacy coexistence, user
backup/restore hardening, output/package integrity, portability, performance, error recovery,
install / portable, release report.

---

## MIGRATION FORECAST

**LOCKED next migration:**

- **v5:** WorkSession Pause / Resume.

**POST-v5 candidates (version numbers NOT locked):**

- Datasheet Registry.
- P-10 Source Freshness.
- P-05 comment relation.

**Do NOT lock future version numbers v6 / v7 / v8 yet.** Version numbers are assigned only when
the implementation slice is ready. Unrelated migrations remain separate by default.

---

## APPROVED PRODUCTIVITY PROPOSALS

**APPROVED:** P-04, P-05, P-06, P-07, P-10, P-11, P-12.

Do **not** mark other prior suggestions approved.
