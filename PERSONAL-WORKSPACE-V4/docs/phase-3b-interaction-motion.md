# Phase 3B shared interaction and motion system

Phase 3B centralizes V4 transient-surface behavior without changing schema v19, API contracts,
domain policy, or Phase 3C visual styling.

## Shared authority

- `useV4Presence` owns `entering`, `open`, and `exiting` lifecycle state. It uses transition or
  animation completion with a computed, bounded fallback of at most 300 ms. A generation guard
  makes rapid close/reopen safe, and zero-duration motion completes without a retained overlay.
- `V4OverlayProvider` owns the single `#v4-overlay-root`, semantic stack order, topmost Escape,
  parent/child modal ownership, background inertness, `aria-hidden`, focus containment and return,
  and reference-counted modal scroll locking with scrollbar compensation.
- `V4ModalLayer`, `V4AnchoredSurface`, `V4InspectorPresence`, and `V4ConfirmDialog` are the shared
  lifecycle shells. Business wording, validation, and mutations remain with their owning surface.
- Floating Workspace, Drawer, Project Edit discard confirmation, common filter selectors, Project
  Status, Generate Output, split-pane Inspectors, Work Session, and the Minimal Sidebar flyout use
  the shared authority. Work Session and Inspectors remain non-modal.

## Dirty-close coordination

`V4DirtyGuardProvider` registers only active dirty surfaces. Routed link navigation delegates to
the surface's existing discard confirmation, `beforeunload` is a last-resort browser safety net,
and Electron window close uses a bounded renderer handshake. Confirmed discard finishes child and
parent exit before navigation or desktop close proceeds.

## Motion and layers

The canonical duration tokens are 140 ms fast, 180 ms standard, and 210 ms workspace. Transient
motion is limited to opacity and transform. Reduced motion makes durations zero, translations zero,
scale one, and easing linear. Semantic layers run from base/sticky through Inspector, popover,
backdrop, modal, nested dialog, and tooltip/toast. Non-modal surfaces stay below modal backdrops.

Phase 3C still owns Project Header, Sidebar, Timer, global card, typography, spacing, color, shadow,
and final status visual polish.

## Validation

Focused component tests cover presence exit/reopen/reduced motion, modal focus and nested Escape,
scroll lock/inertness, Drawer typing/deletion, menu dismissal, Inspector collapse timing, Work
Session layering, dirty navigation, and the desktop bridge contract. The disposable V4 Playwright
acceptance is run with `pnpm test:e2e:v4`; it retains trace and video and attaches computed standard
and reduced-motion tokens.
