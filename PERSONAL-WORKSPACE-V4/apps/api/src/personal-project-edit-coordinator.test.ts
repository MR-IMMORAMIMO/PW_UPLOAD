import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@scli/config';
import { PersonalProjectEditCoordinator } from './personal-project-edit-coordinator';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ProjectService } from './project-service';
import { StandaloneDataProvider } from './standalone-data-provider';
import { fullProjectEditSchema } from '@scli/contracts';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function harness() {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-project-edit-'));
  roots.push(root);
  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: path.join(root, 'app.sqlite'),
    PERSONAL_PROJECT_ROOT: root,
    STANDALONE_SESSION_SECRET: 'project-edit-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Project Edit Admin',
    STANDALONE_ADMIN_EMAIL: 'project-edit@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Project-Edit-Password-2026!',
  });
  const store = new PersonalWorkspaceStore(config);
  const provider = new StandaloneDataProvider(config, undefined, store.getSharedDatabase());
  const actor = (await provider.listUsers())[0]!;
  const service = new ProjectService(
    provider,
    'Asia/Dubai',
    () => new Date('2026-08-23T09:00:00.000Z'),
    'personal',
  );
  const created = await service.createProject(actor, {
    projectName: 'Atomic Edit',
    clientName: 'Original Client',
    projectType: 'Lighting Design',
    description: '',
    collaboratorDesignerIds: [],
    siteLocation: 'Dubai',
    designStage: 'Concept',
    lightingScope: 'Original scope',
    luxRequirements: '',
    drawingReference: '',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 12,
    requiredDeliveryDate: '2026-09-10',
    idempotencyKey: crypto.randomUUID(),
  });
  store.initializeProject(
    created.project.id,
    ['LuminaireSchedule'],
    'Full Lighting Design',
    'Later',
    created.project.requiredDeliveryDate,
  );
  return { root, store, provider, actor, service, project: created.project };
}

describe('PersonalProjectEditCoordinator', () => {
  it('clears optional site/date atomically and retains the recorded before/after audit', async () => {
    const h = await harness();
    try {
      const input = fullProjectEditSchema.parse({
        siteLocation: '',
        requiredDeliveryDate: '',
        scopeItems: [],
        luminaireInputMode: 'Later',
        expectedVersion: h.project.version,
      });
      const { scopeItems, luminaireInputMode, ...metadata } = input;
      const prepared = await h.service.prepareProjectUpdate(h.actor, h.project.id, metadata);
      const result = new PersonalProjectEditCoordinator(h.provider, h.store).commit(prepared, {
        scopeItems,
        luminaireInputMode,
      });
      expect(result.project.siteLocation).toBe('');
      expect(result.project.requiredDeliveryDate).toBe('');
      expect(prepared.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldName: 'requiredDeliveryDate',
            oldValue: '2026-09-10',
            newValue: '',
          }),
        ]),
      );
    } finally {
      h.store.close();
      h.provider.close();
    }
  });
  it('commits metadata, scope, services, and input mode as one configuration', async () => {
    const h = await harness();
    try {
      const prepared = await h.service.prepareProjectUpdate(h.actor, h.project.id, {
        clientName: 'Updated Client',
        expectedVersion: h.project.version,
      });
      const result = new PersonalProjectEditCoordinator(h.provider, h.store).commit(prepared, {
        scopeItems: [
          { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
          { code: null, label: 'Facade mock-up', custom: true },
        ],
        luminaireInputMode: 'Manual',
      });
      expect(result.project).toMatchObject({
        clientName: 'Updated Client',
        services: ['TechnicalBoq'],
        luminaireInputMode: 'Manual',
        version: h.project.version + 1,
      });
      expect(result.workspace.scopeItems.map((item) => item.label)).toEqual([
        'Technical BOQ',
        'Facade mock-up',
      ]);
      expect(result.workspace.lightingPackage.inputMode).toBe('Manual');
    } finally {
      h.store.close();
      h.provider.close();
    }
  });

  it('rolls provider state back when workspace persistence fails', async () => {
    const h = await harness();
    try {
      const prepared = await h.service.prepareProjectUpdate(h.actor, h.project.id, {
        projectName: 'Must Roll Back',
        expectedVersion: h.project.version,
      });
      vi.spyOn(h.store, 'applyProjectConfiguration').mockImplementationOnce(() => {
        throw new Error('simulated workspace failure');
      });
      expect(() =>
        new PersonalProjectEditCoordinator(h.provider, h.store).commit(prepared, {
          scopeItems: [{ code: 'LuminaireSchedule', label: 'Luminaire Schedule', custom: false }],
          luminaireInputMode: 'Manual',
        }),
      ).toThrow(/simulated workspace failure/);
      expect(await h.provider.getProject(h.project.id)).toMatchObject({
        projectName: 'Atomic Edit',
        version: h.project.version,
      });
      expect(h.store.getWorkspace(h.project.id).lightingPackage.inputMode).toBe('Later');
    } finally {
      h.store.close();
      h.provider.close();
    }
  });
});
