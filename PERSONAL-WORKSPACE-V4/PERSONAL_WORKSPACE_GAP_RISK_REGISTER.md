# PERSONAL WORKSPACE — GAP / RISK REGISTER

> **Purpose:** Practical register of active gaps, technical debt, migration forecast, test
> baselines, and release risks. Corrections to prior registers are applied here.
> Live repository reality overrides any stale entry.

---

## A. ACTIVE GAPS

| ID   | Gap                                   | Severity | Timing       | Depends / Migration            |
| ---- | ------------------------------------- | -------- | ------------ | ------------------------------ |
| G-01 | WorkSession Pause / Resume missing    | **HIGH** | **MUST NOW** | Blocks P2-UX-02; Migration v5  |
| G-02 | P2-UX-02 shell missing                | —        | **MUST NOW** | Depends on v5                  |
| G-03 | P2-UX-03 structural composition       | —        | SHOULD NOW   | No migration                   |
| G-04 | P2-UX-04 page composition             | —        | SHOULD NOW   | No migration                   |
| G-05 | Datasheet path identity               | —        | Phase 3      | migration forecast             |
| G-06 | P-10 source freshness persistence     | —        | Phase 5      | migration forecast             |
| G-07 | P-05 Comment → Action relation        | —        | Phase 5      | migration forecast             |
| G-08 | P-11 user gate                        | —        | Phase 3 / 4  | no current Phase-2 blocker     |
| G-09 | user-facing verified backup snapshots | —        | Phase 5 / 6  | distinct from migration backup |

---

## B. TECHNICAL DEBT

**Do NOT record false debt.** Correctly, the `work_sessions` CHECK does **not** block a PAUSED
active row; the actual blocker is missing persistent pause-state / time fields. That is a v5 gap
(G-01), **not** a CHECK debt.

Recorded debt:

- Windows child-process bare unlink cleanup flake.
- Personal E2E Project Type `<select>` test misuse.
- Legacy compatibility paths that must not become production dual authority.
- Release default / authority concerns where repository evidence supports them.
- Desktop preferred-port collision preference edge.
- Minimal sidebar flyout very-short-window containment / focus / resize notes — recorded as
  non-blocking release / polish risks where still relevant.

---

## C. MIGRATION FORECAST

**v5:** Timer Pause / Resume.

- Timing: **MUST NOW**.
- Additive, isolated, low risk.

**POST-v5:**

- Datasheet Registry — Phase 3.
- P-10 Source Freshness — Phase 5.
- P-05 relations — Phase 5.

**Future migration version numbers: NOT LOCKED** (v6 / v7 / v8 not assigned). Numbers are
assigned only when an implementation slice is ready. Unrelated migrations remain separate by
default.

---

## D. TEST BASELINES

Keep separate — do **not** merge:

**Personal E2E wizard:**

- Manual entry click timeout.
- Project Type `<select>` `.fill()` misuse.

**Windows:**

- `.lock.sqlite` `EBUSY` / `EPERM` cleanup flake.

---

## E. RELEASE RISKS

Track, but do **not** prematurely implement:

- Desktop preferred-port collision / localStorage origin edge.
- User backup feature not yet implemented.
- Compatibility paths.
- Release / default schema authority decisions.
- Windows cleanup flake.
