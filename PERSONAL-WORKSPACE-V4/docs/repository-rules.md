# Repository Rules

## Architecture

- Project.id (UUID) is the immutable internal identifier.
- Never use projectCode as a relational key.
- UUID is the only internal identifier.
- All infrastructure code belongs inside apps/api/src/infrastructure/.
- Business logic must never depend directly on infrastructure.
- Domain must not import React, Fastify, Microsoft Graph, Teams SDK, or storage implementations.
- The browser must never import server-only packages or credentials.
- Dependency direction must be inward: UI/API → contracts/domain → shared packages.

## Paths

- Never store absolute paths when relative paths are possible.
- All path normalization, validation, comparison, and resolution must go through PathResolverService.
- Store paths relative to project root when possible.
- Validate path lengths to avoid Windows MAX_PATH limitations.
- Use path normalization for cross-platform compatibility.

## Database

- Every migration must be versioned with a semantic version number.
- Every migration must be reversible whenever practical through rollback mechanisms.
- Every migration requires automated tests covering both forward and rollback operations.
- Never modify production data without creating a verified backup first.
- All migration scripts must be idempotent to safely handle retries.
- Schema changes must be backward compatible when possible.
- Existing v3.2.2 data must remain backward compatible.
- Use transactions for multi-table updates.
- Index foreign keys and frequently queried columns.
- Connection pooling must be configured appropriately for workload.

## Project Metadata

- .scli/project.manifest.json is the application source of truth.
- PROJECT_INFO.txt remains human-readable only.
- Manual PROJECT_INFO.txt changes must never update the manifest automatically.
- Manifest synchronization uses last-write-wins with timestamps.

## Features

- Every feature must preserve backward compatibility.
- Prefer additive changes over breaking changes.
- Keep Personal and Teams boundaries explicit and isolated whenever possible.
- Personal-only work must not modify Teams-only behavior unless explicitly required.
- Feature flags must be used for experimental features.
- All user-facing strings must be externalized for localization.
- Error messages must be user-friendly and actionable.
- Loading states must be implemented for asynchronous operations.
- Empty states must be designed for all data collections.

## Testing

A feature cannot be marked complete unless the required lint, typecheck, tests, and build pass:

- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build

- Unit tests must cover at least 80% of business logic.
- Integration tests must cover critical user flows.
- End-to-end tests must cover critical paths in mock mode.
- Tests must be deterministic and not rely on timing.
- Mock external services in unit tests.
- Test both positive and negative cases.
- Tests must clean up after themselves to avoid pollution.

## Documentation

- Update documentation alongside code changes.
- All public APIs must have JSDoc comments.
- Complex algorithms require explanatory comments.
- Architecture decisions must be documented in decision logs.
- User-facing changes require documentation updates.
- API documentation must be kept current with code.
- Diagram conventions must be followed consistently.
