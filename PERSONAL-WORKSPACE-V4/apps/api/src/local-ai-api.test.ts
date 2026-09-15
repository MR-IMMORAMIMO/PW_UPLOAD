import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUserIds } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { LocalVisionAdapter } from './infrastructure/local-ai/LocalVisionAdapter';
import { createSearchableDocumentPdf } from './infrastructure/document-intelligence/testing/DocumentIntelligenceFixture';
import type { FastifyInstance } from 'fastify';

let root: string;
let app: FastifyInstance;
let store: PersonalWorkspaceStore;
const projectId = seedProjects[0]!.id;
const ownerHeaders = { 'x-mock-user-id': seedUserIds.admin };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'local-ai-api-'));
  const config = loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'false',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
    LOCAL_AI_ENABLED: 'true',
    LOCAL_AI_PORT: '11439',
  });
  store = new PersonalWorkspaceStore(config);
  store.initializeProject(projectId, [], 'Full Lighting Design', 'Later', '2026-09-10');
  store
    .getSharedDatabase()
    .exec(
      "ALTER TABLE luminaire_asset_versions ADD COLUMN locator_kind TEXT DEFAULT 'LEGACY_PATH'; ALTER TABLE luminaire_asset_versions ADD COLUMN locator_value TEXT; ALTER TABLE luminaire_asset_versions ADD COLUMN source_library_asset_version_id TEXT;",
    );
  vi.spyOn(LocalVisionAdapter.prototype, 'check').mockResolvedValue({ digest: 'test-model' });
  vi.spyOn(LocalVisionAdapter.prototype, 'readPage').mockResolvedValue({
    productCode: 'A100',
    summary: 'A single luminaire',
    observations: [],
    fields: [{ field: 'wattage', value: '21 W', quote: 'System power: 21 W' }],
  });
  vi.spyOn(LocalVisionAdapter.prototype, 'unload').mockResolvedValue();
  app = await createApp({ config, provider: new MockDataProvider(), personalStore: store });
});
afterEach(async () => {
  await app?.close();
  store?.close();
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

it('denies non-owner access and reports the fixed local-only model', async () => {
  const denied = await app.inject({
    method: 'GET',
    url: '/api/local-ai/status',
    headers: { 'x-mock-user-id': seedUserIds.salesOne },
  });
  expect(denied.statusCode).toBe(403);
  const status = await app.inject({
    method: 'GET',
    url: '/api/local-ai/status',
    headers: ownerHeaders,
  });
  expect(status.json().data).toMatchObject({
    localOnly: true,
    ready: true,
    model: 'qwen3-vl:2b-instruct',
  });
});
it('scans the canonical attachment, rejects forged paths, and leaves Project fields untouched', async () => {
  const url = `/api/projects/${projectId}/luminaire-studio`;
  const initial = (await app.inject({ method: 'GET', url, headers: ownerHeaders })).json().data;
  initial.document.luminaires.push({
    id: randomUUID(),
    tag: 'LOCAL-01',
    orderCode: 'A100',
    power: 18,
  });
  const saved = await app.inject({
    method: 'PUT',
    url,
    headers: ownerHeaders,
    payload: {
      document: initial.document,
      expectedVersion: initial.version,
      baseFingerprint: initial.fingerprint,
      operationId: randomUUID(),
    },
  });
  expect(saved.statusCode).toBe(200);
  const luminaireId = saved.json().data.document.luminaires[0].id as string;
  const file = path.join(root, 'fixture.pdf');
  await writeFile(file, createSearchableDocumentPdf(['Ordering code: A100', 'System power: 21 W']));
  const attached = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/luminaires/${luminaireId}/asset-versions`,
    headers: ownerHeaders,
    payload: { assetType: 'Datasheet', filePath: file },
  });
  expect(attached.statusCode, attached.body).toBe(201);
  const before = store.getLuminaireRecord(luminaireId, projectId);
  const endpoint = `/api/projects/${projectId}/luminaires/${luminaireId}/local-ai`;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: endpoint,
        headers: ownerHeaders,
        payload: { filePath: file },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ method: 'POST', url: endpoint, headers: ownerHeaders, payload: {} }))
      .statusCode,
  ).toBe(202);
  await vi.waitFor(
    async () => {
      const report = await app.inject({ method: 'GET', url: endpoint, headers: ownerHeaders });
      expect(report.json().data.state).toBe('COMPLETED');
    },
    { timeout: 10000 },
  );
  const report = (await app.inject({ method: 'GET', url: endpoint, headers: ownerHeaders })).json()
    .data;
  expect(report.pages[0].findings[0].result).toBe('DIFFERENT_EVIDENCE');
  expect(store.getLuminaireRecord(luminaireId, projectId)).toEqual(before);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: `${endpoint}/page?pageNumber=2`,
        headers: ownerHeaders,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/luminaires/${randomUUID()}/local-ai`,
        headers: ownerHeaders,
      })
    ).statusCode,
  ).toBe(404);
});
