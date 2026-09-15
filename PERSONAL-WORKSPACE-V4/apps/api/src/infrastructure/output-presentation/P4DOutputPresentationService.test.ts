import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { AppUser } from '@scli/domain';
import { PersonalWorkspaceStore } from '../../personal-workspace-store';
import { createNonProductionPersonalCanonicalRegistry } from '../output-registry/createNonProductionPersonalCanonicalRegistry';
import { P4DOutputPresentationService } from './P4DOutputPresentationService';

const roots: string[] = [];
const stores: PersonalWorkspaceStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function harness() {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p4d-output-'));
  roots.push(root);
  const config = loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const store = new PersonalWorkspaceStore(config);
  stores.push(store);
  const project = structuredClone(seedProjects[0]!);
  store.initializeProject(
    project.id,
    ['LuminaireSchedule'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  store.setFolderPath(project.id, root);
  for (let index = 1; index <= 5; index += 1)
    store.addLuminaire(project.id, {
      tag: `DL${String(index).padStart(2, '0')}`,
      category: index % 2 ? 'Downlight' : 'Track',
      imagePath: '',
      description:
        index === 1 ? 'Long technical description '.repeat(30) : `Professional luminaire ${index}`,
      manufacturer: index === 2 ? '' : 'Test Manufacturer',
      model: `MODEL-${index}`,
      wattage: `${8 + index}W`,
      lumens: `${700 + index * 100} lm`,
      lightColor: index % 2 ? '3000K' : '4000K',
      cri: '90',
      beamAngle: index % 2 ? '24°' : '36°',
      ipRating: 'IP44',
      mounting: 'Recessed',
      cutout: '85 mm',
      driver: 'Remote',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: '',
      location: index % 2 ? 'Lobby' : 'Corridor',
      unit: 'No.',
      quantity: index,
      notes: '',
      sourceName: 'Manual',
      dimensions: '95 x 110 mm',
      bodyColorFinish: 'White',
    });
  let tick = 0;
  const registry = createNonProductionPersonalCanonicalRegistry(store, {
    now: () => new Date(Date.parse('2026-08-25T08:00:00.000Z') + tick++ * 1000),
  });
  return {
    root,
    store,
    project,
    registry,
    service: new P4DOutputPresentationService(store, registry),
    actor: seedUsers.find((user) => user.role === 'Admin') as AppUser,
  };
}

describe('P4DOutputPresentationService', () => {
  it('resolves deterministic technical/presentation/BOQ/register pages without merging distinct Luminaire UUIDs', async () => {
    const h = harness();
    const workspace = h.store.getWorkspace(h.project.id);
    const common = {
      format: 'PDF' as const,
      issueStatus: 'Preliminary',
      issueDate: '2026-08-25',
      options: {
        pageSize: 'A3' as const,
        orientation: 'Landscape' as const,
        productsPerPage: null,
      },
    };
    const technical = await h.service.preview(h.project, workspace, {
      ...common,
      outputKind: 'LuminaireSchedule',
    });
    const presentation = await h.service.preview(h.project, workspace, {
      ...common,
      outputKind: 'PresentationSchedule',
      options: { ...common.options, productsPerPage: 2 as const },
    });
    const boq = await h.service.preview(h.project, workspace, {
      ...common,
      outputKind: 'TechnicalBoq',
    });
    const register = await h.service.preview(h.project, workspace, {
      ...common,
      outputKind: 'DatasheetRegister',
    });
    expect(technical.template.versionId).toBe('v2');
    expect(technical.messages.some((message) => message.code === 'LONG_TEXT')).toBe(true);
    expect(presentation.pages).toHaveLength(3);
    expect(presentation.pages.every((page) => page.kind === 'PresentationSchedule')).toBe(true);
    const boqIds = boq.pages.flatMap((page) =>
      page.kind === 'TechnicalBoq'
        ? page.groups.flatMap((group) => group.rows.map((row) => row.luminaireId))
        : [],
    );
    expect(new Set(boqIds).size).toBe(5);
    expect(boq.unitTotals).toEqual({ 'No.': 15 });
    expect(register.pages[0]?.kind).toBe('DatasheetRegister');
    expect(
      register.messages.filter((message) => message.code === 'MISSING_DATASHEET'),
    ).toHaveLength(5);
  });

  it('requires fresh Preview authority and finalizes a searchable PDF under one exact Revision UUID', async () => {
    const h = harness();
    const workspace = h.store.getWorkspace(h.project.id);
    const input = {
      outputKind: 'LuminaireSchedule' as const,
      format: 'PDF' as const,
      issueStatus: 'For Review',
      issueDate: '2026-08-25',
      options: {
        pageSize: 'A3' as const,
        orientation: 'Landscape' as const,
        productsPerPage: null,
      },
    };
    const preview = await h.service.preview(h.project, workspace, input);
    await expect(
      h.service.generate(h.project, workspace, h.actor, {
        ...input,
        previewFingerprint: '0'.repeat(64),
      }),
    ).rejects.toThrow('Preview again');
    const generated = await h.service.generate(h.project, workspace, h.actor, {
      ...input,
      previewFingerprint: preview.sourceFingerprint,
    });
    expect(generated.revision.lifecycleState).toBe('FINALIZED');
    expect(generated.outputs).toHaveLength(1);
    const output = generated.outputs[0]!;
    expect(output.revisionId).toBe(generated.revision.revisionId);
    expect(output.outputFamily).toBe('LuminaireSchedule');
    expect(output.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(output.resolvedTemplateSnapshot?.versionId).toBe('v2');
    expect(
      output.resolvedTemplateSnapshot?.sections.find(
        (section) => section.sectionId === 'generationMetadata',
      )?.config,
    ).toMatchObject({
      sourceRevisionId: generated.revision.revisionId,
      rendererIdentity: 'scli.output-presentation',
    });
    expect(generated.files.pdfPath && existsSync(generated.files.pdfPath)).toBe(true);
  });

  it('honours explicit current template identity and keeps historical definitions immutable', async () => {
    const h = harness();
    const workspace = h.store.getWorkspace(h.project.id);
    const compactBefore = h.registry.getTemplateVersion('schedule.classic-grid-pro.compact', 'v1');
    const common = {
      outputKind: 'LuminaireSchedule' as const,
      format: 'PDF' as const,
      issueStatus: 'Preliminary',
      issueDate: '2026-08-25',
      options: {
        pageSize: 'A3' as const,
        orientation: 'Landscape' as const,
        productsPerPage: null,
      },
    };
    const professional = await h.service.preview(h.project, workspace, {
      ...common,
      templateId: 'schedule.technical-modern',
      templateVersionId: 'v2',
    });
    const compact = await h.service.preview(h.project, workspace, {
      ...common,
      templateId: 'schedule.classic-grid-pro.compact',
      templateVersionId: 'v1',
    });
    const professionalPage = professional.pages[0];
    const compactPage = compact.pages[0];

    expect(professional.template).toMatchObject({
      templateId: 'schedule.technical-modern',
      versionId: 'v2',
    });
    expect(compact.template).toMatchObject({
      templateId: 'schedule.classic-grid-pro.compact',
      versionId: 'v1',
    });
    expect(professional.sourceFingerprint).not.toBe(compact.sourceFingerprint);
    expect(professional.templateSnapshotHash).not.toBe(compact.templateSnapshotHash);
    expect(professionalPage?.kind).toBe('LuminaireSchedule');
    expect(compactPage?.kind).toBe('LuminaireSchedule');
    if (
      professionalPage?.kind === 'LuminaireSchedule' &&
      compactPage?.kind === 'LuminaireSchedule'
    ) {
      expect(professionalPage.layout.groups).not.toEqual(compactPage.layout.groups);
      expect(compactPage.layout.rowDensity).toBe('Compact');
    }
    expect(
      compact.template.sections.some((section) => section.sectionId === 'generationMetadata'),
    ).toBe(false);
    expect(h.registry.getTemplateVersion('schedule.classic-grid-pro.compact', 'v1')).toEqual(
      compactBefore,
    );
  });

  it('resolves a registered hashless compatibility asset only from the verified Project root', async () => {
    const h = harness();
    const luminaire = h.store.getWorkspace(h.project.id).luminaires[0]!;
    const imagePath = path.join(h.root, 'product.png');
    writeFileSync(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const version = h.store.attachLuminaireAsset(
      h.project.id,
      luminaire.id,
      { assetType: 'ProductImage', filePath: 'product.png' },
      h.actor,
    );
    expect(version.fileHash).toBeNull();

    const preview = await h.service.preview(h.project, h.store.getWorkspace(h.project.id), {
      outputKind: 'PresentationSchedule',
      format: 'PDF',
      issueStatus: 'For Review',
      issueDate: '2026-08-25',
      options: { pageSize: 'A3', orientation: 'Landscape', productsPerPage: 3 },
    });
    const resolved =
      preview.pages[0]?.kind === 'PresentationSchedule'
        ? preview.pages[0].products[0]?.image
        : undefined;
    expect(resolved).toMatchObject({
      assetVersionId: version.id,
      status: 'VERIFIED',
      sizeBytes: 68,
    });
    expect(resolved?.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
