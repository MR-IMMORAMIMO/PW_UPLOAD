/** @vitest-environment jsdom */
/**
 * Corrective delta (Fix C): Revisions & Deliverables must open from EVERY existing
 * project page via the centralized V4AppShell route resolution (no edits to
 * each closed page). Verifies navigation from representative closed pages:
 * Summary, Actions, Luminaire Schedule, Technical BOQ.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { V4AppShell } from '../shell/V4AppShell';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function renderShellFrom(path: string) {
  renderV4(
    <Routes>
      <Route
        path="/projects/:projectId/:section"
        element={
          <V4AppShell
            context="project"
            sidebarMode="extended"
            onToggleSidebarMode={() => undefined}
          />
        }
      />
      <Route
        path="/projects/:projectId/revisions"
        element={
          <div data-testid="v4-revisions-destination">Revisions &amp; Outputs destination</div>
        }
      />
      <Route
        path="/projects/:projectId/packages"
        element={<div data-testid="v4-packages-destination">Packages destination</div>}
      />
    </Routes>,
    [path],
  );
}

describe('Revisions & Deliverables navigation from closed project pages (Fix C)', () => {
  afterEach(() => {
    cleanupV4();
  });

  const closedPages: Array<{ label: string; path: string }> = [
    { label: 'Summary', path: `/projects/${PROJECT_ID}/summary` },
    { label: 'Actions', path: `/projects/${PROJECT_ID}/actions` },
    { label: 'Luminaire Schedule', path: `/projects/${PROJECT_ID}/luminaire-schedule` },
    { label: 'Technical BOQ', path: `/projects/${PROJECT_ID}/technical-boq` },
  ];

  for (const page of closedPages) {
    it(`opens the canonical Revisions route from the ${page.label} page`, async () => {
      stubMatchMedia();
      renderShellFrom(page.path);

      // The Deliverables & Issue group is collapsed by default; open it.
      act(() => {
        screen.getByRole('button', { name: 'Deliverables & Issue' }).click();
      });

      const revisionsItem = screen.getByRole('button', { name: 'Revisions & Deliverables' });
      expect(revisionsItem).toBeEnabled();
      act(() => {
        revisionsItem.click();
      });

      // The centralized shell navigates to the canonical :projectId route.
      expect(await screen.findByTestId('v4-revisions-destination')).toBeInTheDocument();
    });
  }

  it('Packages is enabled while future Submission and Issue History items stay disabled', async () => {
    stubMatchMedia();
    renderShellFrom(`/projects/${PROJECT_ID}/summary`);

    act(() => {
      screen.getByRole('button', { name: 'Deliverables & Issue' }).click();
    });

    const revisionsItem = screen.getByRole('button', { name: 'Revisions & Deliverables' });
    expect(revisionsItem).toBeEnabled();

    const packagesItem = screen.getByRole('button', { name: 'Packages' });
    expect(packagesItem).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Submissions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Issue History' })).toBeDisabled();

    act(() => {
      packagesItem.click();
    });
    expect(await screen.findByTestId('v4-packages-destination')).toBeInTheDocument();
  });

  it('Files is enabled while Register and Activity remain disabled', async () => {
    stubMatchMedia();
    renderShellFrom(`/projects/${PROJECT_ID}/summary`);

    act(() => {
      screen.getByRole('button', { name: 'Files & History' }).click();
    });

    expect(screen.getByRole('button', { name: 'Files' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeDisabled();
  });
});
