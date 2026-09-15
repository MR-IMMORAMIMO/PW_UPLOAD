# Golden v19 reality fixture

The historical `golden:uat` seeder establishes the semantic Golden baseline through
`REV_01` and `REV_02`. The additive P2C-11 command upgrades that exact Golden identity
to the current schema-v19 Phase 2 graph. It does not implement reset or migration
fixtures.

The locked Golden identity is:

- UUID: `440bef8e-5799-4e96-87e9-5d617320b6a4`
- code: `004_SCT260812_SCT_UAT_BOUTIQUE_HOTEL_LIGHTING_PACKAGE`
- name: `[SCT UAT] Boutique Hotel Lighting Package`
- marker: `GOLDEN_UAT:BOUTIQUE_HOTEL_LIGHTING_PACKAGE`

PLAN is the default and opens SQLite immutable/read-only. It performs exact identity,
schema, deterministic-ID, and fixture-file conflict checks without starting production
or creating files:

Before running PLAN or VERIFY against a live Personal Workspace database, fully close
the Desktop and its local API process. Immutable SQLite reads the checkpointed main
database and intentionally does not consume potentially uncheckpointed WAL content.

```text
pnpm golden:v19 --db <absolute.sqlite> --fixture-root <absolute-source-root>
```

The standalone verifier is also immutable/read-only. It checks the v19 Revision graph,
mixed Deliverables, Package initial issue/reissue, Issue History privacy, sparse
compatibility truth, delete/reuse provenance, containment, sizes, and SHA-256 evidence:

```text
pnpm golden:v19:verify --db <absolute.sqlite> --fixture-root <absolute-source-root>
```

APPLY is explicit and additive. It rechecks all guards at mutation time and is intended
only for an isolated fixture during implementation/testing or for a separately
Owner-authorized live Golden gate:

```text
pnpm golden:v19 --apply --db <absolute.sqlite> --fixture-root <absolute-source-root>
```

The source root contains small synthetic Drawing, DIALux Report, Datasheet, and delete
evidence inputs. They may be copied manually for harmless TEST-owned UAT input, but the
fixture tool never registers them into TEST and does not pre-drive normal TEST workflows.
This input root is not the Project storage root: canonical snapshots, generated Outputs,
Package materializations, and Revision Delete archives remain owned by the Project's
persisted connected business-folder authority.

Never use Golden as the destructive Revision Delete UAT target. The source-only
`revision-delete:uat:prepare` command remains allowlisted to the exact TEST project and
uses `PRODUCTION_SCHEMA_TARGET_VERSION` rather than a duplicated schema literal.
