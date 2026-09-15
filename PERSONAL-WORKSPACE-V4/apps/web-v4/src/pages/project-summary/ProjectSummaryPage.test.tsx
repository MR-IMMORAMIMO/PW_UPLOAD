/** @vitest-environment jsdom */
/**
 * Project Summary route/page tests (PW-V4-F3-P1).
 *
 * A: Summary canonical route renders inside the V4 Project shell.
 * B: Summary does not import legacy presentation (structural scan).
 * S: Loading state renders intentionally.
 * T: Error/partial states remain bounded.
 * G/H: Attention View-all drawer behavior.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { V4Router } from '../../router/V4Router';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = {
  id: '00000000-0000-4000-8000-000000000001',
  projectCode: '001_SCT_TEST',
  projectName: 'Riverside HQ',
  clientName: 'Acme',
  projectType: 'Commercial',
  designStage: 'DetailedDesign',
  requiredDeliveryDate: '2026-09-01',
  status: 'InProgress',
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'corr-1' },
    json: () => Promise.resolve(body),
  };
}

function projectResponse() {
  return { data: PROJECT };
}

function workspaceResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      projectId: PROJECT.id,
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
      actions: [],
      meetings: [],
      reviewItems: [],
      revisions: [],
      documents: [],
      fileCenter: [],
      contacts: [],
      communications: [],
      activity: [],
      health: {
        score: 0,
        checklistPercent: 0,
        openRequirements: 0,
        blockingRequirements: 0,
        overdueActions: 0,
        unresolvedReviews: 0,
        checks: [],
      },
      updatedAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

function workflowResponse(transitions: unknown[] = []) {
  return { data: { transitions, revisionCycles: [] } };
}

describe('Project Summary route/page', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: Summary canonical route renders inside the V4 Project shell', async () => {
    stubMatchMedia();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/projects/') && url.endsWith('/workspace')) {
        return Promise.resolve(jsonResponse(workspaceResponse()));
      }
      if (url.startsWith('/api/projects/') && url.endsWith('/workflow-history')) {
        return Promise.resolve(jsonResponse(workflowResponse()));
      }
      if (url.startsWith('/api/projects/') && url.endsWith('/revisions')) {
        return Promise.resolve(jsonResponse({ data: [] }));
      }
      if (url.startsWith('/api/projects/')) {
        return Promise.resolve(jsonResponse(projectResponse()));
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderV4(<V4Router />, [`/projects/${PROJECT.id}/summary`]);
    // The shell renders.
    expect(screen.getByTestId('v4-shell')).toBeInTheDocument();
    // The Summary page header + content.
    await waitFor(() => expect(screen.getByTestId('v4-project-summary')).toBeInTheDocument());
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit Project' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Project storage and more' }),
    ).not.toBeInTheDocument();
  });

  it('H3: resets the document scroll position when the Summary route opens', async () => {
    stubMatchMedia();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/projects/') && url.endsWith('/workspace')) {
        return Promise.resolve(jsonResponse(workspaceResponse()));
      }
      if (url.startsWith('/api/projects/') && url.endsWith('/workflow-history')) {
        return Promise.resolve(jsonResponse(workflowResponse()));
      }
      if (url.startsWith('/api/projects/') && url.endsWith('/revisions')) {
        return Promise.resolve(jsonResponse({ data: [] }));
      }
      return Promise.resolve(jsonResponse(projectResponse()));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderV4(<V4Router />, [`/projects/${PROJECT.id}/summary`]);
    await screen.findByTestId('v4-project-summary');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    scrollTo.mockRestore();
  });

  it('H2: renders the reference-locked workflow, Snapshot, headers, and activity structure', async () => {
    stubMatchMedia();
    const activity = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        projectId: PROJECT.id,
        entityType: 'revision',
        entityId: null,
        action: 'Generated',
        title: 'REV 02 generated',
        detail: 'Revision created.',
        createdAt: '2026-08-10T09:10:00.000Z',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        projectId: PROJECT.id,
        entityType: 'comment',
        entityId: null,
        action: 'Added',
        title: 'Client comment added',
        detail: 'Coordination note received.',
        createdAt: '2026-08-10T08:10:00.000Z',
      },
    ];
    const transitions = [
      {
        transitionId: '20000000-0000-4000-8000-000000000001',
        projectId: PROJECT.id,
        sequence: 1,
        fromStatus: 'Planning',
        toStatus: 'InProgress',
        occurredAt: '2026-08-01T00:00:00.000Z',
        actorId: null,
        reason: null,
        revisionCycleId: null,
      },
      {
        transitionId: '20000000-0000-4000-8000-000000000002',
        projectId: PROJECT.id,
        sequence: 2,
        fromStatus: 'InProgress',
        toStatus: 'ClientReview',
        occurredAt: '2026-08-02T00:00:00.000Z',
        actorId: null,
        reason: null,
        revisionCycleId: null,
      },
      {
        transitionId: '20000000-0000-4000-8000-000000000003',
        projectId: PROJECT.id,
        sequence: 3,
        fromStatus: 'ClientReview',
        toStatus: 'InProgress',
        occurredAt: '2026-08-03T00:00:00.000Z',
        actorId: null,
        reason: null,
        revisionCycleId: null,
      },
    ];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/projects/') && url.endsWith('/workspace')) {
        return Promise.resolve(jsonResponse(workspaceResponse({ activity })));
      }
      if (url.startsWith('/api/projects/') && url.endsWith('/workflow-history')) {
        return Promise.resolve(jsonResponse(workflowResponse(transitions)));
      }
      if (url.startsWith('/api/projects/') && url.endsWith('/revisions')) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                revisionId: 'canonical-19',
                projectId: PROJECT.id,
                revisionSequence: 19,
                revisionLabel: 'REV_19',
                lifecycleState: 'FINALIZED',
              },
            ],
          }),
        );
      }
      if (url.startsWith('/api/projects/')) {
        return Promise.resolve(jsonResponse(projectResponse()));
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderV4(<V4Router />, [`/projects/${PROJECT.id}/summary`]);
    const snapshot = await screen.findByRole('region', { name: 'Project Snapshot' });
    expect(within(snapshot).getByText('REV_19')).toBeVisible();
    expect(within(snapshot).queryByText('REV03')).not.toBeInTheDocument();
    expect(within(snapshot).getByText('Current Revision')).toBeVisible();
    expect(within(snapshot).getByText('Luminaires')).toBeVisible();
    expect(within(snapshot).getByText('Open Actions')).toBeVisible();
    const stages = screen.getByRole('group', { name: 'Project workflow stages' });
    expect(stages.querySelectorAll('[data-state="active"]')).toHaveLength(1);
    expect(stages.querySelector('[data-stage="design"]')).toHaveAttribute('data-state', 'active');
    expect(stages.querySelector('[data-stage="client-review"]')).toHaveAttribute(
      'data-state',
      'completed',
    );
    expect(stages.querySelector('[data-stage="technical"]')).toHaveAttribute(
      'data-state',
      'pending',
    );
    const activityRegion = screen.getByRole('region', { name: 'Recent Activity' });
    for (const item of activity) expect(within(activityRegion).getByText(item.title)).toBeVisible();
    expect(within(activityRegion).queryByText('by Mohamed Ali')).not.toBeInTheDocument();
  });

  it('S: renders an intentional loading state (skeleton, not raw diagnostic text)', () => {
    stubMatchMedia();
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    renderV4(<V4Router />, [`/projects/${PROJECT.id}/summary`]);
    expect(screen.getByTestId('v4-summary-skeleton')).toBeInTheDocument();
  });

  it('T: preserves the heading and recovers the failed reads through Retry', async () => {
    stubMatchMedia();
    let failing = true;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (failing) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'REQUEST_FAILED', message: 'down', correlationId: 'c' } },
            500,
          ),
        );
      }
      if (url.endsWith('/workspace')) return Promise.resolve(jsonResponse(workspaceResponse()));
      if (url.endsWith('/workflow-history')) {
        return Promise.resolve(jsonResponse(workflowResponse()));
      }
      if (url.endsWith('/revisions')) return Promise.resolve(jsonResponse({ data: [] }));
      return Promise.resolve(jsonResponse(projectResponse()));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderV4(<V4Router />, [`/projects/${PROJECT.id}/summary`]);
    expect(screen.getByRole('heading', { name: 'Project Overview' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    failing = false;
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(await screen.findByTestId('v4-project-summary')).toBeInTheDocument();
  });

  it('B: Summary page does not import legacy presentation', () => {
    const pageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const forbidden = [/from ['"]apps\/web/, /from ['"]\.\.\/web/, /@scli\/web/];
    const violations: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          const content = readFileSync(full, 'utf8');
          for (const [i, line] of content.split('\n').entries()) {
            if (forbidden.some((re) => re.test(line)))
              violations.push(`${entry}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    };
    walk(pageRoot);
    expect(violations).toEqual([]);
  });
});
