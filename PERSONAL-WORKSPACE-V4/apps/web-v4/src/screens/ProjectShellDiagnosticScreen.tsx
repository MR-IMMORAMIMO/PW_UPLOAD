/**
 * Project Shell Diagnostic — proves the PROJECT shell context with REAL
 * canonical project data.
 *
 * This is a DIAGNOSTIC-ONLY route (`/diagnostic/project-shell/:projectId`).
 * It demonstrates:
 *   - V4AppShell in PROJECT context (one contextual rail)
 *   - project contextual Sidebar with Back-to-Projects + locked IA groups
 *   - V4ProjectContextHeader bound to a real canonical Project read
 *   - V4PageHeader
 *   - a small diagnostic body ONLY (no Summary / product page)
 *   - diagnostic active-section state via `?section=` (§26)
 *
 * Project fields are read from the canonical API (`api.project(id)`). No
 * fabricated values. Missing fields render a truthful neutral value.
 */
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/environment';
import { LegacyAppShell as V4AppShell } from '../components/shell/LegacyAppShell';
import { V4PageHeader } from '../components/common/V4PageHeader';
import { V4ProjectContextHeader } from '../components/project/V4ProjectContextHeader';
import { findProjectNavItem, PROJECT_NAV_GROUPS } from '../components/navigation/navModel';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../components/sidebar/sidebarMode';

export function ProjectShellDiagnosticScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));

  const projectQuery = useQuery({
    queryKey: ['v4', 'diagnostic', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data;

  // Diagnostic active section from the `?section=` query param (§26). When
  // none supplied, no nav item is treated as active (a controlled diagnostic
  // state rather than a fake default product route).
  const sectionParam = searchParams.get('section');
  const activeSection = useMemo(() => {
    if (!sectionParam) return null;
    return findProjectNavItem(sectionParam) ? sectionParam : null;
  }, [sectionParam]);

  const handleToggleMode = () => {
    setMode((current) => {
      const next: SidebarMode = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });
  };

  const handleSelectSection = (id: string) => {
    setSearchParams({ section: id }, { replace: true });
  };

  const handleBackToProjects = () => {
    // No product route exists yet; diagnostic only.
  };

  const activeLabel = activeSection ? (findProjectNavItem(activeSection)?.label ?? '') : '—';
  const projectCode = project?.projectCode ?? '';

  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={handleToggleMode}
      activeSectionId={activeSection}
      project={
        project
          ? {
              projectCode: project.projectCode,
              projectName: project.projectName,
              status: project.status ?? null,
            }
          : null
      }
      projectLoading={projectQuery.isLoading}
      onBackToProjects={handleBackToProjects}
      onSelectSection={handleSelectSection}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: project?.projectCode ?? '',
            projectName: project?.projectName ?? '',
            clientName: project?.clientName ?? null,
            projectType: project?.projectType ?? null,
            designStage: project?.designStage ?? null,
            requiredDeliveryDate: project?.requiredDeliveryDate ?? null,
          }}
        />
      }
      pageHeader={
        <V4PageHeader
          title="Project Shell"
          description="Project shell context — diagnostic only. Real canonical project data shown; no product page built."
        />
      }
    >
      <div className="v4-diag" data-testid="v4-project-shell-diag">
        {projectQuery.isError ? (
          <p className="v4-diag__error" role="alert" data-testid="v4-project-load-error">
            The canonical project could not be loaded for diagnostic shell proof.
          </p>
        ) : null}

        <dl className="v4-diag__rows">
          <div className="v4-diag__row">
            <dt>Project id</dt>
            <dd data-testid="v4-diag-project-id">{projectId ?? '—'}</dd>
          </div>
          <div className="v4-diag__row">
            <dt>Load state</dt>
            <dd data-testid="v4-diag-project-state">
              {projectQuery.isLoading ? 'Loading' : projectQuery.isError ? 'Error' : 'Loaded'}
            </dd>
          </div>
          <div className="v4-diag__row">
            <dt>Sidebar mode</dt>
            <dd data-testid="v4-diag-sidebar-mode">{mode}</dd>
          </div>
          <div className="v4-diag__row">
            <dt>Active section</dt>
            <dd data-testid="v4-diag-active-section">{activeLabel}</dd>
          </div>
          <div className="v4-diag__row">
            <dt>Project code</dt>
            <dd>{projectCode || '—'}</dd>
          </div>
          <div className="v4-diag__row">
            <dt>Navigation groups</dt>
            <dd>{PROJECT_NAV_GROUPS.length} groups</dd>
          </div>
        </dl>
        <p className="v4-diag__note">
          Diagnostic route only — grouped project navigation and active-state grammar; no Summary or
          product page is implemented in F2.
        </p>
      </div>
    </V4AppShell>
  );
}
