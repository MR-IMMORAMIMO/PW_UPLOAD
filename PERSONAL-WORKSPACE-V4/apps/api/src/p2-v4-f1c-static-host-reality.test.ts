/**
 * PW-V4-F1C focused static-host tests.
 *
 * Proves the canonical personal production server can serve BOTH renderer
 * variants from ONE backend/DB (legacy UI default + V4 under /v4), with the
 * V4 mount conditional on the built dist, registered before the legacy SPA
 * catch-all, and never swallowing /api.
 *
 * Uses a bare Fastify instance with the same registration order as
 * createPersonalProductionServer (V4 static -> legacy static -> legacy
 * catch-all). Synthetic temp dists avoid depending on a pre-built artifact.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  registerV4Static,
  resolveV4DistRoot,
  v4DistExists,
  V4_STATIC_PREFIX,
} from './infrastructure/startup/v4StaticRegistration';

const tempDirs: string[] = [];

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-v4-f1c-static-'));
  tempDirs.push(dir);
  return dir;
}

function makeDist(indexContent: string, assetFile?: { name: string; content: string }): string {
  const dir = path.join(newTempDir(), 'web-v4', 'dist');
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), indexContent);
  writeFileSync(path.join(dir, 'theme-prepaint.js'), '/* prepaint */');
  if (assetFile) writeFileSync(path.join(dir, 'assets', assetFile.name), assetFile.content);
  return dir;
}

const V4_INDEX_HTML = '<!doctype html><html><body>V4-INDEX</body></html>';
const LEGACY_INDEX_HTML = '<!doctype html><html><body>LEGACY-INDEX</body></html>';

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(path.dirname(dir), { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup.
    }
  }
});

/**
 * Builds a Fastify app with the exact static registration order the canonical
 * personal production server uses: legacy static (owns sendFile), then the
 * optional V4 mount, then the legacy SPA catch-all.
 */
async function buildHost(opts: { v4Dist: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const legacyDist = path.join(newTempDir(), 'web', 'dist');
  mkdirSync(legacyDist, { recursive: true });
  writeFileSync(path.join(legacyDist, 'index.html'), LEGACY_INDEX_HTML);
  await app.register(fastifyStatic, { root: legacyDist, wildcard: false });
  await registerV4Static(app, opts.v4Dist);
  app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
  return app;
}

describe('PW-V4-F1C conditional V4 static registration', () => {
  it('A: missing V4 dist does not break legacy startup and V4 is not mounted', async () => {
    const missing = path.join(newTempDir(), 'does-not-exist');
    const app = await buildHost({ v4Dist: missing });
    try {
      const root = await app.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('LEGACY-INDEX');

      // /v4 must NOT be served when the dist is absent (falls through to legacy
      // catch-all, but the V4 fallback route is not present, so legacy index).
      const v4 = await app.inject({ method: 'GET', url: '/v4/' });
      expect(v4.body).toContain('LEGACY-INDEX');
    } finally {
      await app.close();
    }
  });

  it('B: when V4 dist exists, /v4/ returns the V4 index', async () => {
    const v4Dist = makeDist(V4_INDEX_HTML);
    const app = await buildHost({ v4Dist });
    try {
      const res = await app.inject({ method: 'GET', url: '/v4/' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('V4-INDEX');
    } finally {
      await app.close();
    }
  });

  it('C: V4 static assets resolve from /v4 (JS/CSS/public)', async () => {
    const v4Dist = makeDist(V4_INDEX_HTML, { name: 'index-DD.js', content: 'console.log(1);' });
    const app = await buildHost({ v4Dist });
    try {
      const js = await app.inject({ method: 'GET', url: '/v4/assets/index-DD.js' });
      expect(js.statusCode).toBe(200);
      expect(js.body).toContain('console.log(1);');

      const prepaint = await app.inject({ method: 'GET', url: '/v4/theme-prepaint.js' });
      expect(prepaint.statusCode).toBe(200);
      expect(prepaint.body).toContain('prepaint');
    } finally {
      await app.close();
    }
  });

  it('D: /v4 nested route falls back to the V4 index, not legacy index', async () => {
    const v4Dist = makeDist(V4_INDEX_HTML);
    const app = await buildHost({ v4Dist });
    try {
      for (const url of ['/v4/diagnostic', '/v4/projects/does-not-exist', '/v4/some-unknown']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('V4-INDEX');
      }
    } finally {
      await app.close();
    }
  });

  it('E: /api remains API authority and is not swallowed by V4 static routing', async () => {
    const v4Dist = makeDist(V4_INDEX_HTML);
    const app = Fastify({ logger: false });
    // Simulate API route registered before static.
    app.get('/api/health', async (_request, reply) => reply.send({ status: 'ok' }));
    const legacyDist = path.join(newTempDir(), 'web', 'dist');
    mkdirSync(legacyDist, { recursive: true });
    writeFileSync(path.join(legacyDist, 'index.html'), LEGACY_INDEX_HTML);
    await app.register(fastifyStatic, { root: legacyDist, wildcard: false });
    await registerV4Static(app, v4Dist);
    app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
    try {
      const api = await app.inject({ method: 'GET', url: '/api/health' });
      expect(api.statusCode).toBe(200);
      expect(api.json<{ status: string }>().status).toBe('ok');
      // The API body must not be replaced by a static index.
      expect(api.body).toContain('"status"');
    } finally {
      await app.close();
    }
  });

  it('F: legacy root still serves the legacy UI when V4 dist exists', async () => {
    const v4Dist = makeDist(V4_INDEX_HTML);
    const app = await buildHost({ v4Dist });
    try {
      const root = await app.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('LEGACY-INDEX');
    } finally {
      await app.close();
    }
  });
});

describe('PW-V4-F1C V4 dist resolution helpers', () => {
  it('resolves the V4 dist root relative to the compiled server directory', () => {
    const root = resolveV4DistRoot('C:/app/apps/api/dist');
    // The server compiles to apps/api/dist; V4 dist lives at apps/web-v4/dist.
    expect(path.normalize(root)).toBe(path.normalize('C:/app/apps/web-v4/dist'));
  });

  it('v4DistExists reflects the presence of the V4 index', () => {
    const v4Dist = makeDist(V4_INDEX_HTML);
    expect(v4DistExists(v4Dist)).toBe(true);
    expect(v4DistExists(path.join(newTempDir(), 'nope'))).toBe(false);
  });

  it('the V4 static prefix is /v4', () => {
    expect(V4_STATIC_PREFIX).toBe('/v4');
  });

  it('registration returns false for a missing dist (no routes added)', async () => {
    const app = Fastify({ logger: false });
    try {
      const ok = await registerV4Static(app, path.join(newTempDir(), 'missing'));
      expect(ok).toBe(false);
    } finally {
      await app.close();
    }
  });
});
