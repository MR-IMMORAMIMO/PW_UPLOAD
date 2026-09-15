# Phase 5B-C — Master Library Draft Import

Phase 5B-C extends the Smart Import Center with a `MASTER_LIBRARY` destination while preserving the existing Project reconciliation v1 behavior.

## Authority boundaries

- Library reconciliation is schema-versioned as v2 and separates Manufacturer, Product, Variant, technical facts, blockers, warnings, allowed actions, and the recommended action.
- Apply accepts only `LIBRARY_CREATE_DRAFT`, `LIBRARY_USE_EXISTING`, `LIBRARY_REVIEW_EXISTING`, and `SKIP`. There is no update, publish, archive, reactivate, or asset-copy action.
- The Apply service receives a restricted `LuminaireLibraryDraftWritePort`. The port exposes bounded catalogue reads, transactions, replay, and creation of Manufacturer, Product, and mutable Variant rows. It does not expose publish, update, archive, asset, or arbitrary SQL operations.
- Shared Manufacturer and Product dependencies use server-owned group IDs and planned UUIDs stored in existing schema-v25 JSON columns. No migration or new table is required.

## Reconciliation

- Existing exact active Manufacturers resolve automatically. Archived exact Manufacturers block creation. Unknown Manufacturers require an explicit group-level Create decision.
- Products group by planned Manufacturer and normalized Product Family. Conflicting Product Type or Description values block the group until an owner resolves the relevant fact.
- A non-empty Ordering Code is a hard Manufacturer-scoped identity check. Exact active matches permit Use Existing or Review Existing; archived matches cannot be recreated.
- Empty Ordering Codes retain up to five advisory candidates and rely on the planned Variant UUID plus action fingerprint for replay safety.
- Variant labels use the mapped label or a technical descriptor. Ordering Code is never used as the label fallback.
- Numeric power and lumen values preserve the resolved basis (`W`/`W_PER_M`, `LM`/`LM_PER_M`). Unresolved bases block Apply.
- Project-only fields, including Description Override, are evidence only and excluded. Asset columns are evidence only and never create or copy Library asset identities.

## Apply and recovery

- Existing Apply Attempts, active-attempt locks, session revisions, fingerprints, history, restart semantics, and the workspace backup service remain authoritative.
- One verified backup is created before the first Library mutation. Attempts containing only Use Existing and Skip do not create a backup.
- Draft creation runs in deterministic Product-group batches of at most 100 rows. Parent creation and at least one Variant Draft are atomic in the first successful batch.
- Manufacturer, Product, and Variant operations use deterministic import idempotency keys. Destination state is revalidated before backup and before mutation.
- `LIBRARY_USE_EXISTING` records an immutable `USED_EXISTING` row result with exact identities and `mutationOccurred: false`.
- Results never contain a `PUBLISHED` outcome. Terminal summaries always report `Published Versions created: 0`.

## Verification focus

Automated coverage includes strict contracts, create/use-existing outcomes, backup failure with zero Library mutation, Project Apply regression, inspection warnings, backup/restore, and import performance. The implementation uses only disposable in-memory databases and synthetic source evidence.
