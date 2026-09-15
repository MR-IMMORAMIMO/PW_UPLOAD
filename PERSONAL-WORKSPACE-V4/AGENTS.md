# SCLI Lighting Project Workspace — Agent Guide

This file defines the non-negotiable engineering rules for future Codex sessions in this repository.

## Product Boundary

- Build an internal standalone-first lighting-project request and workload workspace with an optional Microsoft Teams personal-tab upgrade path.
- V1 is English-only.
- Do not add chat, generative AI, OpenAI, or unrelated automation features.
- Local mock mode must remain fully functional without a Microsoft tenant.
- Production Microsoft 365 capabilities must be isolated behind adapters and must never be represented as tenant-tested unless they were actually tested in the target tenant.

## Current Collaboration Rule

The repository owner approved autonomous completion of the remaining phases in the current task. Continue through implementation, validation, packaging, and documentation without pausing for phase approval unless a destructive action, tenant-side change, credential, or material product decision requires the owner's authority.

## Planned Architecture

Use a pnpm TypeScript workspace with these boundaries:

- `apps/web`: React + Vite Teams personal-tab SPA.
- `apps/api`: Node.js + Fastify REST API and production static-file host.
- `packages/contracts`: shared Zod request, response, error, and query schemas.
- `packages/domain`: entities, enums, transitions, authorization policies, calculations, and services with no framework dependencies.
- `packages/config`: typed environment parsing and shared build configuration.
- `packages/test-data`: deterministic seed builders used by tests and mock mode.
- `appPackage`: Microsoft 365 app manifest template, icons, and package output.
- `infra`: Microsoft 365 Agents Toolkit configuration and repeatable provisioning scripts.
- `docs`: architecture, deployment, permissions, SharePoint schema, security, and testing documentation.

Dependency direction must be inward:

1. UI and API may depend on contracts and domain.
2. Adapters may implement domain ports.
3. Domain must not import React, Fastify, Microsoft Graph, Teams SDK, or storage implementations.
4. The browser must never import server-only packages or credentials.

## Platform Rules

- Use Microsoft 365 Agents Toolkit configuration and CLI for manifest validation, packaging, provisioning, and deployment workflows.
- Do not introduce the deprecated TeamsFx SDK into new code.
- Use the current stable Teams JavaScript SDK for tab initialization, context, theme, and SSO.
- Treat Teams context as presentation context, never as proof of identity.
- Authenticate production requests with a server-validated Microsoft Entra token.
- Resolve the application role server-side from `AppUser` data keyed by Entra object ID.
- Access SharePoint and Microsoft Graph only from the API layer.
- Use Microsoft Graph `v1.0` APIs in production code. Beta APIs require a documented, approved exception.
- Prefer `Sites.Selected` application access scoped to the dedicated SharePoint site. Any broader permission requires a written justification.
- Feature-flag proactive Teams notifications. In-app notifications must work without a bot or tenant provisioning.

## TypeScript and Code Conventions

- TypeScript strict mode is required in every package.
- Avoid `any`; use `unknown` and narrow it.
- Validate every trust boundary with Zod: environment variables, API input, query strings, Graph payloads, and persisted records.
- Use UUIDs internally. Never use a display name as an identity key.
- Store timestamps as UTC ISO 8601 strings. Convert for display with the configured company timezone.
- Keep enums and status transitions centralized in `packages/domain`.
- Prefer small, explicit functions and dependency injection through constructors or factory parameters.
- Side effects must sit behind ports such as repositories, clocks, sequence generators, notification senders, and identity providers.
- Use structured logs with a correlation ID. Never log tokens, secrets, authorization headers, or entire sensitive payloads.
- API errors use one typed envelope and never expose production stack traces.
- Add comments for intent and invariants, not for syntax that is already obvious.

## Data and Concurrency Rules

- Project codes are immutable and generated only on the server.
- Project sequence allocation must be concurrency-safe.
- Mock mode uses an atomic in-process sequence implementation suitable for concurrency tests.
- SharePoint mode uses the sequence list item ETag with `If-Match`, bounded retry, jitter, and a typed conflict error.
- A consumed sequence number may be skipped if downstream persistence fails; uniqueness is mandatory, gaplessness is not.
- Important mutations must append immutable activity records with actor ID, actor name snapshot, and UTC timestamp.
- Do not provide update or delete operations for existing audit records.
- Repository methods must enforce pagination and stable sorting.
- SharePoint column mappings belong in a single adapter mapping layer, not throughout services.

## Authorization Rules

- Every sensitive query and every mutation must execute an explicit server-side authorization policy.
- UI visibility is a usability feature, not a security boundary.
- Enforce record-level access for Sales and Designer users.
- Reject over-posted fields even when the caller is otherwise authorized.
- Only LineManager/Admin can assign, reassign, or correct Sales ownership.
- Sales can only create for themselves; the server ignores or rejects a forged owner ID.
- Designer access is limited to assigned projects and explicitly allowed fields/transitions.
- Admin-only configuration endpoints require the Admin role.
- Test every policy with allow and deny cases.

## API Rules

- Prefix endpoints with `/api` and keep contracts shared with the web app.
- Use consistent success and error shapes.
- Include `x-correlation-id` on every response and accept a valid inbound ID where safe.
- Apply secure headers, body-size limits, request timeouts, and restrictive environment-specific CORS.
- Support cancellation/abort signals for outbound Graph requests.
- Use idempotency keys for create operations that may be retried by a client or infrastructure.
- Do not claim a SharePoint cross-list transaction. Use an idempotent workflow and clearly document partial-failure handling.

## UX Rules

- Follow the approved Scientechnic Light/Dark/System palette and retain a premium desktop-app character.
- Heavily customize any Fluent UI primitives so the product does not resemble a default admin or SharePoint page.
- Use semantic HTML and accessible primitives for dialogs, menus, comboboxes, tabs, and tooltips.
- Every action must be keyboard reachable, with a visible focus state.
- Never rely on color alone for status or validation.
- Respect `prefers-reduced-motion` and keep normal motion within roughly 180–350 ms.
- Keep loading, empty, offline, error, permission-denied, and optimistic-rollback states intentional.
- Drag-and-drop must have a keyboard-accessible alternative and must use the same server transition validation.
- Charts must include equivalent tabular data.
- Preserve Teams safe areas, iframe constraints, and narrow/mobile layouts.

## Testing Requirements

Before a phase is considered complete, run the checks relevant to that phase. Before final handoff, all of these must pass:

- Formatting check.
- ESLint.
- TypeScript typecheck.
- Domain and API unit tests.
- React component tests.
- Playwright mock-mode end-to-end tests.
- Production build.
- Microsoft 365 app manifest validation and package build.

Test rules:

- Tests must not require live Microsoft 365 access.
- Seed data and time must be deterministic.
- Authorization tests include direct-URL and forged-payload attempts.
- Sequence tests include concurrent requests and SharePoint-style `412` retry behavior.
- UI tests assert behavior and accessible names instead of implementation details.
- E2E tests reset mock state through a test-only mechanism that is impossible to enable in production.

## Security Rules

- Never commit `.env` files, tokens, tenant-specific credentials, certificates, or downloaded production data.
- Never place a client secret or privileged Graph token in browser code.
- Prefer managed identity in Azure; otherwise use a certificate or a secret stored in an approved secret manager.
- Sanitize and validate URLs; V1 accepts only valid HTTPS project-folder/reference links.
- Do not render user-supplied HTML.
- Keep dependencies minimal, maintained, and locked.
- Review dependency audit results; do not automatically apply breaking-force upgrades.
- Document threat assumptions and mitigations in `docs/security.md`.

## Documentation and Change Discipline

- Keep `README.md` commands exact and executable.
- Update architecture, assumptions, schema, permissions, testing, and deployment docs with the code that changes them.
- Preserve user changes and inspect `git status` before editing.
- Make focused commits only when the user asks for commits.
- Do not claim successful tenant deployment, SSO, Graph access, or proactive notifications without evidence from the target environment.

## Migration Rules

- Every migration must be versioned with a semantic version number.
- Every migration must be reversible whenever practical through rollback mechanisms.
- Every migration requires automated tests covering both forward and rollback operations.
- Never modify production data without creating a verified backup first.
- All migration scripts must be idempotent to safely handle retries.
- Migration failures must leave the system in a known good state with automatic rollback when possible.
- Document all breaking changes in migration scripts with clear upgrade instructions.

## Infrastructure Responsibilities

- All infrastructure code (database connections, file systems, external services) must reside in the infrastructure/ directory.
- Business logic must depend on infrastructure through interfaces/abstractions, never on concrete implementations.
- Infrastructure concerns include: database migrations, backup/restore systems, file path resolution, external API clients, and caching mechanisms.
- Infrastructure components must be initialized through dependency injection.
- Error handling in infrastructure layers must distinguish between transient and permanent failures.
- Infrastructure code must be thoroughly tested with both unit and integration tests.

## Commit Requirements

- Make focused commits that address a single concern or feature.
- Commit messages must follow conventional commits format (feat, fix, docs, style, refactor, test, chore).
- Reference relevant issues or tickets in commit messages when applicable.
- Do not commit generated files, dependencies, or build artifacts.
- Ensure all tests pass before committing code changes.
- Include relevant documentation updates in the same commit as functional changes.

## Review Requirements

- All code changes must undergo review before merging to main branch.
- Reviews must verify adherence to coding standards and architectural guidelines.
- Security-sensitive changes require additional security review.
- Changes affecting database schema require database administrator review.
- UI/UX changes require design review when applicable.
- Reviewers must verify that tests exist and pass for new functionality.
- Documentation updates must accompany user-facing changes.
