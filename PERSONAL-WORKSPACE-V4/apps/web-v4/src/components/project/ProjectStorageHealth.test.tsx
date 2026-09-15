/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project, ProjectStorageHealth } from '@scli/domain';
import { ProjectStorageHealth as ProjectStorageHealthSurface } from './ProjectStorageHealth';

const apiMock = vi.hoisted(() => ({
  projectStorageHealth: vi.fn(),
  reconnectProjectStorage: vi.fn(),
}));

vi.mock('../../api/environment', () => ({ api: apiMock }));

const project = {
  id: '10000000-0000-4000-8000-000000000001',
  projectCode: '001_SCT_TEST',
  projectName: 'Storage Test',
  version: 3,
} as Project;

function health(
  state: ProjectStorageHealth['state'],
  overrides: Partial<ProjectStorageHealth> = {},
): ProjectStorageHealth {
  return {
    projectId: project.id,
    state,
    reason: state === 'DISCONNECTED' ? 'NOT_CONFIGURED' : null,
    projectPath: null,
    workspacePath: null,
    canonicalPath: null,
    marker: null,
    canOpenFolder: false,
    canReconnect: true,
    canAdoptLegacy: state === 'LEGACY_UNVERIFIED',
    checkedAt: '2026-08-23T08:00:00.000Z',
    ...overrides,
  };
}

function renderSurface(value: ProjectStorageHealth) {
  apiMock.projectStorageHealth.mockResolvedValue(value);
  apiMock.reconnectProjectStorage.mockResolvedValue({
    project,
    health: value,
    markerCreated: false,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <ProjectStorageHealthSurface project={project} />
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.scliDesktop;
});

describe('ProjectStorageHealth', () => {
  it('keeps matching-marker reconnect and initial empty binding as explicit choices', async () => {
    const selectFolder = vi
      .fn()
      .mockResolvedValueOnce('C:\\Projects\\Moved')
      .mockResolvedValueOnce('C:\\Projects\\Empty');
    window.scliDesktop = { selectFolder };
    renderSurface(health('DISCONNECTED'));

    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect marked folder' }));
    await waitFor(() =>
      expect(apiMock.reconnectProjectStorage).toHaveBeenLastCalledWith(project.id, {
        candidatePath: 'C:\\Projects\\Moved',
        intent: 'MATCHING_MARKER',
        expectedVersion: 3,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bind empty folder' }));
    await waitFor(() =>
      expect(apiMock.reconnectProjectStorage).toHaveBeenLastCalledWith(project.id, {
        candidatePath: 'C:\\Projects\\Empty',
        intent: 'INITIAL_BINDING',
        expectedVersion: 3,
      }),
    );
  });

  it('requires the visibly explicit legacy-adoption action', async () => {
    const candidatePath = 'C:\\Projects\\Legacy';
    window.scliDesktop = { selectFolder: vi.fn().mockResolvedValue(candidatePath) };
    const { client } = renderSurface(
      health('LEGACY_UNVERIFIED', {
        projectPath: candidatePath,
        workspacePath: candidatePath,
        canonicalPath: candidatePath,
      }),
    );
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'Verify / Adopt legacy folder' }));
    await waitFor(() =>
      expect(apiMock.reconnectProjectStorage).toHaveBeenCalledWith(project.id, {
        candidatePath,
        intent: 'ADOPT_LEGACY',
        expectedVersion: 3,
      }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['v4', 'technical-check', 'legacy-adoption', project.id],
      }),
    );
  });
});
