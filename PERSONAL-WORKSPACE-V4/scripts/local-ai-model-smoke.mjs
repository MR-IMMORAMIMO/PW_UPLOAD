import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { LocalVisionAdapter } from '../apps/api/src/infrastructure/local-ai/LocalVisionAdapter.ts';
import { PdfExtractionAdapter } from '../apps/api/src/infrastructure/document-intelligence/PdfExtractionAdapter.ts';

const [port, png, output, cpuOnly] = process.argv.slice(2);
const transport = async (url, options) => {
  if (cpuOnly === 'cpu' && String(url).endsWith('/chat')) {
    const body = JSON.parse(options.body);
    body.options.num_gpu = 0;
    options = { ...options, body: JSON.stringify(body) };
  }
  return fetch(url, options);
};
const adapter = new LocalVisionAdapter(Number(port), transport);
const started = performance.now();
const model = await adapter.check();
try {
  const bytes = png.endsWith('.pdf')
    ? (await new PdfExtractionAdapter().renderPage(png, 1, 1000)).png
    : await readFile(png);
  const result = await adapter.readPage(bytes, '', 'QA100', new AbortController().signal);
  const report = {
    mode: cpuOnly === 'cpu' ? 'cpu-only-two-threads' : 'automatic-gpu',
    seconds: (performance.now() - started) / 1000,
    model,
    result,
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      mode: report.mode,
      seconds: report.seconds,
      productCode: result.productCode,
      fields: result.fields.length,
    }),
  );
} finally {
  await adapter.unload();
}
