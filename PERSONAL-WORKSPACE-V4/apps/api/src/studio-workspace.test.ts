import { StudioOutputService } from './infrastructure/luminaire-studio/StudioOutputService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageOnlyDocumentPdf } from './infrastructure/document-intelligence/testing/DocumentIntelligenceFixture';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import type { StudioDocument } from '@scli/contracts';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

const config = loadConfig({
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
});
const project = seedProjects[0]!;
const headers = { 'x-mock-user-id': seedUserIds.admin };
describe('Studio and canonical project integration', () => {
  let app: FastifyInstance;
  let store: PersonalWorkspaceStore;
  let testRoot: string;
  beforeEach(async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), 'studio-api-test-'));
    const isolatedConfig = {
      ...config,
      STANDALONE_DB_PATH: path.join(testRoot, 'workspace.sqlite'),
    };
    store = new PersonalWorkspaceStore(isolatedConfig);
    store.initializeProject(project.id, [], 'Full Lighting Design', 'Later', '2026-09-10');
    app = await createApp({
      config: isolatedConfig,
      provider: new MockDataProvider(),
      personalStore: store,
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    store?.close();
    if (testRoot?.startsWith(path.join(tmpdir(), 'studio-api-test-')))
      await rm(testRoot, { recursive: true, force: true });
  });
  const url = `/api/projects/${project.id}/luminaire-studio`;
  it('extracts only from the attached Datasheet and preserves image history with stale-selection rejection', async () => {
    // The mock store starts at its legacy schema; production receives these columns in v22.
    store
      .getSharedDatabase()
      .exec(
        "ALTER TABLE luminaire_asset_versions ADD COLUMN locator_kind TEXT DEFAULT 'LEGACY_PATH'; ALTER TABLE luminaire_asset_versions ADD COLUMN locator_value TEXT; ALTER TABLE luminaire_asset_versions ADD COLUMN source_library_asset_version_id TEXT;",
      );
    const initial = (await app.inject({ method: 'GET', url, headers })).json().data;
    const id = randomUUID();
    initial.document.luminaires.push({ id, tag: 'IMAGE-01' });
    const saved = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: {
        document: initial.document,
        expectedVersion: initial.version,
        baseFingerprint: initial.fingerprint,
        operationId: randomUUID(),
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const luminaireId = saved.json().data.document.luminaires[0].id;
    const workspace = (
      await app.inject({ method: 'GET', url: `/api/projects/${project.id}/workspace`, headers })
    ).json().data;
    const beforeEdit = workspace.luminaires.find((row: { id: string }) => row.id === luminaireId);
    const editUrl = `/api/projects/${project.id}/luminaires/${luminaireId}/technical-field`;
    const edit = { fieldKey: 'wattage', value: '13 W', expectedRowVersion: beforeEdit.rowVersion };
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: editUrl,
          headers: { 'x-mock-user-id': seedUserIds.salesOne },
          payload: edit,
        })
      ).statusCode,
    ).toBe(403);
    const corrected = await app.inject({ method: 'PATCH', url: editUrl, headers, payload: edit });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json().data).toMatchObject({ wattage: '13 W', tag: beforeEdit.tag });
    expect(
      (await app.inject({ method: 'PATCH', url: editUrl, headers, payload: edit })).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: editUrl,
          headers,
          payload: { ...edit, fieldKey: 'projectId' },
        })
      ).statusCode,
    ).toBe(400);
    const pdfPath = path.join(testRoot, 'image-source.pdf');
    await writeFile(pdfPath, createImageOnlyDocumentPdf('PRODUCT IMAGE TEST'));
    const attached = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/luminaires/${luminaireId}/asset-versions`,
      headers,
      payload: { assetType: 'Datasheet', filePath: pdfPath },
    });
    expect(attached.statusCode, attached.body).toBe(201);
    const endpoint = `/api/projects/${project.id}/luminaires/${luminaireId}/datasheet-images`;
    const choices = await app.inject({ method: 'GET', url: `${endpoint}?pageNumber=1`, headers });
    expect(choices.statusCode, choices.body).toBe(200);
    const data = choices.json().data;
    const pageEndpoint = endpoint.replace('datasheet-images', 'datasheet-page');
    const rendered = await app.inject({
      method: 'GET',
      url: `${pageEndpoint}?pageNumber=1`,
      headers,
    });
    expect(rendered.statusCode, rendered.body).toBe(200);
    expect(rendered.json().data).toMatchObject({
      sourceAssetVersionId: data.sourceAssetVersionId,
      pageNumber: 1,
    });
    expect(rendered.json().data.pngBase64.length).toBeGreaterThan(100);
    expect(store.listLuminaireAssetVersions(project.id, luminaireId, 'ProductImage')).toHaveLength(
      0,
    );
    expect(
      (await app.inject({ method: 'GET', url: `${pageEndpoint}?pageNumber=0`, headers }))
        .statusCode,
    ).toBe(400);

    const payload = {
      pageNumber: 1,
      sourceAssetVersionId: data.sourceAssetVersionId,
      currentImageVersionId: null,
      imageHash: data.images[0].hash,
    };
    const forged = await app.inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: { ...payload, imageHash: '0'.repeat(64) },
    });
    expect(forged.statusCode).toBe(409);
    const applied = await app.inject({ method: 'POST', url: endpoint, headers, payload });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(store.listLuminaireAssetVersions(project.id, luminaireId, 'ProductImage')).toHaveLength(
      1,
    );
    expect((await app.inject({ method: 'POST', url: endpoint, headers, payload })).statusCode).toBe(
      409,
    );
    expect(
      (await app.inject({ method: 'GET', url: `${endpoint}?pageNumber=0`, headers })).statusCode,
    ).toBe(400);
  });
  const read = async () => {
    const response = await app.inject({ method: 'GET', url, headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as {
      document: StudioDocument;
      version: number;
      fingerprint: string;
    };
  };
  it('saves the five-page Studio data and projects a new luminaire into the existing workspace', async () => {
    const state = await read();
    const systemId = randomUUID();
    state.document.systems.push({ id: systemId, code: 'TR-01', voltage: '48 V DC' });
    state.document.accessories.push({
      id: randomUUID(),
      ref: 'A-01',
      systemId,
      component: 'Power feed',
      quantity: 2,
    });
    state.document.luminaires.push({
      id: randomUUID(),
      tag: 'ST-01',
      systemId,
      power: 12,
      quantity: 3.5,
      unit: 'm',
      orderCode: 'EXACT-001',
      specSheet: { text: 'Preserved sheet description' },
    });
    const payload = {
      document: state.document,
      expectedVersion: state.version,
      baseFingerprint: state.fingerprint,
      operationId: randomUUID(),
    };
    const saved = await app.inject({ method: 'PUT', url, headers, payload });
    expect(saved.statusCode, saved.body).toBe(200);
    const reopened = await read();
    expect(reopened.document.systems).toHaveLength(1);
    expect(reopened.document.accessories).toHaveLength(1);
    expect(reopened.document.luminaires.find((row) => row.tag === 'ST-01')).toMatchObject({
      specSheet: { text: 'Preserved sheet description' },
      systemId,
      quantity: 3.5,
    });
    expect(
      store.getWorkspace(project.id).luminaires.find((row) => row.tag === 'ST-01'),
    ).toMatchObject({ quantity: 3.5, orderingCode: 'EXACT-001', wattage: '12' });
    expect((await app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(200);
    expect(
      store.getWorkspace(project.id).luminaires.filter((row) => row.tag === 'ST-01'),
    ).toHaveLength(1);
  });
  it('recovers a failed Studio output in the same Revision using the frozen document', async () => {
    const state = await read();
    const row = { id: randomUUID(), tag: 'RECOVER-01', quantity: 2 };
    state.document.luminaires.push(row);
    const registry = new CanonicalOutputRegistryStore(
      store.getSharedDatabase(),
      { now: () => new Date('2026-09-10T00:00:00.000Z') },
      'CANONICAL',
    );
    const workspace = { ...store.getWorkspace(project.id), folderPath: testRoot };
    const actor = seedUsers.find((user) => user.id === seedUserIds.admin)!;
    let fail = true;
    const generator = new StudioOutputService(registry, process.cwd(), async (requestPath) => {
      if (fail) throw new Error('Injected renderer failure');
      const request = JSON.parse(await readFile(requestPath, 'utf8'));
      expect(request.document.luminaires[0].tag).toBe('RECOVER-01');
      await writeFile(request.output, '%PDF-1.4 deterministic test renderer');
    });
    const input = {
      version: state.version,
      operationId: randomUUID(),
      baseFingerprint: state.fingerprint,
      format: 'PDF' as const,
      kind: 'schedule' as const,
      selection: [row.id],
      separate: false,
    };
    await expect(
      generator.generate(project, workspace, actor, state.document, input),
    ).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
    const failed = registry.listRevisions(project.id)[0]!;
    expect(failed.lifecycleState).toBe('FAILED_RECOVERABLE');
    fail = false;
    state.document.luminaires[0]!.tag = 'LATER-EDIT';
    const recovered = await generator.recover(project, workspace, actor, failed.revisionId);
    expect(recovered.revisionId).toBe(failed.revisionId);
    expect(registry.listRevisions(project.id)).toHaveLength(1);
    expect(registry.getRevision(failed.revisionId).lifecycleState).toBe('FINALIZED');
    expect(registry.listOutputsForRevision(failed.revisionId)).toHaveLength(1);
    const output = registry.listOutputsForRevision(failed.revisionId)[0]!;
    const frozen = JSON.parse(
      String(output.resolvedTemplateSnapshot?.sections[0]?.config.studioRenderSnapshot),
    );
    expect(frozen.document.luminaires[0].tag).toBe('RECOVER-01');
  });
  it('rolls nested asset-style writes back with the owning transaction', () => {
    const database = store.getSharedDatabase();
    const count = () =>
      database
        .prepare("SELECT COUNT(*) AS n FROM app_state WHERE state_key = 'studio-rollback-test'")
        .get();
    expect(() =>
      store.runInTransaction(() => {
        store.runInTransaction(() =>
          database
            .prepare('INSERT INTO app_state VALUES (?, ?, ?)')
            .run('studio-rollback-test', '{}', '2026-09-10T00:00:00.000Z'),
        );
        throw new Error('Reject later project change');
      }),
    ).toThrow('Reject later project change');
    expect(count()).toMatchObject({ n: 0 });
    expect(database.isTransaction).toBe(false);
  });
  it('registers Specifications in an open composed Revision and rejects duplicate or closed slots', async () => {
    const state = await read();
    const row = { id: randomUUID(), tag: 'SPEC-01', quantity: 1 };
    state.document.luminaires.push(row);
    const registry = new CanonicalOutputRegistryStore(
      store.getSharedDatabase(),
      { now: () => new Date('2026-09-10T00:00:00.000Z') },
      'CANONICAL',
    );
    const actor = seedUsers.find((user) => user.id === seedUserIds.admin)!;
    const revision = registry.createRevision({
      projectId: project.id,
      projectSnapshot: { ...project, canonicalOperation: 'MANUAL_DELIVERABLES' },
      luminaires: [],
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    const renderer = vi.fn(async (requestPath: string) => {
      const request = JSON.parse(await readFile(requestPath, 'utf8'));
      expect(request.kind).toBe('datasheets');
      expect(request.selection).toEqual([row.id]);
      await writeFile(request.output, '%PDF-1.4 deterministic specification');
    });
    const generator = new StudioOutputService(registry, process.cwd(), renderer);
    const workspace = { ...store.getWorkspace(project.id), folderPath: testRoot };
    const input = {
      version: state.version,
      operationId: randomUUID(),
      baseFingerprint: state.fingerprint,
      format: 'PDF' as const,
      kind: 'datasheets' as const,
      selection: [row.id],
      separate: false,
      targetRevisionId: revision.revisionId,
    };
    const result = await generator.generate(project, workspace, actor, state.document, input);
    expect(result.revisionId).toBe(revision.revisionId);
    expect(registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
    const downloaded = await generator.download(project, workspace, result.outputs[0]!.outputId);
    expect(downloaded.bytes.toString()).toBe('%PDF-1.4 deterministic specification');
    await expect(
      generator.download({ ...project, id: randomUUID() }, workspace, result.outputs[0]!.outputId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(registry.listOutputsForRevision(revision.revisionId)).toEqual([
      expect.objectContaining({ outputFamily: 'DatasheetRegister', lifecycleState: 'FINALIZED' }),
    ]);
    await expect(
      generator.generate(project, workspace, actor, state.document, {
        ...input,
        operationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    registry.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
    await expect(
      generator.generate(project, workspace, actor, state.document, {
        ...input,
        operationId: randomUUID(),
        format: 'XLSX',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(renderer).toHaveBeenCalledTimes(1);
  });
  it('adopts an uploaded product image into canonical asset history and hydrates it after reopening', async () => {
    const state = await read();
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a97cAAAAASUVORK5CYII=';
    state.document.luminaires.push({ id: randomUUID(), tag: 'IMAGE-01', image, quantity: 1 });
    const result = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: {
        document: state.document,
        expectedVersion: state.version,
        baseFingerprint: state.fingerprint,
        operationId: randomUUID(),
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    const reopened = await read();
    const row = reopened.document.luminaires.find((item) => item.tag === 'IMAGE-01')!;
    expect(row.image).toBe(image);
    expect(store.listLuminaireAssetVersions(project.id, row.id, 'ProductImage')).toHaveLength(1);
    const again = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: {
        document: reopened.document,
        expectedVersion: reopened.version,
        baseFingerprint: reopened.fingerprint,
        operationId: randomUUID(),
      },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(store.listLuminaireAssetVersions(project.id, row.id, 'ProductImage')).toHaveLength(1);
  });
  it('persists shared templates, rejects stale catalog updates and enforces owner access', async () => {
    const endpoint = '/api/luminaire-studio/templates';
    const template = {
      id: randomUUID(),
      name: 'Radio Station schedule',
      templateVersion: 1,
      output: { kind: 'schedule' },
      customFields: [],
    };
    const initial = (await app.inject({ method: 'GET', url: endpoint, headers })).json().data;
    const payload = { version: initial.version, templates: [...initial.templates, template] };
    const saved = await app.inject({ method: 'PUT', url: endpoint, headers, payload });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: endpoint, headers })).json().data.templates,
    ).toContainEqual(template);
    expect((await app.inject({ method: 'PUT', url: endpoint, headers, payload })).statusCode).toBe(
      409,
    );
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: endpoint,
          headers: { 'x-mock-user-id': seedUserIds.salesOne },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const invalid = { version: initial.version + 1, templates: [template, template] };
    expect(
      (await app.inject({ method: 'PUT', url: endpoint, headers, payload: invalid })).statusCode,
    ).toBe(400);
  });
  it('blocks direct unauthorized access and stale saves without losing canonical data', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { 'x-mock-user-id': seedUserIds.salesOne },
        })
      ).statusCode,
    ).toBe(403);
    const state = await read();
    const response = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: {
        document: state.document,
        expectedVersion: 0,
        operationId: randomUUID(),
        baseFingerprint: 'a'.repeat(64),
      },
    });
    expect(response.statusCode).toBe(409);
    expect((await read()).version).toBe(0);
  });
});
