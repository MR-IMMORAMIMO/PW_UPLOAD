# Local AI trial — 3.3.0-ai.1

The owner approved a separate, entirely local AI trial on 2026-09-10, then requested a small model suitable for weaker machines. This is an explicit exception to the repository's no-AI baseline, limited to this trial branch. The stable product remains on `codex/stable-portable-3.2.3` at commit `087ca56`.

## Isolation and rollback

- Trial branch: `codex/local-ai-verification`.
- Executable: `SCT Workspace Local AI v3.3.0-ai.1.exe`.
- Separate Windows app identity, Electron profile and `SCLI Local AI Data` directory.
- Stable executable and `SCLI Workspace Data` are not modified or migrated by the trial.
- To return to the stable app, close the trial and open the existing 3.2.3 executable. Trial-only changes are not merged back into stable data automatically.
- No commit is pushed. Generated executables, model weights, data, logs and evidence stay outside Git. Source, tests and documentation are committed.

## Opening and moving to another computer

Extract the complete trial ZIP to a writable local folder. Keep these items together:

1. `SCT Workspace Local AI v3.3.0-ai.1.exe`
2. `Local AI Models`
3. `Local AI Runtime`

Double-click the executable. In a Project, attach the exact product Datasheet, open Technical Verification, select **Local AI review**, then **Scan Datasheet**. The trial uses separate data and does not open the stable app's database. For a quick synthetic trial, the kit includes `Sample Datasheet.pdf`: use ordering code **QA100** and Project system power **12 W**; the printed Datasheet system power is **15 W**.

The bundled runtime provides CPU operation without an Ollama installation. An existing compatible Ollama installation is preferred to use its GPU libraries. Inference never installs or downloads models automatically. Missing/unsupported runtimes produce an explicit setup error, not a cloud fallback.

## Lightweight operation

The fixed model is **Qwen3-VL 2B Instruct, Q4_K_M**, approximately **1.9 GB**. Larger models and cloud aliases cannot be selected. The direct-response model was selected instead of the thinking variant. See the [official model variants](https://ollama.com/library/qwen3-vl/tags).

- One scan globally and one page at a time.
- Two CPU inference threads, 4,096-token context, bounded output, 1,000-pixel page raster.
- No background scanning; the user starts each scan and can cancel it.
- The model is explicitly unloaded at the end. A short idle expiry is a fallback.
- Closing the review window leaves the scan running; closing the app cancels it. Interrupted scans are marked incomplete on restart.
- Scan reports are snapshots, with source hash, AssetVersion identity, model digest and time. Changed Project values or attachments are flagged as stale.

Measured on this RTX 4060 Laptop / approximately 31 GB RAM machine using one synthetic Datasheet:

| Test                                                                  | Time                     |
| --------------------------------------------------------------------- | ------------------------ |
| Direct image-only model call, automatic GPU                           | 7.3 seconds              |
| Direct model call forced to CPU, two threads                          | 64.5 seconds             |
| Complete packaged UI scan, GPU                                        | Approximately 10 seconds |
| Complete packaged UI scan, bundled CPU fallback while other tests ran | Approximately 91 seconds |

These are sample measurements, not throughput guarantees. A physically weaker computer was not tested. Dense/scanned PDFs and CPU-only machines can take longer. The trial does not promise that every device can run the model comfortably.

## Privacy and authority

The desktop launches its own Ollama child on an ephemeral `127.0.0.1` port with `OLLAMA_NO_CLOUD=1`. It uses the kit's dedicated model directory and does not alter the user's existing Ollama configuration. The API accepts neither remote URLs nor arbitrary model names; redirects and remote-backed model metadata are rejected. No tools, web search or external provider calls are available to the model. Model files were downloaded during preparation; Project documents remain local during inference. [Ollama local-only settings](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features)

Only the authenticated Personal owner can start, read or cancel reviews. The API resolves canonical Project/Luminaire/AssetVersion identities and checks Datasheet bytes before and after scanning. Client-supplied paths are rejected. Reports are stored separately from Project technical fields, Library snapshots, Revisions and Outputs. AI cannot apply changes or certify a Technical Check result.

The model output is untrusted and schema-validated. Deterministic checks require exact product-code evidence, quoted values, appropriate field labels/basis and compatible units before labeling evidence consistent or different. Ranges, absent evidence and mismatched field labels require review. Even consistent evidence still requires user review.

## Accuracy limits

This small model made real mistakes during testing, including classifying CCT as a cutout and confusing `lm` with `Im` in the image. The guards keep unsupported results in **Needs review**. Summaries and observations are model suggestions and can also be inaccurate; they are not manufacturer-certified statements. The trial is for assisted review, not automatic 100% technical certification. Existing deterministic Technical Verification remains available unchanged.

## Validation

Evidence is retained under `release-local-ai/` and in the validation logs. Tests cover owner access, forged paths, exact attachment bytes, local-only transport, cloud-model rejection, conservative numerical/field-basis checks, persisted reports, stable-edition UI hiding and missing-runtime behavior. Packaged Electron validation runs the real local model and checks that Project data remains unchanged. Both the existing GPU runtime and the kit's CPU fallback were exercised. The portable launcher is tested separately against disposable data.

The complete backend/domain suite passed 3,064 tests with 3 skipped before the final exact-code/subvalue hardening; the affected suite is rerun after that hardening. The full V4 suite passed 1,160 tests, and 8 mock browser E2E tests passed. Final checks and artifact hashes are recorded in the release manifest. Meeting inspector tests now allow five seconds for the existing asynchronous render under load; their assertions are unchanged.

The executable is unsigned. No Microsoft tenant validation or separate clean-machine release certification is claimed.
