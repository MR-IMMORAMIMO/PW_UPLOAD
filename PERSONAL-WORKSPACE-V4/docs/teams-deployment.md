# Optional Teams and Microsoft 365 deployment

This is a future upgrade path. The current standalone browser deployment does not require these steps. Embedding even the standalone URL inside Teams can still require the organization's custom-app upload policy.

## What this repository automates

Microsoft 365 Agents Toolkit configuration lives in `m365agents.yml` and `m365agents.local.yml`. It can create/update the Teams and Entra registrations, validate the manifest, package the app, deploy the code through a configured deployment command, and submit a package to the organization catalog.

The local workflow performs no tenant mutation:

```powershell
pnpm teams:validate
pnpm teams:package
```

It produces `appPackage/build/appPackage.local.zip` using non-secret placeholder IDs and an example domain. This ZIP proves packaging only; do not upload it as the production app.

## Required IT inputs

- Microsoft 365 tenant ID and tenant administrator/owner contacts.
- Final single-tenant Entra application client ID and credential approach.
- Final HTTPS tab origin and domain.
- Azure hosting service, subscription/resource group, region and secret store.
- Dedicated SharePoint site ID/URL and permission to create the eight lists.
- Admin consent for the SSO permission and Graph `Sites.Selected` application permission.
- Explicit write grant for the app on the dedicated SharePoint site.
- Teams custom-app upload/catalog policy and approver.
- Bot registration, public messaging endpoint, installation policy and retention approach only when proactive notifications are enabled.
- Approved privacy/terms owners, retention period, support contact, project types, timezone and capacities.

## Tenant environment

Create `env/.env.dev` from `env/.env.example` and replace every placeholder. Configure the hosting environment separately from `.env.example`; never commit the resulting values.

Provision the registration templates:

```powershell
pnpm exec atk provision --env dev
```

This does not grant `Sites.Selected` access to a site. An administrator must grant the service principal `write` permission on the dedicated site. After that grant and after a credential is available to the shell, provision the schema:

```powershell
pnpm sharepoint:provision
```

Copy the emitted `SP_LIST_*_ID` and `SP_SEQUENCE_ITEM_ID` values into the hosting environment. Seed `SCLI_AppUsers` with each user's internal UUID, Entra object ID, role, active state, and Lighting Designer capacity before sign-in testing. A migration from standalone must preserve UUIDs, project codes, record versions, collaborator IDs, and audit timestamps.

## Build and host

The deployment target must support Node 24 and HTTPS. Set all runtime values from `.env.example`, build, and start:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Health probes should call `/api/health`. The tab origin, `WEB_ORIGIN`, manifest `TAB_ENDPOINT`, `TAB_DOMAIN`, Entra identifier URI, and reverse-proxy public URL must agree. Preserve the `Authorization` header to the API and allow Teams framing through the platform's required headers/policies.

Use the checked-in Agents Toolkit deployment step after connecting it to the company's hosting command:

```powershell
pnpm exec atk deploy --env dev
```

## Validate and publish

Run the local gates, then authenticate Agents Toolkit and validate the tenant-resolved package:

```powershell
pnpm check
pnpm exec atk validate --env dev
pnpm exec atk publish --env dev
```

Publishing submits the app for catalog approval; it is not proof that admins approved or installed it. Test in a pilot policy group before broad deployment.

## Proactive notifications

In-app notifications work without a bot. Keep `TEAMS_NOTIFICATIONS_ENABLED=false` for initial deployment. Enabling it requires the notification-only bot ID/secret or approved managed credential, a reachable messaging endpoint, the app/bot installed for recipients, and persisted conversation IDs. The isolated adapter skips delivery when no conversation is known and must never replace the in-app baseline.

## Rollback

Retain the prior Teams package and application deployment artifact. Roll back web/API code first, then upload the prior Teams package only when manifest behavior changed. SharePoint schema changes are additive; do not delete lists or columns during application rollback. Restore data through the organization's SharePoint retention/backup process.
