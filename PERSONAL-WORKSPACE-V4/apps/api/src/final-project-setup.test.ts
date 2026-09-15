import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProjectSchema, finalProjectSetupSchema } from '@scli/contracts';
import { seedUsers } from '@scli/test-data';
import { MockDataProvider } from './mock-data-provider';
import { ProjectService } from './project-service';

const setup = finalProjectSetupSchema.parse({
  schemaVersion: 1,
  sourceLead: 'Reference',
  contractReference: 'CON-1',
  managerId: null,
  probability: 60,
  category: 'Commercial',
  discipline: 'Lighting',
  projectNature: 'New',
  packageType: 'Standard',
  deliverables: ['Lighting Plans'],
  designServices: ['Concept Design'],
  documentation: [],
  coordination: 'standard',
  standards: [],
  notes: 'Saved scope',
  schedule: {
    startDate: '2026-08-01',
    completionDate: '2026-08-20',
    designDurationDays: 10,
    constructionDurationDays: 0,
    milestones: [
      {
        id: randomUUID(),
        name: 'Review',
        description: '',
        targetDate: '2026-08-18',
        phase: 'Design',
      },
    ],
  },
  structure: {
    enabledGroups: [],
    documentCategory: 'MEET',
    sequenceDigits: 4,
    separator: '-',
    extension: '.pdf',
  },
});
const manager = seedUsers.find((user) => user.role === 'LineManager')!;
function input() {
  return createProjectSchema.parse({
    projectName: 'Final Setup',
    clientName: 'Test Client',
    projectType: 'Lighting Layout',
    designStage: 'Concept',
    priority: 'Low',
    complexity: 'Medium',
    estimatedHours: 0,
    requiredDeliveryDate: '2026-08-20',
    description: '',
    lightingScope: 'Actual scope',
    idempotencyKey: randomUUID(),
    finalSetup: structuredClone(setup),
  });
}
describe('Final wizard persistence and authority', () => {
  it('saves project responsibility notes independently of contact notes, with authority and audit', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(
      provider,
      'Asia/Dubai',
      () => new Date('2026-08-02T09:00:00Z'),
      'personal',
    );
    const { project } = await service.createProject(manager, input());
    const prepared = await service.prepareProjectUpdate(manager, project.id, {
      responsibilityNotes: 'Coordinate through the client lead.',
      expectedVersion: project.version,
    });
    expect(prepared.patch.responsibilityNotes).toBe('Coordinate through the client lead.');
    expect(prepared.patch.finalSetup).toBeUndefined();
    expect(prepared.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: 'responsibilityNotes',
          oldValue: '',
          newValue: 'Coordinate through the client lead.',
        }),
      ]),
    );
    const unrelated = seedUsers.find(
      (user) => user.role === 'Designer' && user.id !== project.assignedDesignerId,
    )!;
    await expect(
      service.prepareProjectUpdate(unrelated, project.id, { responsibilityNotes: 'Forged' }),
    ).rejects.toThrow();
  });
  it('edits shared scope standards and notes without replacing other setup fields and records exact changes', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(
      provider,
      'Asia/Dubai',
      () => new Date('2026-08-02T09:00:00Z'),
      'personal',
    );
    const result = await service.createProject(manager, input());
    const prepared = await service.prepareProjectUpdate(manager, result.project.id, {
      scopeStandards: ['EN 12464-1'],
      scopeNotes: 'Updated scope note',
      expectedVersion: result.project.version,
    });
    expect(prepared.patch.finalSetup).toEqual({
      ...setup,
      standards: ['EN 12464-1'],
      notes: 'Updated scope note',
    });
    expect(prepared.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldName: 'standards', newValue: 'EN 12464-1' }),
        expect.objectContaining({
          fieldName: 'scopeNotes',
          oldValue: 'Saved scope',
          newValue: 'Updated scope note',
        }),
      ]),
    );
    await expect(
      service.prepareProjectUpdate(manager, result.project.id, {
        requiredDeliveryDate: '2026-07-01',
      }),
    ).rejects.toThrow('Completion must follow');
    const unrelated = seedUsers.find(
      (u) => u.role === 'Designer' && u.id !== result.project.assignedDesignerId,
    )!;
    await expect(
      service.prepareProjectUpdate(unrelated, result.project.id, { scopeStandards: [] }),
    ).rejects.toThrow();
  });
  it('creates an undated Planning project and records its first start once in company time', async () => {
    const provider = new MockDataProvider();
    let now = new Date('2026-08-01T21:30:00Z');
    const service = new ProjectService(provider, 'Asia/Dubai', () => now, 'personal');
    const request = input();
    request.requiredDeliveryDate = '';
    request.finalSetup!.schedule = {
      startDate: '',
      completionDate: '',
      designDurationDays: 0,
      constructionDurationDays: 0,
      milestones: [],
    };
    const created = await service.createProject(manager, request);
    expect(created.project).toMatchObject({ status: 'Planning', requiredDeliveryDate: '' });
    expect(created.project.commercialValueMinor ?? null).toBeNull();
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    expect(started.finalSetup?.schedule.startDate).toBe('2026-08-02');
    now = new Date('2026-08-03T10:00:00Z');
    const replay = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    expect(replay.finalSetup?.schedule.startDate).toBe('2026-08-02');
    expect(replay.version).toBe(started.version);
    await service.changeStatus(manager, created.project.id, { status: 'OnHold' });
    const resumed = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    expect(resumed.finalSetup?.schedule.startDate).toBe('2026-08-02');
  });
  it('retains an authored start date when starting a Planning project', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(
      provider,
      'Asia/Dubai',
      () => new Date('2026-08-02T08:00:00Z'),
      'personal',
    );
    const created = await service.createProject(manager, input());
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    expect(started.finalSetup?.schedule.startDate).toBe('2026-08-01');
  });
  it('persists the complete setup atomically with the canonical Project and retains it through edits and idempotent retries', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(
      provider,
      'Asia/Dubai',
      () => new Date('2026-08-01T08:00:00Z'),
      'personal',
    );
    const request = input();
    const result = await service.createProject(manager, request);
    expect((await provider.getProject(result.project.id))?.finalSetup).toEqual(setup);
    expect(result.project.priority).toBe('Low');
    expect((await service.createProject(manager, request)).project.id).toBe(result.project.id);
    request.finalSetup!.notes = 'Client object changed';
    expect((await provider.getProject(result.project.id))?.finalSetup?.notes).toBe('Saved scope');
    expect(
      (await provider.listActivities(result.project.id)).filter(
        (item) => item.actionType === 'ProjectCreated',
      ),
    ).toHaveLength(1);
  });
  it('rejects Team use and conflicting delivery dates before creating a Project', async () => {
    const provider = new MockDataProvider();
    const count = (await provider.listProjects()).length;
    await expect(
      new ProjectService(
        provider,
        'Asia/Dubai',
        () => new Date('2026-08-01T08:00:00Z'),
        'team',
      ).createProject(manager, input()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      new ProjectService(
        provider,
        'Asia/Dubai',
        () => new Date('2026-08-01T08:00:00Z'),
        'personal',
      ).createProject(manager, { ...input(), requiredDeliveryDate: '2026-08-21' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await provider.listProjects()).toHaveLength(count);
  });
  it('rejects forged identities, unsupported versions and malformed nested schedule records', () => {
    expect(finalProjectSetupSchema.safeParse({ ...setup, actorId: manager.id }).success).toBe(
      false,
    );
    expect(finalProjectSetupSchema.safeParse({ ...setup, schemaVersion: 2 }).success).toBe(false);
    expect(finalProjectSetupSchema.safeParse({ ...setup, managerId: 'display-name' }).success).toBe(
      false,
    );
    expect(
      finalProjectSetupSchema.safeParse({
        ...setup,
        schedule: { ...setup.schedule, completionDate: '2026-07-01' },
      }).success,
    ).toBe(false);
    const legacy = { ...input(), finalSetup: undefined, siteLocation: 'Dubai' };
    expect(createProjectSchema.safeParse(legacy).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...legacy, siteLocation: '' }).success).toBe(false);
  });
});
