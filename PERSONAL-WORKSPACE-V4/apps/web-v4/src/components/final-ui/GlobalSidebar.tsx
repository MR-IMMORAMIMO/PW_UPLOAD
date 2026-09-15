import { WorkspaceSearch } from './WorkspaceSearch';
import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import { sctIcons } from '../common/SctIcons';
import { FinalSessionControl } from './FinalSessionControl';
import { useShellData } from './ShellData';
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import sctLogo from './sct-logo.png';
import { C, DIM } from './tokens';

// ── Design tokens from reference CSS ────────────────────────────────────────
const REF = {
  // Sidebar container
  bg: 'var(--v4-surface-raised)',
  radius: 12,
  paddingH: 16,
  paddingV: 24,
  gap: 24,

  // Search bar
  searchBg: 'var(--v4-surface-subtle)',
  searchRadius: 8,

  // Nav items
  itemRadius: 8,
  itemPadH: 12,
  itemPadV: 10,
  itemIconSize: 20,
  itemGap: 8, // gap between icon and label
  itemHeight: 40,

  // Colors
  textPrimary: 'var(--v4-text-primary)',
  textMuted: 'var(--v4-text-muted)',
  iconInactive: 'var(--v4-text-secondary)',
  iconActive: 'var(--v4-accent)',
  labelActive: 'var(--v4-accent-ink)',
  activeBg: 'var(--v4-surface-raised)',
  separator: 'var(--v4-border-subtle)',

  // Minimal sidebar
  minWidth: 68,
};

// ── Icons ────────────────────────────────────────────────────────────────────

function SearchMagnifier({ color = REF.textMuted }: { color?: string }) {
  return <InlineGlyphs.SctSearch width="20" height="20" color={color} />;
}

function IconDashboard({ active }: { active: boolean }) {
  const Icon = sctIcons['dashboard'];
  return <Icon size={20} color={active ? REF.iconActive : REF.iconInactive} />;
}

function IconProjects({ active }: { active: boolean }) {
  const Icon = sctIcons['projects'];
  return <Icon size={20} color={active ? REF.iconActive : REF.iconInactive} />;
}

function IconLuminaire({ active }: { active: boolean }) {
  const Icon = sctIcons['library'];
  return <Icon size={20} color={active ? REF.iconActive : REF.iconInactive} />;
}

function IconSmartImport({ active }: { active: boolean }) {
  const Icon = sctIcons['smart-import'];
  return <Icon size={20} color={active ? REF.iconActive : REF.iconInactive} />;
}

function IconSettings({ active }: { active: boolean }) {
  const Icon = sctIcons['settings'];
  return <Icon size={20} color={active ? REF.iconActive : REF.iconInactive} />;
}

function IconReports({ active }: { active: boolean }) {
  const Icon = sctIcons['reports'];
  return <Icon size={20} color={active ? REF.iconActive : REF.iconInactive} />;
}

function IconWorkSession() {
  return <InlineGlyphs.SctWorkSession width="20" height="20" color={REF.textMuted} />;
}

function IconChevronLeft() {
  return <CustomGlyphs.SctBack size="12" style={{ color: 'currentColor' }} />;
}

// ── Floating nav card (portal — renders above all layers) ────────────────────

interface NavFloatCardProps {
  label: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  visible: boolean;
  anchorX: number;
  anchorY: number;
}

function NavFloatCard({
  label,
  description,
  accent,
  icon,
  visible,
  anchorX,
  anchorY,
}: NavFloatCardProps) {
  return createPortal(
    <div
      className="final-ui-portal"
      aria-hidden
      style={{
        position: 'fixed',
        left: anchorX + 14,
        top: anchorY,
        transform: `translateY(-50%) translateX(${visible ? 0 : -12}px) scale(${visible ? 1 : 0.86})`,
        transformOrigin: 'left center',
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        transition: visible
          ? 'opacity 180ms ease, transform 360ms cubic-bezier(0.34,1.56,0.64,1)'
          : 'opacity 100ms ease, transform 140ms cubic-bezier(0.4,0,1,1)',
        zIndex: 9999,
        whiteSpace: 'nowrap',
      }}
    >
      {/* Arrow pointer */}
      <div
        style={{
          position: 'absolute',
          left: -5,
          top: '50%',
          transform: 'translateY(-50%) rotate(45deg)',
          width: 10,
          height: 10,
          background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.6)',
          borderRight: 'none',
          borderTop: 'none',
          zIndex: 1,
        }}
      />

      {/* Spinning border wrapper */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          borderRadius: 44,
          padding: 1.5,
          /* clip the spinning gradient to a pill shape */
          overflow: 'hidden',
          width: 224,
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        }}
      >
        {/* Rotating conic gradient — the moving light border */}
        <div
          style={{
            position: 'absolute',
            /* extend beyond the container so the rotating square covers corners */
            inset: '-80%',
            background: `conic-gradient(from 0deg, transparent 70%, ${accent} 82%, #ffffff 85%, ${accent} 88%, transparent 94%)`,
            animation: 'finalUiNavBorderSpin 2.4s linear infinite',
            animationPlayState: visible ? 'running' : 'paused',
            zIndex: 0,
          }}
        />

        {/* Card surface — fully opaque so gradient only shows in border gap */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            borderRadius: 43,
            overflow: 'hidden',
          }}
        >
          {/* Left accent bar */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: accent,
              borderRadius: '43px 0 0 43px',
            }}
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              padding: '14px 16px 14px 20px',
            }}
          >
            {/* Icon bubble */}
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 43,
                background: `${accent}22`,
                border: `1.5px solid ${accent}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {icon}
            </div>

            {/* Text */}
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--v4-text-primary)',
                  lineHeight: '18px',
                  letterSpacing: '-0.01em',
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 11,
                  color: 'var(--v4-text-disabled)',
                  marginTop: 3,
                  lineHeight: '14px',
                }}
              >
                {description}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Nav button ────────────────────────────────────────────────────────────────

interface NavBtnProps {
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
  label: string;
  description: string;
  accent: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function NavBtn({
  icon,
  activeIcon,
  label,
  description,
  accent,
  active,
  collapsed,
  onClick,
  disabled = false,
}: NavBtnProps) {
  const [hovered, setHovered] = useState(false);
  const [anchorX, setAnchorX] = useState(0);
  const [anchorY, setAnchorY] = useState(0);
  const btnRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setAnchorX(r.right);
      setAnchorY(r.top + r.height / 2);
    }
    setHovered(true);
  }

  /* Spinning border wrapper — expanded + active only */
  const spinBorder =
    active && !collapsed ? (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: REF.itemRadius,
          padding: 1.5,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '-80%',
            background: `conic-gradient(from 0deg, transparent 70%, ${accent} 82%, #ffffff 85%, ${accent} 88%, transparent 94%)`,
            animation: 'finalUiNavBorderSpin 2.4s linear infinite',
          }}
        />
      </div>
    ) : null;

  return (
    <div
      ref={btnRef}
      style={{ position: 'relative', isolation: 'isolate', width: '100%' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
    >
      {spinBorder}
      <button
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
        aria-current={active && !disabled ? 'page' : undefined}
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: REF.itemPadV,
          paddingBottom: REF.itemPadV,
          paddingLeft: collapsed ? (REF.minWidth - 20) / 2 : REF.itemPadH,
          paddingRight: collapsed ? 0 : REF.itemPadH,
          gap: REF.itemGap,
          width: active && !collapsed ? 'calc(100% - 3px)' : '100%',
          height: REF.itemHeight,
          borderRadius: REF.itemRadius,
          background: active ? REF.activeBg : hovered && !active ? REF.searchBg : 'transparent',
          border: 'none',
          cursor: 'pointer',
          justifyContent: 'flex-start',
          transition:
            'background var(--dur-fast) var(--ease-out), padding-left var(--dur-med) var(--ease-out), padding-right var(--dur-med) var(--ease-out)',
          margin: active && !collapsed ? 1.5 : 0,
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex' }}>{icon}</span>

        <span
          style={{
            fontFamily: "'SCT Final Inter', sans-serif",
            fontWeight: 400,
            fontSize: 16,
            lineHeight: '20px',
            color: active ? REF.labelActive : REF.textPrimary,
            overflow: 'hidden',
            maxWidth: collapsed ? 0 : 180,
            marginLeft: collapsed ? 0 : REF.itemGap,
            opacity: collapsed ? 0 : 1,
            whiteSpace: 'nowrap',
            transition: [
              'max-width var(--dur-med) var(--ease-out)',
              'margin-left var(--dur-med) var(--ease-out)',
              'opacity 120ms var(--ease-out)',
            ].join(', '),
          }}
        >
          {label}
        </span>
      </button>

      {/* Floating paper card — portalled above everything, only in collapsed mode */}
      {collapsed && (
        <NavFloatCard
          label={label}
          description={description}
          accent={accent}
          icon={activeIcon}
          visible={hovered}
          anchorX={anchorX}
          anchorY={anchorY}
        />
      )}
    </div>
  );
}

// ── User tooltip ─────────────────────────────────────────────────────────────

function UserTooltip({ visible }: { visible: boolean }) {
  const { identity } = useShellData();
  return (
    <div
      className="final-ui-portal"
      aria-hidden
      style={{
        position: 'absolute',
        left: 'calc(100% + 8px)',
        bottom: 0,
        opacity: visible ? 1 : 0,
        transform: `translateX(${visible ? 0 : -4}px)`,
        pointerEvents: 'none',
        transition: 'opacity 140ms var(--ease-out), transform 140ms var(--ease-out)',
        zIndex: 300,
      }}
    >
      <div
        style={{
          background: '#1c1c1c',
          borderRadius: 8,
          padding: '8px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--v4-action-primary-foreground)',
          }}
        >
          {identity.name}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            marginTop: 2,
          }}
        >
          {identity.email}
        </div>
      </div>
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

interface SidebarProps {
  activeNav: string;
  setActiveNav: (id: string) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export default function Sidebar({
  activeNav,
  setActiveNav,
  collapsed,
  setCollapsed,
}: SidebarProps) {
  const { identity, sessionLabel, sessionProject, editProfile } = useShellData();
  const [searchOpen, setSearchOpen] = useState(false);
  const [userHovered, setUserHovered] = useState(false);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);
  useEffect(() => {
    const openWithKeyboard = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k' ||
        event.altKey ||
        event.isComposing
      )
        return;
      // Do not cover an editor or another active dialog with a second search surface.
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', openWithKeyboard);
    return () => window.removeEventListener('keydown', openWithKeyboard);
  }, []);

  const FULL_WIDTH = DIM.sidebarWidth; // 290px

  const TOGGLE_TOP = 234; // vertically aligned with search bar
  // Button left: sidebar width minus half its own width (15px), so it straddles the edge.
  // Driven by collapsed state with the same transition so it slides in sync.
  const TOGGLE_LEFT = (collapsed ? REF.minWidth : FULL_WIDTH) - 15;

  return (
    <>
      {/* Wrapper gives the toggle button a positioned parent outside overflow:hidden */}
      <div style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
        <aside
          aria-label="Global workspace sidebar"
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: REF.bg,
            borderRight: `1px solid ${REF.separator}`,
            width: collapsed ? REF.minWidth : FULL_WIDTH,
            transition: 'width var(--dur-med) var(--ease-out)',
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 0,
            willChange: 'width',
          }}
        >
          {/* ── SCT Header ───────────────────────────────────────────────────── */}
          <div
            style={{
              flexShrink: 0,
              height: 183,
              marginTop: 11,
              marginBottom: 11,
              paddingTop: 14,
              paddingBottom: 14,
              paddingLeft: REF.paddingH,
              paddingRight: REF.paddingH,
              borderBottom: `1px solid ${REF.separator}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {/* Logo image — visible when expanded, hidden when collapsed */}
            <img
              src={sctLogo}
              alt="SCT Logo"
              className="final-ui-logo"
              style={{
                height: collapsed ? 0 : 131,
                minHeight: 0,
                opacity: collapsed ? 0 : 1,
                pointerEvents: collapsed ? 'none' : 'auto',
                transition: 'height var(--dur-med) var(--ease-out), opacity 140ms var(--ease-out)',
              }}
            />

            {/* "SCT" monogram — visible only when collapsed */}
            <span
              style={{
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.18em',
                fontSize: 18,
                color: C.textMuted,
                fontWeight: 800,
                textTransform: 'uppercase',
                opacity: collapsed ? 1 : 0,
                maxHeight: collapsed ? 40 : 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                transition:
                  'opacity 180ms var(--ease-out), max-height var(--dur-med) var(--ease-out)',
              }}
            >
              SCT
            </span>

            {/* "SCT WORKSPACE" label — visible only when expanded */}
            <span
              style={{
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.18em',
                fontSize: 17,
                color: C.textMuted,
                fontWeight: 700,
                textTransform: 'uppercase',
                position: 'relative',
                left: -33,
                width: 187,
                overflow: 'hidden',
                maxWidth: collapsed ? 0 : 300,
                opacity: collapsed ? 0 : 1,
                whiteSpace: 'nowrap',
                transition: [
                  'max-width var(--dur-med) var(--ease-out)',
                  'opacity 140ms var(--ease-out)',
                ].join(', '),
              }}
            >
              SCT WORKSPACE
            </span>
          </div>

          {/* ── Body: padding wrapper ─────────────────────────────────────────── */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: REF.gap,
              padding: `${REF.paddingV}px ${collapsed ? 0 : REF.paddingH}px`,
              overflow: 'hidden',
              transition: 'padding var(--dur-med) var(--ease-out)',
            }}
          >
            {/* ── Search ───────────────────────────────────────────────────────── */}
            <div
              style={{ flexShrink: 0, position: 'relative', height: REF.itemHeight, width: '100%' }}
            >
              {/* Full search bar — extended only */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: `${REF.itemPadV}px ${REF.itemPadH}px`,
                  gap: 4,
                  background: REF.searchBg,
                  borderRadius: REF.searchRadius,
                  opacity: collapsed ? 0 : 1,
                  pointerEvents: collapsed ? 'none' : 'auto',
                  transition: 'opacity 140ms var(--ease-out)',
                  overflow: 'hidden',
                }}
              >
                <SearchMagnifier color={REF.textMuted} />
                <input
                  type="text"
                  placeholder="Search"
                  aria-label="Open workspace search"
                  aria-keyshortcuts="Control+k Meta+k"
                  title="Search workspace (Ctrl+K)"
                  readOnly
                  onClick={openSearch}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openSearch();
                    }
                  }}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontFamily: "'SCT Final Inter', sans-serif",
                    fontWeight: 400,
                    fontSize: 16,
                    lineHeight: '20px',
                    color: REF.textMuted,
                    minWidth: 0,
                  }}
                />
              </div>

              {/* Icon-only search button — minimal only */}
              <button
                ref={searchBtnRef}
                onClick={openSearch}
                title="Search workspace (Ctrl+K)"
                aria-label="Open workspace search"
                aria-keyshortcuts="Control+k Meta+k"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: REF.searchRadius,
                  cursor: 'pointer',
                  opacity: collapsed ? 1 : 0,
                  pointerEvents: collapsed ? 'auto' : 'none',
                  transition:
                    'opacity 180ms var(--ease-out) 60ms, background var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => {
                  if (collapsed) (e.currentTarget as HTMLElement).style.background = REF.searchBg;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <SearchMagnifier color={REF.textMuted} />
              </button>
            </div>

            {/* ── Nav items ─────────────────────────────────────────────────────── */}
            <nav
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: REF.itemGap,
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
              <NavBtn
                icon={<IconDashboard active={activeNav === 'dashboard'} />}
                activeIcon={<IconDashboard active={true} />}
                label="Dashboard"
                description="Your command center"
                accent={REF.iconActive}
                active={activeNav === 'dashboard'}
                collapsed={collapsed}
                onClick={() => setActiveNav('dashboard')}
              />
              <NavBtn
                icon={<IconProjects active={activeNav === 'projects'} />}
                activeIcon={<IconProjects active={true} />}
                label="Projects"
                description="All lighting projects"
                accent="var(--v4-accent)"
                active={activeNav === 'projects'}
                collapsed={collapsed}
                onClick={() => setActiveNav('projects')}
              />
              <NavBtn
                icon={<IconLuminaire active={activeNav === 'luminaire'} />}
                activeIcon={<IconLuminaire active={true} />}
                label="Luminaire Library"
                description="Browse & manage fixtures"
                accent="var(--v4-accent)"
                active={activeNav === 'luminaire'}
                collapsed={collapsed}
                onClick={() => setActiveNav('luminaire')}
              />
              <NavBtn
                icon={<IconSmartImport active={activeNav === 'smart-import'} />}
                activeIcon={<IconSmartImport active={true} />}
                label="Smart Import"
                description="Import & map schedules"
                accent="var(--v4-accent)"
                active={activeNav === 'smart-import'}
                collapsed={collapsed}
                onClick={() => setActiveNav('smart-import')}
              />
              <div>
                <NavBtn
                  icon={<IconReports active={activeNav === 'reports'} />}
                  activeIcon={<IconReports active={true} />}
                  label="Reports"
                  description="Activity and productivity"
                  accent="var(--v4-accent)"
                  active={activeNav === 'reports'}
                  collapsed={collapsed}
                  onClick={() => setActiveNav('reports')}
                />
              </div>
            </nav>

            {/* ── Bottom utility zone: Settings → Divider → Work Session → Profile ── */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Settings */}
              <NavBtn
                icon={<IconSettings active={activeNav === 'settings'} />}
                activeIcon={<IconSettings active={true} />}
                label="Settings"
                description="Preferences & account"
                accent="var(--v4-accent)"
                active={activeNav === 'settings'}
                collapsed={collapsed}
                onClick={() => setActiveNav('settings')}
              />

              {/* Separator */}
              <div style={{ height: 1, background: REF.separator, flexShrink: 0 }} />

              {/* Work Session */}
              <FinalSessionControl collapsed={collapsed}>
                {(control) => (
                  <div
                    {...control}
                    title={sessionProject}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: REF.itemGap,
                      padding: `6px ${collapsed ? 0 : REF.itemPadH}px`,
                      paddingLeft: collapsed ? (REF.minWidth - 20) / 2 : REF.itemPadH,
                      transition: 'padding var(--dur-med) var(--ease-out)',
                    }}
                  >
                    <span style={{ flexShrink: 0, display: 'flex' }}>
                      <IconWorkSession />
                    </span>
                    <div
                      style={{
                        overflow: 'hidden',
                        maxWidth: collapsed ? 0 : 200,
                        opacity: collapsed ? 0 : 1,
                        whiteSpace: 'nowrap',
                        transition:
                          'max-width var(--dur-med) var(--ease-out), opacity 120ms var(--ease-out)',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'SCT Final Inter', sans-serif",
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#16a34a',
                        }}
                      >
                        {sessionLabel}
                      </div>
                      <div
                        style={{
                          fontFamily: "'SCT Final Inter', sans-serif",
                          fontSize: 11,
                          color: REF.textMuted,
                        }}
                      >
                        {sessionProject}
                      </div>
                    </div>
                  </div>
                )}
              </FinalSessionControl>

              {/* Separator */}
              <div style={{ height: 1, background: REF.separator, flexShrink: 0 }} />

              {/* User profile */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'space-between',
                  cursor: 'pointer',
                  position: 'relative',
                }}
                onMouseEnter={() => setUserHovered(true)}
                onMouseLeave={() => setUserHovered(false)}
              >
                {/* Avatar — always visible */}
                <div
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: C.teal,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--v4-action-primary-foreground)',
                      fontSize: 14,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      type="button"
                      aria-label="Edit my profile"
                      onClick={editProfile}
                      style={{
                        border: 0,
                        padding: 0,
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        overflow: 'hidden',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      {identity.photo ? (
                        <img
                          src={identity.photo}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        identity.initials
                      )}
                    </button>
                  </div>

                  {/* Name + email */}
                  <div
                    style={{
                      overflow: 'hidden',
                      maxWidth: collapsed ? 0 : 200,
                      marginLeft: collapsed ? 0 : 12,
                      opacity: collapsed ? 0 : 1,
                      whiteSpace: 'nowrap',
                      transition: [
                        'max-width var(--dur-med) var(--ease-out)',
                        'margin-left var(--dur-med) var(--ease-out)',
                        'opacity 120ms var(--ease-out)',
                      ].join(', '),
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'SCT Final Inter', sans-serif",
                        fontWeight: 400,
                        fontSize: 16,
                        lineHeight: '20px',
                        color: REF.textPrimary,
                      }}
                    >
                      <button
                        type="button"
                        className="v4-profile-name"
                        aria-label="Edit profile details"
                        onClick={editProfile}
                      >
                        {identity.name}
                      </button>
                    </div>
                    <div
                      style={{
                        fontFamily: "'SCT Final Inter', sans-serif",
                        fontWeight: 400,
                        fontSize: 12,
                        lineHeight: '16px',
                        color: REF.textMuted,
                      }}
                    >
                      {identity.email}
                    </div>
                  </div>
                </div>

                {/* Log-out / chevron */}
                <div
                  style={{
                    overflow: 'hidden',
                    maxWidth: collapsed ? 0 : 20,
                    opacity: collapsed ? 0 : 1,
                    flexShrink: 0,
                    display: 'flex',
                    transition: [
                      'max-width var(--dur-med) var(--ease-out)',
                      'opacity 140ms var(--ease-out)',
                    ].join(', '),
                  }}
                >
                  <InlineGlyphs.SctMore width="18" height="18" />
                </div>

                {/* User tooltip in minimal mode */}
                {collapsed && <UserTooltip visible={userHovered} />}
              </div>
            </div>
          </div>
        </aside>

        {/* ── Collapse / expand toggle — floats on sidebar edge, not clipped ─── */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute',
            left: TOGGLE_LEFT,
            top: TOGGLE_TOP,
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: REF.bg,
            border: '1px solid #e5e7eb',
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 30,
            transition:
              'left var(--dur-med) var(--ease-out), background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform var(--dur-med) var(--ease-out)',
            }}
          >
            <IconChevronLeft />
          </span>
        </button>
      </div>
      {/* end sidebar wrapper */}

      {/* Floating search panel */}
      {searchOpen && <WorkspaceSearch onClose={() => setSearchOpen(false)} />}
    </>
  );
}
