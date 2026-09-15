# Interrupted-Session Artifact Recovery (P1.0B)

Recovery date: 2026-08-04 (Asia/Dubai)

This directory quarantines partial, non-runnable, or redundant artifacts left behind by an
interrupted previous coding-agent session. These files are **reference-only**. They must not be
compiled, executed, imported, staged, committed, or copied verbatim into the active codebase.

## Provenance

All three artifacts were untracked at recovery time and were never part of a commit. They were
audit-classified in P1.0A. This recovery pass removes them from the active source/test tree
without altering any tracked application source.

## Artifact register

### 1. schema-migration.partial.ts.txt

- Source path: `apps/api/src/schema-migration.ts` (now removed)
- Quarantine path: `docs/recovery/interrupted-session/schema-migration.partial.ts.txt`
- SHA-256: `9588CC0AA32B7370A8CC4A4153401660F34423B8AD27DCE5B323A6D556BE010C`
- Byte size: 1513
- Classification: SALVAGE_AND_REWRITE_LATER
- Reason for quarantine: Partial, architecturally misplaced, and non-compilable. Placing
  migration infrastructure directly under `apps/api/src/` violates the approved layout in
  `docs/repository-rules.md`, which requires all infrastructure code to live under
  `apps/api/src/infrastructure/`.
- Known defects:
  - `import type { DatabaseSyncInstance } from './standalone-data-provider'` references a type
    that is not exported from `standalone-data-provider.ts` (it is a local alias), so the file
    cannot typecheck.
  - Lives outside the approved `apps/api/src/infrastructure/migration/` directory.
  - No verified pre-migration backup is created before mutating data, contrary to
    `docs/roadmap-v3.3.md` acceptance criteria and `docs/repository-rules.md` database rules.
  - Uses `new Date().toISOString()` instead of an injected clock port, violating the
    AGENTS.md rule that side effects must sit behind ports.
  - No idempotency guard beyond version filtering; no bounded jittered retry; no typed
    conflict error.
  - Not wired into `standalone-data-provider.ts` or any provider factory; dead code in its
    original location.
- Reusable ideas (rewrite, do not copy): `IMigration` interface shape
  (`{ version, migrate(db) }`), `schema_migrations(version, applied_at)` ledger, sorted
  version-gated pending selection, and transactional BEGIN/COMMIT with ROLLBACK on failure.

### 2. standalone-migration.test.partial.ts.txt

- Source path: `tests/standalone-migration.test.ts` (now removed)
- Quarantine path: `docs/recovery/interrupted-session/standalone-migration.test.partial.ts.txt`
- SHA-256: `367E93135F0EAF1FBC60D65E859A5F42CAD98F97A5CC0775AE3AD1E62AC2E027`
- Byte size: 2070
- Classification: SALVAGE_AND_REWRITE_LATER
- Reason for quarantine: Non-runnable and does not match the approved migration roadmap.
- Known defects:
  - Runtime bug: `require('fs').existsSync(testDbPath(testDbPath))` treats the string constant
    `testDbPath` as a function, so `beforeEach` throws a TypeError.
  - Uses CommonJS `require('fs')` / `require('path')` inside an ESM project
    (root and `apps/api` declare `type: module`), inconsistent with existing tests that use
    `node:` ESM imports.
  - Accesses `provider.database`, a `private readonly` field, which fails typecheck under
    strict mode.
  - Builds a hand-rolled config cast `as any` that omits required `AppConfig` fields such as
    `COMPANY_TIMEZONE`, instead of using `loadConfig`.
  - Expects `schema_migrations` to exist at version 1 after constructing
    `StandaloneDataProvider`, but the current provider never invokes any migrator and never
    creates that table, so the assertion cannot pass.
  - Uses `temp/test-migration.sqlite` rather than the tmpdir-based cleanup pattern used by
    the existing `standalone-data-provider.test.ts`.
- Reusable test scenarios (rewrite, do not copy): assert the `schema_migrations` table exists
  after provider construction; assert `MAX(version) == 1` after a fresh migration run; isolate
  a temporary SQLite database per test with cleanup.

### 3. standalone-data-provider.ts.backup.redundant

- Source path: `apps/api/src/standalone-data-provider.ts.backup` (now removed from active tree)
- Quarantine path: `docs/recovery/interrupted-session/standalone-data-provider.ts.backup.redundant`
- SHA-256: `DA19244EE84409DC1D8542347AE0C3B24279B64EF7A09A9E391C311E8770EA82`
- Byte size: 9955
- Classification: DELETE_AS_REDUNDANT
- Reason for quarantine: Exact byte-for-byte duplicate of the tracked
  `apps/api/src/standalone-data-provider.ts` (identical SHA-256 and byte size). The intended
  P1.0B action was deletion. The repository safety policy blocked the destructive
  `Remove-Item` operation, so the duplicate was moved here instead. The owner may safely
  delete this file at any time; no unique content exists.

## Rules for future implementation

- Do NOT copy these files blindly into the active codebase. They are retained only as
  reference for reusable patterns and known-defect avoidance.
- Any migration framework built during P1.1 must be implemented fresh under
  `apps/api/src/infrastructure/migration/` (with `backup/`, `manifest/`, `path/`, and
  `journal/` siblings per the approved roadmap), following `AGENTS.md`,
  `docs/repository-rules.md`, and `docs/roadmap-v3.3.md`.
- The migration unit, schema ledger, transactional rollback, and version-gated pending
  selection concepts are worth preserving only after being rewritten with: an exported shared
  infrastructure type (not a private provider alias), an injected clock port, a verified
  pre-migration backup, idempotency, bounded jittered retry, and full forward/rollback tests.
- The quarantined backup duplicate has no unique content and exists solely because the
  safety policy blocked deletion; it must not be restored to `apps/api/src/`.
