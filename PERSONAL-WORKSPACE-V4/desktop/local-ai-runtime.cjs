'use strict';
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { ephemeralPort } = require('./local-port.cjs');

function runtimeEnvironment(port, modelsRoot, environment = process.env) {
  return {
    ...environment,
    OLLAMA_HOST: `127.0.0.1:${port}`,
    OLLAMA_MODELS: modelsRoot,
    OLLAMA_NO_CLOUD: '1',
    OLLAMA_NUM_PARALLEL: '1',
    OLLAMA_MAX_LOADED_MODELS: '1',
    OLLAMA_CONTEXT_LENGTH: '4096',
    OLLAMA_KEEP_ALIVE: '30s',
    OLLAMA_DEBUG: '0',
  };
}

async function startLocalAiRuntime(directory) {
  const bundled = path.join(directory, 'Local AI Runtime', 'ollama.exe');
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  // Prefer an existing GPU-capable installation; the kit includes a small CPU fallback.
  const executable = existsSync(installed) ? installed : bundled;
  if (!existsSync(executable)) return { port: 0, stop() {} };
  const modelsRoot = path.join(directory, 'Local AI Models');
  if (!existsSync(modelsRoot)) return { port: 0, stop() {} };
  const port = await ephemeralPort();
  const child = spawn(executable, ['serve'], {
    env: runtimeEnvironment(port, modelsRoot),
    windowsHide: true,
    stdio: 'ignore',
  });
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  const stop = () => {
    if (child.exitCode === null) child.kill();
  };
  for (let attempt = 0; attempt < 60 && !failed && child.exitCode === null; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/version`, {
        signal: AbortSignal.timeout(500),
        redirect: 'error',
      });
      if (response.ok) return { port, stop };
    } catch {
      /* Dedicated loopback server is starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  stop();
  return { port: 0, stop() {} };
}
module.exports = { runtimeEnvironment, startLocalAiRuntime };
