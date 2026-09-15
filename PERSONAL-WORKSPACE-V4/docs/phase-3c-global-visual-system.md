# Phase 3C global visual system

Phase 3C establishes one V4-owned visual language across the global shell,
project shell, workspaces, inspectors, drawers, tables, forms, transient UI and
page states. It is a presentation-only change: API contracts, domain behavior,
schema v19, persistence and desktop behavior are unchanged.

## Authority and import order

The V4 entry point loads style authority in this deterministic order:

1. `v4-tokens.css` — theme-neutral semantic contracts and Light/Dark values.
2. `styles-v4.css` — existing page-specific composition and compatibility rules.
3. `v4-primitives.css` — shared control, row, state and workspace convergence.
4. `v4-shell.css` — global and project-shell surface hierarchy.

New V4 work should consume semantic variables and shared primitives before adding
page-local declarations. Page-local CSS remains appropriate for unique layout;
it must not redefine global color, type, focus, motion or control contracts.

## Foundations

- Light and Dark themes share the same surface ladder, type hierarchy, borders,
  focus grammar, density scales and semantic states.
- The user accent remains an identity/highlight choice. Primary actions use a
  separately derived action token so controls retain readable contrast.
- Compact, standard and rich row densities are explicit. Captions never fall
  below 10 px, and normal operational copy uses the body scale.
- Icons use the shared 14/16/18/20/24 px scale and Lucide semantics.
- Status is communicated by text and icon/shape as well as color.

## Shared primitives

The common component layer provides buttons, fields, rows, toolbars, inspectors,
state panels and verification states. Existing page DOM and behavior are retained
where a CSS convergence layer is safer; new work should adopt the component APIs
directly. Confirmation dialogs, floating edit workspaces and Work Session controls
now consume the same button language.

## Motion contract

Phase 3B motion timing and lifecycle are locked. Phase 3C retains exactly 140 ms,
180 ms and 210 ms durations, the established easing curves, reduced-motion
behavior, focus restoration and presence lifecycles. Visual polish does not add
new animation systems.

## Acceptance matrix

The Playwright V4 visual-system scenario captures 12 states spanning Light/Dark,
1080/1440 widths, Extended/Minimal navigation, the running Work Session strip,
menus, inspectors, drawers, full-edit and dirty-confirmation states. Every state
also asserts that the document does not overflow horizontally. The scenario uses
only the disposable mock-mode E2E server; Golden and live Personal data are not
read or mutated.
