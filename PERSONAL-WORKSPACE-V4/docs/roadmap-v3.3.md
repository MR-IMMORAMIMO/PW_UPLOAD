> **Note — 2026-08-04:** This document preserves the original Prompt 00–27 numbering as the historical implementation reference. The consolidated master roadmap with current phase ordering, quality gates, approved product decisions, and implementation status is at [docs/master-roadmap-v3.md](docs/master-roadmap-v3.md). Product decisions are recorded in [docs/product-decisions.md](docs/product-decisions.md).

# SCLI Workspace v3.3 Roadmap

## Overview

This roadmap outlines the implementation plan for SCLI Workspace v3.3, focusing on migration safety, immutable IDs, manifests, and rollback foundation as established in Prompt 01.

## Phase 1: Infrastructure Foundation and Path Safety

### Goal

Establish path safety, backup systems, and migration framework without modifying existing business logic.

### Files Affected

- Modified: apps/api/src/standalone-data-provider.ts, packages/domain/src/provider.ts, packages/config/src/index.ts
- New: apps/api/src/infrastructure/path/PathResolverService.ts, apps/api/src/infrastructure/backup/BackupManager.ts, apps/api/src/infrastructure/migration/SchemaMigrator.ts, apps/api/src/infrastructure/migration/migrations/001_init_schema_migrations.ts, apps/api/src/infrastructure/manifest/ManifestService.ts, tests/standalone-migration.test.ts

### Dependencies

- None (foundational phase)

### Risks

- Migration failure during backup (mitigated by backup verification)
- Path resolution regressions (mitigated by comprehensive unit tests)
- Manifest synchronization conflicts (mitigated by last-write-wins with timestamps)

### Acceptance Criteria

- Existing v3.2.2 database upgrades successfully without rerunning completed migrations
- Migration failure rolls back without leaving a half-upgraded database
- Existing projects still open after migration
- Relations continue working when visible project code is changed
- Relative-path resolution works after moving portable test copy
- Build, lint/typecheck, and available tests pass
- Focused migration and rollback tests pass

### Validation Commands

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:all
pnpm build
pnpm test standalone-migration.test.ts
```

### Rollback Strategy

- All migration changes are additive and backward-compatible
- Pre-migration backups allow full restoration
- New infrastructure files can be removed without affecting core functionality
