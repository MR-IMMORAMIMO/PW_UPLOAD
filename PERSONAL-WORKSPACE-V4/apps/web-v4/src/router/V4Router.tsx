import { LuminaireStudioPage } from '../pages/luminaire-studio/LuminaireStudioPage';
/**
 * V4 router foundation.
 *
 * Minimal route tree proving:
 *   - root Foundation route
 *   - a simple nested/diagnostic route
 *   - F2 GLOBAL and PROJECT shell diagnostic routes (diagnostic only)
 *   - not-found handling
 *   - route errors do not render blank white screens
 *
 * No product routes are defined in F2.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProjectLuminaireSchedulePage } from '../pages/luminaire-schedule/ProjectLuminaireSchedulePage';
import { ProjectTechnicalBoqPage } from '../pages/technical-boq/ProjectTechnicalBoqPage';
import { FoundationScreen } from '../screens/FoundationScreen';
import { GlobalShellDiagnosticScreen } from '../screens/GlobalShellDiagnosticScreen';
import { NotFoundScreen } from '../screens/NotFoundScreen';
import { ProjectShellDiagnosticScreen } from '../screens/ProjectShellDiagnosticScreen';
import { ProjectSummaryPage } from '../pages/project-summary/ProjectSummaryPage';
import { ProjectScopePage } from '../pages/project-scope/ProjectScopePage';
import { ProjectActionsPage } from '../pages/project-actions/ProjectActionsPage';
import { ProjectMeetingsPage } from '../pages/project-meetings/ProjectMeetingsPage';
import { ProjectCommentsPage } from '../pages/project-comments/ProjectCommentsPage';
import { ProjectContactsPage } from '../pages/project-contacts/ProjectContactsPage';
import { ProjectLuminairesPage } from '../pages/project-luminaires/ProjectLuminairesPage';
import { ProjectDatasheetsImagesPage } from '../pages/datasheets-images/ProjectDatasheetsImagesPage';
import { ProjectTechnicalCheckPage } from '../pages/technical-check/ProjectTechnicalCheckPage';
import { ProjectRevisionsPage } from '../pages/project-revisions/ProjectRevisionsPage';
import { ProjectPackagesPage } from '../pages/project-packages/ProjectPackagesPage';
import { ProjectFilesPage } from '../pages/project-files/ProjectFilesPage';
import { WorkflowTimelinePage } from '../pages/workflow-timeline/WorkflowTimelinePage';
import { ProjectsPage } from '../pages/projects/ProjectsPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { NewProjectPage } from '../pages/new-project/NewProjectPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { ReportsPage } from '../pages/reports/ReportsPage';
import { LuminaireLibraryPage } from '../pages/luminaire-library/LuminaireLibraryPage';
import { SmartImportCenterPage } from '../pages/imports/SmartImportCenterPage';
import { V4WorkSessionProvider } from '../components/work-session/WorkSessionProvider';
import {
  ROUTE_DIAGNOSTIC,
  ROUTE_DIAGNOSTIC_PROJECT_SHELL,
  ROUTE_DIAGNOSTIC_SHELL,
  ROUTE_FOUNDATION,
  ROUTE_DASHBOARD,
  ROUTE_NEW_PROJECT,
  ROUTE_SETTINGS,
  ROUTE_PROJECTS,
  ROUTE_LUMINAIRE_LIBRARY,
  ROUTE_IMPORTS,
  ROUTE_DOCUMENTS,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_CONTACTS,
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
  ROUTE_PROJECT_REVISIONS,
  ROUTE_PROJECT_PACKAGES,
  ROUTE_PROJECT_FILES,
  ROUTE_PROJECT_INTELLIGENCE,
} from './routes';

function StudioOutputEntry() {
  const { pathname, search } = useLocation();
  const query = new URLSearchParams(search);
  if (query.has('recoveryRevisionId'))
    return pathname.endsWith('/technical-boq') ? (
      <ProjectTechnicalBoqPage />
    ) : (
      <ProjectLuminaireSchedulePage />
    );
  return <LuminaireStudioPage />;
}

export function V4Router() {
  return (
    <V4WorkSessionProvider>
      <Routes>
        <Route path={ROUTE_FOUNDATION} element={<Navigate to={ROUTE_DASHBOARD} replace />} />
        <Route path={ROUTE_DASHBOARD} element={<DashboardPage />} />
        <Route path={ROUTE_NEW_PROJECT} element={<NewProjectPage />} />
        <Route path={ROUTE_SETTINGS} element={<SettingsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path={ROUTE_DIAGNOSTIC} element={<FoundationScreen />} />
        <Route path={ROUTE_DIAGNOSTIC_SHELL} element={<GlobalShellDiagnosticScreen />} />
        <Route path={ROUTE_DIAGNOSTIC_PROJECT_SHELL} element={<ProjectShellDiagnosticScreen />} />
        <Route path={ROUTE_PROJECTS} element={<ProjectsPage />} />
        <Route path={ROUTE_LUMINAIRE_LIBRARY} element={<LuminaireLibraryPage />} />
        <Route path={ROUTE_IMPORTS} element={<SmartImportCenterPage />} />
        <Route path={ROUTE_DOCUMENTS} element={<Navigate to={ROUTE_PROJECTS} replace />} />
        <Route path={ROUTE_PROJECT_SUMMARY} element={<ProjectSummaryPage />} />
        <Route path={ROUTE_PROJECT_WORKFLOW_TIMELINE} element={<WorkflowTimelinePage />} />
        <Route path={ROUTE_PROJECT_SCOPE} element={<ProjectScopePage />} />
        <Route path={ROUTE_PROJECT_ACTIONS} element={<ProjectActionsPage />} />
        <Route path={ROUTE_PROJECT_MEETINGS} element={<ProjectMeetingsPage />} />
        <Route path={ROUTE_PROJECT_COMMENTS} element={<ProjectCommentsPage />} />
        <Route path={ROUTE_PROJECT_CONTACTS} element={<ProjectContactsPage />} />
        <Route path={ROUTE_PROJECT_LUMINAIRES} element={<ProjectLuminairesPage />} />
        <Route
          path="/projects/:projectId/luminaires/advanced"
          element={<ProjectLuminairesPage />}
        />
        <Route path="/projects/:projectId/lighting-systems" element={<LuminaireStudioPage />} />
        <Route path="/projects/:projectId/system-accessories" element={<LuminaireStudioPage />} />
        <Route path="/projects/:projectId/output-studio" element={<LuminaireStudioPage />} />
        <Route path="/projects/:projectId/studio-datasheets" element={<LuminaireStudioPage />} />
        <Route
          path="/projects/:projectId/luminaire-schedule/advanced"
          element={<ProjectLuminaireSchedulePage />}
        />
        <Route
          path="/projects/:projectId/technical-boq/advanced"
          element={<ProjectTechnicalBoqPage />}
        />
        <Route path={ROUTE_PROJECT_DATASHEETS_IMAGES} element={<ProjectDatasheetsImagesPage />} />
        <Route path={ROUTE_PROJECT_TECHNICAL_CHECK} element={<ProjectTechnicalCheckPage />} />
        <Route path={ROUTE_PROJECT_LUMINAIRE_SCHEDULE} element={<StudioOutputEntry />} />
        <Route path={ROUTE_PROJECT_TECHNICAL_BOQ} element={<StudioOutputEntry />} />
        <Route path={ROUTE_PROJECT_REVISIONS} element={<ProjectRevisionsPage />} />
        <Route path={ROUTE_PROJECT_PACKAGES} element={<ProjectPackagesPage />} />
        <Route path={ROUTE_PROJECT_FILES} element={<ProjectFilesPage />} />
        <Route
          path={ROUTE_PROJECT_INTELLIGENCE}
          element={<Navigate to="../files" relative="path" replace />}
        />
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </V4WorkSessionProvider>
  );
}
