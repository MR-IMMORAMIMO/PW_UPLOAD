import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('apps', 'api', 'dist', 'ocr-runtime');
// Resolve from the built runtime, so a missing packaged dependency cannot be
// accidentally supplied by the development workspace.
const apiRequire = createRequire(path.join(root, '..', 'personal-server.js'));
const { createWorker, OEM } = apiRequire('tesseract.js');
const worker = await createWorker('eng', OEM.LSTM_ONLY, {
  workerPath: path.join(root, 'offline-worker.cjs'),
  corePath: path.join(root, 'node_modules', 'tesseract.js-core'),
  langPath: path.join(root, 'lang'),
  gzip: true,
  cacheMethod: 'none',
  logger: () => undefined,
});
await worker.terminate();
console.log('Offline OCR runtime initialized with worker network access disabled.');
