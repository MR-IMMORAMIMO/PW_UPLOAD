# UX workflow improvements — 12 September 2026

The owner requested an independent copy of the current version before applying the agreed usability improvements. The existing page structure, navigation and visual identity remain the reference.

## Independent baseline

`release/preserved-before-ux-20260912` contains the original portable executable, a verified ZIP of 1,172 source files (including the existing uncommitted work), a per-file SHA-256 manifest, the original Git state and prior release evidence. Dependencies, generated output and runtime databases are excluded. This is a program/source backup, not a backup of business data.

The original executable SHA-256 is `9dfefd7bbf961a70f935b057415d11565a6c1cc7e048514bf44878d27760a0b8`. The source archive SHA-256 is `f8f8025ea5cca5a223634fd9e02f956d4974d37574eec57f9b48dc732f9b1fe9`.

The improved portable is built separately under `release/ux-flow-20260912`. Launch each portable from its own directory to keep its default portable workspace separate. No live Project folders, database or user profile were copied into either release.

## Ordered implementation

| Order | Area                          | Result                                                                                                                                                                                                                                                                                                                                             |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Repetitive project browsing   | Search, filters, page, page size and grouping survive returning to Projects. Settings are validated and scoped to the signed-in user. Dashboard drill-down overrides a saved filter. Existing bulk operations and column/view preferences were retained and exercised.                                                                             |
| 2     | Draft protection              | New Project saves an edited draft after 1.2 seconds of inactivity, displays saving/saved/error status and supports manual retry. An older draft is protected until explicitly resumed or manually replaced. Saves and project creation are serialized. Navigation/close protection keeps unsaved inputs recoverable; explicit discard closes once. |
| 3     | Faster access                 | Ctrl/Cmd+K opens existing workspace search, except while a dialog or text composition is active. Search accepts at least two characters and includes luminaires. Results link to the canonical Project/record identity. File results reveal the actual file and its page, including when the current register has filters.                         |
| 4     | Clear operations              | Shared loading buttons are disabled and announce busy state. Draft feedback avoids success-notification noise. Existing error/retry and bulk workflows remain in place.                                                                                                                                                                            |
| 5     | Technical workflow continuity | Technical Check retains its filters, search, page, sort and selected finding while navigating away and back in the same running app. Selection restoration waits for saved findings to load. Existing luminaire/datasheet routes and scoped correction authority are preserved.                                                                    |
| 6     | Theme and smaller windows     | Existing Light/Dark palette and layout are preserved. Wizard header/action content wraps when necessary. Native screenshots verify Light and Dark at 1024 × 768 with reachable close/next controls.                                                                                                                                                |
| 7     | Responsive loading            | Project search rendering is deferred; luminaire images use lazy loading and asynchronous decoding. Workspace search applies project-access restrictions before bounded SQL limits, escapes literal wildcard characters and uses stable ordering. No benchmark speedup percentage or all-page virtualization is claimed.                            |

Project browsing preferences use `scli.v4.projects.browse.<ownerId>` in browser storage and recover gracefully if storage is unavailable or invalid. Technical Check continuity uses the in-memory query cache; it is not a promise of restoration after application restart. Project drafts use the existing server-backed draft endpoint. No schema migration or new external service was introduced.

## Validation

- Domain/API: 3,127 passed; three existing skipped tests.
- V4 component suite: 1,231 passed. Focused follow-up checks after the final corrections: 19 Project Files and nine Technical Check tests passed.
- Legacy components: 47 passed. Desktop tests: 49 passed.
- Mock end-to-end: 23 V4, eight team-mode and six personal-mode tests passed.
- Formatting, ESLint, TypeScript and production builds passed, including focused rechecks after the final corrections.
- Microsoft 365 manifest validation and local package generation passed. No tenant deployment, SSO or Graph test is claimed.
- Native Electron journeys exercised draft creation/resume, Project creation, actions, meetings, luminaires, attachments, files, revision/package operations, remembered browsing and canonical luminaire search in Light and Dark.
- Final native verification covers Technical Check return context, previous-draft preservation, discard, restart/resume and Light/Dark at 1024 × 768. Packaged runtime evidence is recorded in `output/ux-flow-20260912/packaged/results.json` and must show `passed: true`, `packaged: true` and the matching build hash.

Generated reports and temporary verification helpers are excluded from source lint/format discovery. Test rules and application source remain checked. Initial heavily concurrent test runs encountered timing/file-lock failures; clean reruns and the focused final checks are the acceptance evidence.

## Evidence and delivery

The concise owner report, runtime screenshots, release hashes and baseline comparison are under `output/ux-flow-20260912`. Release provenance is also copied next to the improved executable. All UI/runtime validation used disposable test data. Existing unrelated dirty source was preserved. No commit, push or live-data migration was performed.
