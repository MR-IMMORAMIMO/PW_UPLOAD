'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveUiVariant, shouldLaunchV4, windowUrlForUiVariant } = require('./ui-variant.cjs');

// The repository vitest suite also collects this file. It only runs async
// node:test tests, so register one compatible placeholder so the suite is not
// reported as an empty failed file under vitest.
if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop ui-variant tests are executed with node --test', () => {});
}

test('SCT_UI_VARIANT unset resolves to V4 (Personal default)', () => {
  assert.equal(resolveUiVariant(undefined), 'v4');
});

test('SCT_UI_VARIANT legacy resolves to legacy', () => {
  assert.equal(resolveUiVariant('legacy'), 'legacy');
});

test('SCT_UI_VARIANT v4 resolves to v4', () => {
  assert.equal(resolveUiVariant('v4'), 'v4');
});

test('unexpected SCT_UI_VARIANT value retains the V4 default', () => {
  assert.equal(resolveUiVariant('team'), 'v4');
  assert.equal(resolveUiVariant(''), 'v4');
  assert.equal(resolveUiVariant('V4'), 'v4');
  assert.equal(resolveUiVariant('anything-weird'), 'v4');
});

test('V4 launch is gated to the Personal workspace variant', () => {
  assert.equal(shouldLaunchV4('personal', 'v4'), true);
  assert.equal(shouldLaunchV4('personal', 'legacy'), false);
  assert.equal(shouldLaunchV4('team', 'v4'), false);
  assert.equal(shouldLaunchV4('team-demo', 'v4'), false);
});

test('window URL for legacy is the server origin root', () => {
  assert.equal(windowUrlForUiVariant('http://127.0.0.1:3001', 'legacy'), 'http://127.0.0.1:3001');
});

test('window URL for V4 is the origin plus the /v4 mount', () => {
  assert.equal(windowUrlForUiVariant('http://127.0.0.1:3001', 'v4'), 'http://127.0.0.1:3001/v4/');
});
