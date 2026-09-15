# Historical SCLI Design Project Tracker Implementation Plan

> This records the original Teams-first plan. The implemented product is now standalone-first, lighting-specific, collaborative, and dual-theme. Current behavior and operating instructions are authoritative in `README.md`, `docs/architecture.md`, and `docs/standalone-deployment.md`.

## Document Status

- Prepared: 2026-08-01
- Repository state at preparation: empty Git repository, no commits, no existing application files
- Current status: implementation complete; final local quality gates recorded on 2026-08-01
- Execution model: the repository owner authorized autonomous completion through build, test, packaging, documentation, and review

## Outcome

Deliver a polished, secure Microsoft Teams personal app that supports the complete Sales → Line Manager → Designer project workflow. The application will run locally with deterministic mock data and will expose production Microsoft 365 integrations through replaceable server-side adapters.

## Verified Platform Direction

The following choices were checked against current Microsoft documentation on 2026-08-01:

- Use Microsoft 365 Agents Toolkit and its `atk` CLI for app manifest validation, packaging, environment handling, provisioning, and deployment workflows.
- Do not build new code on TeamsFx SDK; Microsoft documents it as deprecated for modern Teams app scenarios.
- Build the product as a web-based Teams personal tab using the current Teams JavaScript SDK.
- Initialize the host with `app.initialize()`, obtain a Teams SSO token in production, and validate it on the API server.
- Do not trust Teams context as identity evidence.
- Use Microsoft Graph `v1.0` for SharePoint Lists and document-library links.
- Use SharePoint list-item ETags and `If-Match` to reject stale sequence updates with `412 Precondition Failed`, then retry safely.
- Implement optional proactive notifications through a bot-backed adapter. The app/bot must be installed for the recipient or relevant context before proactive delivery is possible.

Official references:

- Microsoft 365 Agents Toolkit overview: https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/overview-agents-toolkit
- Agents Toolkit fundamentals and TeamsFx status: https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/agents-toolkit-fundamentals
- Agents Toolkit CLI: https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/microsoft-365-agents-toolkit-cli
- Teams tabs: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs
- Teams tab context security note: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context
- Teams tab SSO: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview
- SSO implementation: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-code
- SharePoint through Microsoft Graph: https://learn.microsoft.com/en-us/graph/api/resources/sharepoint?view=graph-rest-1.0
- SharePoint list item resource: https://learn.microsoft.com/en-us/graph/api/resources/listitem?view=graph-rest-1.0
- Microsoft Graph permissions: https://learn.microsoft.com/en-us/graph/permissions-reference
- Teams proactive messaging: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages

## Architecture Decision

### Deployment shape

Use one repository and one deployable Node application:

- Vite builds the React SPA.
- Fastify exposes `/api/*` and serves the built SPA in production.
- Local development runs Vite and Fastify separately, with a same-origin `/api` proxy.
- The Teams personal tab points to the deployed HTTPS web origin.

This keeps SSO, CORS, cookies/headers, and deployment simpler while preserving strict frontend/backend package boundaries.

### Workspace layout

```text
PROJECTMANGEMENT/
├─ apps/
│  ├─ web/                 React, Vite, TeamsJS, routes, screens, UI
│  └─ api/                 Fastify API, auth middleware, adapters, hosting
├─ packages/
│  ├─ contracts/           Zod API contracts and typed error envelopes
│  ├─ domain/              Models, policies, services, transitions, reports
│  ├─ config/              Typed environment and shared tool configuration
│  └─ test-data/           Seed builders and deterministic scenarios
├─ appPackage/             Manifest template, icons, packaged ZIP output
├─ infra/                  Agents Toolkit and SharePoint provisioning assets
├─ docs/                   Durable project documentation
├─ tests/e2e/              Playwright mock-mode journeys
├─ .github/workflows/      CI quality gates
├─ AGENTS.md
├─ package.json
├─ pnpm-workspace.yaml
└─ pnpm-lock.yaml
```

### Core technology choices

| Concern               | Planned choice                              | Reason                                                                                |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Package manager       | pnpm 11                                     | Available in the Codex runtime; efficient workspaces and strict dependency boundaries |
| Runtime               | Node.js 24                                  | Available local runtime; verify package compatibility during scaffolding              |
| Web                   | React + TypeScript + Vite                   | Fast local workflow and suitable for a Teams tab SPA                                  |
| Routing               | React Router                                | Typed route helpers around standard route/query behavior                              |
| Server state          | TanStack Query                              | Caching, invalidation, optimistic updates, and rollback                               |
| Forms                 | React Hook Form + Zod                       | Typed validation shared with API contracts                                            |
| Accessible primitives | Semantic React/HTML controls                | Minimal dependencies, native keyboard behavior, and fully customized product styling  |
| Animation             | Motion + CSS transitions                    | Small, interruptible, reduced-motion-aware transitions                                |
| API                   | Fastify + TypeScript                        | Lightweight API, schema hooks, structured logging, and testability                    |
| Validation            | Zod                                         | Shared runtime validation across UI, API, config, and adapters                        |
| Tests                 | Vitest + React Testing Library + Playwright | Unit, component, and real browser coverage in mock mode                               |
| Microsoft host        | Teams JavaScript SDK                        | Host initialization, context, theme, navigation, and SSO                              |
| Production data       | Microsoft Graph v1.0 + SharePoint Lists     | Required V1 Microsoft 365 persistence model                                           |

Exact dependency versions will be selected from current stable releases during scaffolding, then pinned by `pnpm-lock.yaml`. No package will be selected solely because it is globally installed.

## Runtime Modes

### Mock mode

- Enabled explicitly by `APP_MODE=mock`.
- Uses deterministic in-memory repositories seeded with at least 2 Sales users, 3 Designers, 1 Line Manager, 1 Admin, and 15 projects.
- Exposes a development-only user switcher.
- Provides in-app notifications.
- Uses an atomic in-process project-sequence service.
- Provides a test-only reset endpoint guarded by environment and process checks.
- Requires no tenant, secrets, tunneling, or external network.

### Microsoft 365 mode

- Enabled explicitly by `APP_MODE=m365`.
- Requires a valid server-side Entra/Teams authentication configuration.
- Uses `SharePointDataProvider` through Microsoft Graph v1.0.
- Resolves application roles from `SCLI_AppUsers`, not from the client or Teams context.
- Uses in-app notifications and optionally a feature-flagged Teams notification adapter.
- Fails closed with a clear configuration response when required settings are missing.
- Does not fall back to mock identity or mock data after production mode starts.

## Domain Design

The domain package will own:

- Typed enums for roles, statuses, priority, complexity, and availability.
- Project, user, comment, activity, notification, settings, and sequence models.
- Explicit allowed-status-transition map.
- Role and record-level authorization policies.
- Project code sanitization and maximum-length rules.
- Workload and availability calculations.
- Report aggregations.
- Project creation, assignment, status change, revision, completion, reopen, and cancellation services.
- Ports for clock, ID generator, repositories, sequence allocator, notifications, and audit append.

Domain services receive an authenticated actor from server middleware. They never accept a client-asserted role as authority.

## API Design

The initial routes follow the master requirements:

- Identity/users: `/api/me`, `/api/users`, `/api/users/sales`, `/api/designers/workload`
- Projects: `/api/projects`, `/api/projects/:id`, assignment, status, comments, and activity subroutes
- Reports: summary and CSV export
- Notifications: list and mark-read
- Admin: users, capacities, project types, settings, and feature flags
- Health/configuration: liveness, readiness, and safe integration-status endpoints

All routes will provide:

- Shared Zod input/output contracts.
- Correlation IDs.
- A consistent typed error envelope.
- Server authorization and record filtering.
- Body and query limits.
- No production stack traces.

## Authentication and Microsoft Graph

Production request flow:

1. React initializes TeamsJS.
2. React requests a Teams SSO token only when production authentication is needed.
3. React sends the token to the API in the authorization header.
4. The API validates signature, issuer, audience, lifetime, and required claims.
5. The API resolves `entraObjectId` to an active `AppUser` and obtains the stored role.
6. Domain policies authorize the query or mutation.
7. The server-side Graph credential accesses the dedicated SharePoint site.

Preferred Graph credential order:

1. Azure managed identity in supported hosting.
2. Certificate-based application credential.
3. Client secret only when required by company operations, stored outside source control in an approved secret store.

Baseline Graph permission target is application `Sites.Selected`, followed by an explicit grant to the dedicated project-tracker site. Directory-wide people search is not required for V1 because the people picker searches active configured `AppUser` records. Optional profile-photo or directory-enrichment permissions will be separately documented and feature-flagged.

## Persistence and Project Code Concurrency

### Mock provider

- Repository operations use cloned data to prevent accidental mutation.
- A mutex/serialized critical section increments the sequence and creates the project.
- Tests issue concurrent project creation requests and assert uniqueness.

### SharePoint provider

- Keep one sequence item for the project-code counter.
- Read its value and ETag.
- Calculate the next number.
- Patch using `If-Match: <etag>`.
- On `412`, add bounded jitter and retry from a fresh read.
- After a successful reservation, create the project using an idempotency key recorded in a dedicated column.
- Treat a consumed-but-unused sequence as an acceptable gap; never reuse it.

SharePoint has no cross-list transaction for project, activity, and notification items. The production workflow will therefore be idempotent and will record/retry incomplete side effects. Documentation will not describe this as a cross-list atomic transaction. The uniqueness guarantee applies to sequence allocation and project code.

## UX Implementation Direction

- Build one responsive application shell with a role-filtered sidebar and top bar.
- Use CSS custom properties for the approved dark tokens.
- Create reusable primitives for cards, badges, progress, skeletons, empty states, errors, confirmation dialogs, and drawers.
- Keep interaction motion between 180–350 ms and remove non-essential motion under `prefers-reduced-motion`.
- Use board, list, and card project views with URL-backed filters.
- Add keyboard-accessible status controls alongside drag-and-drop.
- Provide data tables below or adjacent to accessible charts.
- Test at Teams desktop widths, regular browser widths, tablet, and narrow mobile widths.

## Delivery Phases

### Phase 0 — Repository and environment inspection — Complete

- Confirmed the repository is empty.
- Confirmed Git is initialized with no commits.
- Confirmed no existing `AGENTS.md` or user code.
- Located bundled Node.js 24.14.0 and pnpm 11.9.0.

### Phase 1 — Platform verification and planning — Complete

Deliverables:

- `docs/implementation-plan.md`
- `docs/assumptions.md`
- `AGENTS.md`

Exit criteria:

- Platform choices cite current official Microsoft guidance.
- Architecture, boundaries, risks, and staged delivery are explicit.
- No application dependencies or source code have been created.

### Phase 2 — Workspace scaffold and developer tooling — Complete

Planned changes:

- Create pnpm workspace, web/API/package skeletons, strict TypeScript configuration, formatting, linting, and baseline test configuration.
- Add `.gitignore`, `.env.example`, script entry points, CI skeleton, and initial README commands.
- Add a minimal health endpoint and application shell only to prove the toolchain.
- Add Agents Toolkit manifest/config skeleton without tenant values.

Exit criteria:

- Install, format, lint, typecheck, unit-test smoke, and production build pass.
- Mock web and API start locally with documented commands.
- No feature workflow is claimed complete.

### Phase 3 — Domain, authorization, validation, and mock data — Complete

Planned changes:

- Implement models, enums, transition map, authorization policies, project-code service, workload calculations, report calculations, and Zod contracts.
- Implement mock repositories, atomic sequence service, audit append, notification service, and deterministic seed data.
- Add exhaustive unit tests for the master-prompt cases.

Exit criteria:

- Domain and policy tests pass.
- Concurrent mock code generation is unique.
- Unauthorized field and record access is rejected in service/API tests.

### Phase 4 — Backend API and audit workflows — Complete

Planned changes:

- Implement identity, projects, assignments, status, comments, workload, reports, CSV, notifications, and admin API routes.
- Add correlation IDs, error envelopes, structured safe logging, headers, CORS, and production-mode fail-closed configuration.
- Complete important-change activity recording.

Exit criteria:

- Route-level allow/deny tests pass.
- Complete mock workflow works through HTTP.
- Invalid transitions and over-posted fields are rejected.

### Phase 5 — Polished frontend — Complete

Planned changes:

- Implement shell, mock user switcher, dashboard, new project, unassigned queue, assignment drawer, project views, details, designers, reports, notifications, and settings.
- Add role-aware actions, accessible forms, URL filters, optimistic rollback, loading/error/offline/empty states, CSV download, motion, and responsive behavior.

Exit criteria:

- Required screens are navigable for every seeded role.
- Key component tests pass.
- Keyboard operation, focus visibility, reduced motion, and responsive layouts are reviewed.

### Phase 6 — SharePoint, Teams, and Microsoft 365 adapters — Complete locally

Planned changes:

- Add TeamsJS host and SSO adapter.
- Add server token validation and production identity resolution.
- Add Graph client and SharePoint repository mappings.
- Add ETag sequence retry and provisioning script/config.
- Add optional Teams proactive notification adapter.
- Complete manifest, icons, package scripts, and production configuration state.

Exit criteria:

- Adapters are covered by contract tests using mocked Graph responses.
- App package validates and builds without real tenant secrets.
- Missing production configuration produces a clear non-technical state.
- Any live tenant validation remains explicitly outstanding unless performed.

### Phase 7 — Full test journeys, hardening, and documentation — Complete locally

Planned changes:

- Implement the seven specified E2E workflows in mock mode.
- Run formatting, lint, typecheck, unit, component, E2E, build, manifest validation, and package build.
- Review accessibility, responsive behavior, security, audit completeness, and dependency audit output.
- Complete all README and required `docs/*` deliverables.

Exit criteria:

- All local quality gates pass.
- Teams package is produced.
- IT requirements and untested tenant items are explicit.
- Final report contains exact commands and evidence without unsupported claims.

## Quality Gate Commands

The final script names will be established in Phase 2. The intended root commands are:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:components
pnpm test:e2e
pnpm build
pnpm teams:validate
pnpm teams:package
```

CI will execute the same commands used locally.

## Final Local Verification — 2026-08-01

`pnpm check` completed successfully from the repository root and verified:

- Prettier formatting, ESLint with zero warnings, and strict TypeScript checks.
- 18 domain, contract, provider, service, and API tests.
- 6 React component tests.
- All 7 required Playwright workflow tests in Chromium.
- Production API and route-split web builds.
- A production-process smoke test serving both `/api/health` and an SPA fallback
  route from the built Fastify bundle.
- Custom Teams package checks and the official Agents Toolkit validator (`All passed`).
- Regeneration of `appPackage/build/appPackage.local.zip` with `manifest.json`,
  `color.png`, and `outline.png` at the package root.

The dependency audit was also reviewed. One high-severity advisory remains
reported for React Router's unused unstable RSC code path; its scoped exception,
upstream applicability statement, and mandatory upgrade condition are recorded
in `docs/security.md`. No live Microsoft 365 tenant, Entra, SharePoint, or Teams
catalog claim is made by these local results.

## Main Risks and Controls

| Risk                                               | Control                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| SharePoint has no multi-list transactions          | Idempotency keys, immutable audit events, retryable side effects, reconciliation documentation |
| Duplicate codes under concurrency                  | Dedicated sequence record, ETag `If-Match`, bounded retry, concurrent tests                    |
| Client role forgery                                | Server token validation and server-side AppUser role lookup                                    |
| Teams context spoofing                             | Never accept context as identity proof                                                         |
| Broad Graph permissions                            | Prefer `Sites.Selected`; isolate optional directory/profile features                           |
| Proactive notifications unavailable before install | Feature flag, in-app notification fallback, visible configuration status                       |
| Large SharePoint datasets                          | Indexed columns, server filters, pagination, stable sorting, report scope documentation        |
| UI becoming a generic admin page                   | Custom design tokens, shared premium components, visual review at required breakpoints         |
| Mock behavior diverging from production            | Shared domain services and repository contract tests                                           |
| Node/package incompatibility                       | Verify engines and all builds during Phase 2 before feature implementation                     |

## Microsoft 365 / IT Inputs Needed Later

No values are required for mock-mode implementation. Production configuration will eventually require:

- Microsoft 365 tenant ID and approved application name/ownership.
- Entra application/client ID and approved credential approach.
- Final HTTPS hosting origin and custom domain, if any.
- Dedicated SharePoint site URL and permission to create/configure lists.
- Approval and grant for `Sites.Selected` on that site.
- Teams custom-app upload/admin policy and intended catalog publishing path.
- Bot registration and app-install policy only if proactive Teams notifications are enabled.
- Confirmation of company timezone, capacity defaults, project types, and data-retention policy.

These remain placeholders until the organization provides them.
