'use strict';

const { createServer } = require('node:net');

/**
 * Stable loopback origin for the Desktop renderer.
 *
 * localStorage in the renderer is origin-scoped, so UI preferences that must
 * survive a full Desktop restart (Theme `scli.theme`, sidebar mode
 * `scli.sidebarMode`) need a stable origin. Electron main.cjs allocates a
 * random ephemeral port per launch today, which changes the origin on every
 * restart and silently discards those preferences.
 *
 * We therefore prefer a fixed, unprivileged loopback port and only fall back to
 * an ephemeral port if the preferred one is genuinely in use (so a stray
 * process never blocks startup). The renderer origin is then stable in the
 * common case while the app still never hard-fails on a port collision.
 */
const PREFERRED_LOCAL_PORT = 39177;

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Resolve a stable local port, preferring `preferred` when it is free and
 * falling back to an ephemeral port otherwise.
 */
async function resolveLocalPort(preferred = PREFERRED_LOCAL_PORT) {
  if (await isPortFree(preferred)) return preferred;
  return ephemeralPort();
}

module.exports = {
  PREFERRED_LOCAL_PORT,
  resolveLocalPort,
  isPortFree,
  ephemeralPort,
};
