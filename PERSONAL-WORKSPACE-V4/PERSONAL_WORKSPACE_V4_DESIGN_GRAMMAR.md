# Personal Workspace V4 — Design Grammar

Structural UX grammar for Personal Workspace V4, owner-approved and frozen. This
locks the page-composition rules, the owning-page rules, the inspector/drawer/
pagination conventions, the icon grammar, the Actions locked target, and the
earlier-page visual cohesion decision.

## Project Summary / Overview Page (PW-V4-F3-P1, owner-locked)

The first real V4 Project product page. Canonical route `/projects/:projectId/summary`
renders inside the existing F2 Project Shell. Owner-locked composition:

```
PROJECT CONTEXT HEADER (F2 shell, preserved)
PROJECT OVERVIEW (page title)
FULL-WIDTH STAGE / WORKFLOW STRIP
ROW 1: Need Your Attention | Project Snapshot
ROW 2: Next Action          | Recent Activity
```

Rules locked for P1:

- **Stage / Workflow strip**: full width, connected rounded nodes; truthfully
  visited nodes Success Green, the one authoritative `project.status` node Info
  Blue, and unvisited normal-flow presentation milestones Neutral Gray. The
  Summary-only sequence uses existing canonical statuses, deduplicates recorded
  history before Current, and never fabricates exceptional states such as On
  Hold, Cancelled, or Archived as mandatory future milestones.
- **Need Your Attention**: bounded preview max 4, deterministic severity ranking
  (blocking -> overdue high -> other overdue -> technical warning -> review
  requiring response -> informational). Local View-all opens a right-side drawer
  ONLY when total > capacity. Empty = compact positive "No items need your
  attention". No fabricated counts.
- **Project Snapshot**: exactly 4 metrics (Luminaires, Current Revision, Due
  Date, Open Actions) from canonical data in one shared inner surface. Normal
  desktop uses four equal horizontal columns with icon -> value -> description,
  plus subtle vertical separators. No dead source links (no route yet).
- **Next Action**: ONE deterministic focus from a pure resolver; NO estimated
  time; NO dead source button when the target route is not implemented; empty =
  positive "No urgent next action".
- **Recent Activity**: latest 4 canonical events, newest first; NO fabricated
  actors; View all omitted (Activity page not yet implemented).
- **Colored icons are MANDATORY.** Every main card header has a distinct Lucide
  icon, Snapshot metrics use their approved category icons, and Recent Activity
  uses deterministic category-specific icons. Tinted containers map through
  `v4-icon-chip--<role>` (never random, never monochrome).
- Read/derived only in P1. No mutations, no Inspector.

## Overview / Composition Pages

- Minimal page-level scrolling where practical.
- Cards in the same visual row are equal-height.
- Bounded collection preview.
- Long narrative bounded.
- **Show all (N)** when the current page owns the complete collection.
- Right-side **drawer** for full local collections.
- **View all / Go to source** when another owning page owns the dataset.
- **No internal scrollbars inside overview cards.**

## Owning / Productivity Pages

- Full canonical dataset responsibility.
- **Search**.
- **Filters**.
- **Pagination** or appropriate feed/list mechanics.
- No unnecessary **Show all** for the primary owned dataset.
- Selected-record **Inspector** where useful.

## Inspector

- Same outer visual height as the owning workspace card.
- Inspector body may internally scroll.
- Primary actions remain reachable.
- Do not use brittle fixed-pixel equal-height hacks.

## Drawer

- Right-side.
- Local full-collection detail.
- Internal drawer scrolling allowed.
- No duplicated mutation path.

## Pagination

- Owning-page datasets use pagination where appropriate.
- **Actions locked target: 6 rows per page.**
- No "See all" / "Show more" for the owning Actions dataset.

## Icons

Structural icons are included during Phase 2 / V4 build. Lock now:

- semantic icon
- location
- structural size
- relationship to text
- container use

Defer to Phase 3:

- final icon colors
- glow
- gradients
- final hover effects
- motion polish

Existing icon dependency **`lucide-react`** should remain preferred.

### Explicit Project Group-Icon Authority (H9)

Every PRIMARY Project navigation group owns an explicit semantic Lucide icon on
the PARENT group in the canonical navigation model. The group icon is NOT
derived, inferred, borrowed, or conditionally substituted from any child icon.

Owner-approved group-icon mapping (locked):

- Overview → `LayoutDashboard`
- Coordination → `Network`
- Technical Workspace → `Lightbulb`
- Deliverables & Issue → `PackageCheck`
- Files & History → `FolderClock`

Presentation rules:

- Minimal Project rail renders the PARENT group icon (one icon per primary
  group). Child destinations live inside the contextual flyout; a child icon is
  never the permanent Minimal parent representation.
- Extended Project group headers use the SAME parent-group icon where an icon
  is displayed, preserving semantic continuity across modes:
  `[Network] Coordination` (Extended) ↔ `[Network]` (Minimal).
- Child items retain their own child-specific icons (destination identity);
  parent icon = group identity, child icon = destination identity.

Invariants:

- First-child icon fallback is PROHIBITED. There is no
  `group.icon ?? group.items[0].icon` behavior.
- A primary group missing an explicit icon is a configuration/programming
  defect, not a silent fallback case.
- A group may legitimately share an icon with one of its children (e.g.
  Technical Workspace and its Luminaires child both use `Lightbulb`); that is
  an explicit shared choice, not a fallback.

## Actions Locked Target

Recorded approved V4 Actions layout:

- **Shared Project Context Header** with Actions title + description.
- **KPI cards:** Open, Due Soon, Overdue, Completed.
- **KPI click** filters the **same** Actions table (no KPI drawer).
- **No selected Action:** main owning table uses full available width.
- **Selected Action:** table narrows + right **Action Inspector** enters.
- Main card and Inspector: **same visual height**.
- Inspector body: internal scroll allowed.
- Main dataset: **pagination only**.
- Default: **6 visible rows**.
- Footer concept: "Showing 1–6 of N actions" + page navigation 1 / 2 / 3.
- Icons: included structurally now; final icon colors/effects Phase 3.

## Earlier Page Visual Cohesion

Owner decision: **Dashboard, Summary, Workflow Timeline** will be rebuilt/refined in
V4 using the same structural icon/design grammar. Do **NOT** preserve their old
presentation merely because their old functionality was previously approved.
Preserve their canonical data/domain behavior; rebuild their presentation cleanly.

## No Premature Generic Design-System Abstraction

F1/F2 should build only truly global primitives. Do **NOT** prebuild generic
`V4DataTable`, `V4Pagination`, `V4Inspector`, `V4Drawer`, `V4BoundedPreviewCard`,
or a large generic form system merely because the Blueprint names those patterns.

Instead: define their contract here (in the Design Grammar), implement the first
concrete version with the first real page consumer, and extract / shared-ize only
after repeated use proves the abstraction.

## Resizable Workspace Grammar (owner-locked)

For suitable owning/productivity pages using the **MAIN WORKSPACE | RIGHT
INSPECTOR** layout, the future V4 interaction must support:

**Core direct splitter behavior:**

- narrow vertical splitter
- direct horizontal drag
- both panes resize continuously/live with pointer movement
- release leaves panes at the reached size
- invisible protected min/max constraints only as necessary for usability

**Approved enhancements:**

- preset split layouts
- compact Reset / Resize menu
- double-click splitter resets to default ratio
- minimal resize toolbar/menu
- soft animation for preset transitions, reset, and inspector open/close
- manual dragging itself stays immediate and unanimated
- final ratios/easing/icon treatment tuned through later UAT / Phase 3

The result must feel like a premium professional desktop IDE/editor splitter,
not a flashy control.

## Lighting Motion Language (owner-locked)

V4 motion identity is architectural-lighting-inspired.

Lock:

- active navigation/tab selection uses one restrained perimeter light sweep
- sweep occurs once on selection
- approximate design intent: ~600–900 ms before Phase-3 tuning
- after sweep, active item settles into calm stable state
- hover may use subtle edge illumination
- no strong continuous looping glow
- no gaming/RGB visual language
- selected rows / inspector reveal / success-warning feedback may reuse the same
  restrained visual language
- Light Mode uses crisper/lower-intensity illumination than Dark Mode
- `prefers-reduced-motion` removes traveling-light motion and shows the stable
  state immediately

**Structural now / polish later:**

F1B/F2/component architecture may expose structural hooks/layers needed later,
but final colors, glow intensity, gradients, easing, and motion polish remain
Phase 3. No lighting-motion effect is implemented in F1B; only the structural
motion / reduced-motion tokens and hooks are provided.

## Final Sidebar Navigation Concept (owner-locked, H2)

The owner approved the following as the final V4 shell navigation direction.

### Extended

- Full navigation hierarchy with readable labels and grouped children.
- Extended GLOBAL shows the official Scientechnic logo LARGE (nearly full inner
  Sidebar width, ~14–16px horizontal padding, aspect ratio preserved) above
  `SCT Workspace`.
- Extended PROJECT shows NO global brand block; it starts with Back to
  Projects + project identity + human-readable canonical Project Status.
- Extended PROJECT groups are separated by a very thin low-contrast divider
  after each complete group (not between every child row).

### Minimal

- NOT a long vertical list of every child page.
- Minimal PROJECT is a compact GROUP-LEVEL icon rail: one icon per primary
  group (Overview, Coordination, Technical Workspace, Deliverables & Issue,
  Files & History), then the fixed utility area (Settings, Work Session,
  Profile). No branding.
- Selecting a project group in Minimal opens a contextual flyout to the RIGHT
  of the 76px rail containing that group's child pages. The flyout is an
  overlay (does not push main content), anchored to the selected group icon,
  with the active child clearly marked. Click is the primary open behavior;
  hover only highlights. Opening another group replaces the previous flyout.
  Clicking outside or pressing Escape closes it. Mode/context switch closes it.
- Minimal GLOBAL remains direct (Dashboard, Projects, Reports) because the
  global dataset is small; no flyout for the three global primary items.

### Floating Sidebar Edge Toggle

- The sidebar mode control is a floating circular protrusion grown from the
  Sidebar's right outer edge, approximately half inside / half outside.
- Icons: ChevronLeft (Extended), ChevronRight (Minimal).
- The visual circle is small and matches the Sidebar surface color; the
  interactive hit area is larger (~32px) for comfortable clicking.
- The toggle moves with the Sidebar edge during the Extended↔Minimal morph and
  is never fixed to the viewport independently.

### Extended ↔ Minimal Container Morph

- A restrained desktop container transform, target ~210ms (acceptable
  200–220ms), professional ease-out cubic-bezier.
- H7-R2 geometry authority: the OUTER `.v4-sidebar-shell` is the SINGLE
  animatable width. `mode` drives only a `--v4-sidebar-width` custom property
  (272px ↔ 76px) that the shell `width` + `transition` read. The inner
  `.v4-sidebar` surface is `width: 100%` and switches NO independent
  flex-basis, so the flex track and the main workspace follow ONE continuously
  interpolated width instead of a mode-sized flex-basis jumping instantly.
- No bounce, spring overshoot, full-sidebar fade, slide-off, or staggered
  navigation cascade.
- Icons remain spatially anchored; labels fade/clip early; the large Global
  logo/brand fades away early; the active wide row morphs into a compact
  minimal icon tile.
- `prefers-reduced-motion` switches modes immediately (no width interpolation,
  no label fade choreography, no traveling sweep).

### Settings Placement

- Settings is NOT part of primary Global navigation.
- Settings lives in the fixed BOTTOM utility zone: Settings / divider /
  Work Session / Profile. It remains accessible in Minimal as icon-only.

### Project Context Bar (stable cross-page geometry)

- The bar keeps the SAME geometry on every project page regardless of whether
  that page has a contextual action button.
- Six metadata cells (Project Code, Project Name, Client, Project Type,
  Design Stage, Due Date) are laid out in a left-aligned grid with thin 1px
  neutral vertical dividers between cells.
- A permanent invisible future-action layout column (~200px) is always
  reserved in geometry. When empty it renders NO placeholder, border, dashed
  rectangle, ghost button, or explanatory copy — it simply appears as normal
  empty space, keeping the six metadata fields in identical positions across
  project pages.
- Project Status is humanized for display (e.g. InProgress → In Progress)
  without mutating the canonical domain value.

## H3 Visual/Structural Hardening Delta (owner-locked)

Narrow corrections from owner visual UAT, preserving all approved H2 behavior.

### Minimal Flyout Trigger Anchoring

- The Minimal Project flyout is anchored vertically to the ACTUAL selected
  group trigger (not a fixed Sidebar-top position).
- Horizontal origin remains immediately to the right of the 76px rail with a
  ~6–8px visual gap.
- The flyout is clamped only when viewport bounds require it (max-height +
  local scroll); the selected trigger remains the visual origin.

### Active Group Auto-Open

- In Extended Project mode, the group containing the active child MUST be open
  (e.g. active child `Packages` forces `Deliverables & Issue` open).
- Groups remain NONEXCLUSIVE: other manually opened groups may stay open.
- Group state remains session-local (no localStorage/sessionStorage).

### Project Context Bar — Distinct Action Track

- The Project Context Header is a two-track grid: `minmax(0, 1fr) 200px`.
- The metadata region (six cells) and the fixed 200px action region are
  distinct sibling tracks; metadata NEVER consumes the action track.
- When empty, the action region renders NO placeholder/border/copy — it is
  simply normal empty space, keeping the six metadata fields in identical
  positions across project pages.

### Metadata Label/Value Alignment

- Every metadata value begins at exactly the same horizontal origin as its
  label (left-aligned; no centering via align-items/justify-content/
  place-items/text-align).
- Thin 1px neutral vertical dividers remain between the six metadata cells.

### Unified Minimal Active-Tile Grammar

- Global Minimal and Project Minimal share the SAME compact active-tile
  grammar: a small restrained rounded tile with tonal fill + accent icon, not
  a full-width row.

### Sidebar Toggle — Top/Nav Seam

- The floating toggle is anchored to the TOP/NAV zone seam (not the logo, not
  the bottom), so it never overlaps the official logo.
- The visible circle is small (~22px), only slightly larger than the Chevron
  icon; the invisible interactive hit area remains ~32px.
- Edge geometry preserved: right outer edge, ~half inside / half outside, moves
  with the Sidebar width, ChevronLeft (Extended) / ChevronRight (Minimal).

### Stable Vertical Chrome Across Modes

- The fixed TOP zone keeps the SAME vertical height across Extended/Minimal for
  the same context (Global and Project may differ), so the toggle seam and nav
  start stay spatially continuous.
- The fixed BOTTOM utility zone (Settings / divider / Work Session / Profile)
  preserves its vertical geometry across modes; labels hide but row heights,
  divider placement, and bottom anchoring remain stable.
- The Sidebar morph changes WIDTH (272px ↔ 76px) only; fixed chrome vertical
  geometry does not jump.

## H10 Sidebar Interaction Contract (owner-locked)

Final interaction/geometry behavior for the Sidebar runtime, consolidating the
H8/H9 runtime corrections.

### Persistent Icon Stability Across Modes

- EVERY persistent Sidebar icon (Global primary: Dashboard / Projects /
  Reports; Project group heads: Overview / Coordination / Technical Workspace /
  Deliverables & Issue / Files & History; bottom utility: Settings / Work
  Session / Profile) lives in ONE shared FIXED icon slot with the same left
  X origin in Extended and Minimal.
- The icon slot has fixed width, `flex-shrink: 0`, stable icon dimensions, and
  stable alignment. No per-mode `justify-content` switch re-centers a
  persistent icon.
- During the 272px ↔ 76px morph, only the rail width, label width/opacity/
  clipping, and expanded-only content visibility materially change. No
  persistent icon jumps, flickers, recenters, or slides horizontally because
  its label disappears.
- Labels may fade / clip / hide; the icon slot does not move.

### Minimal Project Flyout Footprint (Next-Icon Clearance)

- The reserved Minimal subtree footprint for the OPEN group derives from the
  ACTUAL MEASURED rendered flyout height (child stack + padding + radius), plus
  the trigger-to-flyout offset and a small bottom clearance (~6–10px).
- The NEXT primary group icon begins AFTER the complete flyout footprint and
  never sits underneath the open contextual flyout.
- The MAIN WORKSPACE is not pushed: the flyout remains an overlay over the
  workspace; only the Sidebar navigation flow reserves the vertical space.
- Only the currently open group reserves a footprint; switching groups moves
  the footprint to the newly open group.

### Project Minimal Group Hover / Tooltip

- Project Minimal group heads do NOT render a detached tooltip/secondary hover
  surface while the contextual flyout is the interaction. The delayed
  `V4Tooltip` is not applied to Project group triggers; the `aria-label` on
  each trigger remains the mandatory accessible label.
- Restrained in-place hover feedback on the trigger tile is preserved.
- GLOBAL Minimal direct-navigation items may retain their normal tooltip
  behavior (not involved in this defect).

### One-Click Group Switching

- Clicking a DIFFERENT Minimal group while one is open switches the contextual
  flyout atomically in ONE click (open new group immediately, compute new
  anchor, transfer footprint, replace flyout contents).
- Clicking the SAME open group toggles it closed.
- Group triggers are NOT treated as outside clicks: a click/pointerdown on any
  Minimal group trigger is owned by that trigger's group-switch/toggle handler.
- Outside click and Escape continue to close the flyout; mode/context change
  closes it.

## H11 Shared Multi-Branch Tree Parity (owner-locked)

Extended and Minimal Project modes are two presentations of the SAME navigation
tree. The curved tree hierarchy must use the SAME multi-branch concept in both.

### Shared Tree Language

- Extended and Minimal tree connectors belong to ONE visual family, driven by
  shared connector tokens: thin neutral low-contrast line (`--v4-tree-trunk-
width`), restrained opacity (`--v4-tree-opacity`), and rounded caps/joins
  (`--v4-tree-cap`). No bright Minimal connector vs. muted Extended connector.
- Parent group icon is the visual root/origin of its subtree; connectors do not
  draw through the icon glyph.

### Extended

- Preserved H8 soft curved tree: thin vertical trunk + one gently curved branch
  per child, rounded caps/joins, restrained opacity, no harsh 90-degree elbows.

### Minimal

- When a Minimal Project group is OPEN, the reserved subtree footprint carries
  a FULL multi-branch tree: ONE curved branch per flyout child.
- Branch count and order derive from the SAME `group.items` collection as the
  flyout, so `branchCount === group.items.length` and branch ordering matches
  the flyout child ordering exactly (Coordination = 5 branches, Overview = 2,
  etc.).
- Each branch aligns visually with its corresponding flyout child row using the
  shared child-row rhythm; no brittle per-group pixel coordinates, and no
  single-trunk-only connector from the parent icon to the flyout container.
- Only the currently open Minimal group owns a branch set. Switching groups in
  one click transfers the entire branch set (count + order) to the new group;
  closing (same-group toggle, outside click, Escape, mode/context change)
  removes the whole branch set with no orphan trunk or ghost branches.
- The H10 ACTUAL measured flyout footprint remains the authority for the
  reserved vertical space; the multi-branch tree renders INSIDE that footprint.

## H12 Runtime Flyout Geometry + Minimal Identity (owner-locked)

### One Runtime Flyout Geometry Authority

- The open Minimal Project flyout reports ONE unified runtime geometry model to
  the Sidebar: effective (viewport-clamped) flyout top, actual rendered height,
  derived flyout bottom, and actual child-row vertical centers (keyed by child
  id, preserving `group.items` order).
- The reserved subtree footprint and the Minimal branch positions BOTH derive
  from this single authority, so they can never drift from one another.
- Viewport clamping propagates: if the flyout is moved upward by clamping, the
  reported top, footprint, and branch endpoints all follow the ACTUAL clamped
  geometry.

### Footprint / Next-Group Boundary

- The NEXT primary group icon must begin AFTER the actual rendered flyout
  bottom + a restrained clearance (~8px). The reserved footprint formula is
  `max(0, flyoutBottom - triggerBottom) + clearance`, where
  `flyoutBottom = flyoutTop + flyoutHeight`.
- Child-count-only footprint authority is removed. The main Workspace is never
  pushed.

### Multi-Branch Alignment

- One curved branch per actual flyout child, in `group.items` order.
- Each branch is positioned at its ACTUAL measured child-row center (falling
  back to the shared row rhythm only pre-measure).
- The tree trunk begins INWARD from the parent alignment using the shared
  `--v4-tree-inset` token, so it reads nested inside the parent hierarchy
  (not flush against the outer rail edge). Extended and Minimal consume the
  same tree token family.

### Global Minimal Identity

- Global Minimal intentionally retains the fixed Global top-zone height with NO
  brand mark when no approved symbol-only SCT/Scientechnic asset exists
  (recorded as `BRAND_MARK_ASSET_GAP`). No "SCT Workspace" text, no fabricated
  logo, no substituted Lucide icon as company branding.
- Extended Global branding is unchanged.

### Project Minimal Identity Beacon

- Project Minimal shows NO company branding. The fixed Project top-zone area
  hosts a compact Project Identity Beacon: a restrained project icon
  (`FolderKanban`), a short presentation-only display code (leading token
  before the first underscore, e.g. `001_SCT260809_TEST` → `001`), and a small
  canonical Project.status indicator dot with an accessible label
  (`Project status: In Progress`).
- The short code is presentation-only and never mutates canonical Project.code /
  UUID / identity. If no usable leading token can be derived, the beacon shows
  the icon + status without fabricating a number.
- Same-context top-zone heights remain stable across modes (Global 168px,
  Project 142px).

## H13 Flow-Owned Minimal Subtree Lane (owner-locked)

The Minimal open-group subtree is restructured so the SUBTREE ITSELF owns its
vertical flow height — no separate imitation spacer.

### Flow-Owned Subtree Lane

- When a Minimal Project group is open, a subtree lane is rendered directly
  after the parent trigger IN the Sidebar navigation flow.
- The lane owns the REAL vertical height of the child stack. The next primary
  group therefore follows it naturally in normal flow — no measured spacer,
  no child-count × row-height spacer, no manual next-icon offset.
- The child panel is an overlay anchored to the lane; it extends horizontally
  over the Main Workspace but does NOT push the Workspace horizontally or
  vertically.

### Tree Grammar

- One curved branch per child, derived from the same `group.items` authority as
  the child panel; branch count === child count, ordering matches.
- Each subtree row pairs ONE curved branch with ONE child row in the same row
  box, so branch/child alignment is structural (not measured coordinates).
- The tree trunk begins INWARD from the parent alignment using the shared
  `--v4-tree-inset` token (~20–25% inward), matching the approved reference.
  Extended and Minimal consume the same curved tree token family.
- No mechanical straight ticks, harsh L-shapes, or square elbows.

### State

- Only the open group owns a subtree lane. Switching groups in one click
  unmounts the old lane and mounts the new one; closing (same-group toggle,
  outside click, Escape, mode/context change) removes the entire lane with no
  ghost spacer or branches.

### Project Minimal Hierarchy

- Back control renders FIRST / higher in hierarchy, then the Project Identity
  Beacon (icon + short code + status dot). Project top-zone height unchanged.
- Global Minimal brand-mark asset gap remains intentionally unresolved
  (`BRAND_MARK_ASSET_GAP`).

## H14 Tree-Gutter-Only Minimal Subtree (owner-locked)

H14 corrects the Minimal subtree presentation so the rail lane carries TREE
GEOMETRY ONLY and the contextual flyout is the SINGLE Minimal child-label /
child-control presentation. The H13 flow-owned lane architecture is preserved
unchanged.

### Single Child Presentation

- The Minimal flow-owned subtree lane contains TREE GEOMETRY ONLY: a trunk
  continuation plus one curved branch per child. It renders NO child text, NO
  child buttons, NO truncated labels, NO duplicate active-child rows, and NO
  duplicate navigation controls.
- The contextual flyout (`V4MinimalProjectFlyout`) is the ONLY Minimal
  presentation of child label, child destination button, active-child state,
  `aria-current`, and navigation interaction.
- Both the branch set and the flyout child controls derive from the SAME
  `group.items` authority (`PROJECT_NAV_GROUPS`). There is no second
  Minimal-only child array.

### Flow Height

- The lane still owns the REAL vertical flow height through its branch-row
  structure: one branch row per child, each using the shared
  `--v4-subtree-row-height` token. Removing the duplicate rail child labels
  does NOT collapse lane height.
- No separate fake spacer. The lane's top/bottom padding matches the flyout's
  panel padding so the first/last branch row centers align with the first/last
  flyout child row centers.
- The next primary group continues to follow the full subtree lane naturally.

### Shared Row Rhythm

- One shared `--v4-subtree-row-height` token drives BOTH the lane branch rows
  and the flyout child rows, so branch row N center === flyout child row N
  center. No independent vertical magic numbers.

### Tree Character

- The tree uses soft TRUE curved connectors (quadratic quarter-curve) matching
  the approved reference: rounded caps/joins, low-contrast thin line, elegant
  and quiet — no mechanical ticks, no hard `└─`/`├─` square geometry.
- The shared `--v4-tree-inset` token is tuned so the trunk reads visibly nested
  inward beneath the parent icon (not flush with the outer rail edge).
- Extended and Minimal share the same connector curve/inset token family.

### State

- Only the open group owns a subtree lane. Switching groups in one click
  unmounts the old lane and mounts the new one; closing (same-group toggle,
  outside click, Escape, mode/context change) removes the entire lane with no
  ghost branches or ghost height.

## H15 Reference Curved Tree Geometry (owner-locked)

H15 refines the tree-connector GEOMETRY ONLY (curve character, trunk inset,
branch horizontal reach) while preserving the H14 tree-gutter-only Minimal lane
and the flow-owned subtree architecture unchanged.

### Parent Icon Slot Is The Visual Root Authority

- The parent group icon is the visual root of its subtree. The tree trunk is
  positioned from the SHARED `--v4-tree-inset` token (trunk X relative to the
  nav content edge), so it reads nested beneath the parent icon's inner/right
  quarter — NOT flush against the outer rail edge.
- Both Extended and Minimal consume the same `--v4-tree-inset` token, so the
  trunk lands under the parent icon in both modes.

### True Soft Curved Connectors

- Connectors use a TRUE soft quarter-curve (SVG arc / quadratic path) with
  `fill="none"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, a
  restrained ~1px low-contrast stroke, and rounded caps/joins.
- No mechanical ticks, no hard `└─`/`├─` square geometry, no tiny 2–4px curve
  that still reads straight.

### Branch Horizontal Reach

- Each Minimal branch extends from the trunk through the tree gutter to the
  flyout's left gutter boundary, so the branch visually connects to its
  corresponding flyout child row (no disconnected gap). The branch may enter
  the flyout edge/gutter slightly for continuity but never draws over child
  label text.
- Each Extended branch originates from the same trunk family and extends far
  enough toward the child row that the hierarchy feels connected, stopping
  before the child icon/text with restrained spacing.
- One branch per child, derived from the same `group.items` authority; branch
  count === child count, ordering matches.

### Shared Connector Family

- Extended and Minimal consume shared connector tokens for stroke color, stroke
  width, opacity, curve radius, trunk inset, and cap/join grammar — they read
  as ONE tree system, with Minimal being the horizontally compressed
  presentation.
- Connectors stay restrained and theme-safe across Light / Dark / System.

### H14 Architecture Remains Authoritative

- The Minimal rail subtree lane remains TREE-GUTTER-ONLY (no child labels /
  buttons); the contextual flyout is the single Minimal child presentation.
- The flow-owned lane height and next-group clearance are unchanged.

## H4 Sidebar Continuity Delta (owner-locked)

Narrow spatial-continuity behavior discovered through direct comparison with
the approved Sidebar reference, preserving all approved H3 behavior.

### Minimal Subtree Footprint

- When a Minimal Project group is open, the Sidebar navigation flow reserves a
  vertical footprint beneath the group trigger corresponding to that group's
  child subtree.
- H10: the reserved footprint derives from the ACTUAL MEASURED rendered flyout
  footprint (measured flyout height + trigger-to-flyout offset + small bottom
  clearance), NOT a child-count-only approximation. This guarantees the NEXT
  primary group icon begins AFTER the complete rendered flyout and never sits
  underneath it.
- Only the currently open Minimal group reserves its subtree footprint. Opening
  another group closes/replaces the previous flyout, removes its footprint,
  and creates the new group's measured footprint.
- Downstream primary group icons therefore preserve their hierarchy/Y
  continuity instead of collapsing upward under the expanded parent.
- The MAIN WORKSPACE is never pushed: the flyout remains an overlay over the
  workspace; only the Sidebar navigation flow reserves the vertical space.

### Flyout Integration

- The flyout remains an OVERLAY over the main workspace; it does NOT push or
  resize main content. Only the Sidebar navigation flow reserves subtree height.
- The flyout visually integrates with the Sidebar edge: its left edge overlaps
  slightly INTO the rail (~16px) rather than sitting at a detached positive
  external gap. The group icon remains readable as the source.
- The flyout uses a clearly rounded contextual panel (border-radius ~16px),
  restrained surface separation, no heavy border, no gaming glow.
- H3 trigger-based vertical anchoring and viewport clamping are preserved.

### Navigation Authority

- Extended inline children and Minimal flyout children derive from the SAME
  navModel group/children — same labels, same ordering, same active section
  identity, same owning group. Only presentation differs.
- Mode switch preserves active section, owning group, child order, and group
  meaning; the hierarchy compresses horizontally rather than rebuilding
  vertically.

### Active Child Visual Family

- The active child treatment reads as the SAME semantic state in both modes: a
  compact rounded tonal pill (shared `v4-active-child` grammar) in both the
  Extended inline child and the Minimal flyout child.
- Extended inline children use a restrained tree/connector grammar (thin quiet
  vertical branch line, low contrast).

## H5 Flat Structural Surface Grammar (owner-locked)

The application reads as three independent modern FLAT structural planes:

1. SIDEBAR
2. PROJECT CONTEXT / TOP BAR
3. MAIN WORKSPACE

The application must NOT visually read as "card inside card inside card".

### Core Surface Rule

- STRUCTURAL SURFACES = FLAT
- TEMPORARY / CONTEXTUAL OVERLAYS = ELEVATED

Structural surfaces (Sidebar, Project Context / Top Bar, Main Workspace canvas)
use NO outer card radius and NO large floating shadow. They are continuous
full-plane surfaces separated by subtle tonal difference + restrained 1px
low-contrast dividers (never bright cyan borders, heavy framing, or glowing
boundaries).

Contextual/elevated surfaces (Minimal Project flyout, tooltip, popover,
contextual menu, temporary floating overlay) MAY be elevated and rounded.

### Per-Plane Rules

- Sidebar: one continuous full-height flat plane; straight structural edge
  toward Workspace; no outer floating-card appearance; no outer radius; no
  large outer shadow. Internal active-row rounding, child-row rounding, group
  hierarchy, flyout relationship, and toggle protrusion are preserved.
- Project Context / Top Bar: one continuous flat horizontal plane; no outer
  radius around the entire bar; no large floating drop shadow. Separation from
  Workspace via subtle tonal shift and/or a restrained 1px divider. All internal
  metadata structure preserved.
- Main Workspace: one clean uninterrupted flat canvas; no outer rounded
  container; no broad outer shadow. Future cards/tables/inspectors may exist
  INSIDE the Workspace — the Workspace itself is not a card.

### Preserved

- Internal interactive rounding (active nav rows, child rows, buttons, chips,
  status indicators, flyouts, menus, tooltips, future cards/forms) is retained.
- Minimal Project flyout remains rounded (~16px) and elevated.
- The current palette direction is unchanged — this is a surface-composition
  rule, not a color redesign. Light/Dark/System all inherit correctly.

## H6 Official Design System Token Authority (owner-locked)

The owner locked the final Personal Workspace V4 Design System. The F2 shell
tokens are aligned to it. These override the older generic bright-blue /
bright-cyan visual authority.

### Brand Layer (official four-color palette)

- Deep Navy: `#1F213F` — primary dark brand identity / deep structural family.
- Brand Teal / Company Cyan: `#479BA2` — PRIMARY brand / interaction accent.
- Secondary Purple: `#49406F` — restrained secondary brand accent.
- Warm Gold: `#F6C96B` — brand highlight / special emphasis.

Brand Teal (`#479BA2`) is the primary SCT brand/interaction accent, used for
selected/active emphasis, primary interaction identity, key links, focus/active
accents, and brand-accented controls.

Warm Gold (`#F6C96B`) is a BRAND highlight, NOT the semantic Warning authority.

### Neutral UI Layer (locked Light reference)

- White: `#FFFFFF`
- Soft Surface: `#F7F8FA`
- Border Gray: `#E5E7EB`
- Primary Text: `#0F172A`
- Secondary Text: `#475569`
- Neutral / Slate: `#64748B`

Theme-safe derived equivalents are used in Dark Mode (deep navy/slate surfaces
compatible with `#1F213F`), never flattening Dark into Light neutral values.

### Semantic Layer (canonical meanings)

- Success: `#22C55E`
- Warning: `#F59E0B`
- Danger: `#EF4444`
- Info: `#3B82F6`

Brand identity and semantic meaning are SEPARATE layers. Warning is not replaced
by Brand Gold; Info is not replaced by Brand Teal.

### Color-System Architecture

Three conceptual layers: BRAND + NEUTRAL UI + SEMANTIC. Prefer the existing V4
CSS token bridge (`apps/web-v4/src/styles-v4.css`) mapped from this canonical
authority; do not build a competing theme system. `packages/theme` remains the
theme-STATE (preference / reduced-motion) authority, not the color palette.

### Derived States

Base official colors are exact root/reference tokens. Hover, selected
backgrounds, active tiles, focus surfaces, chips, flyout active-child
backgrounds, and understated brand emphasis use derived restrained tint/opacity
of the official hues — never an unrelated hue. Accessibility/contrast is
preserved for text-bearing controls.

### Flat Shell / Elevated Overlay

The H5 rule remains authoritative: structural surfaces (Sidebar / Top Bar /
Workspace) are FLAT; the Minimal Project flyout and temporary contextual
overlays remain rounded/elevated.

### Typography / Iconography Compatibility

The locked V4 typography scale and Lucide-style ~2px-stroke outline iconography
are already compatible with the current F2 shell; no broad rewrite was required.
