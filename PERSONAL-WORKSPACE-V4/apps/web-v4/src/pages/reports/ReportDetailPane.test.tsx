import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { PeriodActivityReport } from '@scli/domain';
import { ReportDetailPane } from './ReportDetailPane';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const report = {
  generatedAt: '2026-09-11T08:00:00Z',
  projects: [
    {
      projectId: 'p1',
      projectName: 'Lighting review',
      projectCode: 'P01',
      clientName: 'Client',
      workSeconds: 3600,
      workSessionCount: 2,
      openWorkSessionCount: 1,
      toolSessionCount: 0,
    },
  ],
  sessions: [
    {
      id: 's1',
      projectId: 'p1',
      projectName: 'Lighting review',
      day: '2026-09-11',
      startedAt: '2026-09-11T08:00:00Z',
      endedAt: '2026-09-11T09:00:00Z',
      state: 'STOPPED',
      pausedSeconds: 0,
      netSeconds: 3600,
      actorId: 'u1',
      actorName: 'First operator',
    },
    {
      id: 's2',
      projectId: 'p1',
      projectName: 'Lighting review',
      day: '2026-09-11',
      startedAt: '2026-09-11T10:00:00Z',
      endedAt: null,
      state: 'RUNNING',
      pausedSeconds: 0,
      netSeconds: null,
      actorId: 'u2',
      actorName: 'Second operator',
    },
  ],
  currentProjects: [
    {
      projectId: 'p1',
      projectName: 'Lighting review',
      projectCode: 'P01',
      clientName: 'Client',
      luminaires: 8,
      missingDatasheets: 2,
      missingImages: 0,
      incompleteTechnical: 1,
      openRequirements: 0,
    },
    {
      projectId: 'p2',
      projectName: 'Complete project',
      projectCode: 'P02',
      clientName: 'Client',
      luminaires: 3,
      missingDatasheets: 0,
      missingImages: 0,
      incompleteTechnical: 0,
      openRequirements: 0,
    },
  ],
} as unknown as PeriodActivityReport;

describe('Report detail navigation', () => {
  afterEach(cleanupV4);
  it('separates open session drilldown from net closed work time and keeps operator search', async () => {
    stubMatchMedia();
    renderV4(<ReportDetailPane report={report} tab="Workload" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open sessions: 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Work sessions · Open sessions' });
    expect(within(dialog).getByText('Second operator')).toBeVisible();
    expect(within(dialog).queryByText('First operator')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Not included')).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Search sessions'), {
      target: { value: 'missing operator' },
    });
    expect(within(dialog).queryByText('Second operator')).not.toBeInTheDocument();
  });
  it('opens only contributing projects for a technical metric with a real destination', async () => {
    stubMatchMedia();
    renderV4(<ReportDetailPane report={report} tab="Technical" />);
    fireEvent.click(screen.getByRole('button', { name: 'Missing datasheets: 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Missing datasheets' });
    expect(within(dialog).getByRole('link', { name: 'Lighting review' })).toHaveAttribute(
      'href',
      '/projects/p1/datasheets-images',
    );
    expect(within(dialog).queryByText('Complete project')).not.toBeInTheDocument();
  });
});
