import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [asarPath, pdfPath, outputPath] = process.argv.slice(2);
if (!asarPath || !pdfPath) {
  throw new Error(
    'Usage: verify-packaged-local-intelligence.mjs <app.asar> <datasheet.pdf> [result.json]',
  );
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'scli-packaged-ai-'));
const bundledApiUrl = pathToFileURL(
  path.join(path.resolve(asarPath), 'apps', 'api', 'dist', 'chunk-VRTHWXUR.js'),
).href;
const { createApp, loadConfig, StandaloneDataProvider } = await import(bundledApiUrl);
const config = loadConfig({
  APP_MODE: 'standalone',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'true',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  STANDALONE_DB_PATH: path.join(temporaryRoot, 'scli.sqlite'),
  STANDALONE_SESSION_SECRET: 'packaged-ai-check-session-secret-longer-than-thirty-two-characters',
  STANDALONE_ADMIN_NAME: 'Package Verification',
  STANDALONE_ADMIN_EMAIL: 'package-verification@scli.local',
  STANDALONE_ADMIN_PASSWORD: 'Package-Verification-Password-2026!',
});
const provider = new StandaloneDataProvider(config);
const app = await createApp({ config, provider });

function responseData(response) {
  const body = response.json();
  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}: ${JSON.stringify(body)}`);
  }
  return body.data;
}

try {
  const projectResult = responseData(
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'Packaged AI Verification',
        clientName: 'SCLI QA',
        projectType: 'Lighting Design',
        description: 'Disposable package verification project.',
        siteLocation: 'Local QA',
        designStage: 'Concept',
        lightingScope: 'Luminaire schedule and datasheet verification.',
        luxRequirements: '',
        drawingReference: '',
        priority: 'Normal',
        complexity: 'Small',
        estimatedHours: 1,
        requiredDeliveryDate: '2026-08-20',
        createFolders: false,
        services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        luminaireInputMode: 'Manual',
        idempotencyKey: 'aa93c54b-4dd8-48af-8377-f50f5e710e4b',
      },
    }),
  );
  const projectId = projectResult.project.id;
  const luminaire = responseData(
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires`,
      payload: {
        tag: 'DL01',
        category: 'Downlight',
        manufacturer: 'ERCO',
        model: 'B000339',
        wattage: '4.4W',
        lightColor: '3000K',
        datasheetPath: path.resolve(pdfPath),
        unit: 'No.',
        quantity: 1,
      },
    }),
  );
  const analysis = responseData(
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/${luminaire.id}/analyze-datasheet`,
    }),
  );
  const wattage = analysis.comparisons.find((item) => item.fieldKey === 'wattage');
  const lightColor = analysis.comparisons.find((item) => item.fieldKey === 'lightColor');
  if (!analysis.textAvailable || !['Ready', 'NeedsReview'].includes(analysis.status)) {
    throw new Error(`Packaged PDF extraction failed: ${analysis.message}`);
  }
  if (wattage?.value !== '4.4W' || lightColor?.value !== '3000K') {
    throw new Error(`Unexpected packaged extraction: ${JSON.stringify({ wattage, lightColor })}`);
  }
  const verification = {
    status: analysis.status,
    pageCount: analysis.pageCount,
    wattage: wattage.value,
    lightColor: lightColor.value,
    privacyMode: analysis.privacyMode,
  };
  console.log(JSON.stringify(verification));
  if (outputPath) {
    await writeFile(path.resolve(outputPath), JSON.stringify(verification, null, 2), 'utf8');
  }
} finally {
  await app.close();
  provider.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
