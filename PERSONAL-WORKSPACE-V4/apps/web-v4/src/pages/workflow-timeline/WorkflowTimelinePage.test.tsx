/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { V4Router } from '../../router/V4Router';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const project = {
  id: 'p1',
  projectCode: '001_SCT_TEST',
  projectName: 'Golden project',
  clientName: 'Client',
  projectType: 'Commercial',
  designStage: 'Technical',
  requiredDeliveryDate: null,
  status: 'InProgress',
};
const workspace = {
  projectId: 'p1',
  folderPath: null,
  folderProfile: 'default',
  folderStructure: [],
  outputFolders: {},
  services: [],
  deliverables: [],
  lightingPackage: {},
  luminaires: [],
  exports: [],
  revisionPackages: [],
  requirements: [],
  checklist: [],
  actions: [
    {
      id: 'a1',
      title: 'Action',
      details: '',
      status: 'Open',
      completedAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  meetings: [],
  reviewItems: [],
  revisions: [],
  documents: [],
  fileCenter: [],
  contacts: [],
  communications: [],
  activity: [
    {
      id: 'x1',
      projectId: 'p1',
      entityType: 'Scope',
      entityId: null,
      title: 'Latest activity',
      detail: '',
      action: 'Updated',
      createdAt: '2026-01-03T00:00:00.000Z',
    },
  ],
  health: {
    score: 0,
    checklistPercent: 0,
    openRequirements: 0,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks: [],
  },
  updatedAt: '2026-01-03T00:00:00.000Z',
};
const workflow = {
  transitions: [
    {
      transitionId: 'w1',
      projectId: 'p1',
      sequence: 1,
      fromStatus: 'Planning',
      toStatus: 'InProgress',
      occurredAt: '2026-01-01T00:00:00.000Z',
      actorId: null,
      reason: null,
      revisionCycleId: null,
    },
  ],
  revisionCycles: [],
};

function response(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => 'c1' },
    json: () => Promise.resolve({ data }),
  };
}
function stubApi(error = false, sourceWorkspace: unknown = workspace, revisions: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        response(
          url.endsWith('/workspace')
            ? sourceWorkspace
            : url.endsWith('/workflow-history')
              ? workflow
              : url.endsWith('/revisions')
                ? revisions
                : url.endsWith('/outputs')
                  ? []
                  : project,
          !error,
        ),
      ),
    ),
  );
}

function RouteLocation() {
  return <output data-testid="route-location">{useLocation().pathname}</output>;
}

describe('Final Workflow Timeline', () => {
  afterEach(cleanupV4);
  it('renders actual history and selects the latest event without fabricated records or actors', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/workflow-timeline']);
    const events = await screen.findByRole('region', { name: 'Timeline events' });
    const latest = await within(events).findByRole('button', { name: 'Latest activity' });
    expect(latest).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Event details' })).toHaveTextContent(
      'Latest activity',
    );
    expect(screen.queryByText('REV02_Package.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Revision' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View details' })).toBeEnabled();
  });
  it('filters using canonical categories and keeps the inspector within the selected filter', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/workflow-timeline']);
    await screen.findByRole('region', { name: 'Timeline events' });
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Timeline filters' })).getByRole('button', {
        name: 'Actions',
      }),
    );
    expect(
      await within(screen.getByRole('region', { name: 'Timeline events' })).findByRole('button', {
        name: 'Action',
      }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Event details' })).toHaveTextContent('Action');
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Action' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Latest activity' })).not.toBeInTheDocument();
  });
  it('keeps every history record reachable in the scrolling reference layout', async () => {
    stubMatchMedia();
    stubApi(false, {
      ...workspace,
      activity: [],
      actions: Array.from({ length: 30 }, (_, i) => ({
        id: 'action-' + i,
        title: 'Action ' + i,
        details: '',
        status: 'Open',
        completedAt: null,
        createdAt: '2026-01-' + String(i + 1).padStart(2, '0') + 'T00:00:00.000Z',
      })),
    });
    renderV4(<V4Router />, ['/projects/p1/workflow-timeline']);
    const events = await screen.findByRole('region', { name: 'Timeline events' });
    expect(await within(events).findByRole('button', { name: 'Action 0' })).toBeVisible();
    expect(within(events).getByRole('button', { name: 'Action 29' })).toBeVisible();
    fireEvent.click(within(events).getByRole('button', { name: 'Action 0' }));
    expect(screen.getByRole('region', { name: 'Event details' })).toHaveTextContent('Action 0');
  });
  it('preserves canonical sidebar routes', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(
      <>
        <V4Router />
        <RouteLocation />
      </>,
      ['/projects/p1/workflow-timeline'],
    );
    await screen.findByRole('region', { name: 'Timeline events' });
    expect(screen.getByRole('button', { name: 'Workflow Timeline' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    await waitFor(() =>
      expect(screen.getByTestId('route-location')).toHaveTextContent('/projects/p1/summary'),
    );
  });
  it('selects the source-qualified event identity from a deep link', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/workflow-timeline?eventId=action:a1']);
    const events = await screen.findByRole('region', { name: 'Timeline events' });
    expect(await within(events).findByRole('button', { name: 'Action' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('keeps loading and error states actionable', async () => {
    stubMatchMedia();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const loading = renderV4(<V4Router />, ['/projects/p1/workflow-timeline']);
    expect(screen.getByText('Loading timeline…')).toBeVisible();
    loading.unmount();
    cleanupV4();
    stubMatchMedia();
    stubApi(true);
    renderV4(<V4Router />, ['/projects/p1/workflow-timeline']);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
