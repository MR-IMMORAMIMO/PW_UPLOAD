import { defineConfig } from 'tsup';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const apiRequire = createRequire(import.meta.url);
const pdfParseRequire = createRequire(apiRequire.resolve('pdf-parse'));
const pdfWorkerSource = pdfParseRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
const canvasRoot = path.dirname(pdfParseRequire.resolve('@napi-rs/canvas/package.json'));
const canvasRequire = createRequire(path.join(canvasRoot, 'package.json'));
const nativeCanvasRoot = path.dirname(
  canvasRequire.resolve('@napi-rs/canvas-win32-x64-msvc/package.json'),
);
const tesseractPackage = apiRequire.resolve('tesseract.js/package.json');
const tesseractRoot = path.dirname(tesseractPackage);
const tesseractRequire = createRequire(tesseractPackage);
const tesseractCoreRoot = path.dirname(tesseractRequire.resolve('tesseract.js-core/package.json'));
const wasmFeatureRoot = path.dirname(tesseractRequire.resolve('wasm-feature-detect/package.json'));
const regeneratorRoot = path.dirname(tesseractRequire.resolve('regenerator-runtime/package.json'));
const isUrlRoot = path.dirname(tesseractRequire.resolve('is-url/package.json'));
const bmpRoot = path.dirname(tesseractRequire.resolve('bmp-js/package.json'));
const englishDataRoot = path.dirname(apiRequire.resolve('@tesseract.js-data/eng/package.json'));
const englishDataSource = path.join(englishDataRoot, '4.0.0_best_int', 'eng.traineddata.gz');

async function checksumFiles(root: string, current = root): Promise<Record<string, string>> {
  const checksums: Record<string, string> = {};
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      Object.assign(checksums, await checksumFiles(root, absolutePath));
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
      checksums[relativePath] = createHash('sha256')
        .update(await readFile(absolutePath))
        .digest('hex');
    }
  }
  return checksums;
}

async function packageOcrRuntime(): Promise<void> {
  const runtimeRoot = path.resolve('dist', 'ocr-runtime');
  const apiNodeModulesRoot = path.resolve('dist', 'node_modules');
  await mkdir(path.join(runtimeRoot, 'lang'), { recursive: true });
  await mkdir(apiNodeModulesRoot, { recursive: true });
  await Promise.all([
    cp(tesseractRoot, path.join(runtimeRoot, 'node_modules', 'tesseract.js'), { recursive: true }),
    cp(tesseractCoreRoot, path.join(runtimeRoot, 'node_modules', 'tesseract.js-core'), {
      recursive: true,
    }),
    cp(wasmFeatureRoot, path.join(runtimeRoot, 'node_modules', 'wasm-feature-detect'), {
      recursive: true,
    }),
    cp(regeneratorRoot, path.join(runtimeRoot, 'node_modules', 'regenerator-runtime'), {
      recursive: true,
    }),
    cp(isUrlRoot, path.join(runtimeRoot, 'node_modules', 'is-url'), { recursive: true }),
    cp(bmpRoot, path.join(runtimeRoot, 'node_modules', 'bmp-js'), { recursive: true }),
    // The API host loads Tesseract as its native CommonJS package instead of
    // folding it into the ESM bundle. Keep a self-contained copy beside the
    // generated entry chunks; the isolated worker runtime above remains
    // unchanged and continues to use its network-disabled assets.
    cp(tesseractRoot, path.join(apiNodeModulesRoot, 'tesseract.js'), { recursive: true }),
    cp(tesseractCoreRoot, path.join(apiNodeModulesRoot, 'tesseract.js-core'), {
      recursive: true,
    }),
    cp(wasmFeatureRoot, path.join(apiNodeModulesRoot, 'wasm-feature-detect'), {
      recursive: true,
    }),
    cp(regeneratorRoot, path.join(apiNodeModulesRoot, 'regenerator-runtime'), {
      recursive: true,
    }),
    cp(isUrlRoot, path.join(apiNodeModulesRoot, 'is-url'), { recursive: true }),
    cp(bmpRoot, path.join(apiNodeModulesRoot, 'bmp-js'), { recursive: true }),
    copyFile(englishDataSource, path.join(runtimeRoot, 'lang', 'eng.traineddata.gz')),
    copyFile(path.join(tesseractRoot, 'LICENSE.md'), path.join(runtimeRoot, 'LICENSE.txt')),
  ]);
  await writeFile(
    path.join(runtimeRoot, 'offline-worker.cjs'),
    "'use strict'; global.fetch = async () => { throw new Error('P5C_OCR_NETWORK_DISABLED'); }; require('./node_modules/tesseract.js/src/worker-script/node/index.js');\n",
    'utf8',
  );
  const checksums = await checksumFiles(runtimeRoot);
  await writeFile(
    path.join(runtimeRoot, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, packages: { 'tesseract.js': '7.0.0', 'tesseract.js-core': '7.0.0', '@tesseract.js-data/eng': '1.0.0' }, checksums }, null, 2)}\n`,
    'utf8',
  );
}

export default defineConfig({
  entry: [
    'src/server.ts',
    'src/personal-server.ts',
    'src/team-server.ts',
    'src/team-demo-server.ts',
  ],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  banner: {
    js: "import { createRequire as __scliCreateRequire } from 'node:module'; const require = __scliCreateRequire(import.meta.url);",
  },
  external: ['node:sqlite', 'tesseract.js'],
  noExternal: [
    'pngjs',
    /^@scli\//,
    /^(fastify|@fastify\/|jose|zod|archiver|exceljs|jszip|pdf-parse|pdfjs-dist|@thednp\/dommatrix)/,
  ],
  onSuccess: async () => {
    await copyFile(pdfWorkerSource, path.resolve('dist', 'pdf.worker.mjs'));
    await packageOcrRuntime();
    await cp(canvasRoot, path.resolve('dist/node_modules/@napi-rs/canvas'), { recursive: true });
    await cp(nativeCanvasRoot, path.resolve('dist/node_modules/@napi-rs/canvas-win32-x64-msvc'), {
      recursive: true,
    });
  },
});
