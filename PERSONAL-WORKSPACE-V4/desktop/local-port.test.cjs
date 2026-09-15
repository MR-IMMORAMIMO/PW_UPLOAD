'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const {
  PREFERRED_LOCAL_PORT,
  resolveLocalPort,
  isPortFree,
  ephemeralPort,
} = require('./local-port.cjs');

// The repository vitest suite also collects this file. It only runs async
// node:test tests, so register one compatible placeholder so the suite is not
// reported as an empty failed file under vitest.
if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop local-port tests are executed with node --test', () => {});
}

const heldServers = [];

function holdPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      heldServers.push(server);
      resolve();
    });
  });
}

after(() => {
  for (const server of heldServers.splice(0)) server.close();
});

test('PREFERRED_LOCAL_PORT is the stable loopback port used by the Desktop', () => {
  assert.equal(typeof PREFERRED_LOCAL_PORT, 'number');
  assert.ok(PREFERRED_LOCAL_PORT >= 1024 && PREFERRED_LOCAL_PORT <= 65535);
});

test('resolveLocalPort returns the preferred port when it is free', async () => {
  // The real desktop port may belong to the owner's running application.
  const preferred = await ephemeralPort();
  const port = await resolveLocalPort(preferred);
  assert.equal(port, preferred);
  assert.equal(await isPortFree(port), true);
});

test('resolveLocalPort falls back to an ephemeral port when the preferred one is occupied', async () => {
  const preferred = await ephemeralPort();
  await holdPort(preferred);
  const port = await resolveLocalPort(preferred);
  assert.notEqual(port, preferred);
  assert.ok(port >= 1024 && port <= 65535);
  assert.equal(await isPortFree(port), true);
});

test('ephemeralPort always yields a usable loopback port', async () => {
  const port = await ephemeralPort();
  assert.ok(port >= 1024 && port <= 65535);
  assert.equal(await isPortFree(port), true);
});

test('desktop main.cjs delegates its port choice to the stable resolver', () => {
  const { readFileSync } = require('node:fs');
  const path = require('node:path');
  const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.match(source, /require\('\.\/local-port\.cjs'\)/);
  assert.doesNotMatch(source, /createServer\(\);[\s\S]*listen\(0,/);
});
