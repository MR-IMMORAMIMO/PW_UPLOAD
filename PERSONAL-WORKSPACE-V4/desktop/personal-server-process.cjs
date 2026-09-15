'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  READY: 'ready',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

const READY_MESSAGE = Object.freeze({ type: 'SCLI_PERSONAL_SERVER_READY', version: 1 });
const SHUTDOWN_MESSAGE = Object.freeze({ type: 'SCLI_PERSONAL_SERVER_SHUTDOWN', version: 1 });

class PersonalServerProcessError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'PersonalServerProcessError';
    this.code = code;
  }
}

class StartupBlockedError extends PersonalServerProcessError {
  constructor(message, options) {
    super('STARTUP_BLOCKED', message, options);
    this.name = 'StartupBlockedError';
  }
}

class RecoveryRequiredError extends PersonalServerProcessError {
  constructor(message, options) {
    super('RECOVERY_REQUIRED', message, options);
    this.name = 'RecoveryRequiredError';
  }
}

class StartupFailedError extends PersonalServerProcessError {
  constructor(message, options) {
    super('STARTUP_FAILED', message, options);
    this.name = 'StartupFailedError';
  }
}

class StartupTimeoutError extends PersonalServerProcessError {
  constructor(message, options) {
    super('STARTUP_TIMEOUT', message, options);
    this.name = 'StartupTimeoutError';
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isReadyMessage(message) {
  return (
    typeof message === 'object' &&
    message !== null &&
    message.type === READY_MESSAGE.type &&
    message.version === READY_MESSAGE.version
  );
}

/**
 * One explicit owner of the personal-server child process lifecycle.
 *
 * The owner enforces: one child at a time, no automatic restart loop, verified readiness
 * before start() resolves, a single idempotent shutdown sequence, bounded forced
 * termination as a last-resort fallback, and sanitized (path-free) failure messages.
 */
class PersonalServerProcess extends EventEmitter {
  constructor(options) {
    super();
    this._command = options.command;
    this._args = Array.isArray(options.args) ? options.args : [];
    this._cwd = options.cwd;
    this._env = options.env;
    this._url = options.url;
    this._requireHealth = options.requireHealth === true;
    this._readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
    this._shutdownTimeoutMs = options.shutdownTimeoutMs ?? 8_000;
    this._forcedKillGraceMs = options.forcedKillGraceMs ?? 3_000;
    this._healthIntervalMs = options.healthIntervalMs ?? 180;
    this._onLog = typeof options.onLog === 'function' ? options.onLog : () => {};

    this._state = STATE.IDLE;
    this._child = null;
    this._exitedDeferred = null;
    this._startPromise = null;
    this._resolveStart = null;
    this._rejectStart = null;
    this._stopPromise = null;
    this._startupTimer = null;
    this._stopTimer = null;
    this._healthPoll = null;
    this._startPromiseSettled = false;
    this._readyFromIpc = false;
    this._healthOk = false;
    this._shutdownRequested = false;
    this._shutdownMessageSent = false;
    this._forcedStop = false;
    this._exited = false;
    this._lastExit = null;

    this._onChildExit = (code, signal) => this._handleChildExit(code, signal);
    this._onChildMessage = (message) => this._handleChildMessage(message);
    this._onChildError = () => this._handleChildError();
    this._onStdoutData = (chunk) => this._log('stdout', chunk);
    this._onStderrData = (chunk) => this._log('stderr', chunk);
  }

  get state() {
    return this._state;
  }

  get pid() {
    const child = this._child;
    return child && child.exitCode === null ? child.pid : null;
  }

  get lastExit() {
    return this._lastExit;
  }

  get forcedStop() {
    return this._forcedStop;
  }

  /**
   * Starts one personal-server child and resolves only after verified readiness.
   * Repeated calls while starting or ready never spawn a second child.
   */
  start() {
    if (this._state === STATE.READY) return Promise.resolve({ url: this._url });
    if (this._state === STATE.STARTING) return this._startPromise;
    if (this._state === STATE.STOPPING) {
      return Promise.reject(
        new PersonalServerProcessError(
          'SHUTDOWN_IN_PROGRESS',
          'The personal server is already shutting down.',
        ),
      );
    }
    this._startPromise = this._doStart();
    return this._startPromise;
  }

  /**
   * Requests graceful shutdown once. Repeated calls share the same sequence; forced
   * termination is used only after the shutdown deadline passes.
   */
  stop() {
    if (this._state === STATE.STOPPED) return Promise.resolve();
    if (this._state === STATE.STOPPING) return this._stopPromise;
    this._stopPromise = this._doStop();
    return this._stopPromise;
  }

  _doStart() {
    return new Promise((resolve, reject) => {
      this._resolveStart = resolve;
      this._rejectStart = reject;
      this._resetForStart();
      this._state = STATE.STARTING;
      this._emitState();

      let child;
      try {
        child = spawn(this._command, this._args, {
          cwd: this._cwd,
          env: this._env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
      } catch {
        this._state = STATE.FAILED;
        this._emitState();
        this._startPromiseSettled = true;
        reject(new StartupFailedError('The local workspace service could not be launched.'));
        return;
      }

      this._child = child;
      this._exitedDeferred = createDeferred();
      child.on('exit', this._onChildExit);
      child.on('message', this._onChildMessage);
      child.on('error', this._onChildError);
      if (child.stdout) child.stdout.on('data', this._onStdoutData);
      if (child.stderr) child.stderr.on('data', this._onStderrData);

      this._startupTimer = setTimeout(() => this._handleStartupTimeout(), this._readyTimeoutMs);
      if (this._startupTimer.unref) this._startupTimer.unref();
      this._startHealthPoll();
    });
  }

  _resetForStart() {
    this._startPromiseSettled = false;
    this._readyFromIpc = false;
    this._healthOk = false;
    this._shutdownRequested = false;
    this._shutdownMessageSent = false;
    this._forcedStop = false;
    this._exited = false;
    this._lastExit = null;
    this._exitedDeferred = null;
  }

  _handleChildMessage(message) {
    if (!isReadyMessage(message)) return;
    this._readyFromIpc = true;
    this._maybeFinishStartup();
  }

  _maybeFinishStartup() {
    if (this._startPromiseSettled) return;
    if (this._readyFromIpc && (!this._requireHealth || this._healthOk)) {
      this._startPromiseSettled = true;
      clearTimeout(this._startupTimer);
      this._stopHealthPoll();
      this._state = STATE.READY;
      this._emitState();
      this._resolveStart({ url: this._url });
    }
  }

  _startHealthPoll() {
    if (!this._requireHealth) return;
    this._healthPoll = setInterval(() => {
      void this._probeHealth();
    }, this._healthIntervalMs);
    if (this._healthPoll.unref) this._healthPoll.unref();
    void this._probeHealth();
  }

  async _probeHealth() {
    if (this._startPromiseSettled || this._healthOk || this._state !== STATE.STARTING) return;
    try {
      const response = await fetch(`${this._url}/api/health`);
      if (response.ok) {
        this._healthOk = true;
        this._maybeFinishStartup();
      }
    } catch {
      // The server may not be accepting connections during its first startup ticks.
    }
  }

  _handleStartupTimeout() {
    if (this._startPromiseSettled) return;
    this._startPromiseSettled = true;
    this._stopHealthPoll();
    this._state = STATE.FAILED;
    this._emitState();
    this._forcedStop = true;
    const child = this._child;
    if (child && child.exitCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Best-effort bounded termination; the exit handler still settles the start promise.
      }
      void this._exitedDeferred.promise.then(() => {
        this._cleanupOwned();
        this._rejectStart(
          new StartupTimeoutError('The local workspace service did not become ready in time.'),
        );
      });
    } else {
      this._cleanupOwned();
      this._rejectStart(
        new StartupTimeoutError('The local workspace service did not become ready in time.'),
      );
    }
  }

  _handleChildExit(code, signal) {
    this._exited = true;
    this._lastExit = { code, signal };
    if (this._exitedDeferred) this._exitedDeferred.resolve({ code, signal });

    if (this._state === STATE.STOPPING) return;

    if (this._state === STATE.STARTING && !this._startPromiseSettled) {
      this._startPromiseSettled = true;
      clearTimeout(this._startupTimer);
      this._stopHealthPoll();
      this._state = STATE.FAILED;
      this._emitState();
      this._cleanupOwned();
      if (code === 3) {
        this._rejectStart(
          new StartupBlockedError(
            'The local workspace service cannot start because the workspace is already in use by another instance.',
          ),
        );
      } else if (code === 4) {
        this._rejectStart(
          new RecoveryRequiredError(
            'The local workspace service cannot start because the workspace requires manual recovery.',
          ),
        );
      } else {
        this._rejectStart(
          new StartupFailedError(
            `The local workspace service stopped during startup (exit code ${code ?? 'unknown'}).`,
          ),
        );
      }
      return;
    }

    if (this._state === STATE.READY && !this._shutdownRequested) {
      this._state = STATE.FAILED;
      this._emitState();
      this._cleanupOwned();
      this.emit('unexpected-exit', { code, signal });
    }
  }

  _handleChildError() {
    if (this._state === STATE.STOPPING || this._startPromiseSettled) return;
    this._startPromiseSettled = true;
    clearTimeout(this._startupTimer);
    this._stopHealthPoll();
    this._state = STATE.FAILED;
    this._emitState();
    this._cleanupOwned();
    this._rejectStart(new StartupFailedError('The local workspace service could not be launched.'));
  }

  async _doStop() {
    const child = this._child;
    if (this._state === STATE.FAILED || !child || child.exitCode !== null) {
      // A startup timeout defers its rejection until the killed child's exit is recorded.
      // If stop() preempts that exit, settle the deferred so the start promise never hangs.
      if (this._exitedDeferred) {
        this._exitedDeferred.resolve({
          code: this._lastExit?.code ?? null,
          signal: this._lastExit?.signal ?? null,
        });
      }
      this._cleanupOwned();
      this._state = STATE.STOPPED;
      this._emitState();
      this._settleCancelledStart();
      return;
    }

    this._state = STATE.STOPPING;
    this._emitState();
    this._shutdownRequested = true;
    this._stopHealthPoll();
    clearTimeout(this._startupTimer);
    this._settleCancelledStart();

    if (!this._shutdownMessageSent && typeof child.send === 'function' && child.connected) {
      this._shutdownMessageSent = true;
      try {
        child.send(SHUTDOWN_MESSAGE);
      } catch {
        // The channel may already be closed; bounded forced termination remains the fallback.
      }
    }

    const exited = this._exitedDeferred
      ? this._exitedDeferred.promise.then(() => true)
      : Promise.resolve(true);
    const timedOut = new Promise((resolve) => {
      this._stopTimer = setTimeout(() => resolve(false), this._shutdownTimeoutMs);
    });
    const graceful = await Promise.race([exited, timedOut]);
    clearTimeout(this._stopTimer);

    if (!graceful) {
      this._forcedStop = true;
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Best-effort bounded fallback.
        }
      }
      await this._waitForExited(this._forcedKillGraceMs);
    }

    this._cleanupOwned();
    this._state = STATE.STOPPED;
    this._emitState();
  }

  _settleCancelledStart() {
    if (this._startPromiseSettled) return;
    this._startPromiseSettled = true;
    this._rejectStart(
      new PersonalServerProcessError(
        'STARTUP_CANCELLED',
        'The personal server startup was cancelled.',
      ),
    );
  }

  _waitForExited(timeoutMs) {
    const deferred = this._exitedDeferred;
    if (!deferred) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      void deferred.promise.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  _cleanupOwned() {
    this._stopHealthPoll();
    if (this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    if (this._stopTimer) {
      clearTimeout(this._stopTimer);
      this._stopTimer = null;
    }
    const child = this._child;
    if (child) {
      child.removeListener('exit', this._onChildExit);
      child.removeListener('message', this._onChildMessage);
      child.removeListener('error', this._onChildError);
      if (child.stdout) child.stdout.removeListener('data', this._onStdoutData);
      if (child.stderr) child.stderr.removeListener('data', this._onStderrData);
    }
    this._child = null;
  }

  _stopHealthPoll() {
    if (this._healthPoll) {
      clearInterval(this._healthPoll);
      this._healthPoll = null;
    }
  }

  _log(stream, chunk) {
    const text = String(chunk).trim();
    if (text) this._onLog(stream, text);
  }

  _emitState() {
    this.emit('state', this._state);
  }
}

module.exports = {
  PersonalServerProcess,
  PersonalServerProcessError,
  StartupBlockedError,
  RecoveryRequiredError,
  StartupFailedError,
  StartupTimeoutError,
  STATE,
  READY_MESSAGE,
  SHUTDOWN_MESSAGE,
};
