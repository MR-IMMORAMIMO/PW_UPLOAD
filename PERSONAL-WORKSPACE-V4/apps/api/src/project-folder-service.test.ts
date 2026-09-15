import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_PREFIX,
  DomainError,
  blankProjectFolderDraft,
  folderStructureFromSnapshot,
  instantiateProjectFolderDraft,
  type FolderNodePreset,
  type FolderProfilePreset,
  type OutputMapping,
  type Project,
  type ProjectFolderSnapshot,
  type ProjectOutputFolders,
} from '@scli/domain';
import {
  ProjectFolderService,
  listFolderPaths,
  validateFolderConfiguration,
} from './project-folder-service';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const folders: FolderNodePreset[] = [
  {
    name: '06_LUMINAIRE_SCHEDULE',
    children: [
      { name: 'EXCEL', children: [] },
      { name: 'PDF', children: [] },
    ],
  },
  {
    name: '07_BOQ',
    children: [
      { name: 'EXCEL', children: [] },
      { name: 'PDF', children: [] },
    ],
  },
  { name: '08_DATASHEETS', children: [] },
];

const outputs: ProjectOutputFolders = {
  scheduleExcel: '06_LUMINAIRE_SCHEDULE/EXCEL',
  schedulePdf: '06_LUMINAIRE_SCHEDULE/PDF',
  boqExcel: '07_BOQ/EXCEL',
  boqPdf: '07_BOQ/PDF',
  datasheets: '08_DATASHEETS',
};

describe('custom project folder configuration', () => {
  it('lists nested paths and accepts mappings to created folders', () => {
    expect(listFolderPaths(folders)).toEqual([
      '06_LUMINAIRE_SCHEDULE',
      '06_LUMINAIRE_SCHEDULE/EXCEL',
      '06_LUMINAIRE_SCHEDULE/PDF',
      '07_BOQ',
      '07_BOQ/EXCEL',
      '07_BOQ/PDF',
      '08_DATASHEETS',
    ]);
    expect(validateFolderConfiguration(folders, outputs)).toEqual(outputs);
  });

  it('rejects traversal and mappings to missing folders', () => {
    for (const invalid of ['../OUTSIDE', 'MISSING/PDF']) {
      expect(() =>
        validateFolderConfiguration(folders, { ...outputs, schedulePdf: invalid }),
      ).toThrow(DomainError);
    }
  });

  it('rejects duplicate folder names at the same level', () => {
    expect(() =>
      listFolderPaths([
        { name: 'OUTPUT', children: [] },
        { name: 'output', children: [] },
      ]),
    ).toThrow(DomainError);
  });
});

describe('project folder creation', () => {
  const makeProject = (overrides: Partial<Project> = {}): Project => ({
    id: '11111111-1111-4111-8111-111111111111',
    projectCode: '023_SCT260807_DUBAI_HILLS_VILLA',
    projectName: 'Dubai Hills Villa',
    clientName: 'Client',
    projectType: 'Villa Lighting Design',
    description: '',
    salesOwnerId: '22222222-2222-4222-8222-222222222222',
    salesOwnerNameSnapshot: 'Sales Owner',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: '22222222-2222-4222-8222-222222222222',
    createdByNameSnapshot: 'Sales Owner',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting design.',
    luxRequirements: '',
    drawingReference: '',
    status: 'Planning',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    projectFolderPath: null,
    folderProfile: 'Full Lighting Design',
    services: ['LuminaireSchedule'],
    luminaireInputMode: 'Later',
    revisionNumber: 0,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  });

  it('names the new folder exactly like the canonical SCT project reference', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scli-folder-create-'));
    temporaryDirectories.push(base);
    const profile: FolderProfilePreset = {
      name: 'Full Lighting Design',
      description: 'Test profile',
      folders,
      outputFolders: outputs,
      builtIn: true,
    };
    const service = new ProjectFolderService();
    const result = service.create(base, makeProject(), profile, new Date('2026-08-07T00:00:00Z'));

    expect(result.folderName).toBe('023_SCT260807_DUBAI_HILLS_VILLA');
    expect(path.basename(result.folderPath)).toBe(result.folderName);
    const info = readFileSync(result.projectInfoPath, 'utf8');
    expect(info).toContain(`Company Code   : ${CURRENT_PROJECT_PREFIX}`);
    expect(info).toContain(`Project Code   : 023_SCT260807_DUBAI_HILLS_VILLA`);
    expect(info).toContain(`Folder Name    : 023_SCT260807_DUBAI_HILLS_VILLA`);
  });
});

describe('controlled managed folder rename', () => {
  const makeProject = (overrides: Partial<Project> = {}): Project => ({
    id: '11111111-1111-4111-8111-111111111111',
    projectCode: '023_SCT260807_DUBAI_VILLA',
    projectName: 'Dubai Villa',
    clientName: 'Client',
    projectType: 'Villa Lighting Design',
    description: '',
    salesOwnerId: '22222222-2222-4222-8222-222222222222',
    salesOwnerNameSnapshot: 'Sales Owner',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: '22222222-2222-4222-8222-222222222222',
    createdByNameSnapshot: 'Sales Owner',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting design.',
    luxRequirements: '',
    drawingReference: '',
    status: 'Planning',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    projectFolderPath: null,
    folderProfile: 'Full Lighting Design',
    services: ['LuminaireSchedule'],
    luminaireInputMode: 'Later',
    revisionNumber: 0,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  });

  function createdManagedFolder(project: Project): string {
    const base = mkdtempSync(path.join(tmpdir(), 'scli-rename-create-'));
    temporaryDirectories.push(base);
    const profile: FolderProfilePreset = {
      name: 'Full Lighting Design',
      description: 'Test profile',
      folders,
      outputFolders: outputs,
      builtIn: true,
    };
    const service = new ProjectFolderService();
    const created = service.create(base, project, profile, new Date('2026-08-07T00:00:00Z'));
    return created.folderPath;
  }

  it('renames a proven managed folder to the new SCT reference in the same parent', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const folderPath = createdManagedFolder(project);
    const service = new ProjectFolderService();
    const result = service.renameManagedProjectFolder(
      { ...project, projectFolderPath: folderPath },
      folderPath,
      '023_SCT260807_DUBAI_HILLS_VILLA',
    );
    expect(result.oldPath).toBe(folderPath);
    expect(path.dirname(result.newPath)).toBe(path.dirname(folderPath));
    expect(path.basename(result.newPath)).toBe('023_SCT260807_DUBAI_HILLS_VILLA');
    expect(existsSync(result.newPath)).toBe(true);
    expect(existsSync(folderPath)).toBe(false);
  });

  it('fails closed when the recorded paths disagree', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const folderPath = createdManagedFolder(project);
    const service = new ProjectFolderService();
    expect(() =>
      service.renameManagedProjectFolder(
        { ...project, projectFolderPath: folderPath },
        path.join(path.dirname(folderPath), 'SOMEWHERE_ELSE'),
        '023_SCT260807_DUBAI_HILLS_VILLA',
      ),
    ).toThrow(DomainError);
    expect(existsSync(folderPath)).toBe(true);
  });

  it('fails closed when the basename does not match the current reference', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const folderPath = createdManagedFolder(project);
    const renamed = path.join(path.dirname(folderPath), 'UNRELATED_FOLDER');
    mkdirSync(renamed);
    temporaryDirectories.push(renamed);
    const service = new ProjectFolderService();
    expect(() =>
      service.renameManagedProjectFolder(
        { ...project, projectFolderPath: renamed },
        renamed,
        '023_SCT260807_DUBAI_HILLS_VILLA',
      ),
    ).toThrow(DomainError);
    expect(existsSync(renamed)).toBe(true);
  });

  it('fails closed when PROJECT_INFO.txt contradicts the current reference', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const folderPath = createdManagedFolder(project);
    writeFileSync(
      path.join(folderPath, 'PROJECT_INFO.txt'),
      'SCLI LIGHTING PROJECT\r\nProject Code   : 999_SCLI000000_OTHER\r\n',
      'utf8',
    );
    const service = new ProjectFolderService();
    expect(() =>
      service.renameManagedProjectFolder(
        { ...project, projectFolderPath: folderPath },
        folderPath,
        '023_SCT260807_DUBAI_HILLS_VILLA',
      ),
    ).toThrow(DomainError);
    expect(path.basename(folderPath)).toBe('023_SCT260807_DUBAI_VILLA');
  });

  it('fails before mutation when the managed folder is missing', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const missing = path.join(tmpdir(), `missing-${Date.now()}`);
    const service = new ProjectFolderService();
    expect(() =>
      service.renameManagedProjectFolder(
        { ...project, projectFolderPath: missing },
        missing,
        '023_SCT260807_DUBAI_HILLS_VILLA',
      ),
    ).toThrow(DomainError);
  });

  it('rejects a rename when the target folder already exists', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const folderPath = createdManagedFolder(project);
    const target = path.join(path.dirname(folderPath), '023_SCT260807_DUBAI_HILLS_VILLA');
    mkdirSync(target);
    temporaryDirectories.push(target);
    const service = new ProjectFolderService();
    expect(() =>
      service.renameManagedProjectFolder(
        { ...project, projectFolderPath: folderPath },
        folderPath,
        '023_SCT260807_DUBAI_HILLS_VILLA',
      ),
    ).toThrow(DomainError);
    expect(existsSync(folderPath)).toBe(true);
  });

  it('allows legacy imports without PROJECT_INFO when the legacy folder name matches', () => {
    const project = makeProject({
      projectCode: '019_SCLI251204_GEVI_SHARJAH',
      legacyFolderName: '019_SCLI251204_GEVI_SHARJAH',
      isLegacyProject: true,
    });
    const base = mkdtempSync(path.join(tmpdir(), 'scli-rename-legacy-'));
    temporaryDirectories.push(base);
    const legacyFolder = path.join(base, project.projectCode!);
    mkdirSync(legacyFolder);
    writeFileSync(path.join(legacyFolder, 'DESIGN.NOTES.txt'), 'legacy content', 'utf8');
    const service = new ProjectFolderService();
    const result = service.renameManagedProjectFolder(
      { ...project, projectFolderPath: legacyFolder },
      legacyFolder,
      '019_SCT251204_GEVI_SHARJAH',
    );
    expect(path.basename(result.newPath)).toBe('019_SCT251204_GEVI_SHARJAH');
    expect(existsSync(path.join(result.newPath, 'DESIGN.NOTES.txt'))).toBe(true);
  });

  it('restores a renamed folder to its previous name for compensation', () => {
    const project = makeProject({ projectCode: '023_SCT260807_DUBAI_VILLA' });
    const folderPath = createdManagedFolder(project);
    const service = new ProjectFolderService();
    const result = service.renameManagedProjectFolder(
      { ...project, projectFolderPath: folderPath },
      folderPath,
      '023_SCT260807_DUBAI_HILLS_VILLA',
    );
    service.restoreManagedProjectFolder(result.newPath, result.oldPath);
    expect(existsSync(result.oldPath)).toBe(true);
    expect(existsSync(result.newPath)).toBe(false);
  });
});

describe('PROJECT_INFO.txt reference refresh', () => {
  it('updates the project identity lines and preserves unrelated metadata', () => {
    const service = new ProjectFolderService();
    const base = mkdtempSync(path.join(tmpdir(), 'scli-info-update-'));
    temporaryDirectories.push(base);
    const folder = path.join(base, '023_SCT260807_DUBAI_HILLS_VILLA');
    mkdirSync(folder);
    writeFileSync(
      path.join(folder, 'PROJECT_INFO.txt'),
      [
        'SCLI LIGHTING PROJECT',
        '=====================',
        'Project Number : 023',
        'Company Code   : SCT',
        'Project Code   : 023_SCT260807_DUBAI_VILLA',
        'Project Name   : DUBAI VILLA',
        'Client         : Acme',
        'Folder Name    : 023_SCT260807_DUBAI_VILLA',
        'Custom Note    : keep me',
        '',
      ].join('\r\n'),
      'utf8',
    );
    const project: Project = {
      id: '11111111-1111-4111-8111-111111111111',
      projectCode: '023_SCT260807_DUBAI_HILLS_VILLA',
      projectName: 'Dubai Hills Villa',
      clientName: 'Acme',
      projectType: 'Villa Lighting Design',
      description: '',
      salesOwnerId: '22222222-2222-4222-8222-222222222222',
      salesOwnerNameSnapshot: 'Sales Owner',
      salesOwnerEmailSnapshot: 'sales@example.com',
      createdById: '22222222-2222-4222-8222-222222222222',
      createdByNameSnapshot: 'Sales Owner',
      createdByEmailSnapshot: 'sales@example.com',
      assignedDesignerId: null,
      assignedDesignerNameSnapshot: null,
      collaboratorDesignerIds: [],
      collaboratorDesignerNameSnapshots: [],
      siteLocation: 'Dubai, UAE',
      designStage: 'Concept',
      lightingScope: 'Interior lighting design.',
      luxRequirements: '',
      drawingReference: '',
      status: 'Planning',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 24,
      actualHours: 0,
      progressPercent: 0,
      requiredDeliveryDate: '2026-08-20',
      projectFolderUrl: null,
      projectFolderPath: folder,
      folderProfile: 'Full Lighting Design',
      services: ['LuminaireSchedule'],
      luminaireInputMode: 'Later',
      revisionNumber: 0,
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      completedAt: null,
      cancelledAt: null,
      version: 1,
    };
    service.updateProjectInfo(project, folder);
    const info = readFileSync(path.join(folder, 'PROJECT_INFO.txt'), 'utf8');
    expect(info).toContain('Project Code   : 023_SCT260807_DUBAI_HILLS_VILLA');
    expect(info).toContain('Company Code   : SCT');
    expect(info).toContain('Folder Name    : 023_SCT260807_DUBAI_HILLS_VILLA');
    expect(info).toContain('Project Name   : DUBAI VILLA');
    expect(info).toContain('Custom Note    : keep me');
  });
});
describe('P2.4B3B2A canonical physical creation from a persisted snapshot', () => {
  const makeProject = (overrides: Partial<Project> = {}): Project => ({
    id: '11111111-1111-4111-8111-111111111111',
    projectCode: '023_SCT260807_DUBAI_HILLS_VILLA',
    projectName: 'Dubai Hills Villa',
    clientName: 'Client',
    projectType: 'Villa Lighting Design',
    description: '',
    salesOwnerId: '22222222-2222-4222-8222-222222222222',
    salesOwnerNameSnapshot: 'Sales Owner',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: '22222222-2222-4222-8222-222222222222',
    createdByNameSnapshot: 'Sales Owner',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting design.',
    luxRequirements: '',
    drawingReference: '',
    status: 'Planning',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    projectFolderPath: null,
    folderProfile: 'Full Lighting Design',
    services: ['LuminaireSchedule'],
    luminaireInputMode: 'Later',
    revisionNumber: 0,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  });

  function instantiated(): { snapshot: ProjectFolderSnapshot; mappings: OutputMapping[] } {
    const result = instantiateProjectFolderDraft(
      {
        folders: [
          { draftFolderId: 'D1', parentDraftFolderId: null, name: '01_RECEIVED', displayOrder: 0 },
          { draftFolderId: 'D2', parentDraftFolderId: null, name: '02_WORKING', displayOrder: 1 },
          {
            draftFolderId: 'D3',
            parentDraftFolderId: 'D2',
            name: 'CAD',
            displayOrder: 0,
          },
          {
            draftFolderId: 'D4',
            parentDraftFolderId: null,
            name: '03_DELIVERABLES',
            displayOrder: 2,
          },
        ],
        outputMappings: [
          { outputTypeId: 'scheduleExcel', destinationDraftFolderId: 'D3' },
          { outputTypeId: 'Reports', destinationDraftFolderId: 'D4' },
        ],
        sourceProfile: {
          profileId: null,
          profileName: 'Full Lighting Design',
          profileRevision: null,
          structuralFingerprint: 'fp-test',
          factoryProfileKey: 'full-lighting-design',
        },
      },
      (() => {
        let next = 0;
        return () => `project-folder-${(next += 1)}`;
      })(),
    );
    return { snapshot: result.snapshot, mappings: result.outputMappings.mappings };
  }

  function relativeDirectories(root: string): string[] {
    const entries: string[] = [];
    const visit = (current: string, relative: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        entries.push(childRelative);
        visit(path.join(current, entry.name), childRelative);
      }
    };
    visit(root, '');
    return entries.sort((left, right) => left.localeCompare(right));
  }

  it('creates exactly the persisted snapshot tree and no extra folders', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scli-canonical-create-'));
    temporaryDirectories.push(base);
    const { snapshot, mappings } = instantiated();
    const service = new ProjectFolderService();
    const created = service.createCanonical(base, makeProject(), snapshot, mappings);
    expect(created.createdFolderCount).toBe(4);
    const expected = listFolderPaths(folderStructureFromSnapshot(snapshot)).sort((left, right) =>
      left.localeCompare(right),
    );
    expect(relativeDirectories(created.folderPath)).toEqual(expected);
    const projectInfoPath = path.join(created.folderPath, 'PROJECT_INFO.txt');
    expect(existsSync(projectInfoPath)).toBe(true);
    expect(readFileSync(projectInfoPath, 'utf8')).toContain('SCT LIGHTING PROJECT');
  });

  it('rejects dangling output mappings before any physical mutation', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scli-canonical-invalid-'));
    temporaryDirectories.push(base);
    const { snapshot } = instantiated();
    const service = new ProjectFolderService();
    expect(() =>
      service.createCanonical(base, makeProject(), snapshot, [
        {
          outputTypeId: 'scheduleExcel',
          destinationFolderId: 'not-in-snapshot',
          unresolved: false,
          legacyPath: null,
        },
      ]),
    ).toThrow(DomainError);
    expect(existsSync(path.join(base, '023_SCT260807_DUBAI_HILLS_VILLA'))).toBe(false);
  });

  it('rejects an invalid snapshot before any physical mutation', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scli-canonical-invalid-snapshot-'));
    temporaryDirectories.push(base);
    const invalid: ProjectFolderSnapshot = {
      schemaVersion: '1.0',
      sourceProfile: null,
      folders: [
        {
          folderId: 'A',
          parentFolderId: 'MISSING',
          name: 'FOLDER',
          displayOrder: 0,
          enabled: true,
          semanticRole: null,
        },
      ],
    };
    expect(() =>
      new ProjectFolderService().createCanonical(base, makeProject(), invalid, []),
    ).toThrow(DomainError);
    expect(existsSync(path.join(base, '023_SCT260807_DUBAI_HILLS_VILLA'))).toBe(false);
  });

  it('creates only the managed root for a blank canonical snapshot', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'scli-canonical-blank-'));
    temporaryDirectories.push(base);
    const draft = blankProjectFolderDraft();
    const instantiated = instantiateProjectFolderDraft(draft, () => 'never-called');
    const service = new ProjectFolderService();
    const created = service.createCanonical(
      base,
      makeProject(),
      instantiated.snapshot,
      instantiated.outputMappings.mappings,
    );
    expect(created.createdFolderCount).toBe(0);
    expect(relativeDirectories(created.folderPath)).toEqual([]);
    expect(existsSync(path.join(created.folderPath, 'PROJECT_INFO.txt'))).toBe(true);
  });
});
