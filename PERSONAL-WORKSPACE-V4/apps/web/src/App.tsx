import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Role } from '@scli/domain';
import { useAppContext } from './app-context';
import { AppLayout } from './components/layout';
import { EmptyState, LoadingState } from './components/ui';

const DashboardScreen = lazy(() =>
  import('./screens/dashboard').then((module) => ({ default: module.DashboardScreen })),
);
const DesignersScreen = lazy(() =>
  import('./screens/designers').then((module) => ({ default: module.DesignersScreen })),
);
const NewProjectScreen = lazy(() =>
  import('./screens/new-project').then((module) => ({ default: module.NewProjectScreen })),
);
const PersonalNewProjectScreen = lazy(() =>
  import('./screens/personal-new-project').then((module) => ({
    default: module.PersonalNewProjectScreen,
  })),
);
const ProjectDetailsScreen = lazy(() =>
  import('./screens/project-details').then((module) => ({ default: module.ProjectDetailsScreen })),
);
const PersonalProjectDetailsScreen = lazy(() =>
  import('./screens/personal-project-details').then((module) => ({
    default: module.PersonalProjectDetailsScreen,
  })),
);
const ProjectsScreen = lazy(() =>
  import('./screens/projects').then((module) => ({ default: module.ProjectsScreen })),
);
const UnassignedScreen = lazy(() =>
  import('./screens/projects').then((module) => ({ default: module.UnassignedScreen })),
);
const ArchiveScreen = lazy(() =>
  import('./screens/projects').then((module) => ({ default: module.ArchiveScreen })),
);
const ReportsScreen = lazy(() =>
  import('./screens/reports').then((module) => ({ default: module.ReportsScreen })),
);
const PersonalReportsScreen = lazy(() =>
  import('./screens/personal-reports').then((module) => ({
    default: module.PersonalReportsScreen,
  })),
);
const SettingsScreen = lazy(() =>
  import('./screens/settings').then((module) => ({ default: module.SettingsScreen })),
);
const TimesheetsScreen = lazy(() =>
  import('./screens/timesheets').then((module) => ({ default: module.TimesheetsScreen })),
);
const NotificationsScreen = lazy(() =>
  import('./screens/notifications').then((module) => ({ default: module.NotificationsScreen })),
);
const PersonalSettingsScreen = lazy(() =>
  import('./screens/personal-settings').then((module) => ({
    default: module.PersonalSettingsScreen,
  })),
);
const PersonalSearchScreen = lazy(() =>
  import('./screens/personal-search').then((module) => ({
    default: module.PersonalSearchScreen,
  })),
);
const PersonalSalesScreen = lazy(() =>
  import('./screens/personal-sales').then((module) => ({
    default: module.PersonalSalesScreen,
  })),
);
const PersonalLegacyImportScreen = lazy(() =>
  import('./screens/personal-legacy-import').then((module) => ({
    default: module.PersonalLegacyImportScreen,
  })),
);
const LuminaireLibraryScreen = lazy(() =>
  import('./screens/luminaire-library').then((module) => ({
    default: module.LuminaireLibraryScreen,
  })),
);

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { currentUser } = useAppContext();
  if (!roles.includes(currentUser.role)) {
    return (
      <EmptyState
        kind="permission"
        title="This area is not available for your role"
        description="Your project data is protected by server-side role and record-level permissions."
      />
    );
  }
  return children;
}

export function App() {
  const { integrationStatus } = useAppContext();
  const personal = integrationStatus.workspaceVariant === 'personal';
  return (
    <Suspense fallback={<LoadingState label="Opening workspace…" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardScreen />} />
          <Route
            path="new"
            element={
              personal ? (
                <PersonalNewProjectScreen />
              ) : (
                <RequireRole roles={['Sales', 'LineManager', 'Admin']}>
                  <NewProjectScreen />
                </RequireRole>
              )
            }
          />
          <Route
            path="unassigned"
            element={
              <RequireRole roles={['LineManager', 'Admin']}>
                <UnassignedScreen />
              </RequireRole>
            }
          />
          <Route path="projects" element={<ProjectsScreen />} />
          <Route path="luminaires" element={<LuminaireLibraryScreen />} />
          <Route path="notifications" element={<NotificationsScreen />} />
          <Route
            path="timesheets"
            element={
              personal ? (
                <Navigate to="/" replace />
              ) : (
                <RequireRole roles={['Designer', 'LineManager', 'Admin']}>
                  <TimesheetsScreen />
                </RequireRole>
              )
            }
          />
          <Route path="archive" element={<ArchiveScreen />} />
          <Route
            path="sales"
            element={personal ? <PersonalSalesScreen /> : <Navigate to="/projects" replace />}
          />
          <Route
            path="import-projects"
            element={
              personal ? <PersonalLegacyImportScreen /> : <Navigate to="/projects" replace />
            }
          />
          <Route
            path="projects/:id"
            element={personal ? <PersonalProjectDetailsScreen /> : <ProjectDetailsScreen />}
          />
          <Route
            path="projects/:id/:section"
            element={personal ? <PersonalProjectDetailsScreen /> : <ProjectDetailsScreen />}
          />
          <Route
            path="designers"
            element={
              <RequireRole roles={['Designer', 'LineManager', 'Admin']}>
                <DesignersScreen />
              </RequireRole>
            }
          />
          <Route
            path="reports"
            element={
              personal ? (
                <PersonalReportsScreen />
              ) : (
                <RequireRole roles={['LineManager', 'Admin']}>
                  <ReportsScreen />
                </RequireRole>
              )
            }
          />
          <Route
            path="settings"
            element={
              personal ? (
                <PersonalSettingsScreen />
              ) : (
                <RequireRole roles={['Admin']}>
                  <SettingsScreen />
                </RequireRole>
              )
            }
          />
          <Route
            path="search"
            element={personal ? <PersonalSearchScreen /> : <Navigate to="/projects" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
