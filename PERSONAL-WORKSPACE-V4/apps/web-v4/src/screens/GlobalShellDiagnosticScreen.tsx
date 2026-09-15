/**
 * Global Shell Diagnostic — proves the GLOBAL shell context.
 *
 * This is a DIAGNOSTIC-ONLY route (`/diagnostic/shell`). It demonstrates:
 *   - V4AppShell in GLOBAL context
 *   - V4PageHeader ("Shell Foundation")
 *   - Extended <-> Minimal sidebar mode switching
 *   - diagnostic active-section state via a `?section=` query param (§26)
 *   - reserved Work Session / Profile shell zones (inactive anchors)
 *
 * It MUST NOT become a Dashboard. It renders minimal diagnostic content only.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LegacyAppShell as V4AppShell } from '../components/shell/LegacyAppShell';
import { V4PageHeader } from '../components/common/V4PageHeader';
import { GLOBAL_NAV_ITEMS } from '../components/navigation/navModel';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../components/sidebar/sidebarMode';

export function GlobalShellDiagnosticScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));

  // Diagnostic active section from the `?section=` query param (not a product
  // route). Falls back to the first global item when none is supplied.
  const sectionParam = searchParams.get('section');
  const activeSection = useMemo(
    () =>
      sectionParam && GLOBAL_NAV_ITEMS.some((item) => item.id === sectionParam)
        ? sectionParam
        : (GLOBAL_NAV_ITEMS[0]?.id ?? 'dashboard'),
    [sectionParam],
  );

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

  const activeLabel = GLOBAL_NAV_ITEMS.find((item) => item.id === activeSection)?.label ?? '';

  return (
    <V4AppShell
      context="global"
      sidebarMode={mode}
      onToggleSidebarMode={handleToggleMode}
      activeSectionId={activeSection}
      onSelectSection={handleSelectSection}
      pageHeader={
        <V4PageHeader
          title="Shell Foundation"
          description="Global shell context — diagnostic only. Sidebar mode, active navigation, and shell geometry."
        />
      }
    >
      <div className="v4-diag" data-testid="v4-global-shell-diag">
        <dl className="v4-diag__rows">
          <div className="v4-diag__row">
            <dt>Context</dt>
            <dd data-testid="v4-diag-context">GLOBAL</dd>
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
            <dt>Navigation model</dt>
            <dd>{GLOBAL_NAV_ITEMS.length} global items</dd>
          </div>
        </dl>
        <p className="v4-diag__note">
          Diagnostic route only — no product pages are implemented in F2.
        </p>
      </div>
    </V4AppShell>
  );
}
