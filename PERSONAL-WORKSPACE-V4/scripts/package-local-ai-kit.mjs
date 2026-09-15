import { ZipArchive } from 'archiver';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'release-local-ai');
const manifest = JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8'));
const destination = path.join(root, `SCT-Local-AI-${manifest.version}-kit.zip`);
const output = createWriteStream(destination);
const archive = new ZipArchive({ store: true, forceZip64: true });
const completed = new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
});
archive.pipe(output);
for (const file of [
  manifest.executable,
  'START-HERE.md',
  'release-manifest.json',
  'Sample Datasheet.pdf',
])
  archive.file(path.join(root, file), { name: file });
archive.directory(path.join(root, 'Local AI Models'), 'Local AI Models');
archive.directory(path.join(root, 'Local AI Runtime'), 'Local AI Runtime');
await archive.finalize();
await completed;
console.log(JSON.stringify({ destination, bytes: archive.pointer() }));
