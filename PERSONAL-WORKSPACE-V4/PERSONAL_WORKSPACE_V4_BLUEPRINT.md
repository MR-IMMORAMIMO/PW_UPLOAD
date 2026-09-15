# Personal Workspace V4 — Architecture Blueprint

Canonical architecture for the Personal Workspace V4 clean renderer rebuild. This
document locks the approved architecture, the shared API client contract, theme
mechanics, the migration route namespace, the final canonical routes, the parallel
static host, the desktop launch variant, the route / page ownership map, and the
build sequence.

## Architecture

### NEW_RENDERER_PACKAGE

Target package: **`apps/web-v4`**.

`apps/web-v4` **cannot import `apps/web` presentation code** (see the Constitution's
Hard Isolation Rule). It may depend only on shared non-visual packages, canonical
domain/contracts, the shared API client, query foundations, utilities, and desktop
bridge abstractions.

### Shared API Client

The current canonical client at **`apps/web/src/api.ts`** will be extracted in **F1**
into a shared non-visual package, recommended: **`packages/api-client`**.

The shared API client must use an injected environment/auth seam. Lock this
load-bearing contract (equivalent naming is allowed during F1 only if semantics
remain identical):

```ts
configure({
  getAuthToken,
  storage,
  onSessionExpired,
});
```

`packages/api-client` MUST NOT:

- import `@microsoft/teams-js`
- import `apps/web`
- directly depend on legacy React components
- hard-code `localStorage` / `sessionStorage` / window session events as its only
  environment mechanism

Legacy `apps/web` will use a compatibility facade / re-export that wires its own
Teams/local environment bindings.

### Theme

Share only **non-visual theme mechanics**. V4 owns its own visual token / style
surface. V4 MUST NEVER import legacy `styles.css`.

### Routes During Migration

Temporary migration namespace: **`/v4`** (e.g. `/v4/projects/:id/actions`). This
namespace is **TEMPORARY**.

### Final Routes After Cutover

V4 owns canonical routes **without `/v4`**:

- `/`
- `/projects`
- `/projects/:id/summary`
- `/projects/:id/workflow`
- `/projects/:id/scope`
- `/projects/:id/actions`

Do not design permanent product architecture around `/v4`.

### Parallel Static Host

**F1** must add conditional V4 static registration:

- The V4 dist is available under the temporary `/v4` prefix **only when the V4 build
  exists**.
- The V4 route registration must occur **before the legacy catch-all fallback**.
- Legacy UI remains the default un-prefixed UI during parallel development.

### Desktop Launch

**F1** must extend the existing workspace/variant launch mechanism with a V4 UI
selector, conceptually **`SCT_UI_VARIANT=v4`** (exact naming may be chosen in F1).

- Legacy remains default.
- Both UIs use the **same API, same DB, same project data**. No sync process.
- Rollback: launch the legacy UI again.

## Route / Page Ownership Map

Each V4 page has one clear owner. There is **no legacy combined overview route**.
Cross-page rule: if another page owns the full canonical dataset, use
**View all / Go to source** — do not duplicate authority.

### Global

| Page      | Owner     |
| --------- | --------- |
| Dashboard | V4 Global |
| Projects  | V4 Global |
| Reports   | V4 Global |
| Settings  | V4 Global |

### Project Overview

| Page              | Owner               |
| ----------------- | ------------------- |
| Summary           | V4 Project Overview |
| Workflow Timeline | V4 Project Overview |

### Coordination

| Page             | Owner           |
| ---------------- | --------------- |
| Scope & Services | V4 Coordination |
| Actions          | V4 Coordination |
| Meetings         | V4 Coordination |
| Comments         | V4 Coordination |
| Contacts         | V4 Coordination |

### Technical

| Page                | Owner        |
| ------------------- | ------------ |
| Luminaires          | V4 Technical |
| Datasheets & Images | V4 Technical |
| Technical Check     | V4 Technical |
| Lighting Schedule   | V4 Technical |
| Technical BOQ       | V4 Technical |

### Deliverables / Issue

| Page          | Owner                   |
| ------------- | ----------------------- |
| Revisions     | V4 Deliverables / Issue |
| Packages      | V4 Deliverables / Issue |
| Submissions   | V4 Deliverables / Issue |
| Issue History | V4 Deliverables / Issue |

### Files / History

| Page     | Owner              |
| -------- | ------------------ |
| Files    | V4 Files / History |
| Register | V4 Files / History |
| Activity | V4 Files / History |

## Build Sequence

- **F0** — Baseline + worktree + canonical V4 freeze documents.
- **F1** — Renderer foundation: `apps/web-v4` package, shared API client extraction,
  route/query foundation, theme mechanics / structural tokens, conditional `/v4`
  static-host support, desktop V4 launch selector.
- **F2** — Global/project shell: `V4AppShell`, `V4Sidebar`,
  `V4ProjectContextHeader`, `V4PageHeader`, fundamental loading/empty/error/icon/
  status primitives.

Then page implementation against this locked Blueprint.

Recommended page sequence:

Dashboard → Projects → Settings → Summary → Workflow Timeline → Scope & Services →
Actions → Meetings → Comments → Contacts → Technical pages → Deliverables / Issue →
Files / History → Cutover.

The exact later ordering may change only because of an evidenced dependency, not
because legacy UI architecture forces it.
