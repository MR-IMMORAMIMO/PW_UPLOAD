# Phase 5B-B Project Apply Authority

Phase 5B-B is the first Smart Import slice that may mutate current Project Luminaire state. It consumes the persistent inspection evidence introduced in P5B-A and does not mutate Master Library drafts, immutable Published Versions, external assets, Revisions, outputs, or packages.

## Authority model

- Project Tag is the only automatic Project-row identity. Comparison trims and ignores case; new writes use canonical uppercase. Blank, invalid, duplicate, and historically ambiguous canonical Tags block.
- Reconciliation is server-owned and persists a strict versioned evidence object. A recommendation never becomes an action until the Owner selects it.
- The four mutation decisions are `PROJECT_CREATE_ONLY`, `PROJECT_UPDATE_EXISTING`, `PROJECT_ADD_FROM_LIBRARY`, and `SKIP`.
- Existing updates are sparse. Absent, unmapped, invalid, blank, and unchanged fields are omitted. There is no clear/delete or Tag-rename semantic.
- Library-linked rows accept only Project Category, Location, Unit, Quantity, Notes, and explicit Description Override. Imported technical differences remain visible as Library-snapshot-owned ignored changes.
- Exact Library resolution requires normalized Manufacturer plus non-empty normalized Ordering Code. Latest is recommended; an explicitly selected older immutable Published Version UUID is preserved and revalidated at Apply.

## Schema v25

The additive v25 migration adds `project_luminaires.row_version`, session `apply_plan_fingerprint`, bounded Apply Attempt evidence, a partial unique active-attempt lock, and a canonical Project Tag lookup index. Historical v22-v24 migrations remain unchanged. All authoritative Project Luminaire mutations use compare-and-swap row versions and increment exactly once when a row changes.

## Apply lifecycle

Apply requires the exact session revision, inspection preview fingerprint, destination fingerprint, plan fingerprint, and idempotency key. The server validates the complete baseline, creates one verified canonical workspace backup, revalidates, then processes operational pages of 100 rows. Project creates/updates and their Import Row results share one SQLite transaction per row. Phase 5A owns Library snapshot materialization, managed-asset copying, binding creation, cleanup, and its deterministic operation key.

The active-attempt partial unique index and transactional insert prevent concurrent attempts. Same-key replay returns the same terminal attempt. An attempt interrupted during a Phase 5A add is marked `ABANDONED` at startup; replay of the same Apply key resumes its persisted plan and reuses `import:<sessionId>:<rowId>:<planFingerprint>` to repair the Import Row result without duplicating Project or asset state.

Normal Apply blocks while unresolved or blocked rows remain. `Apply Ready Rows Only` is a separate Owner-confirmed request. Applied rows are immutable and excluded from later plans; remaining rows may be reconciled into a new plan.

## Measured synthetic performance

Measurements were taken on a disposable file-backed SQLite workspace on 2026-08-27. Times are milliseconds.

|   Rows | Reconcile | Destination fingerprint | Plan construction | Count query | Project-only Apply | Database bytes |
| -----: | --------: | ----------------------: | ----------------: | ----------: | -----------------: | -------------: |
|    100 |      18.0 |                     6.0 |              16.5 |         1.5 |               27.3 |      1,658,880 |
|  1,000 |      52.8 |                     1.1 |             156.2 |         7.8 |              376.8 |      5,963,776 |
|  5,000 |     250.2 |                     6.2 |           1,626.1 |        33.7 |            1,870.1 |     25,231,360 |
| 10,000 |     496.9 |                    10.8 |           5,206.4 |        64.4 |            3,821.5 |     49,344,512 |

The performance probe is repeatable in `ImportProjectApplyPerformance.test.ts`. Results are evidence from this machine, not fixed service-level targets.

## Disposable Owner UAT

Run the P5B-B Playwright case through `playwright.v4.config.ts`. It creates a marker-owned temporary Personal runtime, uploads a deterministic two-row Project fixture, reconciles it, plans one Project-only create, proves normal Apply blocks on the blank Tag, confirms `Apply Ready Rows Only`, creates a real verified backup, applies once, checks the resulting canonical Project Tag, reopens history, and captures responsive screenshots. The global teardown verifies and removes only its exact temporary root.

The broader automated fixtures cover Project-only create/update, blank preservation, stale row versions, exact latest and explicit older Published Version selection, partial Apply, active Apply contention, interrupted Library-add replay repair, schema convergence, and v25 backup/restore evidence. MADAM OLD PALACE and Golden UAT are never opened or mutated.

## Review boundaries

P5B-C owns Master Library Apply. P5B-D owns new external image, datasheet, IES, LDT, and ZIP admission. Phase 5B-B does not generate a Revision and leaves the legacy Project CSV/DIALux flow available.
