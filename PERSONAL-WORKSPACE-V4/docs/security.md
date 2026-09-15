# Security and privacy

## Trust boundaries

The browser and optional Teams iframe are untrusted clients. Fastify authentication, Zod validation, domain authorization, and record filtering are the enforcement boundary. Standalone credentials and data stay server-side in SQLite. SharePoint and Graph are optional external services reached only from the API with a server-side credential.

## Threats and controls

| Threat                                 | Control                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged role or owner ID                | Role comes from active `SCLI_AppUsers`; Sales creation policy rejects a different owner; over-posted fields are stripped/rejected.                                                                                                                                                                       |
| Direct URL access to another record    | Every project read, activity, comment and mutation calls record-level authorization. Allow/deny API and E2E tests cover this.                                                                                                                                                                            |
| Token theft or spoofing                | HTTPS, bearer validation, exact issuer/audience and expiration checks; local HMAC secret or tenant JWKS validation; no token logging.                                                                                                                                                                    |
| Local password disclosure              | Salted scrypt hashes, constant-cost unknown-account verification, generic login errors, per-IP/email throttling, session invalidation after account/password change, and no password logging.                                                                                                            |
| Stale collaborative overwrite          | Project versions and optional `expectedVersion` checks reject stale shared edits with `409 CONFLICT`.                                                                                                                                                                                                    |
| Teams context spoofing                 | Context is used only for presentation/host behavior, never identity proof.                                                                                                                                                                                                                               |
| Duplicate project codes                | Server-only generation, serialized standalone/mock allocation, persisted sequence state, SharePoint ETag `If-Match`, and bounded conflict retry.                                                                                                                                                         |
| Concurrent workspace startup           | Database-scoped startup lock held as a live SQLite `BEGIN EXCLUSIVE` transaction on a sibling lock database; no PID stale-marker deletion; crashed owners release the lock via OS handle close; canonical path identity prevents alias bypass.                                                           |
| Partial or replaced generated artifact | Canonical UUIDs are reserved before filesystem work; project-relative locators pass the v4 path validator; owned temp files are hashed with SHA-256 and moved without replacement; collisions, missing files, and hash mismatches fail closed or produce recovery attention without overwriting history. |
| Stored/reflected XSS                   | React text rendering, plain-text comments, no `dangerouslySetInnerHTML`, HTTPS-only URL validation.                                                                                                                                                                                                      |
| SSRF through project links             | URLs are stored/displayed as links; the API does not fetch submitted project/attachment URLs. Only HTTPS is accepted.                                                                                                                                                                                    |
| Cross-origin API abuse                 | Restrictive configured CORS, allowed methods/headers, no credential cookie dependency. Authentication remains required.                                                                                                                                                                                  |
| Secret disclosure                      | Secrets are server environment values; `.env*`, local Agents Toolkit values and build artifacts are ignored; logs redact authorization and secret fields.                                                                                                                                                |
| Excessive Graph access                 | Application `Sites.Selected` plus an explicit dedicated-site write grant.                                                                                                                                                                                                                                |
| Audit tampering                        | Activity provider exposes append/list only; no update/delete endpoint. Actor snapshots and UTC timestamps are server-generated.                                                                                                                                                                          |
| Forged or overlapping timer state      | Timer timestamps and duration are calculated by the API; only assigned Designers can track time; one running/paused timer is enforced; corrections append reasons instead of overwriting audit records.                                                                                                  |
| Employee activity surveillance         | The timer records only explicit Start/Pause/Resume/Stop actions, category, note, and elapsed time. It does not inspect applications, files, keystrokes, screenshots, or device-idle activity.                                                                                                            |
| Multi-list partial failure             | Idempotency key, typed reconciliation error, immutable side-effect records, documented non-transactional boundary.                                                                                                                                                                                       |
| Notification privacy leak              | Notifications are filtered by recipient; mark-read verifies ownership; proactive delivery skips unknown conversations.                                                                                                                                                                                   |
| Test backdoor in production            | Reset route requires mock mode, non-production, concrete mock provider, and a test header. It is unavailable in standalone mode.                                                                                                                                                                         |

## Desktop integration boundary

Phase 4A does not expose a generic process or shell primitive. Renderer calls identify only
`AUTOCAD` or `DIALUX`; executable auto-discovery is bounded to known vendor directories, and manual
selection is returned by the Desktop-owned Windows file picker rather than supplied as an arbitrary
renderer path. The executable basename must match the selected application.

Opening a source file requires an absolute, application-specific extension inside a canonical
Project root. Desktop re-checks the root's `.scli-project.json` Project UUID marker, real-path
identity, containment, and non-symlink source identity before using direct spawn arguments with no
shell. A UUID-owned inbox is created only under the Desktop application-data root. P4A installs no
watcher and grants no trust to files in that inbox; capture/routing remains a later security review.

## HTTP and logging

Fastify limits request bodies to 1 MB, uses a 30-second request timeout, emits correlation IDs, applies Helmet, and redacts authorization/cookie/access-token/client-secret fields from structured logs. Production errors return generic messages and no stack trace.

Development disables CSP so Vite hot reload can work. Production enables an allowlist CSP for same-origin scripts/assets, local fonts, HTTPS images, the Microsoft login endpoint, and the documented Teams/Microsoft 365 frame ancestors. The legacy `X-Frame-Options` header is disabled because it conflicts with explicit Teams `frame-ancestors`; standalone access remains protected by authentication, restrictive CORS, and the CSP. Revalidate this allowlist against the final hostname and target Teams cloud before an `m365` rollout.

## Data minimization and retention

Stored user data is limited to stable IDs, optional Entra object ID, name, work email, job/department, role, capacity, availability and optional avatar URL. Standalone mode additionally stores salted password hashes. Projects store delivery/audit information, plain-text comments, local meeting notes, contact details, file paths, reference URLs, and explicit project timer/timesheet events. The personal application does not connect to or store mailbox/calendar content and does not store uploaded project-file binaries in SQLite.

Before broad rollout, the application owner must define retention, backup, restore, subject access/correction, and leaver deactivation procedures. Deactivating an AppUser blocks access without destroying historical actor snapshots. Standalone backup and single-process limits are documented in [Standalone deployment](standalone-deployment.md).

## Operational checklist

- Scan committed history and deployment variables for secrets before release.
- Run `pnpm audit --prod`; triage findings rather than applying force upgrades automatically.
- Pin deploys to the lockfile and use a protected CI environment.
- Restrict deployment and app-catalog credentials.
- Monitor health, 401/403/409/5xx rates, Graph throttling and sequence conflicts without logging payloads/tokens.
- Exercise credential rotation, app rollback and SharePoint recovery before broad launch.
- Re-test authorization after any role, transition or schema change.
- Keep the standalone database on an access-controlled local disk, run one API process, and test consistent backup/restore.
- Replace the example standalone secret and bootstrap password; production validation refuses those defaults.

## Dependency-audit decision

As of 2026-08-01, the production audit reports `GHSA-qwww-vcr4-c8h2` against
React Router 7.18.2. The upstream advisory states that the issue only affects
applications using React Router's unstable React Server Components APIs. This
application is a Vite client-side SPA: it does not enable RSC, SSR, server
actions, or React Router's RSC request handlers, so the vulnerable execution
path is absent. The application remains pinned to the newest version currently
published in the configured npm registry because downgrading reintroduces
multiple reachable router advisories and the advisory's patched 8.3.0 release
is not yet available there.

This is a narrow, reviewed exception rather than a blanket audit waiver. The
release owner must re-run `pnpm audit --prod` and upgrade to React Router 8.3.0
or newer as soon as a compatible package is published. Enabling RSC, SSR, or
router server actions before that upgrade invalidates this exception and blocks
release.

# Phase 4B capture boundary

Automatic capture is strict allow-list and controlled-ingress only. Candidate real paths must remain direct regular non-link children of the exact UUID-bound session inbox, and containment is revalidated before staging. Project writes require the existing UUID marker-backed verified-root gate; Revision routing uses the exact persisted Revision UUID and never sequence or filename inference. Capture API read models redact all absolute filesystem locations.

## Phase 5B-A Smart Import boundary

- The renderer sends source bytes or invokes an opaque `SELECT_IMPORT_SOURCE` handoff; it never
  receives filesystem authority and never supplies a trusted hash or local path.
- Desktop accepts only `.csv`, `.tsv`, and `.xlsx`, rechecks a regular non-link real path and the
  per-format size limit, and copies once into the exact UUID-owned import inbox. The API repeats
  admission and computes SHA-256 itself.
- CSV/TSV is limited to 10 MiB. XLSX is limited to 25 MiB, 5,000 ZIP entries, 100 MiB expanded
  content, 50 worksheets, 200 columns, 10,000 rows, 20,000 characters per cell, and 50 MiB of
  persisted raw review JSON.
- XLSX macros and unsupported formats are rejected. Formulas are never calculated; cached values
  may be inspected while formulas without a safe cached result become blocking evidence. External
  links are not fetched.
- Every route requires an authenticated actor. Session reads/writes are actor-scoped, and a
  Project destination is re-authorized through the existing record-level Project policy.
- Errors expose bounded reason text, not absolute paths. Original source bytes are deleted after
  durable parsing or on failure; only the sanitized display filename, server hash, raw cell
  evidence, mappings, derived normalization, and validation remain.
- P5B-A contains no Project mutation, Library mutation, asset creation, archive extraction, OCR,
  Apply endpoint, or generic desktop path bridge.

## Phase 5C PDF and OCR boundary

- Only an opaque UUID handoff may invoke the Desktop PDF picker. Desktop and API independently
  enforce PDF type, 50 MiB size, regular non-link files, exact staging containment, and no-replace
  admission; API responses never contain absolute paths.
- Server SHA-256 or an immutable Phase 4 Artifact Version UUID owns source identity. Extracted
  names, Project Codes, and filesystem similarity cannot confer Project authority.
- OCR uses only checksum-locked bundled English assets. The packaged worker disables network fetch,
  and the offline package/runtime smoke checks are release-blocking.
- Preview is bounded to one raster page; no arbitrary file read, PDF modification, HTML rendering,
  annotation, or browser filesystem authority is exposed.
- Routing revalidates hash, confirmed Project UUID, marker-backed root, folder mapping fingerprint,
  relationship state, classification, and proposal CAS before a no-replace copy. It never creates
  or rewrites a Revision.
