/**
 * V4 contextual Sidebar — the ONE structural navigation rail (owner-locked).
 *
 * Three-zone architecture (H1-D1):
 *   TOP    — fixed: brand (Extended GLOBAL) OR project context (Extended
 *            PROJECT: Back to Projects + identity + status chip).
 *   MIDDLE — scrollable navigation ONLY (the sole overflow region).
 *   BOTTOM — fixed: Settings / Work Session / Profile.
 *
 * H2 final navigation concept (owner-locked):
 *   - Extended GLOBAL shows the official logo LARGE above "SCT Workspace".
 *   - Settings is NOT primary Global navigation; it lives in the BOTTOM
 *     utility zone (Settings / divider / Work Session / Profile).
 *   - Extended PROJECT groups have thin low-contrast separators between them.
 *   - Minimal PROJECT is a GROUP-LEVEL icon rail (one icon per primary group),
 *     NOT a long child-page list. Selecting a group opens a contextual flyout
 *     with that group's child pages.
 *   - The sidebar mode control is a floating circular edge toggle (ChevronLeft
 *     in Extended, ChevronRight in Minimal) attached to the rail's right edge.
 *   - Extended<->Minimal is a restrained 210ms container morph; reduced motion
 *     switches immediately.
 *
 * The active-navigation lighting motion is driven by `useV4NavMotion`. A
 * structural `data-sweep` key restarts the single perimeter sweep; reduced
 * motion shows the stable active state immediately.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Clock3, FolderKanban, UserRound } from '../common/SctIcons';
import scientechnicLogo from '../../assets/branding/scientechnic-official-logo.png';
import {
  BACK_TO_PROJECTS_ITEM,
  GLOBAL_NAV_ITEMS,
  PROJECT_NAV_GROUPS,
  SETTINGS_NAV_ITEM,
  type ShellContext,
  type V4NavItem,
} from '../navigation/navModel';
import type { SidebarMode } from './sidebarMode';
import { useV4NavMotion } from '../navigation/useV4NavMotion';
import {
  ensureActiveGroupOpen,
  initialGroupState,
  toggleGroup,
  type V4GroupState,
} from './groupState';
import { V4Tooltip } from '../common/V4Tooltip';
import { V4SidebarEdgeToggle } from './V4SidebarEdgeToggle';
import { V4MinimalProjectFlyout } from './V4MinimalProjectFlyout';
import { formatProjectStatus, projectStatusTone } from '../project/statusDisplay';
import { deriveShortProjectCode } from '../project/shortProjectCode';

export interface V4ProjectIdentity {
  projectCode: string;
  projectName: string;
  /** Canonical Project Status (real data; never fabricated). */
  status: string | null;
}

export interface V4SidebarProps {
  /** Which shell context the rail presents. */
  context: ShellContext;
  /** Current presentation mode. */
  mode: SidebarMode;
  /** Persist the presentation mode (Extended <-> Minimal). */
  onToggleMode: () => void;
  /** Diagnostic active nav item id (e.g. from a `?section=` query param). */
  activeSectionId?: string | null;
  /** Project context: compact identity block (REAL canonical data). */
  project?: V4ProjectIdentity | null;
  /** Project context: project loading state. */
  projectLoading?: boolean;
  /** Project context: back-to-projects navigation. */
  onBackToProjects?: (() => void) | undefined;
  /** Diagnostic nav activation (no product routes are registered in F2). */
  onSelectSection?: ((id: string) => void) | undefined;
  /** Structural Work Session indicator node (reserved zone, inactive anchor). */
  workSessionSlot?: ReactNode;
  /** Structural Profile slot (neutral icon + accessible label). */
  profileSlot?: ReactNode;
}

function NavItem({
  item,
  active,
  motionEnabled,
  sweepKey,
  minimal,
  child,
  onSelect,
}: {
  item: V4NavItem;
  active: boolean;
  motionEnabled: boolean;
  /** Re-key the single sweep animation on each new selection. */
  sweepKey: number | null;
  /** Minimal mode: icon-only with tooltip. */
  minimal: boolean;
  /** H4: this is a project child row (adds shared active-child grammar). */
  child?: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = item.icon;
  const disabledReasonId = useId();
  const activeClass = active
    ? child
      ? 'v4-nav-item v4-nav-item--active v4-active-child'
      : 'v4-nav-item v4-nav-item--active'
    : 'v4-nav-item';
  const button = (
    <button
      type="button"
      className={activeClass}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      aria-describedby={item.disabledReason ? disabledReasonId : undefined}
      title={item.disabledReason ?? (minimal ? undefined : item.label)}
      disabled={item.disabled}
      onClick={() => onSelect(item.id)}
    >
      <span className="v4-nav-item__edge" aria-hidden="true" />
      <Icon className="v4-nav-item__icon" aria-hidden="true" strokeWidth={1.75} />
      <span className="v4-nav-item__label">{item.label}</span>
      {active && motionEnabled && sweepKey !== null ? (
        <span key={sweepKey} className="v4-nav-sweep" aria-hidden="true" />
      ) : null}
      {item.disabledReason ? (
        <span id={disabledReasonId} className="v4-visually-hidden">
          {item.disabledReason}
        </span>
      ) : null}
    </button>
  );
  return minimal ? <V4Tooltip label={item.label}>{button}</V4Tooltip> : button;
}

export function V4Sidebar({
  context,
  mode,
  onToggleMode,
  activeSectionId = null,
  project = null,
  projectLoading = false,
  onBackToProjects,
  onSelectSection,
  workSessionSlot,
  profileSlot,
}: V4SidebarProps) {
  const { activeId, sweepKey, motionEnabled, select } = useV4NavMotion({
    initialActiveId: activeSectionId,
  });

  const isExtended = mode === 'extended';
  const isProject = context === 'project';
  const minimal = !isExtended;

  // Project group expand/collapse state (presentation-only, non-exclusive).
  const [groupState, setGroupState] = useState<V4GroupState>(() =>
    initialGroupState(PROJECT_NAV_GROUPS, activeSectionId),
  );

  // Minimal Project: which group's flyout is open (null = closed).
  const [openFlyoutGroupId, setOpenFlyoutGroupId] = useState<string | null>(null);
  // H13: the open group's flow-owned subtree lane position relative to the
  // shell. Used ONLY to anchor the child panel overlay (which extends over the
  // workspace). The lane itself owns the vertical flow height in the nav, so
  // the next primary group follows it naturally — no measured spacer.
  const [subtreeLaneTop, setSubtreeLaneTop] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const groupTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const flyoutTriggerRef = useRef<HTMLElement | null>(null);
  const subtreeLaneRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-open the group containing the active section whenever it changes, so
  // the active item is never hidden.
  useEffect(() => {
    setGroupState((current) => ensureActiveGroupOpen(current, PROJECT_NAV_GROUPS, activeId));
  }, [activeId]);

  const handleSelect = (id: string) => {
    const item =
      GLOBAL_NAV_ITEMS.find((candidate) => candidate.id === id) ??
      PROJECT_NAV_GROUPS.flatMap((group) => group.items).find((candidate) => candidate.id === id);
    if (item?.disabled) return;
    select(id);
    onSelectSection?.(id);
  };

  const handleBackToProjects = () => {
    select(BACK_TO_PROJECTS_ITEM.id);
    onBackToProjects?.();
  };

  const handleToggleGroup = (groupId: string) => {
    setGroupState((current) => toggleGroup(current, groupId));
  };

  const handleOpenFlyout = (groupId: string) => {
    // H10 (Defect 4): a click on a DIFFERENT group opens it immediately (atomic
    // one-click switch); clicking the SAME group closes it (toggle). No
    // close-first/wait/open-second intermediate state.
    setOpenFlyoutGroupId((current) => {
      const next = current === groupId ? null : groupId;
      if (!next) {
        setSubtreeLaneTop(null);
      }
      return next;
    });
  };

  // H13: after the open group's subtree lane renders, measure its position
  // relative to the shell and anchor the child panel overlay to it. The lane
  // owns the vertical flow height; the overlay only needs the lane's top.
  // useLayoutEffect so the anchor is set synchronously within the commit (no
  // flash of the panel at top:0).
  useLayoutEffect(() => {
    if (!openFlyoutGroupId) {
      setSubtreeLaneTop(null);
      return;
    }
    const lane = subtreeLaneRefs.current[openFlyoutGroupId];
    const shell = shellRef.current;
    if (lane && shell) {
      const laneRect = lane.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      setSubtreeLaneTop(laneRect.top - shellRect.top);
    }
  }, [openFlyoutGroupId]);

  const handleFlyoutSelectChild = (childId: string) => {
    handleSelect(childId);
    setOpenFlyoutGroupId(null);
  };

  const showGlobalBrand = isExtended && !isProject;
  const showProjectIdentity = isExtended && isProject;
  // H12: Project Minimal gets a compact Project Identity Beacon. (Global
  // Minimal intentionally keeps the zone geometry with no brand — no approved
  // symbol-only brand asset exists; see BRAND_MARK_ASSET_GAP finding.)
  const showProjectMinimalBeacon = isProject && minimal;

  const projectStatus = project?.status ?? null;
  const activeGroupId = PROJECT_NAV_GROUPS.find((group) =>
    group.items.some((item) => item.id === activeId),
  )?.id;

  const openFlyoutGroup = openFlyoutGroupId
    ? (PROJECT_NAV_GROUPS.find((group) => group.id === openFlyoutGroupId) ?? null)
    : null;

  return (
    <div className="v4-sidebar-shell" ref={shellRef} data-context={context} data-mode={mode}>
      <aside className={`v4-sidebar v4-sidebar--${mode}`} data-context={context}>
        {/* TOP — fixed. Brand (Extended GLOBAL) or project context. Never
            scrolls. H12: Global Minimal intentionally keeps the zone geometry
            with no brand (BRAND_MARK_ASSET_GAP — see Findings); Project Minimal
            renders a compact Project Identity Beacon. */}
        <div className="v4-sidebar__top">
          {showGlobalBrand ? (
            <div className="v4-sidebar__brand" data-testid="v4-sidebar-brand">
              <img
                className="v4-sidebar__logo"
                src={scientechnicLogo}
                alt="Scientechic"
                data-testid="v4-sidebar-logo"
              />
              <span className="v4-sidebar__product">SCT Workspace</span>
            </div>
          ) : null}

          {isProject ? (
            <div className="v4-sidebar__project-head">
              <NavItem
                item={BACK_TO_PROJECTS_ITEM}
                active={activeId === BACK_TO_PROJECTS_ITEM.id}
                motionEnabled={motionEnabled}
                sweepKey={sweepKey}
                minimal={minimal}
                onSelect={handleBackToProjects}
              />
              {showProjectIdentity ? (
                <div className="v4-sidebar__project-identity" data-testid="v4-project-identity">
                  {projectLoading ? (
                    <span className="v4-sidebar__project-state v4-sidebar__project-state--loading">
                      Loading project…
                    </span>
                  ) : project ? (
                    <>
                      <span
                        className="v4-sidebar__project-code"
                        title={project.projectCode}
                        aria-label={`Project code: ${project.projectCode}`}
                      >
                        {project.projectCode}
                      </span>
                      <span
                        className="v4-sidebar__project-name"
                        title={project.projectName}
                        aria-label={`Project name: ${project.projectName}`}
                      >
                        {project.projectName}
                      </span>
                      {projectStatus ? (
                        <span
                          className="v4-sidebar__project-status"
                          data-testid="v4-project-status-chip"
                          data-tone={projectStatusTone(projectStatus)}
                        >
                          {formatProjectStatus(projectStatus)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="v4-sidebar__project-state v4-sidebar__project-state--unavailable">
                      Project unavailable
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* H13: Project Minimal Identity Beacon renders AFTER the Back control
              so Back reads FIRST / higher in hierarchy, then the beacon. */}
          {showProjectMinimalBeacon ? (
            <div className="v4-sidebar__project-beacon" data-testid="v4-project-beacon">
              {projectLoading ? (
                <span className="v4-sidebar__project-state v4-sidebar__project-state--loading">
                  Loading…
                </span>
              ) : project ? (
                <>
                  <FolderKanban
                    className="v4-sidebar__beacon-icon"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  {deriveShortProjectCode(project.projectCode) ? (
                    <span className="v4-sidebar__beacon-code">
                      {deriveShortProjectCode(project.projectCode)}
                    </span>
                  ) : null}
                  {projectStatus ? (
                    <span
                      className="v4-sidebar__beacon-status"
                      data-testid="v4-project-beacon-status"
                      role="status"
                      aria-label={`Project status: ${formatProjectStatus(projectStatus)}`}
                      data-tone={projectStatusTone(projectStatus)}
                    />
                  ) : null}
                </>
              ) : (
                <span className="v4-sidebar__project-state v4-sidebar__project-state--unavailable">
                  Project unavailable
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* MIDDLE — the ONLY scrollable region (navigation). */}
        <nav
          className="v4-sidebar__nav"
          aria-label={isProject ? 'Project navigation' : 'Global navigation'}
        >
          {!isProject ? (
            <div className="v4-sidebar__global-list">
              {GLOBAL_NAV_ITEMS.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  active={activeId === item.id}
                  motionEnabled={motionEnabled}
                  sweepKey={sweepKey}
                  minimal={minimal}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          ) : null}

          {isProject && isExtended
            ? PROJECT_NAV_GROUPS.map((group) => {
                const open = groupState[group.id] ?? false;
                return (
                  <section
                    key={group.id}
                    className="v4-sidebar__group"
                    data-testid="v4-nav-group"
                    data-group-id={group.id}
                    data-open={open}
                  >
                    <button
                      type="button"
                      className="v4-sidebar__group-header"
                      aria-expanded={open}
                      onClick={() => handleToggleGroup(group.id)}
                    >
                      <span className="v4-sidebar__group-title">
                        <group.icon
                          className="v4-sidebar__group-icon"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                        <span className="v4-sidebar__group-label">{group.label}</span>
                      </span>
                      {open ? (
                        <ChevronUp
                          className="v4-sidebar__group-chevron"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <ChevronDown
                          className="v4-sidebar__group-chevron"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                      )}
                    </button>
                    {open ? (
                      <div className="v4-sidebar__group-items">
                        {group.items.map((item) => (
                          <NavItem
                            key={item.id}
                            item={item}
                            active={activeId === item.id}
                            motionEnabled={motionEnabled}
                            sweepKey={sweepKey}
                            minimal={false}
                            child
                            onSelect={handleSelect}
                          />
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })
            : null}

          {isProject && minimal ? (
            <div className="v4-sidebar__minimal-groups" data-testid="v4-minimal-groups">
              {PROJECT_NAV_GROUPS.map((group) => {
                const Icon = group.icon;
                const active = group.id === activeGroupId;
                const isOpen = openFlyoutGroupId === group.id;
                return (
                  <div key={group.id} className="v4-sidebar__minimal-group-wrap">
                    {/* H10 (Defect 3): NO V4Tooltip on project group triggers.
                        The contextual flyout is the interaction; a delayed
                        tooltip would produce a detached ghost artifact. The
                        aria-label below remains the mandatory accessible
                        label. Restrained in-place hover feedback comes from
                        the button's own :hover styling. */}
                    <button
                      ref={(el) => {
                        groupTriggerRefs.current[group.id] = el;
                      }}
                      type="button"
                      className={
                        active
                          ? 'v4-nav-item v4-nav-item--active v4-sidebar__minimal-group'
                          : 'v4-nav-item v4-sidebar__minimal-group'
                      }
                      aria-label={group.label}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? 'v4-minimal-flyout' : undefined}
                      onClick={(event) => {
                        flyoutTriggerRef.current = event.currentTarget;
                        handleOpenFlyout(group.id);
                      }}
                    >
                      <span className="v4-nav-item__edge" aria-hidden="true" />
                      <Icon className="v4-nav-item__icon" aria-hidden="true" strokeWidth={1.75} />
                    </button>
                    {/* H13: FLOW-OWNED SUBTREE LANE. When the group is open, a
                        lane is rendered directly after the trigger IN the nav
                        flow. The lane owns the REAL vertical height of the
                        child stack, so the next primary group follows it
                        naturally — no measured spacer. Each subtree row pairs
                        one curved branch with one child row (structural
                        alignment). The child panel itself is rendered as a
                        shell sibling overlay (see below) so it can extend over
                        the workspace without being clipped by the rail. */}
                    {isOpen ? (
                      <div
                        ref={(el) => {
                          subtreeLaneRefs.current[group.id] = el;
                        }}
                        className="v4-sidebar__minimal-subtree"
                        data-testid="v4-minimal-subtree"
                        data-group-id={group.id}
                        data-child-count={group.items.length}
                      >
                        <div
                          className="v4-sidebar__minimal-tree"
                          data-testid="v4-minimal-tree"
                          data-branch-count={group.items.length}
                        >
                          {group.items.map((item, index) => (
                            <div
                              key={item.id}
                              className="v4-sidebar__minimal-subtree-row"
                              data-child-id={item.id}
                              data-branch-index={index}
                            >
                              {/* H14: TREE GUTTER ONLY — the rail subtree lane
                                  carries tree geometry (one curved branch per
                                  child) and NO child label/button. The
                                  contextual flyout is the single Minimal child
                                  presentation. */}
                              <span className="v4-sidebar__minimal-branch" aria-hidden="true" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </nav>

        {/* BOTTOM — fixed. Settings / divider / Work Session / Profile. */}
        <div className="v4-sidebar__footer">
          <NavItem
            item={SETTINGS_NAV_ITEM}
            active={activeId === SETTINGS_NAV_ITEM.id}
            motionEnabled={motionEnabled}
            sweepKey={sweepKey}
            minimal={minimal}
            onSelect={handleSelect}
          />
          <div className="v4-sidebar__footer-divider" aria-hidden="true" />

          {/* Reserved Work Session shell zone (structural inactive anchor). */}
          <div className="v4-sidebar__zone" data-testid="v4-work-session-zone">
            {workSessionSlot ?? (
              <V4Tooltip label="Work Session">
                <div className="v4-sidebar__zone-anchor">
                  <Clock3 className="v4-sidebar__zone-icon" aria-hidden="true" strokeWidth={1.75} />
                  {isExtended ? (
                    <span className="v4-sidebar__zone-label">Work Session</span>
                  ) : (
                    <span className="v4-sidebar__zone-label-sr">Work Session</span>
                  )}
                </div>
              </V4Tooltip>
            )}
          </div>

          {/* Reserved Profile shell zone. */}
          <div className="v4-sidebar__zone" data-testid="v4-profile-zone">
            {profileSlot ?? (
              <V4Tooltip label="Profile">
                <div className="v4-sidebar__profile-anchor">
                  <UserRound
                    className="v4-sidebar__profile-icon"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  {isExtended ? <span className="v4-sidebar__profile-label">Profile</span> : null}
                </div>
              </V4Tooltip>
            )}
          </div>
        </div>
      </aside>

      {/* Floating circular edge toggle — attached to the rail's right edge. */}
      <V4SidebarEdgeToggle mode={mode} onToggle={onToggleMode} />

      {/* Minimal Project contextual child panel (overlay, does not push content).
          Anchored to the open group's flow-owned subtree lane; extends over the
          workspace. The lane owns the vertical flow height, so the next primary
          group follows it naturally. */}
      {isProject && minimal && openFlyoutGroup ? (
        <V4MinimalProjectFlyout
          group={openFlyoutGroup}
          activeChildId={activeId}
          top={subtreeLaneTop}
          onSelectChild={handleFlyoutSelectChild}
          onClose={() => setOpenFlyoutGroupId(null)}
          triggerRef={flyoutTriggerRef}
          isTrigger={(target) => {
            // H10 (Defect 4): clicks on ANY Minimal group trigger are NOT
            // outside clicks — the trigger's own onClick owns the atomic group
            // switch/toggle, so the outside-close handler must ignore them.
            if (!(target instanceof Node)) return false;
            return PROJECT_NAV_GROUPS.some((group) =>
              groupTriggerRefs.current[group.id]?.contains(target),
            );
          }}
        />
      ) : null}
    </div>
  );
}
