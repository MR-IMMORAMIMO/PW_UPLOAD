# Local development

## First run

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

Services:

- Web UI: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3001`
- Health: `http://127.0.0.1:3001/api/health`

Vite proxies `/api` to Fastify. Keep `WEB_ORIGIN=http://localhost:5173` or `http://127.0.0.1:5173` during local work. Restart the API after changing environment values.

The checked-in example starts in `standalone` mode. The first run creates `data/scli.sqlite` and the bootstrap Admin from `.env`. Use **Settings → Users & roles** to add local accounts. See [Standalone deployment](standalone-deployment.md) for production-style hosting and backups.

## Mock users and data

To use the deterministic demo workspace, set `APP_MODE=mock` in `.env` before starting the API.

The initial user is Daniel Brooks, the Line Manager. The **Development mode / View as** selector includes two Sales users, three Lighting Designers, one Line Manager, and one Admin. Fifteen seeded lighting projects cover urgent, overdue, waiting, revision, completed, cancelled, unassigned, and on-behalf scenarios.

Mock persistence is process-local. Restarting the API resets it. `POST /api/test/reset` is additionally available only when all of these are true:

- `APP_MODE=mock`
- `NODE_ENV` is not `production`
- the provider is the real `MockDataProvider`
- request header `x-test-reset: scli-e2e` is present

## Useful commands

```powershell
pnpm dev:api
pnpm dev:web
pnpm format
pnpm lint
pnpm typecheck
pnpm test:all
pnpm test:e2e
pnpm build
```

Install the E2E browser once on a new machine:

```powershell
pnpm exec playwright install chromium
```

## Environment behavior

`packages/config` validates all values at startup. Production standalone mode rejects the example session secret and Admin password. Empty optional Microsoft 365 variables are normalized to undefined. In `m365` mode, incomplete SharePoint settings create an unconfigured provider that returns a safe `CONFIGURATION_REQUIRED` response instead of using local or mock data.

Do not put tenant secrets in `apps/web`, `VITE_*` variables, committed `.env` files, Teams manifests, tests, or screenshots.

## Troubleshooting

- Port in use: stop the prior local process or change `PORT`; Vite is intentionally strict on 5173.
- UI says API is unavailable: confirm `/api/health` on port 3001 and inspect the API terminal.
- E2E starts before API: use the checked-in Playwright configuration; it independently waits for API health and Vite.
- Teams package validation asks for values: run `pnpm teams:validate`; the script creates an ignored `env/.env.local` containing only documented placeholders.
