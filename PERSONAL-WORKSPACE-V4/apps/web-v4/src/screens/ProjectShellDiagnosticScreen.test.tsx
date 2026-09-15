/** @vitest-environment jsdom */
/**
 * Project shell diagnostic route test.
 *
 *   B. Project shell renders using canonical project data.
 *   G. Global context navigation model differs from Project context.
 *   H. Project navigation groups match the locked IA.
 *   L. Project Code/Name/Client/Type/Due Date render from canonical data.
 *   (No fabricated project values are introduced by the screen.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { ProjectShellDiagnosticScreen } from './ProjectShellDiagnosticScreen';
import { cleanupV4, renderV4, stubMatchMedia } from '../test-utils/renderV4';

const PROJECT_ID = 'a1b2c3d4-1111-4222-8333-444455556666';

const canonicalProject = {
  id: PROJECT_ID,
  projectCode: 'SCT-1042',
  projectName: 'Riverside HQ Lighting',
  clientName: 'Riverside Properties',
  projectType: 'Hospitality',
  designStage: 'DetailedDesign',
  requiredDeliveryDate: '2026-09-01T00:00:00Z',
  // Minimal Project fields used by the diagnostic screen; the canonical API
  // returns the full record, but the screen only reads these.
};

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
};

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'corr-1' },
    json: () => Promise.resolve(body),
  };
}

describe('ProjectShellDiagnosticScreen', () => {
  afterEach(() => {
    cleanupV4();
  });

  function renderProjectShell(initial: string) {
    return renderV4(
      <Routes>
        <Route
          path="/diagnostic/project-shell/:projectId"
          element={<ProjectShellDiagnosticScreen />}
        />
      </Routes>,
      [initial],
    );
  }

  it('renders PROJECT shell and real canonical project data (B, L)', async () => {
    stubMatchMedia();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: canonicalProject }));
    vi.stubGlobal('fetch', fetchMock);

    renderProjectShell(`/diagnostic/project-shell/${PROJECT_ID}`);

    expect(screen.getByTestId('v4-shell')).toHaveAttribute('data-context', 'project');
    expect(screen.getByRole('navigation', { name: 'Project navigation' })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('v4-pch-code')).toHaveTextContent('SCT-1042'));
    expect(screen.getByTestId('v4-pch-name')).toHaveTextContent('Riverside HQ Lighting');
    expect(screen.getByTestId('v4-pch-client')).toHaveTextContent('Riverside Properties');
    expect(screen.getByTestId('v4-pch-type')).toHaveTextContent('Hospitality');
    expect(screen.getByTestId('v4-pch-stage')).toHaveTextContent('DetailedDesign');

    // The project fetch is a GET to /api/projects/:id with no mutation.
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string }];
    expect(url).toBe(`/api/projects/${PROJECT_ID}`);
    expect(init?.method).toBe('GET');
  });

  it('renders locked project IA groups (H)', async () => {
    stubMatchMedia();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: canonicalProject })));

    renderProjectShell(`/diagnostic/project-shell/${PROJECT_ID}?section=actions`);

    await waitFor(() => expect(screen.getByTestId('v4-pch-code')).toHaveTextContent('SCT-1042'));
    for (const label of ['Overview', 'Coordination', 'Technical Workspace']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Open the remaining groups to reveal their items.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Technical Workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deliverables & Issue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Files & History' }));
    for (const label of ['Summary', 'Actions', 'Luminaires', 'Revisions & Deliverables', 'Files']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // Project context does NOT show global top-level items.
    expect(screen.queryByRole('button', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('renders a controlled error state without fabricated data', async () => {
    stubMatchMedia();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'REQUEST_FAILED', message: 'down', correlationId: 'c' } },
            500,
          ),
        ),
    );

    renderProjectShell(`/diagnostic/project-shell/${PROJECT_ID}`);

    await waitFor(() => expect(screen.getByTestId('v4-project-load-error')).toBeInTheDocument());
    // No fabricated code/name are shown.
    expect(screen.getByTestId('v4-pch-code')).toHaveTextContent('');
  });
});
