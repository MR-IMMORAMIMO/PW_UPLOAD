import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { LuminaireRecordInput } from '@scli/contracts';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { AppUser } from '@scli/domain';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { RevisionPackageService } from './revision-package-service';
import { scanProjectFolder } from './legacy-project-import-service';

const stores: PersonalWorkspaceStore[] = [];
const temporaryFolders: string[] = [];
const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

const packageLuminaire: LuminaireRecordInput = {
  tag: 'DL01',
  category: 'Downlight',
  imagePath: '',
  description: 'Package quality check luminaire',
  manufacturer: 'ERCO',
  model: 'MODEL-01',
  wattage: '8W',
  lumens: '720 lm',
  lightColor: '3000K',
  cri: '90',
  beamAngle: '24 deg',
  ipRating: 'IP44',
  mounting: 'Recessed',
  cutout: '85 mm',
  driver: 'Remote',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: '',
  location: 'Ground Floor',
  unit: 'No.',
  quantity: 1,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
};

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryFolders.length) {
    const folder = temporaryFolders.pop();
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
});

describe('revision package service', () => {
  it('flags historical case-and-whitespace tag variants through canonical quality checks', async () => {
    const store = new PersonalWorkspaceStore(
      loadConfig({
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'personal',
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
      }),
    );
    stores.push(store);
    const project = seedProjects[0]!;
    store.initializeProject(
      project.id,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Manual',
      project.requiredDeliveryDate,
    );
    const original = store.addLuminaire(project.id, { ...packageLuminaire, tag: 'dl01' });
    expect(original.tag).toBe('DL01');
    const historicalWorkspace = store.getWorkspace(project.id);
    historicalWorkspace.luminaires.push({
      ...original,
      id: '22222222-2222-4222-8222-222222222222',
      tag: ' dl01 ',
    });

    const duplicateCheck = (
      await new RevisionPackageService(store).catalog(project, historicalWorkspace)
    ).checks.find((check) => check.key === 'duplicate-luminaire-tags');

    expect(duplicateCheck).toMatchObject({
      passed: false,
      severity: 'Blocking',
      detail: '1 duplicated tag(s) must be resolved.',
    });
  });

  it('packages only explicitly selected files without empty category folders', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'scli-revision-package-'));
    temporaryFolders.push(testRoot);
    const projectFolder = path.join(testRoot, 'project');
    mkdirSync(projectFolder, { recursive: true });
    const sourcePath = path.join(testRoot, 'L-101.pdf');
    writeFileSync(sourcePath, 'SCLI lighting layout test document', 'utf8');
    const indexedDialuxPath = path.join(projectFolder, 'DIALux Calculation Report.pdf');
    writeFileSync(indexedDialuxPath, 'SCLI DIALux report', 'utf8');
    const datasheetPath = path.join(testRoot, 'dl02-datasheet.pdf');
    writeFileSync(datasheetPath, 'SCLI luminaire datasheet', 'utf8');

    const store = new PersonalWorkspaceStore(
      loadConfig({
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'personal',
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
      }),
    );
    stores.push(store);
    const project = seedProjects[0]!;
    store.initializeProject(
      project.id,
      ['LightingLayout'],
      'Full Lighting Design',
      'Manual',
      project.requiredDeliveryDate,
    );
    store.setFolderPath(project.id, projectFolder);
    store.replaceFolderIndex(scanProjectFolder(projectFolder, project.id));
    const luminaire = store.addLuminaire(project.id, {
      ...packageLuminaire,
      tag: 'dl02',
      datasheetPath,
    });
    const document = store.operations.createDocument(project.id, {
      category: 'Drawing',
      documentNumber: 'L-101',
      title: 'Ground Floor Lighting Layout',
      revision: 'REV_01',
      status: 'Working',
      filePath: sourcePath,
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    const service = new RevisionPackageService(store);
    const workspace = store.getWorkspace(project.id);
    const catalog = await service.catalog(project, workspace);
    const selectedItem = catalog.items.find((item) => item.id === `document:${document.id}`);
    expect(selectedItem?.available).toBe(true);
    expect(catalog.items.find((item) => item.filePath === indexedDialuxPath)).toMatchObject({
      group: 'DialuxReports',
      available: true,
    });
    expect(catalog.items.find((item) => item.id === `datasheet:${luminaire.id}`)).toMatchObject({
      label: 'DL02 · ERCO',
      filePath: datasheetPath,
      available: true,
    });

    const record = await service.create(project, workspace, actor, {
      revisionNumber: 1,
      reissueNumber: 0,
      label: 'REV_01 Draft',
      status: 'Draft',
      outputMode: 'Both',
      relativeOutputFolder: 'ISSUED/REV_01_TEST',
      selectedItemIds: [selectedItem!.id],
      warningOverrideReason: '',
    });

    expect(record.itemCount).toBe(1);
    expect(record.manifest).toHaveLength(1);
    expect(record.manifest[0]?.group).toBe('LayoutDrawings');
    expect(existsSync(record.zipPath)).toBe(true);
    expect(statSync(record.zipPath).size).toBeGreaterThan(0);
    expect(readdirSync(record.folderPath)).toEqual(['03_LAYOUT_DRAWINGS']);
    expect(readdirSync(path.join(record.folderPath, '03_LAYOUT_DRAWINGS'))).toEqual(['L-101.pdf']);
    expect(store.listRevisionPackages(project.id)).toHaveLength(1);
  });
});
