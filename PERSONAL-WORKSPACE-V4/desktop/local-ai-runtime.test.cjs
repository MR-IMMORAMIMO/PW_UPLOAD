const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtimeEnvironment } = require('./local-ai-runtime.cjs');
test('local AI overrides inherited cloud and network settings for its own runtime', () => {
  const environment = runtimeEnvironment(12345, 'C:\\trial\\models', {
    OLLAMA_HOST: 'https://cloud.example',
    OLLAMA_NO_CLOUD: '0',
    OLLAMA_NUM_PARALLEL: '8',
  });
  assert.equal(environment.OLLAMA_HOST, '127.0.0.1:12345');
  assert.equal(environment.OLLAMA_NO_CLOUD, '1');
  assert.equal(environment.OLLAMA_NUM_PARALLEL, '1');
  assert.equal(environment.OLLAMA_MODELS, 'C:\\trial\\models');
  assert.equal(environment.OLLAMA_CONTEXT_LENGTH, '4096');
});
