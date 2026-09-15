# PERSONAL WORKSPACE — CANONICAL BASELINE

> **Purpose:** Verified system baseline recorded after `P2-SYSTEM-AUDIT-A0` and
> `P2-SYSTEM-AUDIT-A0-R1` reconciliation.
>
> **Warning:** The values below are a **snapshot**. Live Git reality overrides them. Re-run the
> checks in `PERSONAL_WORKSPACE_CURRENT_STATE.md` before relying on any value here.

---

## AUDITED BASELINE (Snapshot)

| Item                  | Value                                      |
| --------------------- | ------------------------------------------ |
| Audited HEAD          | `1712badfb7ad2fc352aeb32846f8d8985cbef49e` |
| Branch                | `feature/v3.3-migration-foundation`        |
| Audited schema target | **v4**                                     |
| Working tree at audit | **CLEAN**                                  |
| Remote                | **NONE**                                   |
| Migration v5          | **ABSENT** (not implemented)               |

---

## SYSTEM FOUNDATIONS — VERIFIED

Verified at audit (do not overstate beyond audited evidence):

- Migration chain `0 → 1 → 2 → 3 → 4`.
- Checksummed migrations / journal / fail-closed behavior.
- Canonical production Personal authority.
- Project UUID relational identity.
- Luminaire UUID relational identity.
- Tag Project-scoped business identifier.
- Transactional imports.
- Sparse import preservation.
- DIALux support.
- Canonical Revision / Output / IssuePackage UUID model.
- Immutable revision / output / package history.
- Versioned templates.
- Resolved template snapshots.
- Technical BOQ non-priced.
- P2-UX-01 closed after real Desktop UAT.

Use this wording only:

> "No destructive-rewrite risk identified in the audited scope."

**NOT:**

> "No hidden risk exists."

---

## WORKSESSION CURRENT REALITY

**Current engine:** Start, Stop, explicit Switch, one current session, restart recovery.

**Missing:** true Pause / Resume.

**Timer v5:** a **MUST NOW** dependency for P2-UX-02.

**Correct critical statement:**

> The existing `work_sessions` CHECK **does NOT block** a PAUSED active row.
>
> The actual blocker is **missing persistent pause-state / time fields.**

**Candidate schema v5 (additive, not yet implemented):**

- `paused_at TEXT NULL`
- `accumulated_paused_ms INTEGER NOT NULL DEFAULT 0`

Expected properties of v5 (design intent):

- Additive.
- No table rebuild.
- No CHECK rewrite.
- No index change.
- No event table.
- Same WorkSession UUID across Pause / Resume.
- PAUSED owns the active slot.
- Elapsed subtracts accumulated paused time.

---

## TEST BASELINES — KEEP SEPARATE

**Personal E2E wizard baseline:**

- Manual entry click timeout.
- Project Type `<select>` `.fill()` misuse.

**Separate Windows cleanup flake:**

- `.lock.sqlite`.
- `EBUSY` / `EPERM`.
- Child-process cleanup timing.

Do **not** conflate these two baselines.

---

## P2-UX-03 / P2-UX-04

Record:

- Architecturally **data-ready**.
- **No schema blocker identified** for either.
- Default execution remains **sequential** because one writer per worktree.
