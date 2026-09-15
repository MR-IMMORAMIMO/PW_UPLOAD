# Personal Workspace V4 — Constitution

Canonical governance for the Personal Workspace V4 clean renderer/product-surface
rebuild. This document locks the program identity, the preservation boundary, the
presentation-rebuild scope, the hard isolation rule, API authority, review
governance, and owner authority for V4.

## Program Identity

Personal Workspace V4 is a **clean renderer / product-surface rebuild** over the
**existing proven canonical core**. It is not a from-scratch product and not an
automatic scope expansion. It re-expresses the already-approved product with a
clean presentation layer while preserving the canonical domain, data, and API
authority unchanged.

V4 strategy = CLEAN-SLATE PRESENTATION + PROVEN CANONICAL CORE PRESERVATION.
The stable legacy UI remains available as a fallback during V4 development.

## Core Preservation

V4 preserves, unchanged and as the single source of truth:

- the **database**
- **schema v5**
- **migrations** (the production migration registry chain 0→1→2→3→4→5)
- **domain contracts** (`packages/domain`, `packages/contracts`)
- **stores / services** (canonical stores, personal store, operations store)
- **API authorities** (the Fastify `/api` layer and its authorization policies)
- **import authority** (legacy-project import compatibility)
- **Project UUID identity** (never a display name as an identity key)
- **luminaire / tag authority** (uppercase canonical tag, case-insensitive uniqueness)
- **revision authority** (canonical output registry allocation, issued locking)
- **outputs / templates** (canonical output registry and template versions)
- **Work Sessions** (Personal WorkSession lifecycle incl. Pause/Resume)
- **legacy-project compatibility**
- **Golden UAT capability** (deterministic canonical seeding)

V4 may depend on shared non-visual packages, canonical domain/contracts, the shared
API client, query foundations, utilities, and desktop-bridge abstractions. It does
NOT duplicate, copy, or re-implement any preserved core authority.

## Presentation Rebuild

V4 rebuilds cleanly, with no debt to legacy presentation internals:

- renderer
- app shell
- sidebar
- route presentation
- page composition
- design system (V4 owns its own visual token / style surface)
- icon grammar (structural icons now; final colors/effects Phase 3)
- table / inspector / drawer / pagination presentation
- responsive presentation
- loading / empty / error / permission-denied states

## Hard Isolation Rule

`apps/web-v4` MUST NOT import presentation code from `apps/web`.

Forbidden: `AppLayout`, contextual-sidebar, project-operations,
personal-project-details, legacy screens, legacy `styles.css`, and old page
compositions.

`apps/web-v4` may depend only on shared non-visual packages, canonical
domain/contracts, the shared API client, query foundations, utilities, and desktop
bridge abstractions.

## API Authority

V4 uses the **same canonical API authority** as legacy:

- **No direct DB access** from the renderer.
- **No duplicate persistence.**
- **No synchronization layer.**
- **No copied V4 database.**

Both UIs share the same API, the same DB, and the same project data. No sync
process exists or is introduced.

## Review Governance

The one-time architecture / capability / design freeze for V4 is complete
(APPROVED_WITH_NON_BLOCKING_NOTES). After F1, the normal page workflow is:

implementation → focused automated validation → focused OpenCode contract review →
one complete owner UAT pack → commit.

Broad audits are allowed only when:

- canonical authority changes
- a true domain gap appears
- migration work is needed
- identity / concurrency / recovery is involved
- implementation materially contradicts the Blueprint

## Owner Authority

No new product capability is silently added merely because V4 is a rebuild. V4 is a
clean implementation of the approved product, not automatic scope expansion. Any
enrichment (e.g. Actions Category/Notes/linking, Comments threading/origin,
Datasheets registry, Submissions/Issue History/Register authority) requires a
future owner decision before any schema/domain expansion, and must not be
implemented automatically.

## Document Precedence

V4 decision precedence (highest first):

1. **Live repository reality**
2. `PERSONAL_WORKSPACE_V4_CONSTITUTION.md`
3. `PERSONAL_WORKSPACE_V4_BLUEPRINT.md`
4. `PERSONAL_WORKSPACE_V4_CAPABILITY_MATRIX.md`
5. `PERSONAL_WORKSPACE_V4_DESIGN_GRAMMAR.md`
6. `PERSONAL_WORKSPACE_V4_CURRENT_STATE.md`
7. Legacy Personal Workspace documentation — historical context only

If a V4 document conflicts with live repository reality, **repository reality wins**
and the discrepancy must be reported.
