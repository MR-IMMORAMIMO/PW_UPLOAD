import { access } from 'node:fs/promises';
import { resolvedManifest } from './manifest-utils.mjs';

const manifest = await resolvedManifest();
const errors = [];
if (manifest.manifestVersion !== '1.23') errors.push('manifestVersion must be 1.23.');
if (!/^[0-9a-f-]{36}$/i.test(manifest.id)) errors.push('id must resolve to a UUID.');
if (!manifest.staticTabs?.some((tab) => tab.scopes?.includes('personal'))) {
  errors.push('A personal static tab is required.');
}
if (!manifest.webApplicationInfo?.id || !manifest.webApplicationInfo?.resource) {
  errors.push('webApplicationInfo is required for Teams SSO.');
}
for (const icon of [manifest.icons?.color, manifest.icons?.outline]) {
  if (!icon) errors.push('Both Teams icons are required.');
  else await access(`appPackage/${icon}`);
}
if (errors.length) throw new Error(`Teams manifest validation failed:\n- ${errors.join('\n- ')}`);
process.stdout.write('Teams manifest structure is valid.\n');
