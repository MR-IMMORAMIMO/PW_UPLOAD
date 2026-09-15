import { useState } from 'react';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
} from '../../components/sidebar/sidebarMode';
import { DashboardDataProvider } from '../../components/final-ui/FinalDashboardData';
import FinalDashboardView from '../../components/final-ui/FinalDashboardView';
export function DashboardPage() {
  const [mode, setMode] = useState(() => readStoredSidebarMode(window.localStorage));
  return (
    <V4AppShell
      context="global"
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      finalContacts
    >
      <DashboardDataProvider>
        <FinalDashboardView />
      </DashboardDataProvider>
    </V4AppShell>
  );
}
