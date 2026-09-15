import { build } from '../node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const directory = 'output/agreement-recheck-20260912/icons';
await fs.mkdir(directory, { recursive: true });
const source = 'apps/web-v4/src/components/common/SctIcons.tsx';
await build({
  stdin: { contents: `export {sctIcons} from './${source}';`, resolveDir: process.cwd() },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile: directory + '/icons.cjs',
});
const require = createRequire(new URL('../apps/web-v4/package.json', import.meta.url));
const { sctIcons } = require(path.resolve(directory, 'icons.cjs'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const hash = createHash('sha256')
  .update(await fs.readFile(source))
  .digest('hex');
const cards = Object.entries(sctIcons)
  .map(
    ([name, Icon]) =>
      `<article><strong>${name}</strong><div>${[16, 20, 24].map((size) => `<span>${renderToStaticMarkup(React.createElement(Icon, { size }))}<small>${size}px</small></span>`).join('')}</div></article>`,
  )
  .join('');
await fs.writeFile(
  directory + '/preview.html',
  `<!doctype html><meta charset="utf-8"><title>SCT application icons</title><style>body{margin:0;font:14px Arial}header,section{padding:24px}h2{margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}article{border:1px solid #b7c4ce77;border-radius:8px;padding:12px}article div{display:flex;gap:20px;margin-top:12px}span{display:grid;gap:8px;justify-items:center}small{opacity:.65}section.dark{background:#0f172a;color:#e2e8f0}section.light{background:#f7f8fa;color:#0f172a}code{overflow-wrap:anywhere}</style><header><h1>SCT application icons</h1><p>Rendered from the actual application components at 16, 20 and 24 pixels.</p><details><summary>Source verification</summary><code>${source}<br>SHA-256 ${hash}</code></details></header><section class="light"><h2>Light</h2><div class="grid">${cards}</div></section><section class="dark"><h2>Dark</h2><div class="grid">${cards}</div></section>`,
);
console.log(
  JSON.stringify({
    count: Object.keys(sctIcons).length,
    source,
    hash,
    preview: directory + '/preview.html',
  }),
);
