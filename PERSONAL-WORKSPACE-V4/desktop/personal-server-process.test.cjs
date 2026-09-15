'use strict';

const { after, test } = require('node:test');

// The repository vitest suite also collects this file. Its lifecycle tests spawn synthetic
// child processes and must run under `node --test`; when vitest loads the file, register one
// compatible placeholder so the suite is not reported as an empty failed file.
if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop lifecycle tests are executed with node --test', () => {});
}
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PersonalServerProcess,
  RecoveryRequiredError,
  StartupBlockedError,
  StartupFailedError,
  StartupTimeoutError,
} = require('./personal-server-process.cjs');

const CHILD_SCRIPT = `
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const logDir = process.env.SCLI_TEST_CHILD_LOG_DIR;
if (logDir) {
  fs.appendFileSync(path.join(logDir, 'started.log'), process.pid + '\\n', 'utf8');
}

if (process.env.SCLI_TEST_CHILD_KEEP_ALIVE === '1') {
  setInterval(() => {}, 60_000);
}

const sendReady = process.env.SCLI_TEST_CHILD_SEND_READY === '1';
const readyGate = process.env.SCLI_TEST_CHILD_READY_GATE;
const readyDelay = Number(process.env.SCLI_TEST_CHILD_READY_DELAY_MS || 0);
const exitCodeRaw = process.env.SCLI_TEST_CHILD_EXIT_CODE;
const exitCode =
  exitCodeRaw === undefined || exitCodeRaw === '' ? null : Number(exitCodeRaw);
const exitDelay = Number(process.env.SCLI_TEST_CHILD_EXIT_DELAY_MS || 0);
const handleShutdown = process.env.SCLI_TEST_CHILD_HANDLE_SHUTDOWN === '1';

const emitReady = () => {
  if (typeof process.send === 'function' && process.connected) {
    process.send({ type: 'SCLI_PERSONAL_SERVER_READY', version: 1 });
  }
};

if (sendReady) {
  if (readyGate) {
    const poll = setInterval(() => {
      if (fs.existsSync(readyGate)) {
        clearInterval(poll);
        emitReady();
      }
    }, 20);
  } else if (readyDelay > 0) {
    setTimeout(emitReady, readyDelay);
  } else {
    emitReady();
  }
}

if (exitCode !== null) {
  setTimeout(() => process.exit(exitCode), exitDelay);
}

const recordMessage = (message) => {
  if (logDir) {
    fs.appendFileSync(
      path.join(logDir, 'shutdown-messages.jsonl'),
      JSON.stringify(message) + '\\n',
      'utf8',
    );
  }
};

if (handleShutdown) {
  process.on('message', (message) => {
    recordMessage(message);
    if (
      message &&
      message.type === 'SCLI_PERSONAL_SERVER_SHUTDOWN' &&
      message.version === 1
    ) {
      setTimeout(() => process.exit(0), 50);
    }
  });
} else {
  process.on('message', recordMessage);
}
`;

const tempRoots = [];

function newTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scli-desktop-lifecycle-'));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function readJsonLines(file) {
  return readLines(file).map((line) => JSON.parse(line));
}

function startSupervisor(dir, childEnv = {}, options = {}) {
  const childScript = path.join(dir, 'child.cjs');
  writeFileSync(childScript, CHILD_SCRIPT, 'utf8');
  return new PersonalServerProcess({
    command: process.execPath,
    args: [childScript],
    cwd: dir,
    env: {
      ...process.env,
      SCLI_TEST_CHILD_LOG_DIR: dir,
      SCLI_TEST_CHILD_KEEP_ALIVE: '1',
      ...childEnv,
    },
    url: 'http://127.0.0.1:39871',
    requireHealth: false,
    readyTimeoutMs: options.readyTimeoutMs ?? 10_000,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 8_000,
    forcedKillGraceMs: options.forcedKillGraceMs ?? 3_000,
    onLog: () => {},
  });
}

test(
  'starts exactly one child and only reports ready after READY',
  { timeout: 15_000 },
  async () => {
    const dir = newTempDir();
    const server = startSupervisor(dir, {
      SCLI_TEST_CHILD_SEND_READY: '1',
      SCLI_TEST_CHILD_HANDLE_SHUTDOWN: '1',
    });
    const states = [];
    server.on('state', (state) => states.push(state));
    const result = await server.start();
    assert.equal(result.url, 'http://127.0.0.1:39871');
    assert.equal(server.state, 'ready');
    assert.deepEqual(readLines(path.join(dir, 'started.log')).length, 1);
    await server.stop();
    assert.equal(server.state, 'stopped');
    assert.deepEqual(states, ['starting', 'ready', 'stopping', 'stopped']);
  },
);

test(
  'window is not shown before readiness and READY allows the window',
  { timeout: 15_000 },
  async () => {
    const dir = newTempDir();
    const gate = path.join(dir, 'ready.gate');
    const server = startSupervisor(dir, {
      SCLI_TEST_CHILD_SEND_READY: '1',
      SCLI_TEST_CHILD_READY_GATE: gate,
      SCLI_TEST_CHILD_HANDLE_SHUTDOWN: '1',
    });
    let windowShown = false;
    const started = server.start().then(() => {
      windowShown = true;
    });
    await delay(150);
    assert.equal(server.state, 'starting');
    assert.equal(windowShown, false);
    writeFileSync(gate, 'ready', 'utf8');
    await started;
    assert.equal(server.state, 'ready');
    assert.equal(windowShown, true);
    await server.stop();
  },
);

test('STARTUP_BLOCKED does not show the window', { timeout: 15_000 }, async () => {
  const dir = newTempDir();
  const server = startSupervisor(dir, { SCLI_TEST_CHILD_EXIT_CODE: '3' });
  await assert.rejects(
    server.start(),
    (error) => error instanceof StartupBlockedError && error.code === 'STARTUP_BLOCKED',
  );
  assert.equal(server.state, 'failed');
  await server.stop();
  assert.equal(server.state, 'stopped');
});

test('RECOVERY_REQUIRED does not show the window', { timeout: 15_000 }, async () => {
  const dir = newTempDir();
  const server = startSupervisor(dir, { SCLI_TEST_CHILD_EXIT_CODE: '4' });
  await assert.rejects(
    server.start(),
    (error) => error instanceof RecoveryRequiredError && error.code === 'RECOVERY_REQUIRED',
  );
  assert.equal(server.state, 'failed');
  await server.stop();
  assert.equal(server.state, 'stopped');
});

test('unknown child failure remains an error', { timeout: 15_000 }, async () => {
  const dir = newTempDir();
  const server = startSupervisor(dir, { SCLI_TEST_CHILD_EXIT_CODE: '1' });
  await assert.rejects(
    server.start(),
    (error) =>
      error instanceof StartupFailedError &&
      !(error instanceof StartupBlockedError) &&
      !(error instanceof RecoveryRequiredError) &&
      error.code === 'STARTUP_FAILED',
  );
  assert.equal(server.state, 'failed');
  await server.stop();
  assert.equal(server.state, 'stopped');
});

test('startup timeout fails closed', { timeout: 15_000 }, async () => {
  const dir = newTempDir();
  const server = startSupervisor(dir, {}, { readyTimeoutMs: 500 });
  await assert.rejects(
    server.start(),
    (error) => error instanceof StartupTimeoutError && error.code === 'STARTUP_TIMEOUT',
  );
  assert.equal(server.state, 'failed');
  assert.ok(server.lastExit !== null, 'bounded child must be terminated on timeout');
  await server.stop();
  assert.equal(server.state, 'stopped');
});

test('repeated startup calls do not create duplicate children', { timeout: 15_000 }, async () => {
  const dir = newTempDir();
  const gate = path.join(dir, 'ready.gate');
  const server = startSupervisor(dir, {
    SCLI_TEST_CHILD_SEND_READY: '1',
    SCLI_TEST_CHILD_READY_GATE: gate,
    SCLI_TEST_CHILD_HANDLE_SHUTDOWN: '1',
  });
  const first = server.start();
  const second = server.start();
  assert.equal(first, second);
  assert.equal(server.state, 'starting');
  writeFileSync(gate, 'ready', 'utf8');
  const [resultA, resultB] = await Promise.all([first, second]);
  assert.equal(resultA.url, resultB.url);
  assert.equal(readLines(path.join(dir, 'started.log')).length, 1);
  assert.equal(server.state, 'ready');
  await server.stop();
});

test(
  'repeated shutdown calls execute one sequence and send IPC shutdown once',
  { timeout: 15_000 },
  async () => {
    const dir = newTempDir();
    const server = startSupervisor(dir, {
      SCLI_TEST_CHILD_SEND_READY: '1',
      SCLI_TEST_CHILD_HANDLE_SHUTDOWN: '1',
    });
    await server.start();
    await Promise.all([server.stop(), server.stop()]);
    assert.equal(server.state, 'stopped');
    const messages = readJsonLines(path.join(dir, 'shutdown-messages.jsonl'));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], { type: 'SCLI_PERSONAL_SERVER_SHUTDOWN', version: 1 });
    assert.equal(server.lastExit.code, 0);
    assert.equal(server.forcedStop, false);
  },
);

test(
  'normal child exit completes shutdown without forced termination',
  { timeout: 15_000 },
  async () => {
    const dir = newTempDir();
    const server = startSupervisor(dir, {
      SCLI_TEST_CHILD_SEND_READY: '1',
      SCLI_TEST_CHILD_HANDLE_SHUTDOWN: '1',
    });
    await server.start();
    await server.stop();
    assert.equal(server.state, 'stopped');
    assert.equal(server.lastExit.code, 0);
    assert.equal(server.forcedStop, false);
  },
);

test('shutdown timeout invokes bounded forced termination', { timeout: 15_000 }, async () => {
  const dir = newTempDir();
  const server = startSupervisor(
    dir,
    { SCLI_TEST_CHILD_SEND_READY: '1' },
    { shutdownTimeoutMs: 500 },
  );
  await server.start();
  await server.stop();
  assert.equal(server.state, 'stopped');
  assert.equal(server.forcedStop, true);
  assert.ok(server.lastExit !== null, 'forced fallback must terminate the child');
});

test(
  'unexpected child exit while ready is surfaced without automatic restart',
  { timeout: 15_000 },
  async () => {
    const dir = newTempDir();
    const server = startSupervisor(dir, {
      SCLI_TEST_CHILD_SEND_READY: '1',
      SCLI_TEST_CHILD_EXIT_CODE: '1',
      SCLI_TEST_CHILD_EXIT_DELAY_MS: '400',
    });
    const unexpected = new Promise((resolve) => server.once('unexpected-exit', resolve));
    await server.start();
    const info = await unexpected;
    assert.equal(info.code, 1);
    assert.equal(server.state, 'failed');
    assert.equal(readLines(path.join(dir, 'started.log')).length, 1);
    await server.stop();
    assert.equal(server.state, 'stopped');
  },
);

test('second-instance behavior still focuses the existing window', () => {
  const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.match(source, /app\.on\('second-instance'/);
  assert.match(source, /mainWindow\.isMinimized\(\)/);
  assert.match(source, /mainWindow\.restore\(\)/);
  assert.match(source, /mainWindow\.focus\(\)/);
});

test('personal desktop and startup dialogs use current copy without changing lifecycle wiring', () => {
  const mainSource = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const supervisorSource = readFileSync(
    path.join(__dirname, 'personal-server-process.cjs'),
    'utf8',
  );
  assert.match(mainSource, /: 'SCT Workspace';/);
  assert.doesNotMatch(mainSource, /: 'SCLI Workspace';/);
  assert.doesNotMatch(mainSource, /local SCLI service/i);
  assert.doesNotMatch(supervisorSource, /local SCLI service/i);
  assert.match(
    supervisorSource,
    /The local workspace service cannot start because the workspace is already in use by another instance\./,
  );
  assert.match(supervisorSource, /SCLI_PERSONAL_SERVER_READY/);
  assert.match(supervisorSource, /SCLI_PERSONAL_SERVER_SHUTDOWN/);
});

test(
  'explicit restart after stop starts a new child without duplicates',
  { timeout: 15_000 },
  async () => {
    const dir = newTempDir();
    const server = startSupervisor(dir, {
      SCLI_TEST_CHILD_SEND_READY: '1',
      SCLI_TEST_CHILD_HANDLE_SHUTDOWN: '1',
    });
    await server.start();
    await server.stop();
    const again = await server.start();
    assert.equal(again.url, 'http://127.0.0.1:39871');
    assert.equal(server.state, 'ready');
    assert.equal(readLines(path.join(dir, 'started.log')).length, 2);
    await server.stop();
  },
);

test('no test writes inside the repository', () => {
  const repoDesktop = path.resolve(__dirname);
  const temp = mkdtempSync(path.join(os.tmpdir(), 'scli-desktop-lifecycle-probe-'));
  try {
    const resolvedTemp = path.resolve(temp);
    assert.ok(
      resolvedTemp.startsWith(path.resolve(os.tmpdir())),
      'temporary data must live outside the repository',
    );
    assert.ok(
      !resolvedTemp.startsWith(repoDesktop + path.sep) && resolvedTemp !== repoDesktop,
      'temporary data must not be inside the repository',
    );
    writeFileSync(path.join(temp, 'probe.txt'), 'x', 'utf8');
    assert.ok(existsSync(path.join(temp, 'probe.txt')));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
