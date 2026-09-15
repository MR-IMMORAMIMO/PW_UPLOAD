import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { loadConfig } from '@scli/config';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';

const config = loadConfig({
  ...process.env,
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'team',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'production',
});

const app = await createApp({ config, provider: new MockDataProvider() });
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(currentDirectory, '../../web/dist');
await app.register(fastifyStatic, { root: webDist, wildcard: false });
app.get('/*', async (_request, reply) => reply.sendFile('index.html'));

try {
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
