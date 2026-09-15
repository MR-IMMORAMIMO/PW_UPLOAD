import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { loadConfig } from '@scli/config';
import { createApp } from './app';
import { createDataProvider } from './provider-factory';
import {
  createPersonalProductionServer,
  isPersonalProductionMode,
} from './infrastructure/startup/createPersonalProductionServer';

try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

// Supported production Personal standalone runtime (APP_MODE=standalone + WORKSPACE_VARIANT=personal
// + NODE_ENV=production) must resolve to the ONE canonical Personal production bootstrap, never to
// the generic legacy-capable assembly below. This prevents the same codebase from running with two
// different production authorities depending on the startup command (P2-FND-A2-01).
if (isPersonalProductionMode(process.env)) {
  // The production Personal server binds 0.0.0.0 so the documented standalone network deployment
  // (docs/standalone-deployment.md) remains reachable on the LAN, matching the pre-existing generic
  // server host binding. All authority assembly, migration, and canonical wiring live in the shared
  // module; this call never returns for a long-running process.
  await createPersonalProductionServer({
    env: process.env,
    host: '0.0.0.0',
  });
  process.exitCode = process.exitCode ?? 0;
} else {
  // Generic / test / team / mock / m365 / development bootstrap. This path intentionally keeps the
  // flexible createApp construction (including the legacy Revision/Export/Package fallback) for
  // explicit non-production harnesses and the team/Microsoft 365 runtimes. It must never be used
  // for a supported production Personal runtime.
  const config = loadConfig();

  const app = await createApp({
    config,
    provider: createDataProvider(config),
  });

  if (config.NODE_ENV === 'production') {
    const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
    const webDist = path.resolve(currentDirectory, '../../web/dist');
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });
    app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
  }

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}
