import { describe, expect, it } from 'vitest';
import { seedProjects, seedUserIds } from '@scli/test-data';
import { MockDataProvider } from './mock-data-provider';
import { TimeTrackingService } from './time-tracking-service';

describe('TimeTrackingService', () => {
  it('tracks one live designer timer, excludes paused time and supports approval', async () => {
    const provider = new MockDataProvider();
    let now = new Date('2026-08-01T08:00:00.000Z');
    const service = new TimeTrackingService(provider, () => now);
    const designer = await provider.getUser(seedUserIds.designerOne);
    const manager = await provider.getUser(seedUserIds.manager);
    const project = seedProjects.find(
      (item) => item.assignedDesignerId === seedUserIds.designerOne && item.status === 'InProgress',
    );
    const secondProject = seedProjects.find(
      (item) => item.assignedDesignerId === seedUserIds.designerOne && item.id !== project?.id,
    );
    if (!designer || !manager || !project || !secondProject) throw new Error('Missing test seed.');

    const started = await service.start(designer, project.id, {
      workCategory: 'DIALux',
      note: 'Calculation model',
    });
    expect(started.status).toBe('Running');

    await expect(
      service.start(designer, secondProject.id, {
        workCategory: 'Drawings',
        note: '',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    now = new Date('2026-08-01T08:30:00.000Z');
    const paused = await service.pause(designer, project.id, started.id);
    expect(paused.durationMinutes).toBe(30);

    now = new Date('2026-08-01T08:40:00.000Z');
    await service.resume(designer, project.id, started.id);
    now = new Date('2026-08-01T09:00:00.000Z');
    const stopped = await service.stop(designer, project.id, started.id);
    expect(stopped.status).toBe('Stopped');
    expect(stopped.durationMinutes).toBe(50);

    const corrected = await service.correct(designer, project.id, started.id, {
      workCategory: 'DIALux',
      note: 'Calculation model and report',
      durationMinutes: 45,
      reason: 'Removed the non-working setup time.',
    });
    expect(corrected.durationMinutes).toBe(45);

    const submitted = await service.submit(designer, project.id);
    expect(submitted.status).toBe('Submitted');
    const approved = await service.review(
      manager,
      project.id,
      designer.id,
      'approve',
      'Reviewed against the project record.',
    );
    expect(approved.status).toBe('Approved');

    await expect(
      service.correct(designer, project.id, started.id, {
        workCategory: 'DIALux',
        note: 'Late edit',
        durationMinutes: 40,
        reason: 'Attempt after approval.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('denies time tracking to Sales and unassigned Designers', async () => {
    const provider = new MockDataProvider();
    const service = new TimeTrackingService(provider, () => new Date('2026-08-01T08:00:00.000Z'));
    const sales = await provider.getUser(seedUserIds.salesOne);
    const designer = await provider.getUser(seedUserIds.designerTwo);
    const otherProject = seedProjects.find(
      (item) => item.assignedDesignerId === seedUserIds.designerOne,
    );
    if (!sales || !designer || !otherProject) throw new Error('Missing test seed.');

    await expect(
      service.start(sales, otherProject.id, { workCategory: 'Coordination', note: '' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.start(designer, otherProject.id, { workCategory: 'Coordination', note: '' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('requires a manager return reason', async () => {
    const provider = new MockDataProvider();
    let now = new Date('2026-08-01T08:00:00.000Z');
    const service = new TimeTrackingService(provider, () => now);
    const designer = await provider.getUser(seedUserIds.designerOne);
    const manager = await provider.getUser(seedUserIds.manager);
    const project = seedProjects.find(
      (item) => item.assignedDesignerId === seedUserIds.designerOne && item.status === 'InProgress',
    );
    if (!designer || !manager || !project) throw new Error('Missing test seed.');
    const entry = await service.start(designer, project.id, {
      workCategory: 'LightingDesign',
      note: '',
    });
    now = new Date('2026-08-01T08:15:00.000Z');
    await service.stop(designer, project.id, entry.id);
    await service.submit(designer, project.id);
    await expect(
      service.review(manager, project.id, designer.id, 'reject', 'No'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
