# Phase 4B — Project/Revision-bound capture and routing

Phase 4B adds an API-owned, backend-only capture pipeline for exact AutoCAD and DIALux session outputs. It does not add renderer controls, manual capture, OCR, semantic content classification, or arbitrary folder scanning.

## Controlled ingress

Each active `LIVE` or explicitly `REBOUND` Tool Context owns exactly one non-recursive inbox:

`<data-root>/automation-sessions/<toolContextId>/inbox`

`fs.watch` is only a latency hint. A bounded reconciliation runs approximately every two seconds, enumerates direct children only, and accepts only regular non-link files whose real path remains a direct child of the exact inbox. Downloads, Desktop, Project roots, OneDrive roots, subdirectories, and arbitrary folders are never scanned. API restart preserves Phase 4A expiry; only durable nonterminal captures recover until a context is explicitly rebound.

Raw bytes copied manually into a controlled inbox cannot prove semantic provenance. P4B therefore guarantees controlled ingress and exact context/capability/extension policy, not content classification.

## Exact policy

| Artifact              | Tool    | Extension      | Level    | Output mapping      | Document                   | Snapshot |
| --------------------- | ------- | -------------- | -------- | ------------------- | -------------------------- | -------- |
| `DIALUX_REPORT`       | DIALUX  | `.pdf`         | Revision | `dialuxReport`      | LuxReport / InternalReview | Yes      |
| `CAD_LAYOUT_PDF`      | AUTOCAD | `.pdf`         | Revision | `cadLayoutPdf`      | Drawing / InternalReview   | Yes      |
| `CAD_WORKING_DRAWING` | AUTOCAD | `.dwg`, `.dxf` | Project  | `cadWorkingDrawing` | Drawing / Working          | No       |

There are no wildcard, `ANY_PDF`, or `ANY_FILE` capabilities. DWG/DXF bytes are opaque extension- and SHA-256-backed content; no structural validation is claimed. Internal-generated, package, Snapshot, staging, and recovery source classes remain loop-firewalled.

## Byte proof and retention

Stability uses a 250 ms interval, a baseline plus three unchanged readable size/mtime observations, and a 10 second timeout. Staging is copy-only and requires streaming SHA-256 `source A == staged B == post-copy source C`. The original inbox file and capture staging are retained; P4B has no cleanup or source deletion feature.

## Routing and identity

Every final write reuses `resolveVerifiedProjectRoot`. The root is resolved before planning, before final mutation, and before Revision Snapshot admission. Destination identity is only:

`outputTypeId -> destinationFolderId -> enabled folder UUID -> current derived relative path`

Legacy paths, folder-name guesses, Revision sequence/label inference, and client-supplied final paths are not routing authority. Revision captures retain the exact `targetRevisionId`; a deleted/reused sequence is rejected and a FINALIZED target remains staged and unresolved.

Canonical file names are NFC-normalized, Windows-safe, device-name protected, bounded to 120 characters, and kept within a conservative 240-character absolute path envelope. Collision allocation is case-insensitive on Windows and uses `_A02`, `_A03`, and so on. Identical content reuses the existing final file/version/Snapshot; different content never overwrites.

`AUTO_APPROVED` is recorded immediately before the no-replace final mutation after all objective gates pass. Permanent policy, source-boundary, and stale-Revision failures use immutable `REJECTED` plus `DISCARDED`. Configuration/user-disposition conditions use `UNRESOLVED`; transient file/storage failures use `FAILED_RECOVERABLE`. P4B never writes `USER_CONFIRMED`.

## Recovery and API

Startup reconciles durable `DETECTED`, `STABILIZING`, `STAGED`, `VERIFYING`, `ADMITTED`, and `MATERIALIZING` captures from persisted milestones and exact file/DB identities. `UNRESOLVED` stays unresolved. `FAILED_RECOVERABLE` requires explicit retry. Capture-owned partial files may be verified/replaced; unknown temp-like files are untouched.

Authenticated endpoints are:

- `GET /api/personal/projects/:projectId/captures`
- `GET /api/personal/captures/:captureId`
- `POST /api/personal/captures/:captureId/retry` with an empty body

Responses expose safe names, UUIDs, hashes, states, timestamps, project-relative locators, and allowed recovery actions. Absolute source/root/executable paths are never returned.

Phase 4 remains open. Phase 4C still owns contextual launch UX, Integration Settings, Needs Attention, Manual Capture, and user disposition of unresolved captures.
