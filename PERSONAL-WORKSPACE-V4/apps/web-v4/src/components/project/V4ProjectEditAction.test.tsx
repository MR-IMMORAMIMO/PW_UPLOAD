/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project } from '@scli/domain';
import { V4ProjectEditAction } from './V4ProjectEditAction';

const project = {
  id: 'p1',
  projectCode: '001_SCT_TEST',
  projectName: 'Test Project',
  clientName: 'Client',
  projectType: 'Commercial',
  designStage: 'Concept',
  requiredDeliveryDate: '2026-09-01',
  siteLocation: 'Dubai',
  lightingScope: 'Interior lighting',
  luxRequirements: '',
  drawingReference: '',
  description: '',
  priority: 'Normal',
  complexity: 'Medium',
  estimatedHours: 24,
  salesOwnerId: '00000000-0000-4000-8000-000000000002',
  services: ['LuminaireSchedule'],
  luminaireInputMode: 'Later',
  version: 3,
} as Project;

function response(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'c1' },
    json: () => Promise.resolve({ data }),
  };
}

describe('V4ProjectEditAction', () => {
  it('uses one canonical PATCH and updates every matching V4 project cache entry from server truth', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      void options;
      if (url === '/api/project-types/catalog')
        return Promise.resolve(
          response([
            { id: 't1', name: 'Commercial', isActive: true, createdAt: '', updatedAt: '' },
          ]),
        );
      if (url === '/api/projects/p1/workspace')
        return Promise.resolve(
          response({
            services: ['LuminaireSchedule'],
            scopeItems: [
              {
                id: 'scope-1',
                code: 'LuminaireSchedule',
                label: 'Luminaire Schedule',
                custom: false,
              },
            ],
            lightingPackage: { inputMode: 'Later' },
          }),
        );
      if (url === '/api/me') return Promise.resolve(response({ id: 'me', role: 'Admin' }));
      if (url === '/api/users/sales') return Promise.resolve(response([]));
      if (url === '/api/projects/p1/storage-health')
        return Promise.resolve(
          response({
            projectId: 'p1',
            state: 'DISCONNECTED',
            reason: 'NOT_CONFIGURED',
            projectPath: null,
            workspacePath: null,
            canonicalPath: null,
            marker: null,
            canOpenFolder: false,
            canReconnect: true,
            canAdoptLegacy: false,
            checkedAt: '2026-08-23T00:00:00.000Z',
          }),
        );
      return Promise.resolve(
        response({
          project: { ...project, projectName: 'Saved Project', version: 4 },
          workspace: {
            services: ['LuminaireSchedule'],
            scopeItems: [],
            lightingPackage: { inputMode: 'Later' },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['v4', 'summary', 'project', 'p1'], project);
    render(
      <QueryClientProvider client={client}>
        <V4ProjectEditAction
          project={project}
          projectQueryKey={['v4', 'summary', 'project', 'p1']}
        />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('button', { name: 'Edit Project' })).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Project storage and more' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Project' }));
    await screen.findByRole('dialog', { name: 'Edit Project' });
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Saved Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled(),
    );
    const patch = fetchMock.mock.calls.find((call) => call[0] === '/api/projects/p1/configuration');
    expect(patch?.[0]).toBe('/api/projects/p1/configuration');
    expect(patch?.[1]).toEqual(expect.objectContaining({ method: 'PATCH' }));
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual(
      expect.objectContaining({
        projectName: 'Saved Project',
        expectedVersion: 3,
        luminaireInputMode: 'Later',
        scopeItems: expect.any(Array),
      }),
    );
    expect(client.getQueryData<Project>(['v4', 'summary', 'project', 'p1'])?.projectName).toBe(
      'Saved Project',
    );
  });
});
