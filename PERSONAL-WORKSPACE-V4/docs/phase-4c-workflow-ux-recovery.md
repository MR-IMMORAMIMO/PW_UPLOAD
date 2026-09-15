# Phase 4C — Tool Workflow UX and Recovery

Phase 4C exposes the Phase 4A/4B foundation through contextual AutoCAD and
DIALux Tool Sessions. Schema authority remains v20. No OCR, document-content
classification, plugin, global automation switch, n8n integration, new Sidebar
route, or Project Header launcher is introduced.

## Security boundary

The renderer receives only one-time Desktop handoff UUIDs, bounded action
enums, Project/context/capture UUIDs, and safe display data. Absolute executable,
Project-root, source, inbox, and final-file paths remain in API-owned handoff
records under the local app data root. Electron main atomically consumes each
record once, rejects expiry/action mismatch/replay, revalidates the Project UUID
marker and file boundary where applicable, and returns no local path.

Supported handoffs are `LAUNCH_TOOL`, `OPEN_EXPORT_FOLDER`, `TEST_LAUNCH`,
`MANUAL_FILE_PICK`, `OPEN_CAPTURE_FILE`, and `REVEAL_CAPTURE_FILE`. There is no
generic execution handoff. Test Launch creates no Tool Context, inbox, watcher,
or capture row.

## Tool Sessions and recovery

- A Tool Session binds one Project UUID, application, output type, exact source
  Document UUID, and exact Revision UUID where revision-level output is used.
- Revision-level starts and restarts require the bound Revision to remain
  `PREPARING`. Project storage and the registered source are reverified.
- An exact LIVE/REBOUND tuple is reused, preventing a second watcher/inbox.
- Restart rebinds the original EXPIRED identity; it never selects the current
  Revision.
- Ending a Tool Session closes the context only. Routed outputs, staging, inbox bytes,
  and recoverable captures remain.
- FINALIZED targets cannot Retry or retarget. The operator starts a new exact
  Tool Session, re-exports, then may discard the old recoverable capture.
- Storage recovery reuses Project storage health/reconnect. Filing repair may
  select only an enabled folder from the stored Project folder snapshot and
  requires the current folder-configuration fingerprint.

## Manual audit semantics

Manual capture creates one `MANUAL_EXPLICIT` / `MANUAL_PICKER_INBOX` Tool
Context. The API durably records the authorizing actor snapshot beside that
context before issuing its picker handoff. Electron copies one eligible regular,
non-link file into the exact inbox and does not disclose its source path to the
renderer. P4B performs the ordinary stability, hash, mapping, naming, filing,
version, and Revision Snapshot pipeline.

Cancelling or failing the one-shot Desktop picker closes the newly created
manual context. A successful first candidate closes it automatically after
admission.

The manual file's single v20 routing decision is `USER_CONFIRMED`, with actor and
time from the durable admission record. It means the user explicitly admitted
that exact file and authorized its bound route. The final objective routing
gates are still revalidated, but no second `AUTO_APPROVED` decision is written.
Automatic Tool Sessions continue to use `AUTO_APPROVED`. Retry, Test Launch,
and Open Export Folder never write `USER_CONFIRMED`. The manual context closes
after its first valid candidate, so it cannot admit a second file.

## Owner UAT diagnostics

Use a disposable v20 Project with a verified marked root. Do not use Golden,
MADAM, the live Personal database, or a business Project folder.

In the Desktop renderer DevTools, substitute disposable UUIDs only:

```js
await fetch('/api/personal/projects/<PROJECT_UUID>/tool-sessions').then((r) => r.json());
await fetch('/api/personal/projects/<PROJECT_UUID>/captures?view=attention&limit=8&page=0').then(
  (r) => r.json(),
);
await fetch('/api/personal/projects/<PROJECT_UUID>/captures?view=recent&limit=8&page=0').then((r) =>
  r.json(),
);
```

UAT sequence:

1. In Settings → Integrations & Automation, select the real AutoCAD installation
   explicitly, verify alternatives remain visible, then use Test Launch. Repeat
   discovery/Test Launch for DIALux. The success copy is “Launch requested.”
2. From a disposable registered DWG/DXF/DWT, start an AutoCAD Working Drawing
   Tool Session. Open its Export Folder and export/copy one controlled DWG.
3. From an exact PREPARING Revision, start Lighting Layout and DIALux Report Tool
   Sessions. Export controlled PDFs and verify Completed rows, relative filing,
   safe Open/Reveal, and refreshed Revision Deliverables.
4. Break only the disposable storage connection, observe `STORAGE_UNAVAILABLE`,
   reconnect through the existing storage UI, then Retry.
5. Remove one disposable output mapping, observe `DESTINATION_MAPPING_REQUIRED`,
   choose an enabled Project folder, save under the current fingerprint, Retry.
6. Finalize a disposable target before routing and verify there is no Retry or
   retarget action; start a new PREPARING Revision/session and re-export.
7. Capture one supported file manually and verify the one-shot picker, closed
   manual context, `USER_CONFIRMED` actor audit, and ordinary P4B filing.
8. Check Light/Dark, exact 1080 width, and 1440×900. Settings and Output Activity
   must not overflow horizontally; Output Activity remains paginated at 8 rows.

Process spawn proves only that a launch was requested. It does not prove license
availability, application readiness, or successful export.
