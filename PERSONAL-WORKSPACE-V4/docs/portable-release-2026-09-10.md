# Personal V4 portable delivery — 10 September 2026

The portable is built and validated for owner acceptance testing. This is the Personal application, not the shared Team edition. It is not an unconditional security or clean-machine release certification.

## Delivery

- File: `release-portable-final-20260910/SCT Workspace Portable v3.2.2.exe`
- Version: 3.2.2; build time: 2026-09-10T03:04:09.921Z.
- Source fingerprint: `c5bd3446c5995526e534f2538578518fc3fe62cd4a8316c9e65298e2c70de2f0`.
- EXE SHA-256: `3F575A523F5E5408D4E8EAF4537404E5DA9D30E582F248B3703E8D1848D442C2`.
- Size: 583,141,113 bytes. The payload is stored without extra compression and includes local export/OCR engines.
- Authenticode status: NotSigned. No certificate or security settings were changed.

Place the EXE in a new writable local folder and open it. No development checkout, Node installation or package manager is required by the packaged application. First extraction can take time. The application creates `SCLI Workspace Data` beside the portable. Preserve that entire folder when moving the application; project folders and their managed assets must also remain available. Start acceptance testing in a separate folder rather than replacing an existing production installation or copying live databases while running.

This delivery starts with a fresh Personal workspace. Radio Station review data is not embedded into the executable, and existing business data has not been migrated or modified.

## Fixes made for packaging

The Studio source and rendering helper are now included as application resources. The packaged API resolves the Studio data engine from those resources and launches the packaged executable in a separate render-only mode for PDF/XLSX creation. Render mode does not start the workspace or open its database. Development Electron resolution is retained only for development launches.

The Windows startup test now tracks the server process directly rather than a tsx launcher with a separate child that could retain database handles. A component test retains its exact functional assertions but allows five seconds for the asynchronous Library promotion button. Generated release directories are excluded from source linting.

## Accepted checks

- Domain/API: 193 files, 3036 passed, 3 skipped (`portable-api-accepted.log`).
- V4 components: 123 files, 1156 passed (`portable-v4-accepted.log`).
- Desktop bridges: 42 passed; legacy components: 47 passed.
- Browser E2E: 8 mock workflows, 6 Personal workflows, 4 focused V4 scenarios passed.
- Full TypeScript, ESLint, formatting and production build passed. Final harness scripts also passed scoped lint/format checks.
- Microsoft 365 manifest schema/package validation passed locally. No tenant deployment, SSO or Teams acceptance is claimed.
- Offline OCR packaged resources and checksums passed; the OCR worker initialized from `app.asar` with network disabled.
- Final packaged Electron: 75 route/size checks, zero renderer errors, six real Studio exports (Schedule/BOQ/Datasheets in PDF/XLSX), valid download signatures, canonical Revision records, existing output/package workflows, persisted project and downloadable Studio artifacts after close/reopen. Evidence: `release-portable-final-20260910/unpacked-validation/electron-validation.json`.
- Actual delivered portable EXE copied to a disposable folder: extraction, V4 startup, source/build/API/DOM fingerprint agreement, identity persistence and close/reopen passed. Evidence: `release-portable-final-20260910/launcher-validation/portable-launch.json`; screenshots alongside it.

Earlier failed attempts remain in their logs: stale build fingerprint after formatting; missing packaged Studio source path; Windows test cleanup holding files; asynchronous UI timeout; and Playwright inspector transport incompatibility with the portable wrapper. These were addressed and the acceptance evidence above was recorded after the fixes. The wrapper was tested using loopback Chromium debugging separately from the complete packaged Electron workflow suite.

## Remaining limits

- The external dependency vulnerability audit remains unexecuted. Automatic approval review previously rejected sending package/lockfile metadata to an external registry; explicit approval has not been received. No substitute disclosure or bypass was used.
- The executable is unsigned. It was tested on this Windows machine with isolated data and packaged dependencies, not on a separate clean Windows machine.
- Automated backup, restore and migration suites passed, but upgrading/rolling back a real existing business installation was not performed. Do that only with a verified backup and explicit target selection.
- The entire V4 E2E directory was not rerun in this packaging turn; the listed focused E2E tests and broad packaged route/workflow checks were run. Three backend tests remain intentionally skipped as reported by the suite.
- Team sharing, cloud hosting and corporate Microsoft sign-in remain separate work. Existing intentionally disabled future UI destinations remain unchanged.

No commit, push, live data migration, tenant action or security-policy change was performed.
