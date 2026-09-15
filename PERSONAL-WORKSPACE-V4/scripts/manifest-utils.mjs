import { readFile } from 'node:fs/promises';

export const validationValues = {
  TEAMS_APP_ID: process.env.TEAMS_APP_ID || '10000000-0000-4000-8000-000000000001',
  ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID || '10000000-0000-4000-8000-000000000002',
  TEAMS_BOT_ID: process.env.TEAMS_BOT_ID || '10000000-0000-4000-8000-000000000003',
  TAB_ENDPOINT: process.env.TAB_ENDPOINT || 'https://scli-tracker.example.com',
  TAB_DOMAIN: process.env.TAB_DOMAIN || 'scli-tracker.example.com',
};

export async function resolvedManifest() {
  let source = await readFile('appPackage/manifest.json', 'utf8');
  source = source.replace(/\$\{\{([A-Z0-9_]+)\}\}/g, (_match, name) => {
    const value = validationValues[name];
    if (!value) throw new Error(`No value is available for manifest variable ${name}.`);
    return value;
  });
  return JSON.parse(source);
}
