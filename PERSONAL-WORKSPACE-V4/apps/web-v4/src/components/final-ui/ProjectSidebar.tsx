import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import { sctIcons, type SctIconKey } from '../common/SctIcons';
import { FinalSessionControl } from './FinalSessionControl';
import { useShellData } from './ShellData';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { C, DIM } from './tokens';
import type { ShellProject as Project } from './ShellData';

// ── Design tokens (mirrors Sidebar.tsx REF) ──────────────────────────────────
const REF = {
  bg: 'var(--v4-surface-raised)',
  paddingH: 16,
  paddingV: 20,
  gap: 24,
  searchBg: 'var(--v4-surface-subtle)',
  itemRadius: 8,
  itemPadH: 12,
  itemPadV: 9,
  itemGap: 8,
  itemHeight: 36,
  textPrimary: 'var(--v4-text-primary)',
  textMuted: 'var(--v4-text-muted)',
  iconInactive: 'var(--v4-text-secondary)',
  iconActive: 'var(--v4-accent-ink)',
  labelActive: 'var(--v4-accent-ink)',
  activeBg: 'var(--v4-surface-raised)',
  separator: 'var(--v4-border-subtle)',
  minWidth: 68,
};

// ── Per-item icons ────────────────────────────────────────────────────────────

function ItemIcon({ id, active }: { id: string; active: boolean }) {
  const aliases: Record<string, SctIconKey> = {
    'tech-check': 'technical-check',
    'studio-systems': 'systems',
    'studio-datasheets': 'datasheets',
    'studio-output': 'output-studio',
    'luminaire-sch': 'schedule',
    'studio-accessories': 'accessories',
    'tech-boq': 'boq',
    'issue-history': 'timeline',
    activity: 'timeline',
    register: 'files',
  };
  const key = aliases[id] ?? id;
  const Icon = sctIcons[key as SctIconKey] ?? sctIcons.file;
  return <Icon size={18} color={active ? REF.iconActive : REF.iconInactive} />;
}

// ── Nav group definitions ─────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  disabled?: boolean;
}
interface NavGroup {
  id: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (active) => (
      <InlineGlyphs.SctDashboard
        width="18"
        height="18"
        color={active ? REF.iconActive : REF.iconInactive}
      />
    ),
    items: [
      { id: 'summary', label: 'Summary' },
      { id: 'timeline', label: 'Workflow Timeline' },
    ],
  },
  {
    id: 'coordination',
    label: 'Coordination',
    icon: (active) => (
      <InlineGlyphs.SctCoordination
        width="18"
        height="18"
        color={active ? REF.iconActive : REF.iconInactive}
      />
    ),
    items: [
      { id: 'meetings', label: 'Meetings' },
      { id: 'scope', label: 'Scope & Services' },
      { id: 'actions', label: 'Actions' },
      { id: 'comments', label: 'Comments' },
      { id: 'contacts', label: 'Contacts' },
    ],
  },
  {
    id: 'technical',
    label: 'Technical Workspace',
    icon: (active) => (
      <InlineGlyphs.SctLuminaires
        width="18"
        height="18"
        color={active ? REF.iconActive : REF.iconInactive}
      />
    ),
    items: [
      { id: 'luminaires', label: 'Luminaires' },
      { id: 'datasheets', label: 'Datasheets & Images' },
      { id: 'tech-check', label: 'Technical Check' },
      { id: 'studio-systems', label: 'Lighting Systems' },
      { id: 'studio-accessories', label: 'System Accessories' },
      { id: 'studio-output', label: 'Output Studio' },
      { id: 'studio-datasheets', label: 'Luminaire Specifications' },
    ],
  },
  {
    id: 'deliverables',
    label: 'Deliverables & Issue',
    icon: (active) => (
      <InlineGlyphs.SctPackages
        width="18"
        height="18"
        color={active ? REF.iconActive : REF.iconInactive}
      />
    ),
    items: [
      { id: 'revisions', label: 'Revisions & Deliverables' },
      { id: 'packages', label: 'Packages' },
      { id: 'submissions', label: 'Submissions', disabled: true },
      { id: 'issue-history', label: 'Issue History', disabled: true },
    ],
  },
  {
    id: 'files',
    label: 'Files & History',
    icon: (active) => (
      <InlineGlyphs.SctFiles
        width="18"
        height="18"
        color={active ? REF.iconActive : REF.iconInactive}
      />
    ),
    items: [
      { id: 'files', label: 'Files' },
      { id: 'register', label: 'Register', disabled: true },
      { id: 'activity', label: 'Activity', disabled: true },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupOfPage(pageId: string): string | null {
  for (const g of NAV_GROUPS) {
    if (g.items.some((i) => i.id === pageId)) return g.id;
  }
  return null;
}

// ── NavFloatCard portal ───────────────────────────────────────────────────────

function NavFloatCard({
  label,
  visible,
  anchorX,
  anchorY,
}: {
  label: string;
  visible: boolean;
  anchorX: number;
  anchorY: number;
}) {
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
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          borderRadius: 44,
          padding: 1.5,
          overflow: 'hidden',
          width: 200,
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '-80%',
            background: `conic-gradient(from 0deg, transparent 70%, ${REF.iconActive} 82%, #ffffff 85%, ${REF.iconActive} 88%, transparent 94%)`,
            animation: 'finalUiNavBorderSpin 2.4s linear infinite',
            animationPlayState: visible ? 'running' : 'paused',
            zIndex: 0,
          }}
        />
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
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: REF.iconActive,
              borderRadius: '43px 0 0 43px',
            }}
          />
          <div style={{ padding: '10px 16px 10px 18px' }}>
            <div
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--v4-text-primary)',
              }}
            >
              {label}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Group flyout panel (minimal mode) ─────────────────────────────────────────

function GroupFlyout({
  group,
  activePage,
  onSelect,
  anchorY,
  visible,
  onClose,
}: {
  group: NavGroup;
  activePage: string;
  onSelect: (id: string) => void;
  anchorY: number;
  visible: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible) return;
    const owner = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => owner?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [visible, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      tabIndex={-1}
      className="final-ui-portal"
      inert={!visible}
      aria-hidden={!visible}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        left: REF.minWidth + 8,
        top: Math.min(anchorY - 8, window.innerHeight - 280),
        zIndex: 9998,
        opacity: visible ? 1 : 0,
        transform: `translateX(${visible ? 0 : -10}px) scale(${visible ? 1 : 0.96})`,
        transformOrigin: 'left top',
        pointerEvents: visible ? 'auto' : 'none',
        transition: visible
          ? 'opacity 180ms ease, transform 280ms cubic-bezier(0.34,1.56,0.64,1)'
          : 'opacity 120ms ease, transform 120ms ease',
      }}
    >
      <div
        style={{
          background: 'var(--v4-surface-raised)',
          borderRadius: 12,
          border: '1px solid #e8e8ed',
          boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          minWidth: 220,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '10px 14px 8px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ opacity: 0.7 }}>{group.icon(true)}</span>
          <span
            style={{
              fontFamily: "'SCT Final Inter', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              color: REF.iconActive,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            {group.label}
          </span>
        </div>
        {/* Items */}
        <div style={{ padding: '6px 8px 8px' }}>
          {group.items.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              disabled={item.disabled}
              aria-current={activePage === item.id && !item.disabled ? 'page' : undefined}
              onClick={() => {
                if (!item.disabled) {
                  onSelect(item.id);
                  onClose();
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '7px 8px',
                borderRadius: 7,
                border: 'none',
                cursor: item.disabled ? 'default' : 'pointer',
                background: activePage === item.id ? REF.activeBg : 'transparent',
                opacity: item.disabled ? 0.38 : 1,
                transition: 'background 120ms ease',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!item.disabled && activePage !== item.id)
                  (e.currentTarget as HTMLElement).style.background = REF.searchBg;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  activePage === item.id ? REF.activeBg : 'transparent';
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  opacity: activePage === item.id ? 1 : 0.55,
                }}
              >
                <ItemIcon id={item.id} active={activePage === item.id} />
              </span>
              <span
                style={{
                  fontFamily: "'SCT Final Inter', sans-serif",
                  fontSize: 13,
                  fontWeight: activePage === item.id ? 600 : 400,
                  color:
                    activePage === item.id
                      ? REF.labelActive
                      : item.disabled
                        ? REF.textMuted
                        : REF.textPrimary,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </span>
              {item.disabled && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--v4-text-disabled)',
                    background: 'var(--v4-surface-muted)',
                    borderRadius: 4,
                    padding: '1px 5px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Group icon button (minimal mode) ─────────────────────────────────────────

function GroupIconBtn({
  group,
  isActiveGroup,
  isOpen,
  onClick,
}: {
  group: NavGroup;
  isActiveGroup: boolean;
  isOpen: boolean;
  onClick: (rect: DOMRect) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={btnRef}
      onClick={() => {
        if (btnRef.current) onClick(btnRef.current.getBoundingClientRect());
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={group.label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: REF.minWidth,
        height: 36,
        border: 'none',
        cursor: 'pointer',
        borderRadius: REF.itemRadius,
        background: isOpen || isActiveGroup ? REF.activeBg : hovered ? REF.searchBg : 'transparent',
        position: 'relative',
        transition: 'background 140ms ease',
      }}
    >
      {/* Active indicator dot */}
      {isActiveGroup && (
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: REF.iconActive,
          }}
        />
      )}
      {group.icon(isActiveGroup || isOpen)}
    </button>
  );
}

// ── Child nav item (extended mode) ────────────────────────────────────────────

function ChildNavBtn({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [anchorX, setAnchorX] = useState(0);
  const [anchorY, setAnchorY] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

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
            background: `conic-gradient(from 0deg, transparent 70%, ${REF.iconActive} 82%, #ffffff 85%, ${REF.iconActive} 88%, transparent 94%)`,
            animation: 'finalUiNavBorderSpin 2.4s linear infinite',
          }}
        />
      </div>
    ) : null;

  return (
    <div
      ref={ref}
      style={{ position: 'relative', width: '100%' }}
      onMouseEnter={() => {
        if (ref.current) {
          const r = ref.current.getBoundingClientRect();
          setAnchorX(r.right);
          setAnchorY(r.top + r.height / 2);
        }
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {spinBorder}
      <button
        onClick={onClick}
        aria-label={item.label}
        disabled={item.disabled}
        aria-current={active && !item.disabled ? 'page' : undefined}
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          paddingTop: REF.itemPadV,
          paddingBottom: REF.itemPadV,
          paddingLeft: collapsed ? (REF.minWidth - 15) / 2 : REF.itemPadH + 8,
          paddingRight: REF.itemPadH,
          gap: 8,
          width: active && !collapsed ? 'calc(100% - 3px)' : '100%',
          height: REF.itemHeight,
          borderRadius: REF.itemRadius,
          background: active
            ? REF.activeBg
            : hovered && !active && !item.disabled
              ? REF.searchBg
              : 'transparent',
          border: 'none',
          cursor: item.disabled ? 'default' : 'pointer',
          opacity: item.disabled ? 0.38 : 1,
          transition: 'background 140ms ease, padding-left var(--dur-med) var(--ease-out)',
          margin: active && !collapsed ? 1.5 : 0,
          textAlign: 'left',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            display: 'flex',
            opacity: active ? 1 : 0.6,
            transition: 'opacity 140ms ease',
          }}
        >
          <ItemIcon id={item.id} active={active} />
        </span>
        <span
          style={{
            fontFamily: "'SCT Final Inter', sans-serif",
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active ? REF.labelActive : REF.textPrimary,
            overflow: 'hidden',
            maxWidth: collapsed ? 0 : 180,
            opacity: collapsed ? 0 : 1,
            whiteSpace: 'nowrap',
            transition: 'max-width var(--dur-med) var(--ease-out), opacity 120ms var(--ease-out)',
          }}
        >
          {item.label}
        </span>
        {item.disabled && !collapsed && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--v4-text-disabled)',
              background: 'var(--v4-surface-muted)',
              borderRadius: 4,
              padding: '1px 5px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              flexShrink: 0,
            }}
          >
            Soon
          </span>
        )}
      </button>
      {collapsed && !item.disabled && (
        <NavFloatCard label={item.label} visible={hovered} anchorX={anchorX} anchorY={anchorY} />
      )}
    </div>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────

type ProjectStatus =
  'Planning' | 'In Progress' | 'Client Review' | 'Revision Required' | 'On Hold' | 'Completed';
const STATUS_STYLES: Record<ProjectStatus, { dot: string; bg: string; text: string }> = {
  Planning: { dot: '#2563eb', bg: '#dbeafe', text: '#1d4ed8' },
  'In Progress': { dot: C.blue, bg: C.selectedRow, text: C.blueDeep },
  'Client Review': { dot: C.violet, bg: C.violetLight, text: C.violetDark },
  'Revision Required': { dot: C.amber, bg: C.amberLight, text: C.amberDark },
  'On Hold': { dot: 'var(--v4-text-disabled)', bg: '#f9fafb', text: 'var(--v4-text-muted)' },
  Completed: { dot: C.greenMid, bg: C.greenMidLight, text: C.greenDeep },
};
export function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status as ProjectStatus] ?? STATUS_STYLES.Planning;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 15,
        background: s.bg,
        color: s.text,
        border: `1.5px solid ${s.dot}`,
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "'SCT Final Inter', sans-serif",
        whiteSpace: 'nowrap',
        height: 43,
        width: 102,
        boxSizing: 'border-box',
        justifyContent: 'center',
      }}
    >
      <span
        style={{ width: 11, height: 10, borderRadius: '50%', background: s.dot, flexShrink: 0 }}
      />
      {status}
    </span>
  );
}

// ── User tooltip ──────────────────────────────────────────────────────────────

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

// ── IconChevronLeft ───────────────────────────────────────────────────────────

function IconChevronLeft() {
  return <CustomGlyphs.SctBack size="12" style={{ color: 'currentColor' }} />;
}

// ── Main ProjectSidebar ───────────────────────────────────────────────────────

interface ProjectSidebarProps {
  statusControl?: React.ReactNode;
  project: Project;
  activePage: string;
  setActivePage: (id: string) => void;
  onBack: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export default function ProjectSidebar({
  project,
  activePage,
  setActivePage,
  onBack,
  collapsed,
  setCollapsed,
  statusControl,
}: ProjectSidebarProps) {
  const { identity, sessionLabel, sessionProject, editProfile } = useShellData();
  const [userHovered, setUserHovered] = useState(false);
  // expanded groups in extended mode
  const activeGroupId = groupOfPage(activePage);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(activeGroupId ? [activeGroupId] : ['overview']),
  );
  // open flyout group in minimal mode
  const [flyoutGroupId, setFlyoutGroupId] = useState<string | null>(null);
  const [flyoutAnchorY, setFlyoutAnchorY] = useState(0);

  // auto-expand active group when page changes
  useEffect(() => {
    if (activeGroupId) {
      setExpandedGroups((prev) => new Set([...prev, activeGroupId]));
    }
  }, [activeGroupId]);

  const FULL_WIDTH = DIM.sidebarWidth;
  const TOGGLE_TOP = 200;
  const TOGGLE_LEFT = (collapsed ? REF.minWidth : FULL_WIDTH) - 15;
  const initials = project.code.slice(0, 3).toUpperCase();

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openFlyout(groupId: string, rect: DOMRect) {
    if (flyoutGroupId === groupId) {
      setFlyoutGroupId(null);
      return;
    }
    setFlyoutAnchorY(rect.top);
    setFlyoutGroupId(groupId);
  }

  return (
    <>
      <div style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
        <aside
          aria-label="Project workspace sidebar"
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
            willChange: 'width',
          }}
        >
          {/* ── Project context header ───────────────────────────────────── */}
          <div
            style={{
              flexShrink: 0,
              minHeight: 183,
              marginTop: 11,
              marginBottom: 11,
              paddingTop: 14,
              paddingBottom: 14,
              paddingLeft: REF.paddingH,
              paddingRight: REF.paddingH,
              borderBottom: `1px solid ${REF.separator}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: collapsed ? 'center' : 'flex-start',
              justifyContent: 'center',
              gap: 8,
              overflow: 'hidden',
            }}
          >
            {/* Collapsed: project initials bubble */}
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: '#F5F0FF',
                border: '1.5px solid #d8b4fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--v4-accent-ink)',
                fontSize: 13,
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.05em',
                flexShrink: 0,
                opacity: collapsed ? 1 : 0,
                maxHeight: collapsed ? 40 : 0,
                overflow: 'hidden',
                transition:
                  'opacity 180ms var(--ease-out), max-height var(--dur-med) var(--ease-out)',
              }}
            >
              {initials}
            </div>

            {/* Expanded: back + project identity */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                rowGap: 16,
                columnGap: 7,
                opacity: collapsed ? 0 : 1,
                maxHeight: collapsed ? 0 : 300,
                overflow: 'hidden',
                transition:
                  'opacity 140ms var(--ease-out), max-height var(--dur-med) var(--ease-out)',
                width: '100%',
                margin: '-1px 0',
              }}
            >
              {/* Back to Projects */}
              <button
                onClick={onBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--v4-accent-ink)',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "'SCT Final Inter', sans-serif",
                  padding: '2px 0',
                  marginBottom: 2,
                }}
              >
                <InlineGlyphs.SctBack width="14" height="14" />
                Back to Projects
              </button>

              {/* Project code */}
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.textMuted,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {project.code}
              </div>

              {/* Project name */}
              {project.name && (
                <div
                  style={{
                    fontFamily: "'SCT Final Inter', sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {project.name}
                </div>
              )}
              {!project.name && (
                <div
                  style={{
                    fontFamily: "'SCT Final Inter', sans-serif",
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.textDark,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {project.type}
                </div>
              )}

              {/* Status */}
              {statusControl ?? <StatusChip status={project.status as ProjectStatus} />}
            </div>
          </div>

          {/* ── Nav ─────────────────────────────────────────────────────── */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: `${REF.paddingV}px 0`,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {collapsed
              ? /* ── MINIMAL: one icon per group ───────────────────────── */
                NAV_GROUPS.map((group) => (
                  <GroupIconBtn
                    key={group.id}
                    group={group}
                    isActiveGroup={activeGroupId === group.id}
                    isOpen={flyoutGroupId === group.id}
                    onClick={(rect) => openFlyout(group.id, rect)}
                  />
                ))
              : /* ── EXTENDED: collapsible groups ──────────────────────── */
                NAV_GROUPS.map((group, gi) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const isActiveGrp = activeGroupId === group.id;
                  return (
                    <div
                      key={group.id}
                      data-group-id={group.id}
                      data-open={isExpanded}
                      style={{ marginBottom: gi < NAV_GROUPS.length - 1 ? 2 : 0 }}
                    >
                      {/* Group header (clickable) */}
                      <button
                        aria-expanded={isExpanded}
                        onClick={() => toggleGroup(group.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          width: '100%',
                          padding: '6px 12px',
                          gap: 8,
                          border: 'none',
                          cursor: 'pointer',
                          background: 'transparent',
                          borderRadius: REF.itemRadius,
                        }}
                        onMouseEnter={(e) =>
                          ((e.currentTarget as HTMLElement).style.background = REF.searchBg)
                        }
                        onMouseLeave={(e) =>
                          ((e.currentTarget as HTMLElement).style.background = 'transparent')
                        }
                      >
                        <span style={{ opacity: isActiveGrp ? 1 : 0.55 }}>
                          {group.icon(isActiveGrp)}
                        </span>
                        <span
                          style={{
                            fontFamily: "'SCT Final Inter', sans-serif",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: '0.07em',
                            textTransform: 'uppercase',
                            color: isActiveGrp ? REF.iconActive : REF.textMuted,
                            flex: 1,
                            textAlign: 'left',
                          }}
                        >
                          {group.label}
                        </span>
                        <InlineGlyphs.SctExpand
                          width="12"
                          height="12"
                          style={{
                            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                            transition: 'transform 200ms ease',
                            flexShrink: 0,
                          }}
                        />
                      </button>

                      {/* Children */}
                      <div
                        inert={!isExpanded}
                        aria-hidden={!isExpanded}
                        style={{
                          overflow: 'hidden',
                          maxHeight: isExpanded ? group.items.length * 44 : 0,
                          transition: 'max-height 260ms cubic-bezier(0.16,1,0.3,1)',
                          paddingLeft: REF.paddingH,
                          paddingRight: REF.paddingH / 2,
                        }}
                      >
                        {group.items.map((item) => (
                          <ChildNavBtn
                            key={item.id}
                            item={item}
                            active={activePage === item.id}
                            collapsed={false}
                            onClick={() => {
                              if (!item.disabled) setActivePage(item.id);
                            }}
                          />
                        ))}
                      </div>

                      {/* Group separator */}
                      {gi < NAV_GROUPS.length - 1 && isExpanded && (
                        <div
                          style={{ height: 1, background: REF.separator, margin: '6px 12px 4px' }}
                        />
                      )}
                    </div>
                  );
                })}
          </div>

          {/* ── Bottom utility zone ──────────────────────────────────── */}
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${REF.separator}`,
              padding: `16px ${collapsed ? 0 : REF.paddingH}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              transition: 'padding var(--dur-med) var(--ease-out)',
            }}
          >
            <ChildNavBtn
              item={{ id: 'settings', label: 'Settings' }}
              active={activePage === 'settings'}
              collapsed={collapsed}
              onClick={() => setActivePage('settings')}
            />

            <div style={{ height: 1, background: REF.separator }} />

            {/* Work Session */}
            <FinalSessionControl collapsed={collapsed}>
              {(control) => (
                <div
                  {...control}
                  title={sessionProject}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: collapsed ? (REF.minWidth - 18) / 2 : 0,
                    gap: 8,
                    transition: 'padding-left var(--dur-med) var(--ease-out)',
                  }}
                >
                  <InlineGlyphs.SctWorkSession width="18" height="18" color={REF.textMuted} />
                  <span
                    style={{
                      fontFamily: "'SCT Final Inter', sans-serif",
                      fontSize: 13,
                      color: REF.textMuted,
                      overflow: 'hidden',
                      maxWidth: collapsed ? 0 : 140,
                      opacity: collapsed ? 0 : 1,
                      whiteSpace: 'nowrap',
                      transition:
                        'max-width var(--dur-med) var(--ease-out), opacity 120ms var(--ease-out)',
                    }}
                  >
                    {sessionLabel}
                  </span>
                </div>
              )}
            </FinalSessionControl>

            <div style={{ height: 1, background: REF.separator }} />

            {/* Profile */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'space-between',
                cursor: 'pointer',
                position: 'relative',
              }}
              onMouseEnter={() => setUserHovered(true)}
              onMouseLeave={() => setUserHovered(false)}
            >
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'var(--v4-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--v4-action-primary-foreground)',
                    fontSize: 13,
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
                <div
                  style={{
                    overflow: 'hidden',
                    maxWidth: collapsed ? 0 : 170,
                    marginLeft: collapsed ? 0 : 10,
                    opacity: collapsed ? 0 : 1,
                    whiteSpace: 'nowrap',
                    transition:
                      'max-width var(--dur-med) var(--ease-out), margin-left var(--dur-med) var(--ease-out), opacity 120ms var(--ease-out)',
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'SCT Final Inter', sans-serif",
                      fontSize: 14,
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
                      fontSize: 11,
                      color: REF.textMuted,
                    }}
                  >
                    {identity.email}
                  </div>
                </div>
              </div>
              {collapsed && <UserTooltip visible={userHovered} />}
            </div>
          </div>
        </aside>

        {/* Collapse / expand toggle */}
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
            transition: 'left var(--dur-med) var(--ease-out), background 140ms ease',
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

      {/* Group flyout — minimal mode */}
      {NAV_GROUPS.map((group) => (
        <GroupFlyout
          key={group.id}
          group={group}
          activePage={activePage}
          onSelect={setActivePage}
          anchorY={flyoutAnchorY}
          visible={flyoutGroupId === group.id}
          onClose={() => setFlyoutGroupId(null)}
        />
      ))}
    </>
  );
}
