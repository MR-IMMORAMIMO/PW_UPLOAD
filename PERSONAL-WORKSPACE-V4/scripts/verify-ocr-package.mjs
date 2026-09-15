import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const runtimeRoot = path.resolve('apps', 'api', 'dist', 'ocr-runtime');
const manifestPath = path.join(runtimeRoot, 'manifest.json');
if (!existsSync(manifestPath))
  throw new Error('OCR package manifest is missing. Run the API build first.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const required = [
  'offline-worker.cjs',
  'node_modules/tesseract.js/src/worker-script/node/index.js',
  'node_modules/tesseract.js-core/tesseract-core.wasm.js',
  'node_modules/tesseract.js-core/tesseract-core-simd.wasm.js',
  'node_modules/wasm-feature-detect/dist/umd/index.js',
  'lang/eng.traineddata.gz',
  'LICENSE.txt',
];
for (const relativePath of required) {
  const absolutePath = path.join(runtimeRoot, ...relativePath.split('/'));
  if (!existsSync(absolutePath))
    throw new Error(`Required offline OCR asset is missing: ${relativePath}`);
  const checksum = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
  if (manifest.checksums?.[relativePath] !== checksum)
    throw new Error(`OCR checksum mismatch: ${relativePath}`);
}
if (
  manifest.packages?.['tesseract.js'] !== '7.0.0' ||
  manifest.packages?.['@tesseract.js-data/eng'] !== '1.0.0'
) {
  throw new Error('OCR package versions are not pinned to the Phase 5C authority.');
}
console.log(
  `Offline OCR package verified: ${required.length} required assets and pinned checksums.`,
);
