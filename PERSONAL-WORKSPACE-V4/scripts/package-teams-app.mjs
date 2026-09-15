import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { ZipArchive } from 'archiver';
import { resolvedManifest } from './manifest-utils.mjs';

await mkdir('appPackage/build', { recursive: true });
const manifest = await resolvedManifest();
await writeFile('appPackage/build/manifest.local.json', `${JSON.stringify(manifest, null, 2)}\n`);

await new Promise((resolve, reject) => {
  const output = createWriteStream('appPackage/build/appPackage.local.zip');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.pipe(output);
  archive.file('appPackage/build/manifest.local.json', { name: 'manifest.json' });
  archive.file('appPackage/color.png', { name: 'color.png' });
  archive.file('appPackage/outline.png', { name: 'outline.png' });
  void archive.finalize();
});
process.stdout.write('Created appPackage/build/appPackage.local.zip.\n');
