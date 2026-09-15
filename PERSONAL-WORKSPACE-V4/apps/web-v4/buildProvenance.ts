import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Hash only code and explicitly selected build inputs; never settings or credentials. */
export function v4BuildProvenance(repositoryRoot: string): {
  metadata: { version: string; sourceSha256: string; builtAt: string };
  plugin: Plugin;
} {
  const roots = [
    'apps/web-v4/src',
    'apps/api/src',
    'packages/domain/src',
    'packages/contracts/src',
    'packages/api-client/src',
    'packages/config/src',
    'desktop',
    'tools/luminaire-studio-v1.4.1',
    'apps/web-v4/studio',
  ];
  const files = [
    'package.json',
    'tools/render-luminaire-studio.cjs',
    'apps/web-v4/studioIntegration.ts',
    'pnpm-lock.yaml',
    'apps/web-v4/package.json',
    'apps/api/package.json',
    'apps/api/tsup.config.ts',
    'apps/web-v4/vite.config.ts',
    'apps/web-v4/buildProvenance.ts',
  ];
  const visit = (relative: string) => {
    for (const entry of readdirSync(path.join(repositoryRoot, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && /\.(?:ts|tsx|js|cjs|css|png|svg|ttf|woff2?)$/.test(entry.name))
        files.push(name);
    }
  };
  roots.forEach(visit);
  const digest = createHash('sha256');
  for (const file of files.sort())
    digest
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(repositoryRoot, file)))
      .update('\0');
  const packageMetadata: unknown = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  if (
    !packageMetadata ||
    typeof packageMetadata !== 'object' ||
    !('version' in packageMetadata) ||
    typeof packageMetadata.version !== 'string'
  )
    throw new Error('Missing package version for build provenance.');
  const metadata = {
    version: packageMetadata.version,
    sourceSha256: digest.digest('hex'),
    builtAt: new Date().toISOString(),
  };
  return {
    metadata,
    plugin: {
      name: 'sct-v4-build-provenance',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify(metadata, null, 2),
        });
      },
    },
  };
}
