import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSeedData, seedUserIds, seedUsers } from '@scli/test-data';
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

describe('P2.5B1 controlled Personal workflow reality', () => {
  it('runs the full Personal loop, OnHold resume, stale conflict, and retry replay', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Lighting Workflow Reality'));

    expect(created.project.status).toBe('Planning');
    expect(created.project.projectCode).toContain('LIGHTING_WORKFLOW_REALITY');

    // Planning -> InProgress -> ClientReview -> RevisionRequired -> InProgress
    // -> ClientReview -> RevisionRequired -> InProgress -> Completed -> Reopen
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    expect(started.status).toBe('InProgress');

    const review1 = await service.changeStatus(manager, started.id, { status: 'ClientReview' });
    expect(review1.status).toBe('ClientReview');

    const revision1 = await service.changeStatus(manager, review1.id, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
    });
    expect(revision1.status).toBe('RevisionRequired');

    const back1 = await service.changeStatus(manager, revision1.id, { status: 'InProgress' });
    expect(back1.status).toBe('InProgress');

    const review2 = await service.changeStatus(manager, back1.id, { status: 'ClientReview' });
    expect(review2.status).toBe('ClientReview');

    const revision2 = await service.changeStatus(manager, review2.id, {
      status: 'RevisionRequired',
      reason: 'Client requested further lighting revisions.',
    });
    expect(revision2.status).toBe('RevisionRequired');

    const back2 = await service.changeStatus(manager, revision2.id, { status: 'InProgress' });
    expect(back2.status).toBe('InProgress');

    const completed = await service.changeStatus(manager, back2.id, { status: 'Completed' });
    expect(completed.status).toBe('Completed');
    expect(completed.completedAt).toBeTruthy();

    const reopened = await service.changeStatus(manager, completed.id, { status: 'InProgress' });
    expect(reopened.status).toBe('InProgress');
    expect(reopened.completedAt).toBeNull();

    // No Revision entity is created by the workflow.
    const revisionActivities = (await provider.listActivities(reopened.id)).filter(
      (item) => item.actionType === 'RevisionRequested',
    );
    expect(revisionActivities).toHaveLength(2);
    expect(reopened.revisionNumber).toBe(0);
  });

  it('restores the recorded status on OnHold resume and falls back safely for legacy holds', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);

    const inProgressProject = await service.createProject(manager, input('Hold In Progress'));
    const started = await service.changeStatus(manager, inProgressProject.project.id, {
      status: 'InProgress',
    });
    const held = await service.changeStatus(manager, started.id, { status: 'OnHold' });
    expect(held.status).toBe('OnHold');
    expect(held.statusBeforeHold).toBe('InProgress');
    const resumed = await service.changeStatus(manager, held.id, { status: 'InProgress' });
    expect(resumed.status).toBe('InProgress');
    expect(resumed.statusBeforeHold).toBeNull();

    const reviewProject = await service.createProject(manager, input('Hold Client Review'));
    const reviewStarted = await service.changeStatus(manager, reviewProject.project.id, {
      status: 'InProgress',
    });
    const review = await service.changeStatus(manager, reviewStarted.id, {
      status: 'ClientReview',
    });
    const reviewHeld = await service.changeStatus(manager, review.id, { status: 'OnHold' });
    expect(reviewHeld.statusBeforeHold).toBe('ClientReview');
    const reviewResumed = await service.changeStatus(manager, reviewHeld.id, {
      status: 'ClientReview',
    });
    expect(reviewResumed.status).toBe('ClientReview');
    expect(reviewResumed.statusBeforeHold).toBeNull();

    // Legacy OnHold without a recorded prior status resumes safely to InProgress.
    const legacy = await service.createProject(manager, input('Legacy Hold'));
    await provider.updateProject(legacy.project.id, {
      status: 'OnHold',
      statusBeforeHold: null,
    });
    const legacyResumed = await service.changeStatus(manager, legacy.project.id, {
      status: 'InProgress',
    });
    expect(legacyResumed.status).toBe('InProgress');
    expect(legacyResumed.statusBeforeHold).toBeNull();

    // Arbitrary unrelated OnHold target is blocked.
    const blocked = await service.createProject(manager, input('Blocked Hold'));
    const blockedHeld = await service.changeStatus(manager, blocked.project.id, {
      status: 'OnHold',
    });
    await expect(
      service.changeStatus(manager, blockedHeld.id, { status: 'ClientReview' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });
  });

  it('rejects a stale caller with 409 and makes no mutation or activity', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Stale Caller'));
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    const review = await service.changeStatus(manager, started.id, { status: 'ClientReview' });

    const before = (await provider.listActivities(review.id)).length;
    await expect(
      service.changeStatus(manager, review.id, {
        status: 'RevisionRequired',
        expectedCurrentStatus: 'InProgress',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect((await provider.getProject(review.id))?.status).toBe('ClientReview');
    expect((await provider.listActivities(review.id)).length).toBe(before);
  });

  it('treats a lost-response retry as an idempotent successful replay without duplicate audit', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Retry Replay'));
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });

    const first = await service.changeStatus(manager, started.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(first.status).toBe('ClientReview');
    const afterFirst = (await provider.listActivities(first.id)).filter(
      (item) => item.actionType === 'StatusChanged',
    ).length;

    const replay = await service.changeStatus(manager, first.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(replay.status).toBe('ClientReview');
    expect(replay.version).toBe(first.version);
    const afterReplay = (await provider.listActivities(replay.id)).filter(
      (item) => item.actionType === 'StatusChanged',
    ).length;
    expect(afterReplay).toBe(afterFirst);
  });

  it('keeps a fresh Planning project in Planning when progress is updated', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, input('Progress No Auto Start'));

    const updated = await service.updateProject(manager, created.project.id, {
      progressPercent: 60,
    });
    expect(updated.progressPercent).toBe(60);
    expect(updated.status).toBe('Planning');

    // Explicit Start Work still transitions.
    const started = await service.changeStatus(manager, updated.id, { status: 'InProgress' });
    expect(started.status).toBe('InProgress');
  });

  it('preserves Team behavior and keeps generic PATCH unable to change status', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'team');
    const manager = user(seedUserIds.manager);
    const created = await service.createProject(manager, {
      ...input('Team Safety'),
      assignedDesignerId: seedUserIds.designerOne,
    });
    expect(created.project.status).toBe('Assigned');

    // Team does not gain a Personal ClientReview transition from Assigned.
    await expect(
      service.changeStatus(manager, created.project.id, { status: 'ClientReview' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });

    // Team still increments revisionNumber on RevisionRequired.
    const started = await service.changeStatus(manager, created.project.id, {
      status: 'InProgress',
    });
    const revision = await service.changeStatus(manager, started.id, {
      status: 'RevisionRequired',
    });
    expect(revision.revisionNumber).toBe(1);

    // Team cancellation does not require a reason (Personal-only enforcement).
    const teamCancelled = await service.changeStatus(manager, revision.id, {
      status: 'Cancelled',
    });
    expect(teamCancelled.status).toBe('Cancelled');
  });

  it('blocks completion from Planning, RevisionRequired and OnHold for Personal projects', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);

    const planning = await service.createProject(manager, input('Completion Planning Block'));
    await expect(
      service.changeStatus(manager, planning.project.id, { status: 'Completed' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });

    const flow = await service.createProject(manager, input('Completion Flow Block'));
    const started = await service.changeStatus(manager, flow.project.id, {
      status: 'InProgress',
    });
    const review = await service.changeStatus(manager, started.id, { status: 'ClientReview' });
    const revision = await service.changeStatus(manager, review.id, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
    });
    await expect(
      service.changeStatus(manager, revision.id, { status: 'Completed' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });

    const held = await service.changeStatus(manager, started.id, { status: 'OnHold' });
    await expect(
      service.changeStatus(manager, held.id, { status: 'Completed' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION', statusCode: 409 });

    const explicit = await service.createProject(manager, input('Completion Explicit'));
    const explicitStarted = await service.changeStatus(manager, explicit.project.id, {
      status: 'InProgress',
    });
    const completed = await service.changeStatus(manager, explicitStarted.id, {
      status: 'Completed',
    });
    expect(completed.status).toBe('Completed');
    expect(completed.completedAt).toBeTruthy();
  });

  it('requires a meaningful cancellation reason for Personal projects', async () => {
    const provider = new MockDataProvider(createSeedData());
    const service = new ProjectService(provider, 'Asia/Dubai', clock, 'personal');
    const manager = user(seedUserIds.manager);

    const missing = await service.createProject(manager, input('Cancel Missing'));
    const missingStarted = await service.changeStatus(manager, missing.project.id, {
      status: 'InProgress',
    });
    await expect(
      service.changeStatus(manager, missingStarted.id, { status: 'Cancelled' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

    const empty = await service.createProject(manager, input('Cancel Empty'));
    const emptyStarted = await service.changeStatus(manager, empty.project.id, {
      status: 'InProgress',
    });
    await expect(
      service.changeStatus(manager, emptyStarted.id, { status: 'Cancelled', reason: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

    const whitespace = await service.createProject(manager, input('Cancel Whitespace'));
    const whitespaceStarted = await service.changeStatus(manager, whitespace.project.id, {
      status: 'InProgress',
    });
    await expect(
      service.changeStatus(manager, whitespaceStarted.id, { status: 'Cancelled', reason: ' ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

    const valid = await service.createProject(manager, input('Cancel Valid'));
    const validStarted = await service.changeStatus(manager, valid.project.id, {
      status: 'InProgress',
    });
    const cancelled = await service.changeStatus(manager, validStarted.id, {
      status: 'Cancelled',
      reason: 'Client paused the project.',
    });
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.cancelledAt).toBeTruthy();
    const cancelledActivities = (await provider.listActivities(cancelled.id)).filter(
      (item) => item.actionType === 'ProjectCancelled',
    );
    expect(cancelledActivities).toHaveLength(1);

    // Replay of the already-successful cancellation is side-effect free: it
    // must not require a new reason nor append a duplicate ProjectCancelled.
    const replay = await service.changeStatus(manager, cancelled.id, { status: 'Cancelled' });
    expect(replay.version).toBe(cancelled.version);
    const afterReplay = (await provider.listActivities(replay.id)).filter(
      (item) => item.actionType === 'ProjectCancelled',
    );
    expect(afterReplay).toHaveLength(1);
  });
});
