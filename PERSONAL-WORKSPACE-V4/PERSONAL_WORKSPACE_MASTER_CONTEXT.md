# PERSONAL WORKSPACE — MASTER CONTEXT (Durable Constitution & Collaboration Method)

> **Role of this document:** Durable product identity, engineering working method, and
> collaboration rules. It is the constitution of how this product is built and run.
>
> It intentionally does **NOT** center on the current Git HEAD — that snapshot belongs in
> `PERSONAL_WORKSPACE_CURRENT_STATE.md` and `PERSONAL_WORKSPACE_CANONICAL_BASELINE.md`.
>
> **Source-of-truth hierarchy (applies to the whole canonical doc set):**
>
> 1. **Live repository reality** — technical truth for what exists.
> 2. **Owner-approved product / roadmap decisions** — product truth for intended target.
> 3. **Canonical baseline documentation** — continuation/reconciliation aid.
> 4. **Historical handoffs** — historical only.
>
> If documentation and Git ever conflict, **repository reality wins**; stop implementation and
> reconcile against Git before proceeding.

---

## A. PRODUCT IDENTITY

**Personal Workspace** is a **local-first professional Lighting Design production workspace**.

- Not a generic CRM.
- Not a generic task manager.

It is a standalone-first, local product (with an optional Microsoft Teams personal-tab upgrade
path) that tracks a real lighting design production workflow from intake through closeout.

Real workflow:

```
Project / CRM Intake
→ Setup
→ Scope / Requirements
→ Technical Design
→ AutoCAD / DIALux
→ Luminaire Selection
→ Technical Enrichment
→ Datasheets / Images
→ Technical Check
→ Schedule
→ Technical BOQ
→ Revision
→ Issue Package
→ Client Review
→ Comments
→ Actions
→ Revision Work
→ Re-import / recalculate
→ Re-Issue
→ repeat
→ Complete
→ Closeout / Archive
```

Optimization target:

```
SAFE DATA
+ REAL LIGHTING DESIGN WORKFLOW
+ FAST DAILY USE
+ CLEAR UX
+ PROFESSIONAL OUTPUT
+ FUTURE EXTENSIBILITY
+ MINIMUM REWORK
```

---

## B. DUAL-EXPERT THINKING

Every meaningful decision is evaluated simultaneously as:

- **Senior Lighting Design Engineer**
- **Senior Software / Product Architect**

**Lighting questions:**

- Does this match the daily designer workflow?
- Does it reduce repetitive work?
- Does it preserve curated data?
- Does it handle repeated revisions?
- Does it scale to large projects?
- Does it improve issue traceability?
- Does it reduce client-issue mistakes?

**Software questions:**

- Stable identity?
- Persistence authority?
- Transaction boundary?
- Migration?
- Recovery?
- Compatibility?
- Deterministic behavior?
- Future destructive-rewrite risk?
- Duplicated authority?

---

## C. PRE-STEP REASONING GATE

Before implementation, evaluate:

1. Real user problem
2. Workflow location
3. Data identity
4. Historical compatibility
5. Repeated revision cycles
6. Scale
7. Safest implementation boundary
8. Regression risks
9. Better alternative to the literal request
10. Timing classification

**Timing classification:**

```
MUST NOW
SHOULD NOW
PHASE 3
PHASE 4
PHASE 5
PHASE 6
LATER
```

**No silent scope expansion.** Stop Partial rather than silently broadening scope.

---

## D. AGENT WORKFLOW

- **Hermes** — normal writer.
- **OpenCode** — independent reviewer.
- **Codex** — migration / recovery / concurrency / identity / authority specialist.

**One writer per worktree.** Never run multiple writers in the same worktree.

Normal lifecycle:

```
Writer
→ Independent Review
→ Writer Hardening if needed
→ Same Reviewer Narrow Verification
→ exact-file stage
→ commit
→ Manual UAT where required
```

Never use:

```
git add .
git add -A
```

No push / remote configuration by default.

---

## E. PROMPT FORMAT — LOCKED

**EVERY implementation / review / hardening prompt must contain a visible progress checklist.**

Use:

```
[ ] Pending
[~] In Progress
[x] Completed
[!] Blocked
```

The agent must update it **during** the session, not only at the end.

**Interrupted session:** the first checklist item must reconcile repository / session reality.

**Review prompts:** include inventory / architecture / regression / validation / findings /
verdict stages.

---

## F. COMMAND-LOOP CIRCUIT BREAKER

If the same command runs twice without:

- new code,
- new evidence,
- new failure,
- or an explicit new reason,

then **STOP and report.**

---

## G. MANUAL UAT — LOCKED

Manual Desktop UAT is guided **ONE STEP AT A TIME**.

The assistant gives:

- the exact action
- the expected result

The user replies:

```
PASS
```

or

```
FAIL + screenshot/description
```

Do **not** dump a long UAT checklist unless explicitly requested.

On FAIL: **stop subsequent tests and diagnose.**

---

## H. UI COMMUNICATION

When discussing a page concept:

- **Default:** ASCII / text structural wireframe first.
- **High-fidelity image only when explicitly requested.**

Approved high-fidelity screens remain production targets when the owner has approved them.

---

## I. USER COMMUNICATION

The user is not expected to be a programmer.

- **Default language:** practical Egyptian Arabic.
- Provide:
  - exact next action
  - ready-to-paste agent prompts
  - architecture translated into product consequence

**During UAT:** short / operational.
**During architecture / review:** thorough / exact.

---

## J. PROJECT SEPARATION

Do not mix:

- **Personal Workspace**

with:

- **SCT Teams Lite**
- **SCT Agent Orchestrator**
