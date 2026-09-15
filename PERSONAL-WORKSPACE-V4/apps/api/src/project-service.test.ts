import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSeedData, seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import { DomainError, type ProjectComment } from '@scli/domain';
import { MockDataProvider } from './mock-data-provider';
import { ProjectService } from './project-service';

const clock = () => new Date('2026-08-01T08:00:00.000Z');
const user = (id: string) => {
  const value = seedUsers.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing seed user ${id}`);
  return value;
};
const input = (name: string, ownerId?: string) => ({
  projectName: name,
  clientName: 'Test Client',
  projectType: 'Lighting Layout',
  description: 'A lighting design request.',
  ...(ownerId ? { salesOwnerId: ownerId } : {}),
  assignedDesignerId: null,
  collaboratorDesignerIds: [],
  siteLocation: 'Dubai, UAE',
  designStage: 'Concept' as const,
  lightingScope: 'Interior lighting design and luminaire coordination.',
  luxRequirements: 'Target 500 lux at working plane.',
  drawingReference: 'A-101',
  priority: 'Normal' as const,
  complexity: 'Medium' as const,
  estimatedHours: 8,
  requiredDeliveryDate: '2026-08-20',
  projectFolderUrl: null,
  idempotencyKey: randomUUID(),
});

describe('ProjectService workflows', () => {
  it('creates on behalf of Sales and records both actors', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const result = await service.createProject(
      user(seedUserIds.manager),
      input('Manager Created Project', seedUserIds.salesTwo),
    );

    expect(result.project.salesOwnerId).toBe(seedUserIds.salesTwo);
    expect(result.project.createdById).toBe(seedUserIds.manager);
    expect(result.project.status).toBe('Unassigned');
    expect(
      (await provider.listActivities(result.project.id)).map((item) => item.actionType),
    ).toEqual(expect.arrayContaining(['ProjectCreated', 'CreatedOnBehalf']));
  });

  it('does not let Sales forge an owner', async () => {
    const service = new ProjectService(new MockDataProvider(), 'Asia/Dubai', clock);
    await expect(
      service.createProject(
        user(seedUserIds.salesOne),
        input('Forged Owner', seedUserIds.salesTwo),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
  });

  it('requires an audited override for unavailable capacity', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const manager = user(seedUserIds.manager);
    const project = seedProjects.find((candidate) => candidate.status === 'Unassigned');
    if (!project) throw new Error('Missing unassigned project.');

    await expect(
      service.assignProject(manager, project.id, {
        designerId: seedUserIds.designerThree,
        collaboratorDesignerIds: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const updated = await service.assignProject(manager, project.id, {
      designerId: seedUserIds.designerThree,
      collaboratorDesignerIds: [],
      overrideReason: 'Specialist required for this motion deliverable.',
    });
    expect(updated.assignedDesignerId).toBe(seedUserIds.designerThree);
    expect((await provider.listActivities(project.id))[0]?.message).toContain('Override:');
  });

  it('rejects invalid transitions without mutating the record', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const project = seedProjects.find((candidate) => candidate.status === 'Unassigned');
    if (!project) throw new Error('Missing unassigned project.');

    await expect(
      service.changeStatus(user(seedUserIds.manager), project.id, { status: 'Completed' }),
    ).rejects.toBeInstanceOf(DomainError);
    expect((await provider.getProject(project.id))?.status).toBe('Unassigned');
  });

  it('grants shared-content access to the Sales owner, primary Designer, and collaborators', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const created = await service.createProject(user(seedUserIds.manager), {
      ...input('Collaborative Lighting Project', seedUserIds.salesOne),
      assignedDesignerId: seedUserIds.designerOne,
      collaboratorDesignerIds: [seedUserIds.designerTwo],
    });

    const salesUpdate = await service.updateProject(
      user(seedUserIds.salesOne),
      created.project.id,
      { lightingScope: 'Sales clarified the façade and landscape scope.' },
    );
    const collaboratorUpdate = await service.updateProject(
      user(seedUserIds.designerTwo),
      created.project.id,
      {
        drawingReference: 'L-201 Rev B',
        expectedVersion: salesUpdate.version,
      },
    );
    const primaryUpdate = await service.updateProject(
      user(seedUserIds.designerOne),
      created.project.id,
      {
        luxRequirements: '300 lux general, 500 lux task areas.',
        expectedVersion: collaboratorUpdate.version,
      },
    );

    expect(primaryUpdate).toMatchObject({
      lightingScope: 'Sales clarified the façade and landscape scope.',
      drawingReference: 'L-201 Rev B',
      luxRequirements: '300 lux general, 500 lux task areas.',
      version: 4,
    });
    await expect(
      service.getProject(user(seedUserIds.designerThree), created.project.id),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects stale edits and locks content after completion until a valid reopen', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const created = await service.createProject(user(seedUserIds.manager), {
      ...input('Versioned Lighting Project', seedUserIds.salesOne),
      assignedDesignerId: seedUserIds.designerOne,
    });
    const designer = user(seedUserIds.designerOne);
    const started = await service.changeStatus(designer, created.project.id, {
      status: 'InProgress',
    });

    await expect(
      service.updateProject(designer, started.id, {
        drawingReference: 'stale edit',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });

    const completed = await service.changeStatus(designer, started.id, { status: 'Completed' });
    await expect(
      service.updateProject(user(seedUserIds.salesOne), completed.id, {
        description: 'Attempted change after completion',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });

    const reopened = await service.changeStatus(user(seedUserIds.manager), completed.id, {
      status: 'InProgress',
    });
    await expect(
      service.updateProject(user(seedUserIds.salesOne), reopened.id, {
        description: 'Approved change after reopening',
        expectedVersion: reopened.version,
      }),
    ).resolves.toMatchObject({ description: 'Approved change after reopening' });
  });

  it('allocates unique project codes under concurrent creation', async () => {
    const seed = createSeedData();
    seed.projects = [];
    seed.activities = [];
    seed.comments = [];
    seed.notifications = [];
    seed.lastSequence = 0;
    const provider = new MockDataProvider(seed);
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const actor = user(seedUserIds.salesOne);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        service.createProject(actor, input(`Concurrent project ${index + 1}`)),
      ),
    );
    const codes = results.map((result) => result.project.projectCode);
    expect(new Set(codes).size).toBe(25);
    expect(codes).toContain('001_SCT260801_CONCURRENT_PROJECT_1');
    expect(codes).toContain('025_SCT260801_CONCURRENT_PROJECT_25');
  });

  it('creates projects with and without a CRM Reference and normalizes blank input', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const actor = user(seedUserIds.salesOne);

    const without = await service.createProject(actor, input('No CRM Project'));
    expect(without.project.crmReference).toBeNull();

    const withCrm = await service.createProject(actor, {
      ...input('CRM Project'),
      crmReference: ' CRM-48572 ',
    });
    expect(withCrm.project.crmReference).toBe('CRM-48572');

    const blank = await service.createProject(actor, {
      ...input('Blank CRM Project'),
      crmReference: '   ',
    });
    expect(blank.project.crmReference).toBeNull();
  });

  it('edits and clears the CRM Reference through the real authorization path', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const manager = user(seedUserIds.manager);
    const salesOwner = user(seedUserIds.salesOne);
    const created = await service.createProject(manager, {
      ...input('Editable CRM Project', seedUserIds.salesOne),
      crmReference: 'CRM-48572',
    });

    const edited = await service.updateProject(salesOwner, created.project.id, {
      crmReference: 'CRM-99110',
      expectedVersion: created.project.version,
    });
    expect(edited.crmReference).toBe('CRM-99110');

    const cleared = await service.updateProject(manager, created.project.id, {
      crmReference: null,
      expectedVersion: edited.version,
    });
    expect(cleared.crmReference).toBeNull();

    const activities = await provider.listActivities(created.project.id);
    expect(
      activities
        .filter((item) => item.fieldName === 'crmReference')
        .map((item) => [item.oldValue, item.newValue]),
    ).toEqual(
      expect.arrayContaining([
        ['CRM-48572', 'CRM-99110'],
        ['CRM-99110', null],
      ]),
    );
  });

  it('creates Personal projects with an optional commercial value pair', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);

    const valued = await service.createProject(manager, {
      ...input('Commercial Personal Project', seedUserIds.salesOne),
      commercialValueMinor: 12_345_678,
      commercialCurrency: 'AED',
    });
    expect(valued.project).toMatchObject({
      commercialValueMinor: 12_345_678,
      commercialCurrency: 'AED',
    });

    const omitted = await service.createProject(
      manager,
      input('Personal Project Without Commercial Value', seedUserIds.salesOne),
    );
    expect(omitted.project).not.toHaveProperty('commercialValueMinor');
    expect(omitted.project).not.toHaveProperty('commercialCurrency');
  });

  it('sets, updates, and atomically clears commercial value on a legacy Personal project', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const salesOwner = user(seedUserIds.salesOne);
    const manager = user(seedUserIds.manager);
    const legacy = seedProjects[0];
    if (!legacy) throw new Error('Missing legacy project fixture.');

    const loaded = await service.getProject(salesOwner, legacy.id);
    expect(loaded).not.toHaveProperty('commercialValueMinor');
    expect(loaded).not.toHaveProperty('commercialCurrency');

    const set = await service.updateProject(salesOwner, legacy.id, {
      commercialValueMinor: 12_345_678,
      commercialCurrency: 'AED',
      expectedVersion: loaded.version,
    });
    expect(set).toMatchObject({
      id: legacy.id,
      commercialValueMinor: 12_345_678,
      commercialCurrency: 'AED',
      version: loaded.version + 1,
    });

    await expect(
      service.updateProject(manager, legacy.id, {
        commercialValueMinor: 13_000_000,
        commercialCurrency: 'USD',
        expectedVersion: loaded.version,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });

    const updated = await service.updateProject(manager, legacy.id, {
      commercialValueMinor: 13_000_000,
      commercialCurrency: 'USD',
      expectedVersion: set.version,
    });
    const cleared = await service.updateProject(manager, legacy.id, {
      commercialValueMinor: null,
      commercialCurrency: null,
      expectedVersion: updated.version,
    });
    expect(cleared).toMatchObject({
      id: legacy.id,
      commercialValueMinor: null,
      commercialCurrency: null,
      version: loaded.version + 3,
    });

    const activities = (await provider.listActivities(legacy.id)).filter((activity) =>
      ['commercialValueMinor', 'commercialCurrency'].includes(activity.fieldName ?? ''),
    );
    expect(activities).toHaveLength(6);
    expect(activities.every((activity) => activity.actionType === 'ProjectUpdated')).toBe(true);
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: 'commercialValueMinor',
          oldValue: null,
          newValue: '12345678',
        }),
        expect.objectContaining({
          fieldName: 'commercialCurrency',
          oldValue: 'USD',
          newValue: null,
        }),
      ]),
    );
  });

  it('lets an assigned Designer read commercial metadata but denies mutation', async () => {
    const seed = createSeedData();
    const assigned = seed.projects.find(
      (project) => project.assignedDesignerId === seedUserIds.designerOne,
    );
    if (!assigned) throw new Error('Missing assigned project fixture.');
    assigned.commercialValueMinor = 450_000;
    assigned.commercialCurrency = 'AED';
    const provider = new MockDataProvider(seed);
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const designer = user(seedUserIds.designerOne);

    await expect(service.getProject(designer, assigned.id)).resolves.toMatchObject({
      commercialValueMinor: 450_000,
      commercialCurrency: 'AED',
    });
    await expect(
      service.updateProject(designer, assigned.id, {
        commercialValueMinor: 500_000,
        commercialCurrency: 'AED',
        expectedVersion: assigned.version,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    await expect(provider.getProject(assigned.id)).resolves.toMatchObject({
      commercialValueMinor: 450_000,
      commercialCurrency: 'AED',
      version: assigned.version,
    });
  });

  it('rejects commercial value creation and updates in Team mode', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'team');
    const manager = user(seedUserIds.manager);
    const existing = seedProjects[0];
    if (!existing) throw new Error('Missing Team project fixture.');

    await expect(
      service.createProject(manager, {
        ...input('Rejected Team Commercial Project', seedUserIds.salesOne),
        commercialValueMinor: 100_000,
        commercialCurrency: 'AED',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(
      service.updateProject(manager, existing.id, {
        commercialValueMinor: 100_000,
        commercialCurrency: 'AED',
        expectedVersion: existing.version,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(provider.getProject(existing.id)).resolves.not.toHaveProperty(
      'commercialValueMinor',
    );
  });

  it('rejects direct Personal actualHours mutation while allowing other metadata edits', async () => {
    const seed = createSeedData();
    const provider = new MockDataProvider(seed);
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const project = seed.projects[0];
    if (!project) throw new Error('Missing project fixture.');
    const versionBefore = project.version;
    const actualHoursBefore = project.actualHours;

    // A direct actualHours write through the ordinary metadata path is rejected.
    await expect(
      service.updateProject(manager, project.id, {
        actualHours: 99,
        expectedVersion: project.version,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    expect((await provider.getProject(project.id))?.actualHours).toBe(actualHoursBefore);
    expect((await provider.getProject(project.id))?.version).toBe(versionBefore);

    // Unrelated permitted metadata edits continue to work.
    const updated = await service.updateProject(manager, project.id, {
      projectName: 'Personal Metadata Edit',
      expectedVersion: project.version,
    });
    expect(updated.projectName).toBe('Personal Metadata Edit');
    expect(updated.actualHours).toBe(actualHoursBefore);
  });

  it('still allows Team actualHours mutation via the shared path', async () => {
    const seed = createSeedData();
    const provider = new MockDataProvider(seed);
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'team');
    const manager = user(seedUserIds.manager);
    const project = seed.projects[0];
    if (!project) throw new Error('Missing Team project fixture.');
    const updated = await service.updateProject(manager, project.id, {
      actualHours: 12,
      expectedVersion: project.version,
    });
    expect(updated.actualHours).toBe(12);
  });

  it('searches by CRM Reference, SCT codes, and historical SCLI codes', async () => {
    const seed = createSeedData();
    seed.lastSequence = 0;
    const provider = new MockDataProvider(seed);
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const manager = user(seedUserIds.manager);

    const sct = await service.createProject(manager, {
      ...input('CRM Searchable Project', seedUserIds.salesOne),
      crmReference: 'DUB-2026-154',
    });
    await service.createProject(manager, input('Another Project'));

    const legacy = seedProjects.find((project) => project.projectCode.includes('SCLI'));
    if (!legacy) throw new Error('Missing historical SCLI project.');

    await expect(service.listProjects(manager, { search: 'DUB-2026-154' })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sct.project.id })]),
    );
    await expect(
      service.listProjects(manager, { search: sct.project.projectCode }),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: sct.project.id })]));
    await expect(service.listProjects(manager, { search: 'SCLI' })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: legacy.id })]),
    );
  });

  it('edits every safe metadata field in one save and preserves identity, folder, and relations', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, {
      ...input('Dubai Hills Villa', seedUserIds.salesOne),
      crmReference: 'CRM-48572',
      projectFolderUrl: 'https://contoso.sharepoint.com/sites/projects/dubai-hills',
    });
    const comment: ProjectComment = {
      id: randomUUID(),
      projectId: created.project.id,
      body: 'Client confirmed the villa brief.',
      authorId: manager.id,
      authorNameSnapshot: manager.displayName,
      attachmentUrl: null,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    };
    await provider.addComment(comment);

    const updated = await service.updateProject(manager, created.project.id, {
      projectName: 'Dubai Hills Villa - Updated',
      clientName: 'Private Client',
      crmReference: 'CRM-99110',
      projectType: 'Lux Calculations',
      description: 'Complete villa lighting design and documentation.',
      siteLocation: 'Dubai Hills, Al Barari',
      designStage: 'DetailedDesign',
      lightingScope: 'Interior, landscape and facade lighting design.',
      luxRequirements: '500 lux at working plane, 300 lux general.',
      drawingReference: 'L-101 Rev B',
      priority: 'High',
      complexity: 'Large',
      estimatedHours: 40,
      actualHours: 12,
      progressPercent: 30,
      requiredDeliveryDate: '2026-09-15',
      expectedVersion: created.project.version,
    });

    expect(updated).toMatchObject({
      id: created.project.id,
      projectCode: created.project.projectCode,
      projectFolderUrl: created.project.projectFolderUrl,
      projectName: 'Dubai Hills Villa - Updated',
      clientName: 'Private Client',
      crmReference: 'CRM-99110',
      projectType: 'Lux Calculations',
      description: 'Complete villa lighting design and documentation.',
      siteLocation: 'Dubai Hills, Al Barari',
      designStage: 'DetailedDesign',
      lightingScope: 'Interior, landscape and facade lighting design.',
      luxRequirements: '500 lux at working plane, 300 lux general.',
      drawingReference: 'L-101 Rev B',
      priority: 'High',
      complexity: 'Large',
      estimatedHours: 40,
      actualHours: 12,
      progressPercent: 30,
      requiredDeliveryDate: '2026-09-15',
      status: created.project.status,
      version: created.project.version + 1,
    });

    const persisted = await provider.getProject(created.project.id);
    expect(persisted).toMatchObject({
      id: created.project.id,
      projectCode: created.project.projectCode,
      projectFolderUrl: created.project.projectFolderUrl,
      projectName: 'Dubai Hills Villa - Updated',
      crmReference: 'CRM-99110',
    });

    const activities = await provider.listActivities(created.project.id);
    const changedFields = activities.map((item) => item.fieldName);
    for (const field of [
      'projectName',
      'clientName',
      'crmReference',
      'projectType',
      'description',
      'siteLocation',
      'designStage',
      'lightingScope',
      'luxRequirements',
      'drawingReference',
      'priority',
      'complexity',
      'estimatedHours',
      'actualHours',
      'progressPercent',
      'requiredDeliveryDate',
    ]) {
      expect(changedFields).toContain(field);
    }

    const comments = await provider.listComments(created.project.id);
    expect(comments.map((item) => item.id)).toContain(comment.id);
    expect(comments[0]?.projectId).toBe(created.project.id);
  });

  it('keeps untouched fields intact during a partial metadata update', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, {
      ...input('Partial Update Project', seedUserIds.salesOne),
      crmReference: 'CRM-48572',
      description: 'Original description.',
      luxRequirements: 'Original lux target.',
      drawingReference: 'A-101',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: '2026-08-20',
    });

    const updated = await service.updateProject(manager, created.project.id, {
      projectName: 'Renamed Only',
      expectedVersion: created.project.version,
    });

    expect(updated).toMatchObject({
      id: created.project.id,
      projectCode: created.project.projectCode,
      projectName: 'Renamed Only',
      clientName: created.project.clientName,
      crmReference: 'CRM-48572',
      projectType: created.project.projectType,
      description: 'Original description.',
      siteLocation: created.project.siteLocation,
      designStage: created.project.designStage,
      lightingScope: created.project.lightingScope,
      luxRequirements: 'Original lux target.',
      drawingReference: 'A-101',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      actualHours: 0,
      progressPercent: 0,
      requiredDeliveryDate: '2026-08-20',
      status: created.project.status,
    });
  });

  it('preserves inactive historical Project Type snapshots during unrelated edits', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Historical Type Project'));
    const settings = await provider.getSettings();
    await provider.updateSettings({
      ...settings,
      projectTypes: [
        ...settings.projectTypes,
        {
          id: randomUUID(),
          name: 'Residential',
          isActive: true,
          createdAt: clock().toISOString(),
          updatedAt: clock().toISOString(),
        },
        {
          id: randomUUID(),
          name: 'Villa',
          isActive: false,
          createdAt: clock().toISOString(),
          updatedAt: clock().toISOString(),
        },
      ],
    });
    await provider.updateProject(created.project.id, { projectType: 'Villa' });

    const unrelated = await service.updateProject(manager, created.project.id, {
      clientName: 'Historical Client Updated',
      projectType: 'Villa',
      expectedVersion: created.project.version,
    });
    expect(unrelated).toMatchObject({
      id: created.project.id,
      projectCode: created.project.projectCode,
      clientName: 'Historical Client Updated',
      projectType: 'Villa',
    });
    expect((await provider.getSettings()).projectTypes.some((type) => type.name === 'Villa')).toBe(
      true,
    );

    const changed = await service.updateProject(manager, created.project.id, {
      projectType: 'Residential',
      expectedVersion: unrelated.version,
    });
    expect(changed.projectType).toBe('Residential');
    expect(changed.id).toBe(created.project.id);
    expect(changed.projectCode).toBe(created.project.projectCode);
  });

  it('rejects arbitrary, inactive, and concurrently deactivated Project Type targets', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Controlled Type Project'));
    const settings = await provider.getSettings();
    const commercial = {
      id: randomUUID(),
      name: 'Commercial',
      isActive: true,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    };
    const villa = {
      id: randomUUID(),
      name: 'Villa',
      isActive: false,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    };
    await provider.updateSettings({
      ...settings,
      projectTypes: [...settings.projectTypes, commercial, villa],
    });

    await expect(
      service.updateProject(manager, created.project.id, {
        projectType: 'RANDOM_UNCONFIGURED_TYPE',
        expectedVersion: created.project.version,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(
      service.updateProject(manager, created.project.id, {
        projectType: 'Villa',
        expectedVersion: created.project.version,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

    const catalogueSeenByEditor = (await provider.getSettings()).projectTypes;
    expect(catalogueSeenByEditor.find((type) => type.name === 'Commercial')?.isActive).toBe(true);
    await provider.updateSettings({
      ...(await provider.getSettings()),
      projectTypes: catalogueSeenByEditor.map((type) =>
        type.id === commercial.id ? { ...type, isActive: false } : type,
      ),
    });
    await expect(
      service.updateProject(manager, created.project.id, {
        projectType: 'Commercial',
        expectedVersion: created.project.version,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(await provider.getProject(created.project.id)).toMatchObject({
      projectType: 'Lighting Layout',
      version: created.project.version,
    });
  });

  it('allows unrelated edits for a missing historical value with zero active types', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Zero Active Historical Project'));
    const settings = await provider.getSettings();
    await provider.updateProject(created.project.id, { projectType: 'Retail Fitout' });
    await provider.updateSettings({
      ...settings,
      projectTypes: settings.projectTypes.map((type) => ({ ...type, isActive: false })),
    });

    const updated = await service.updateProject(manager, created.project.id, {
      clientName: 'Historical Client',
      projectType: 'Retail Fitout',
      expectedVersion: created.project.version,
    });
    expect(updated.projectType).toBe('Retail Fitout');
    expect(updated.clientName).toBe('Historical Client');
    expect((await provider.getSettings()).projectTypes).not.toContainEqual(
      expect.objectContaining({ name: 'Retail Fitout' }),
    );
  });

  it('rejects unauthorized metadata fields without partial persistence', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const salesOwner = user(seedUserIds.salesOne);
    const created = await service.createProject(salesOwner, input('Sales Owned Project'));

    await expect(
      service.updateProject(salesOwner, created.project.id, {
        projectName: 'Allowed rename',
        priority: 'Urgent',
        expectedVersion: created.project.version,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const persisted = await provider.getProject(created.project.id);
    expect(persisted).toMatchObject({
      projectName: created.project.projectName,
      priority: created.project.priority,
      version: created.project.version,
    });
  });

  it('keeps cancelled projects locked until a valid reopen', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock);
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Cancelled Lock Project'));

    const cancelled = await service.changeStatus(manager, created.project.id, {
      status: 'Cancelled',
      reason: 'Client paused the villa scope.',
    });
    await expect(
      service.updateProject(manager, cancelled.id, {
        description: 'Attempted edit while cancelled',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });

    const reopened = await service.changeStatus(manager, cancelled.id, { status: 'Unassigned' });
    await expect(
      service.updateProject(manager, reopened.id, {
        description: 'Approved edit after reopening',
        expectedVersion: reopened.version,
      }),
    ).resolves.toMatchObject({ description: 'Approved edit after reopening' });
  });

  it('archives, restores, and removes only from the workspace after exact confirmation', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(
      manager,
      input('Safe Archive Project', seedUserIds.salesOne),
    );

    const archived = await service.archiveProject(manager, created.project.id);
    expect(archived).toMatchObject({ status: 'Archived', statusBeforeArchive: 'Planning' });
    const restored = await service.restoreProject(manager, created.project.id);
    expect(restored).toMatchObject({ status: 'Planning', statusBeforeArchive: null });

    await service.archiveProject(manager, created.project.id);
    await expect(
      service.removeProjectFromWorkspace(manager, created.project.id, 'wrong-code'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(provider.getProject(created.project.id)).resolves.toBeTruthy();

    const removed = await service.removeProjectFromWorkspace(
      manager,
      created.project.id,
      created.project.projectCode,
    );
    expect(removed.projectCode).toBe(created.project.projectCode);
    await expect(provider.getProject(created.project.id)).resolves.toBeNull();
  });
});

describe('controlled project reference updates', () => {
  it('treats a same-code request as a safe no-op', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('No Op Villa'));
    const prepared = await service.prepareProjectReferenceChange(manager, created.project.id, {
      projectCode: created.project.projectCode,
      expectedVersion: created.project.version,
    });
    expect(prepared.changed).toBe(false);
    expect(prepared.newCode).toBe(created.project.projectCode);
    expect((await provider.getProject(created.project.id))?.version).toBe(created.project.version);
  });

  it('rejects a duplicate reference before any mutation', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const first = await service.createProject(manager, input('Duplicate Villa'));
    const second = await service.createProject(manager, input('Another Villa'));
    await expect(
      service.prepareProjectReferenceChange(manager, second.project.id, {
        projectCode: first.project.projectCode,
        expectedVersion: second.project.version,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect((await provider.getProject(second.project.id))?.projectCode).toBe(
      second.project.projectCode,
    );
  });

  it('rejects stale expected versions', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Stale Villa'));
    await expect(
      service.prepareProjectReferenceChange(manager, created.project.id, {
        projectCode: '001_SCT260801_STALE_VILLA',
        expectedVersion: created.project.version + 10,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('denies designers and non-owner Sales users', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(
      manager,
      input('Owned Villa', seedUserIds.salesOne),
    );
    await expect(
      service.prepareProjectReferenceChange(user(seedUserIds.designerOne), created.project.id, {
        projectCode: '001_SCT260801_OWNED_VILLA',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    await expect(
      service.prepareProjectReferenceChange(user(seedUserIds.salesTwo), created.project.id, {
        projectCode: '001_SCT260801_OWNED_VILLA',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
  });

  it('rejects reference changes on completed or cancelled projects', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Closed Villa'));
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    const completed = await service.changeStatus(manager, started.id, { status: 'Completed' });
    await expect(
      service.prepareProjectReferenceChange(manager, completed.id, {
        projectCode: '001_SCT260801_CLOSED_VILLA',
        expectedVersion: completed.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });
    const cancelledProject = await service.createProject(manager, input('Cancelled Villa'));
    const cancelled = await service.changeStatus(manager, cancelledProject.project.id, {
      status: 'Cancelled',
      reason: 'Client paused the villa scope.',
    });
    await expect(
      service.prepareProjectReferenceChange(manager, cancelled.id, {
        projectCode: '001_SCT260801_CLOSED_VILLA',
        expectedVersion: cancelled.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });
    expect((await provider.getProject(created.project.id))?.projectCode).toBe(
      created.project.projectCode,
    );
  });

  it('commits the new code, path, version and an old/new audit record', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Commit Villa'));
    const prepared = await service.prepareProjectReferenceChange(manager, created.project.id, {
      projectCode: '001_SCT260801_COMMIT_VILLA',
      expectedVersion: created.project.version,
    });
    const committed = await service.commitProjectReferenceChange(manager, created.project.id, {
      previousProject: prepared.project,
      newCode: prepared.newCode,
      newFolderPath: 'C:\\Projects\\001_SCT260801_COMMIT_VILLA',
      folderIndexedAt: '2026-08-01T08:00:00.000Z',
      folderFileCount: 3,
      now: prepared.now,
    });
    expect(committed).toMatchObject({
      id: created.project.id,
      projectCode: '001_SCT260801_COMMIT_VILLA',
      projectFolderPath: 'C:\\Projects\\001_SCT260801_COMMIT_VILLA',
      folderFileCount: 3,
      version: created.project.version + 1,
    });
    const activity = (await provider.listActivities(created.project.id)).find(
      (item) => item.actionType === 'ProjectReferenceChanged',
    );
    expect(activity).toMatchObject({
      fieldName: 'projectCode',
      oldValue: created.project.projectCode,
      newValue: '001_SCT260801_COMMIT_VILLA',
    });
  });

  it('restores a reference snapshot for compensation without an audit record', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Rollback Villa'));
    const prepared = await service.prepareProjectReferenceChange(manager, created.project.id, {
      projectCode: '001_SCT260801_ROLLBACK_VILLA',
      expectedVersion: created.project.version,
    });
    await service.commitProjectReferenceChange(manager, created.project.id, {
      previousProject: prepared.project,
      newCode: prepared.newCode,
      newFolderPath: null,
      folderIndexedAt: null,
      folderFileCount: null,
      now: prepared.now,
    });
    await service.restoreProjectReferenceSnapshot(created.project.id, prepared.project);
    const restored = await provider.getProject(created.project.id);
    expect(restored).toMatchObject({
      projectCode: created.project.projectCode,
      version: created.project.version,
    });
    expect(
      (await provider.listActivities(created.project.id)).filter(
        (item) => item.actionType === 'ProjectReferenceChanged',
      ),
    ).toHaveLength(1);
  });
});
