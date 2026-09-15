/**
 * V4 conditional static registration for the canonical personal production
 * server (PW-V4-F1C).
 *
 * The personal production server is the single static host for BOTH renderer
 * variants (one canonical backend, one canonical DB, two presentation
 * surfaces). This module adds the V4 dist under the temporary `/v4` namespace
 * ONLY when the built V4 dist is present, and guarantees registration order so
 * no wildcard/ordering bug can send a `/v4` path into the legacy SPA fallback.
 *
 * Registration order (load-bearing, F1C invariant):
 *
 *   1. `/api/*` routes — registered by `createApp` first; never intercepted by
 *      static serving.
 *   2. Legacy static root (`apps/web/dist`) — registered first so it owns the
 *      `sendFile` reply decorator. `wildcard: false` only registers exact asset
 *      routes, so it does not act as an SPA catch-all.
 *   3. V4 static root (`apps/web-v4/dist`) under prefix `/v4`
 *      (fastify-static `wildcard: false` + `decorateReply: false` so it never
 *      collides with the legacy `sendFile` decorator). Precise, prefixed mount:
 *      it can only ever match paths beginning with `/v4`.
 *   4. V4 SPA fallback `GET /v4/*` → sendFile('index.html') so direct
 *      navigation to V4 nested/unknown paths returns the V4 index (the V4
 *      router then renders Foundation or NotFound). Registered BEFORE the
 *      legacy catch-all below. Exact asset routes from step 3 take precedence
 *      over this wildcard, so real JS/CSS/public files still resolve.
 *   5. Legacy SPA fallback `GET /*` → sendFile('index.html'). Only reached when
 *      no `/v4` route matched.
 *
 * `/api` authority is preserved because API routes are registered ahead of all
 * static routing and the V4 mount is confined to the `/v4` prefix.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const V4_STATIC_PREFIX = '/v4';
export const V4_INDEX_FILENAME = 'index.html';

/**
 * Resolve the V4 dist root relative to a directory containing the compiled
 * server. The server compiles to `apps/api/dist`, so the V4 dist lives at
 * `../../web-v4/dist` from there (matching the legacy `../../web/dist`).
 */
export function resolveV4DistRoot(currentDirectory: string): string {
  return path.resolve(currentDirectory, '../../web-v4/dist');
}

/** True when the V4 production index exists at the given dist root. */
export function v4DistExists(distRoot: string): boolean {
  return existsSync(path.join(distRoot, V4_INDEX_FILENAME));
}

/**
 * Register the V4 static mount + SPA fallback on the given Fastify instance.
 * Returns `false` (and registers nothing) when the V4 dist is absent, so a
 * missing V4 build NEVER breaks legacy startup.
 */
export async function registerV4Static(app: FastifyInstance, distRoot: string): Promise<boolean> {
  if (!v4DistExists(distRoot)) return false;

  // Real asset files (JS/CSS/public) resolve from /v4/<file>. The legacy static
  // registration (registered first by the caller) owns the `sendFile` reply
  // decorator, so V4 disables decorateReply to avoid a decorator collision.
  await app.register(fastifyStatic, {
    root: distRoot,
    prefix: V4_STATIC_PREFIX,
    wildcard: false,
    decorateReply: false,
  });

  // V4 SPA fallback: any /v4 nested/unknown path returns the V4 index. Must be
  // registered before the legacy catch-all (which the caller adds after this
  // returns) so /v4 never reaches legacy index.html. Exact asset routes from
  // the fastify-static registration above take precedence over this wildcard.
  // The legacy static registration owns the `sendFile` decorator, so the V4
  // root must be passed explicitly — otherwise the V4 index would be resolved
  // against the legacy root.
  app.get(`${V4_STATIC_PREFIX}/*`, async (_request, reply) =>
    reply.sendFile(V4_INDEX_FILENAME, distRoot),
  );

  return true;
}
