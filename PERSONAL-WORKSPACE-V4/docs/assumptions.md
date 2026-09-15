# SCLI Lighting Project Workspace — Assumptions

## Purpose

These assumptions distinguish the approved standalone product from the optional future Microsoft 365 rollout. Standalone operation does not depend on tenant IDs, secrets, URLs, or administrative approval. Tenant-specific assumptions must be reviewed only before an `m365` deployment.

## Confirmed from the Product Brief

1. The product is an internal business tool for Scientechnic Lighting Solutions named **SCLI Lighting Project Workspace**.
2. V1 user-facing copy is English-only.
3. The current application runs standalone in a regular browser; its future Teams personal-tab route remains supported by isolated adapters.
4. V1 roles are `Sales`, `Designer`, `LineManager`, and `Admin`.
5. Role membership comes from application configuration and is never accepted from a client-submitted value.
6. Standalone data uses SQLite. A future Microsoft 365 deployment uses SharePoint Lists. Project files remain HTTPS folder/reference links rather than direct binary uploads.
7. Standalone mode uses local accounts and durable data without a Microsoft tenant. Seeded mock data and the development-only user switcher remain available for tests/demos.
8. Default company timezone is `Asia/Dubai`; persisted timestamps are UTC.
9. Project codes are immutable, server-generated, and follow `###_SCLIyymmdd_PROJECT_NAME`.
10. Completed and Cancelled projects do not count as active workload.
11. All important project changes create immutable audit activity.
12. No AI or chat functionality belongs in the product.

## Technical Assumptions

1. The repository remains a single pnpm TypeScript workspace.
2. Node.js 24 and pnpm 11 are acceptable for local/CI execution, subject to dependency compatibility checks during scaffolding.
3. The standalone deployment hosts one Node API that also serves the built SPA. Shared/team access should use an approved HTTPS endpoint.
4. Vite proxies `/api` to Fastify during local development so the browser uses stable same-origin paths.
5. Standalone SQLite persistence must survive restart. Mock persistence intentionally resets and remains deterministic for tests.
6. Microsoft Graph `v1.0` is sufficient for required SharePoint list and document-library-link operations.
7. A dedicated SharePoint site will be available, and IT can grant the application `Sites.Selected` access to it.
8. Production Graph access happens only on the server. No Graph application credential or privileged access token is shipped to the browser.
9. Teams SSO proves the signed-in Entra identity; application role and record access are resolved separately by the API.
10. The Sales people picker searches active configured application users first. Company-wide directory search is not needed for V1.
11. Profile photos are optional enhancement data. The UI will provide initials-based avatars when photos or permissions are unavailable.
12. Proactive Teams notifications are optional. In-app notifications are the guaranteed baseline.
13. No production code will depend on Microsoft Graph beta endpoints.
14. A sequence number can be permanently consumed if project persistence fails after allocation. Codes must be unique but do not need to be gapless.
15. SharePoint cross-list writes cannot be made truly transactional. Project creation will use idempotency and retry/reconciliation rather than claim atomicity across projects, activities, and notifications.

## Business and UX Assumptions

1. Weekly Lighting Designer capacity defaults to 40 hours unless changed by an Admin.
2. A work week is Monday through Friday for date presentation and “due this week” calculations, pending business confirmation.
3. Workload recommendation compares all active estimated hours to weekly capacity exactly as requested, even though projects may span multiple weeks. A future scheduling model is outside V1.
4. Line Managers may assign an active Lighting Designer despite `FullyLoaded` or `Unavailable`; the UI requires an explicit reason and the activity records the override.
5. Sales-created projects begin `Unassigned`. A Manager-created project with an optional Primary Lighting Designer begins `Assigned`; otherwise it begins `Unassigned`.
6. `NewRequest` and `UnderReview` remain valid configured statuses, but the creation service will use the workflow-specific initial status above.
7. Completing a project sets progress to 100% server-side when needed.
8. Reopening a Cancelled or Completed project is a Manager/Admin action and creates an audit event.
9. Comments are plain text. Attachment support is an optional HTTPS URL; file binary upload is outside V1.
10. Project-folder/reference URLs must use HTTPS. Localhost URLs are allowed only in test fixtures, never through production validation.
11. Revision requests increment `revisionNumber`, move the project to the configured revision state, and append an explicit activity record.
12. Reports attribute work to `salesOwnerId`, not `createdById`, including projects created on behalf of Sales.
13. CSV export uses invariant machine-readable dates and UTF-8 encoding, while the UI displays dates in the company timezone.
14. Saved views are user-local, non-sensitive preferences in V1. Cross-device saved filters are outside scope.
15. Light, Dark, and System themes are supported. All use the Scientechnic teal/white/charcoal visual language; Teams theme context can drive System mode.
16. A project has one Primary Lighting Designer and up to 12 collaborators. The Sales Owner and all assigned Lighting Designers can edit shared content.
17. Completed and Cancelled project content/comments are locked until an authorized status transition reopens the project.

## Scale and Operations Assumptions

1. Standalone usage is one API process for a small internal team. A future Microsoft 365 deployment may support tens of users and fewer than 10,000 active/recent project records.
2. All list queries are paginated and common filter columns are indexed even at the initial smaller scale.
3. Reports can be calculated on the API for the V1 data volume. Long-term warehousing/BI is outside scope.
4. The application owner will define retention, backup, and restore procedures before broad standalone rollout; tenant legal-hold rules are future deployment work.
5. The company will own monitoring and hosting subscriptions; the repository will provide health endpoints and structured application logs.
6. Production deployment targets a single tenant unless IT explicitly requests multitenant support.
7. Government or sovereign Microsoft cloud endpoints are outside the initial configuration but must not be hard-coded in domain logic.

## Decisions Required Before Production Provisioning

These are required only before the optional Microsoft 365 rollout:

1. Which Azure hosting service and region will be used?
2. What is the final HTTPS domain/origin?
3. Which SharePoint site and document library will hold production data and project folders?
4. Will Graph use managed identity or a certificate-based application credential?
5. Will proactive Teams notifications be enabled at launch?
6. Who approves custom Teams apps, Entra permissions, and SharePoint site grants?
7. What are the final approved lighting project types and default Lighting Designer capacities?
8. What are the data-retention, audit-retention, and recovery requirements?
9. Should Admin users be allowed to assign a non-Lighting-Designer under an emergency override? The current assumption is no.
10. Should a project required-delivery date allow a past date for data migration? The current assumption is no for interactive creation and yes only for an audited import tool, which is not part of V1.

## Explicit Non-Claims

- No Microsoft tenant connection has been configured or tested.
- No Entra application has been registered.
- No SharePoint list has been provisioned.
- No Teams app has been uploaded or installed.
- No proactive Teams notification has been delivered.
- No production hosting choice has been made.
