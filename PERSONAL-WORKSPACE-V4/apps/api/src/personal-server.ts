/**
 * personal-server: Desktop Personal production entrypoint (P2-FND-A2-01).
 *
 * Thin wrapper over the shared canonical Personal production bootstrap
 * (createPersonalProductionServer). This preserves the validated Desktop behavior exactly:
 *   - production DB startup / migration to schema v4
 *   - CANONICAL authority
 *   - atomic Revision generation
 *   - canonical Outputs / Packages
 *   - canonical reconciliation
 *   - legacy projections derived from canonical identity
 * while delegating all authority assembly to the single shared module so standalone startup
 * (pnpm start) can never drift to a legacy authority.
 *
 * The Desktop host binds to 127.0.0.1 and enables Electron parent-child IPC readiness/shutdown.
 */
import { createPersonalProductionServer } from './infrastructure/startup/createPersonalProductionServer';

await createPersonalProductionServer({
  host: '127.0.0.1',
  enableIpc: true,
});
