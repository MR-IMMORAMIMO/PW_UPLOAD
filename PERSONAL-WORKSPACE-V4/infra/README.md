# Infrastructure notes

Microsoft 365 Agents Toolkit requires its environment and project YAML files at the repository root, so `m365agents.yml`, `m365agents.local.yml`, `env/`, and `appPackage/` remain there. Repeatable SharePoint infrastructure is implemented by `scripts/provision-sharepoint.ts`.

See `docs/teams-deployment.md`, `docs/entra-and-permissions.md`, and `docs/sharepoint-schema.md` before changing tenant resources.
