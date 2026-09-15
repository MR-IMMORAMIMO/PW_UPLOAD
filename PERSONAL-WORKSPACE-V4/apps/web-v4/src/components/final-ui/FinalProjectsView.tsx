import { V4ResizableTable } from '../common/V4ResizableTable';
import * as InlineGlyphs from '../common/SctIcons';
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
import React, { useRef, useState, useEffect, useDeferredValue } from 'react';
import { readProjectBrowse, writeProjectBrowse } from '../../infrastructure/projectBrowseStorage';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { useLocation } from 'react-router-dom';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isActiveProject, projectStatuses, type Priority as DomainPriority } from '@scli/domain';
import { dashboardProjectFilters } from '../../pages/dashboard/dashboardProjectFilters';
import { calendarDayDistance, dateKeyInTimezone } from '../../pages/dashboard/dashboardViewModel';
import { api } from '../../api/environment';
import { useFinalUiPreferences } from './useFinalUiPreferences';
import type { ProjectsWorkspaceBinding } from '../../pages/projects/ProjectsWorkspaceController';
import { dueCopy, formatProjectTimestamp } from '../../pages/projects/projectsViewModel';
import { formatProjectStatus } from '../project/statusDisplay';
import './referenceUtilities.css';

// ── Data ─────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  code: string;
  name: string;
  client: string;
  type: string;
  status: Status;
  priority: Priority;
  dueDate: string;
  dueDateKey: string;
  dueDaysLabel: string;
  overdue: boolean;
  progress: number;
  folder: FolderStatus;
  folderFiles: number;
  lastUpdated: string;
  starred: boolean;
  activeSession: boolean;
  assignee: string;
}

type Status = string;
type Priority = DomainPriority;
type FolderStatus = 'Ready' | 'Missing' | 'Not Created';
type ViewMode = 'table' | 'kanban' | 'cards';

// ── Color helpers ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<Status, { dot: string; bg: string; text: string }> = {
  Planning: { dot: C.textMid, bg: C.neutralLight, text: C.textDark },
  'In Progress': { dot: C.blue, bg: C.blueLight, text: C.blueDeep },
  'Client Review': { dot: C.violet, bg: C.violetLight, text: C.violetDark },
  'Revision Required': { dot: C.amber, bg: C.amberLight, text: C.amberDark },
  'On Hold': { dot: C.textMuted, bg: C.cardBg, text: C.textMedium },
  Completed: { dot: C.greenMid, bg: C.greenMidLight, text: C.greenDeep },
};

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string }> = {
  Urgent: { bg: C.redLight, text: C.red },
  High: { bg: C.redLight, text: C.red },
  Normal: { bg: C.neutralLight, text: C.textDark },
  Low: { bg: C.greenLight, text: C.greenRunning },
};

const FOLDER_STYLES: Record<FolderStatus, { icon: string; text: string; color: string }> = {
  Ready: { icon: '📁', text: 'Ready', color: '#10b981' },
  Missing: { icon: '📂', text: 'Missing', color: '#f59e0b' },
  'Not Created': { icon: '📁', text: 'Not Created', color: 'var(--v4-text-disabled)' },
};

const STATUS_ORDER: Status[] = [
  'Planning',
  'In Progress',
  'Client Review',
  'Revision Required',
  'On Hold',
  'Completed',
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ProjectMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; run(): void; disabled?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ownerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div ref={ownerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="p-1 rounded hover:bg-gray-100 transition-colors"
      >
        <MoreDotsIcon />
      </button>
      <V4AnchoredSurface
        open={open}
        anchorToTrigger
        ownerRef={ownerRef}
        triggerRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        className="v4-filter-select__menu"
        role="menu"
        ariaLabel={label}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              setOpen(false);
              item.run();
            }}
          >
            {item.label}
          </button>
        ))}
      </V4AnchoredSurface>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.Planning!;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const s = PRIORITY_STYLES[priority];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
      style={{ background: s.bg, color: s.text }}
    >
      {priority}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const barColor = value >= 50 ? C.teal : value >= 20 ? C.amber : C.textMuted;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[60px]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, background: barColor }}
        />
      </div>
      <span className="text-[11px] font-semibold text-gray-500 w-8 text-right flex-shrink-0">
        {value}%
      </span>
    </div>
  );
}

function StarIcon({ filled, onClick }: { filled: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={filled ? 'Remove favorite' : 'Favorite project'}
      aria-pressed={filled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="p-0.5 hover:scale-110 transition-transform"
    >
      <InlineGlyphs.SctFavorite
        className="w-3.5 h-3.5"
        color={filled ? '#f59e0b' : 'var(--v4-border-control)'}
      />
    </button>
  );
}

function MoreDotsIcon() {
  return <ApprovedIcons.more size={16} />;
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
      <div className="relative">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none pl-2.5 pr-6 py-1.5 rounded border border-gray-200 bg-white text-[12px] text-gray-700 font-medium cursor-pointer hover:border-gray-300 transition-colors focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <InlineGlyphs.SctExpand
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none"
          color="currentColor"
        />
      </div>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({
  projects,
  onToggleStar,
  onOpenProject,
  onEdit,
  onOpenFolder,
}: {
  projects: Project[];
  onToggleStar: (id: string) => void;
  onOpenProject?: (p: Project) => void;
  onEdit(p: Project): void;
  onOpenFolder(p: Project): void;
}) {
  const cols = [
    'PROJECT',
    'CLIENT',
    'TYPE',
    'STATUS',
    'PRIORITY',
    'DUE DATE',
    'PROGRESS',
    'FOLDER',
    'LAST UPDATED',
    'ACTIONS',
  ];
  return (
    <div className="overflow-x-auto">
      <V4ResizableTable
        tableKey="FinalProjectsView-1"
        className="w-full text-left border-collapse min-w-[1100px]"
      >
        <thead>
          <tr className="border-b border-gray-100">
            <th className="w-8 py-3 pl-4" />
            <th className="w-8 py-3" />
            {cols.map((c) => (
              <th
                key={c}
                className="py-3 px-3 text-[10px] font-semibold tracking-wider text-gray-400 uppercase whitespace-nowrap"
              >
                {c === 'DUE DATE' ? (
                  <span className="flex items-center gap-1">
                    DUE DATE
                    <InlineGlyphs.SctSort className="w-2.5 h-2.5 text-teal-600" />
                  </span>
                ) : (
                  c
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              className="border-b border-gray-50 hover:bg-gray-50 transition-colors group cursor-pointer"
              onClick={() => onOpenProject?.(p)}
            >
              <td className="pl-4 py-3" onClick={(e) => e.stopPropagation()}>
                <StarIcon filled={p.starred} onClick={() => onToggleStar(p.id)} />
              </td>
              <td className="py-3 pr-1">
                {p.activeSession && (
                  <span
                    className="w-2 h-2 rounded-full bg-teal-500 block animate-pulse"
                    title="Active session"
                  />
                )}
              </td>
              {/* PROJECT */}
              <td className="py-3 px-3 min-w-[220px]">
                <div className="text-[12px] font-semibold text-gray-900 leading-snug">{p.code}</div>
                {p.name && <div className="text-[11px] text-gray-500 leading-snug">{p.name}</div>}
                {p.activeSession && (
                  <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold text-teal-700 bg-teal-50 border border-teal-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                    Active Session
                  </span>
                )}
              </td>
              {/* CLIENT */}
              <td className="py-3 px-3 text-[12px] text-gray-600 whitespace-nowrap">{p.client}</td>
              {/* TYPE */}
              <td className="py-3 px-3 text-[12px] text-gray-600 whitespace-nowrap">{p.type}</td>
              {/* STATUS */}
              <td className="py-3 px-3">
                <StatusBadge status={p.status} />
              </td>
              {/* PRIORITY */}
              <td className="py-3 px-3">
                <PriorityBadge priority={p.priority} />
              </td>
              {/* DUE DATE */}
              <td className="py-3 px-3 min-w-[130px]">
                <div
                  className={`text-[12px] font-medium ${p.overdue ? 'text-orange-500' : 'text-gray-800'}`}
                >
                  {p.dueDate}
                </div>
                <div
                  className={`text-[11px] ${p.overdue ? 'text-orange-400 font-semibold' : 'text-gray-400'}`}
                >
                  {p.dueDaysLabel}
                </div>
              </td>
              {/* PROGRESS */}
              <td className="py-3 px-3 min-w-[120px]">
                <ProgressBar value={p.progress} />
              </td>
              {/* FOLDER */}
              <td className="py-3 px-3 whitespace-nowrap">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Open folder for ${p.name || p.code}`}
                    disabled={p.folder === 'Not Created'}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFolder(p);
                    }}
                  >
                    <InlineGlyphs.SctFolder
                      className="w-3.5 h-3.5 flex-shrink-0"
                      color={FOLDER_STYLES[p.folder].color}
                    />
                  </button>
                  <div>
                    <div
                      className="text-[11px] font-medium"
                      style={{ color: FOLDER_STYLES[p.folder].color }}
                    >
                      {p.folder}
                    </div>
                    {p.folderFiles > 0 && (
                      <div className="text-[10px] text-gray-400">{p.folderFiles} files</div>
                    )}
                    {p.folderFiles === 0 && (
                      <div className="text-[10px] text-gray-400">
                        {p.folder === 'Not Created' ? 'Not created' : '0 indexed files'}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              {/* LAST UPDATED */}
              <td className="py-3 px-3 whitespace-nowrap">
                <div className="text-[11px] text-gray-600">
                  {p.lastUpdated.split(' ').slice(0, 3).join(' ')}
                </div>
                <div className="text-[10px] text-gray-400">
                  {p.lastUpdated.split(' ').slice(3).join(' ')}
                </div>
              </td>
              {/* ACTIONS */}
              <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onOpenProject?.(p)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    Open
                    <InlineGlyphs.SctNext className="w-2.5 h-2.5" color="currentColor" />
                  </button>
                  <ProjectMenu
                    label={`Actions for ${p.name || p.code}`}
                    items={[
                      { label: 'Open Project', run: () => onOpenProject?.(p) },
                      { label: 'Edit Project', run: () => onEdit(p) },
                      {
                        label: 'Open Folder',
                        run: () => onOpenFolder(p),
                        disabled: p.folder === 'Not Created',
                      },
                    ]}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </V4ResizableTable>
    </div>
  );
}

// ── Kanban view ───────────────────────────────────────────────────────────────

function KanbanView({
  projects,
  onProjectsChange,
  onOpenProject,
  onNew,
  group,
}: {
  projects: Project[];
  onProjectsChange: (p: Project[]) => void;
  onOpenProject(p: Project): void;
  onNew(): void;
  group: 'status' | 'priority' | 'client';
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<Status | null>(null);
  const [columnSort, setColumnSort] = useState<Record<string, 'due' | 'priority' | 'name'>>({});

  function handleDragStart(id: string) {
    setDraggingId(id);
    setOverStatus(null);
  }

  function handleDragOver(e: React.DragEvent, status: Status) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverStatus(status);
  }

  function handleDragLeave() {
    setOverStatus(null);
  }

  function handleDrop(targetStatus: Status) {
    if (draggingId == null) return;
    onProjectsChange(
      projects.map((p) => (p.id === draggingId ? { ...p, [group]: targetStatus } : p)),
    );
    setDraggingId(null);
    setOverStatus(null);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setOverStatus(null);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: 500 }}>
      {(group === 'status'
        ? [...new Set([...STATUS_ORDER, ...projects.map((p) => p.status)])]
        : [...new Set(projects.map((p) => p[group]))]
      ).map((status) => {
        const col = projects.filter((p) => p[group] === status);
        const sort = columnSort[status];
        if (sort)
          col.sort((a, b) => {
            if (sort === 'name')
              return a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
            if (sort === 'due')
              return (
                (a.dueDateKey || '9999').localeCompare(b.dueDateKey || '9999') ||
                a.code.localeCompare(b.code)
              );
            const priority = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
            return priority[a.priority] - priority[b.priority] || a.code.localeCompare(b.code);
          });
        const s = STATUS_STYLES[status] ?? STATUS_STYLES.Planning!;
        const isOver = overStatus === status;
        const isDragging = draggingId != null;
        return (
          <div
            key={status}
            role="group"
            aria-label={`${status} projects`}
            className="flex-1 min-w-[260px] flex flex-col"
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(status)}
          >
            {/* Column header */}
            <div
              className="flex items-center justify-between px-3 py-2.5 rounded-t border border-b-0 transition-all duration-200"
              style={{
                background: isOver ? `${s.dot}14` : C.cardBg,
                borderColor: isOver ? s.dot : 'var(--v4-border-subtle)',
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-transform duration-200"
                  style={{ background: s.dot, transform: isOver ? 'scale(1.35)' : 'scale(1)' }}
                />
                <span className="text-[12px] font-semibold text-gray-700">{status}</span>
                <span
                  className="text-[11px] font-semibold rounded-full px-1.5 py-0.5 transition-all duration-200"
                  style={{
                    background: isOver ? s.dot : 'var(--v4-border-subtle)',
                    color: isOver ? '#fff' : 'var(--v4-text-disabled)',
                  }}
                >
                  {col.length}
                </span>
              </div>
              <ProjectMenu
                label={`Sort ${status} projects`}
                items={[
                  {
                    label: 'Due Date',
                    run: () => setColumnSort((current) => ({ ...current, [status]: 'due' })),
                  },
                  {
                    label: 'Priority',
                    run: () => setColumnSort((current) => ({ ...current, [status]: 'priority' })),
                  },
                  {
                    label: 'Name',
                    run: () => setColumnSort((current) => ({ ...current, [status]: 'name' })),
                  },
                ]}
              />
            </div>

            {/* Drop zone */}
            <div
              className="flex-1 rounded-b p-2 space-y-2 transition-all duration-200"
              style={{
                minHeight: 400,
                border: isOver ? `2px dashed ${s.dot}` : '1px solid #e5e7eb',
                background: isOver
                  ? `${s.dot}08`
                  : isDragging
                    ? '#fafafa'
                    : 'rgba(249,250,251,0.5)',
                boxShadow: isOver ? `inset 0 0 0 1px ${s.dot}30` : 'none',
              }}
            >
              {col.map((p) => (
                <KanbanCard
                  key={p.id}
                  project={p}
                  isDragging={draggingId === p.id}
                  anyDragging={isDragging}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onOpen={() => onOpenProject(p)}
                />
              ))}
              {col.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center h-32 transition-all duration-300"
                  style={{
                    color: isOver ? s.dot : 'var(--v4-border-control)',
                    opacity: isOver ? 1 : 0.7,
                  }}
                >
                  <InlineGlyphs.SctPackages className="w-10 h-10 mb-2" color="currentColor" />
                  <span className="text-[11px] font-medium">
                    {isOver ? 'Drop here' : 'No projects'}
                  </span>
                </div>
              )}
              {/* Drop target pulse when dragging over an occupied column */}
              {isOver && col.length > 0 && (
                <div
                  className="h-1.5 rounded-full mx-1 kanban-drop-pulse"
                  style={{ background: s.dot }}
                />
              )}
              <button
                onClick={onNew}
                className="w-full flex items-center gap-1.5 px-2 py-2 rounded text-[12px] text-teal-600 hover:bg-teal-50 transition-colors font-medium"
              >
                <InlineGlyphs.SctAdd className="w-3.5 h-3.5" color="currentColor" />
                Add project
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  project: p,
  isDragging,
  anyDragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  project: Project;
  isDragging: boolean;
  anyDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen(): void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${p.name || p.code}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      draggable
      onDragStart={() => onDragStart(p.id)}
      onDragEnd={onDragEnd}
      className="bg-white rounded-lg border p-3 select-none"
      style={{
        borderColor: isDragging ? '#0d9488' : 'var(--v4-border-subtle)',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.35 : 1,
        transform: isDragging
          ? 'rotate(2deg) scale(0.97)'
          : anyDragging
            ? 'scale(0.99)'
            : 'scale(1)',
        boxShadow: isDragging
          ? '0 20px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.1)'
          : anyDragging
            ? SHADOW.card
            : SHADOW.card,
        transition: isDragging
          ? 'none'
          : 'transform 220ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 220ms ease, opacity 180ms ease, border-color 160ms ease',
        willChange: 'transform, opacity',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-gray-900 leading-snug truncate">{p.code}</p>
          {p.name && <p className="text-[10px] text-gray-500 truncate">{p.name}</p>}
        </div>
        {p.activeSession && (
          <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0 mt-0.5 animate-pulse" />
        )}
      </div>

      <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
        <span className="text-[10px] text-gray-500 font-medium">{p.client}</span>
        <span className="text-gray-300">·</span>
        <span className="text-[10px] text-gray-500">{p.type}</span>
      </div>

      <div
        className={`text-[11px] font-medium mb-2 ${p.overdue ? 'text-orange-500' : 'text-gray-600'}`}
      >
        Due {p.dueDate} ({p.dueDaysLabel})
      </div>

      <ProgressBar value={p.progress} />

      <div className="flex items-center justify-between mt-2.5">
        <PriorityBadge priority={p.priority} />
        <div className="w-6 h-6 rounded-full bg-teal-600 flex items-center justify-center text-[9px] font-bold text-white">
          {p.assignee}
        </div>
      </div>
    </div>
  );
}

// ── Cards / Planner view ──────────────────────────────────────────────────────

function CardsView({
  projects,
  onToggleStar,
  onProjectsChange,
  onOpenProject,
}: {
  projects: Project[];
  onToggleStar: (id: string) => void;
  onProjectsChange: (p: Project[]) => void;
  onOpenProject?: (p: Project) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function handleDragStart(id: string) {
    setDraggingId(id);
  }
  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggingId) setDragOverId(id);
  }
  function handleDrop(targetId: string) {
    if (draggingId == null || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const from = projects.findIndex((p) => p.id === draggingId);
    const to = projects.findIndex((p) => p.id === targetId);
    const next = [...projects];
    const [item] = next.splice(from, 1);
    if (!item || from < 0 || to < 0) return;
    next.splice(to, 0, item);
    onProjectsChange(next);
    setDraggingId(null);
    setDragOverId(null);
  }
  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  const anyDragging = draggingId != null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {projects.map((p) => {
        const s = STATUS_STYLES[p.status] ?? STATUS_STYLES.Planning!;
        const isMe = draggingId === p.id;
        const isOver = dragOverId === p.id;
        return (
          <div
            key={p.id}
            draggable
            onDragStart={() => handleDragStart(p.id)}
            onDragOver={(e) => handleDragOver(e, p.id)}
            onDrop={() => handleDrop(p.id)}
            onDragEnd={handleDragEnd}
            role="button"
            tabIndex={0}
            aria-label={`Open ${p.name}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpenProject?.(p);
            }}
            onClick={() => !draggingId && onOpenProject?.(p)}
            className="bg-white rounded-xl select-none"
            style={{
              border: isOver
                ? `2px solid ${s.dot}`
                : isMe
                  ? '2px solid #0d9488'
                  : '1px solid #e5e7eb',
              cursor: isMe ? 'grabbing' : 'grab',
              opacity: isMe ? 0.3 : 1,
              transform: isMe
                ? 'rotate(1.5deg) scale(0.96)'
                : isOver
                  ? 'scale(1.025) translateY(-3px)'
                  : anyDragging
                    ? 'scale(0.98)'
                    : 'scale(1)',
              boxShadow: isOver
                ? `0 16px 40px ${s.dot}30, 0 4px 12px rgba(0,0,0,0.1)`
                : isMe
                  ? '0 24px 48px rgba(0,0,0,0.2)'
                  : anyDragging
                    ? 'none'
                    : SHADOW.card,
              transition: isMe
                ? 'none'
                : 'transform 260ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 260ms ease, opacity 200ms ease, border-color 160ms ease',
              willChange: 'transform, opacity',
            }}
          >
            {/* Top color strip */}
            <div className="h-1.5 rounded-t-xl" style={{ background: s.dot }} />

            <div className="p-4">
              {/* Header row */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-[12px] font-bold text-gray-900 leading-snug line-clamp-2">
                    {p.code}
                  </p>
                  {p.name && <p className="text-[10px] text-gray-500 mt-0.5">{p.name}</p>}
                </div>
                <StarIcon filled={p.starred} onClick={() => onToggleStar(p.id)} />
              </div>

              {/* Meta */}
              <div className="flex items-center gap-1.5 mb-3 text-[11px] text-gray-500">
                <InlineGlyphs.SctClient
                  className="w-3 h-3 flex-shrink-0 text-gray-400"
                  color="currentColor"
                />
                {p.client}
                <span className="text-gray-300">·</span>
                {p.type}
              </div>

              {/* Status + Priority */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <StatusBadge status={p.status} />
                <PriorityBadge priority={p.priority} />
              </div>

              {/* Progress */}
              <div className="mb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-gray-400 font-medium">Progress</span>
                </div>
                <ProgressBar value={p.progress} />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div>
                  <div
                    className={`text-[11px] font-medium ${p.overdue ? 'text-orange-500' : 'text-gray-600'}`}
                  >
                    {p.dueDate}
                  </div>
                  <div
                    className={`text-[10px] ${p.overdue ? 'text-orange-400 font-semibold' : 'text-gray-400'}`}
                  >
                    {p.dueDaysLabel}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {p.folder === 'Ready' && (
                    <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {p.folderFiles} files
                    </span>
                  )}
                  {p.folder === 'Missing' && (
                    <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                      Missing
                    </span>
                  )}
                  {p.folder === 'Not Created' && (
                    <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      No folder
                    </span>
                  )}
                  <div className="w-6 h-6 rounded-full bg-teal-600 flex items-center justify-center text-[9px] font-bold text-white">
                    {p.assignee}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FinalProjectsView({ binding }: { binding: ProjectsWorkspaceBinding }) {
  const preferences = useFinalUiPreferences();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['v4', 'personal-settings'],
    queryFn: () => api.personalSettings(),
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const openRoot = useMutation({
    mutationFn: async () => {
      let root = settings.data?.projectRoot;
      if (!root) {
        root = (await window.scliDesktop?.selectFolder?.()) ?? undefined;
        if (!root) return;
        await api.updatePersonalSettings({ projectRoot: root });
        await queryClient.invalidateQueries({ queryKey: ['v4', 'personal-settings'] });
      }
      const error = await window.scliDesktop?.openPath?.(root);
      if (typeof error === 'string' && error) throw new Error(error);
    },
    onMutate: () => setLocalError(null),
    onError: (error) => setLocalError(error.message),
  });
  const location = useLocation();
  const [filterNow] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (location.state?.view === 'kanban') return 'kanban';
    try {
      const saved = window.localStorage.getItem('scli.v4.projects.view');
      if (saved === 'kanban' || saved === 'cards') return saved;
    } catch {
      /* Storage may be unavailable in a restricted browser. */
    }
    return 'table';
  });
  const selectViewMode = (next: ViewMode) => {
    setViewMode(next);
    try {
      window.localStorage.setItem('scli.v4.projects.view', next);
    } catch {
      /* Keep the current view usable. */
    }
  };
  const [savedBrowse] = useState(() => readProjectBrowse(binding.preferenceScope));
  const dashboardRequest = new URLSearchParams(location.search).get('dashboard');
  const [search, setSearch] = useState(dashboardRequest ? '' : (savedBrowse?.search ?? ''));
  const deferredSearch = useDeferredValue(search);
  const [requestedPage, setPage] = useState(dashboardRequest ? 1 : (savedBrowse?.page ?? 1));
  const [PER_PAGE, setPerPage] = useState<number>(savedBrowse?.pageSize ?? 10);
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    dashboardRequest
      ? dashboardProjectFilters(dashboardRequest)
      : ((savedBrowse?.filters as Record<string, string>) ?? dashboardProjectFilters(null)),
  );
  const [group, setGroup] = useState<'status' | 'priority' | 'client'>(
    savedBrowse?.group ?? 'status',
  );
  useEffect(() => {
    writeProjectBrowse(binding.preferenceScope, {
      search,
      filters,
      page: requestedPage,
      pageSize: PER_PAGE,
      group,
    });
  }, [binding.preferenceScope, search, filters, requestedPage, PER_PAGE, group]);
  const getPreference = (id: string) =>
    preferences.items.find((item) => item.kind === 'PROJECT' && item.targetId === id);
  const projects: Project[] = binding.projects.map((project) => {
    const due = dueCopy(project.requiredDeliveryDate, new Date());
    return {
      id: project.id,
      code: project.projectCode,
      name: project.projectName,
      client: project.clientName,
      type: project.projectType,
      status: formatProjectStatus(project.status),
      priority: project.priority,
      dueDate: due.label,
      dueDateKey: project.requiredDeliveryDate,
      dueDaysLabel: due.detail,
      overdue:
        due.state === 'overdue' && !['Completed', 'Cancelled', 'Archived'].includes(project.status),
      progress: project.progressPercent,
      folder: project.projectFolderPath ? 'Ready' : 'Not Created',
      folderFiles: project.folderFileCount ?? 0,
      lastUpdated: formatProjectTimestamp(project.updatedAt),
      starred: getPreference(project.id)?.favorite ?? false,
      assignee:
        project.assignedDesignerNameSnapshot
          ?.split(/\s+/)
          .map((word) => word[0])
          .slice(0, 2)
          .join('') || '—',
      activeSession: binding.activeProjectId === project.id,
    };
  });
  function toggleStar(id: string) {
    preferences.update({ kind: 'PROJECT', targetId: id, favorite: !getPreference(id)?.favorite });
  }
  const original = (project: Project) => binding.projects.find((item) => item.id === project.id)!;
  const onOpenProject = (project: Project) => {
    preferences.update({ kind: 'PROJECT', targetId: project.id, markViewed: true });
    binding.callbacks.onOpen(original(project));
  };
  const editMutation = useMutation({
    mutationFn: ({
      project,
      patch,
    }: {
      project: Project;
      patch: { priority?: DomainPriority; clientName?: string };
    }) => api.updateProject(project.id, { ...patch, expectedVersion: original(project).version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'projects', 'list'] });
    },
  });
  function setProjects(next: Project[]) {
    const changed = next.find((project) => {
      const previous = projects.find((item) => item.id === project.id);
      return (
        previous &&
        (project.status !== previous.status ||
          project.priority !== previous.priority ||
          project.client !== previous.client)
      );
    });
    if (changed) {
      const previous = projects.find((project) => project.id === changed.id)!;
      if (changed.status !== previous.status) {
        const target = projectStatuses.find(
          (status) => formatProjectStatus(status) === changed.status,
        );
        if (target) binding.callbacks.onMove(original(changed), target);
      } else
        editMutation.mutate({
          project: changed,
          patch:
            changed.priority !== previous.priority
              ? { priority: changed.priority }
              : { clientName: changed.client },
        });
    } else
      next.forEach((project, rank) =>
        preferences.update({ kind: 'PROJECT', targetId: project.id, rank }),
      );
  }
  const updateFilter = (label: string, value: string) => {
    setFilters((current) => ({ ...current, [label]: value }));
    setPage(1);
  };
  const filtered = projects
    .filter((project) => {
      if (
        deferredSearch &&
        ![project.name, project.code, project.client, project.type].some((value) =>
          value.toLowerCase().includes(deferredSearch.toLowerCase()),
        )
      )
        return false;
      if (filters.Status === 'Active Projects' && !isActiveProject(original(project))) return false;
      if (
        filters.Status &&
        !['All Statuses', 'Active Projects'].includes(filters.Status) &&
        project.status !== filters.Status
      )
        return false;
      if (
        filters.Priority &&
        filters.Priority !== 'All Priorities' &&
        project.priority !== filters.Priority
      )
        return false;
      if (
        filters['Project Type'] &&
        filters['Project Type'] !== 'All Types' &&
        project.type !== filters['Project Type']
      )
        return false;
      const due = original(project).requiredDeliveryDate;
      const days = due ? calendarDayDistance(dateKeyInTimezone(new Date(filterNow)), due) : null;
      if (filters['Due Date'] === 'Overdue' && !project.overdue) return false;
      if (filters['Due Date'] === 'This Week' && (days === null || days < 0 || days > 7))
        return false;
      if (filters['Due Date'] === 'This Month' && (days === null || days < 0 || days > 30))
        return false;
      return true;
    })
    .sort((a, b) => {
      if (viewMode === 'cards')
        return (getPreference(a.id)?.rank ?? 5000) - (getPreference(b.id)?.rank ?? 5000);
      switch (filters['Sort By']) {
        case 'Name':
          return a.name.localeCompare(b.name);
        case 'Progress':
          return b.progress - a.progress;
        case 'Last Updated':
          return original(b).updatedAt.localeCompare(original(a).updatedAt);
        case 'Priority':
          return (
            ['Urgent', 'High', 'Normal', 'Low'].indexOf(a.priority) -
            ['Urgent', 'High', 'Normal', 'Low'].indexOf(b.priority)
          );
        default:
          return original(a).requiredDeliveryDate.localeCompare(original(b).requiredDeliveryDate);
      }
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.min(requestedPage, totalPages);
  const pageProjects = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const feedback =
    binding.error ||
    localError ||
    editMutation.error?.message ||
    preferences.error?.message ||
    binding.feedback;
  const activeFilterCount = [
    search,
    ...Object.entries(filters)
      .filter(
        ([label, value]) =>
          label !== 'Sort By' && !value.startsWith('All ') && value !== 'Any Date',
      )
      .map(([, value]) => value),
  ].filter(Boolean).length;

  const cardStyle = {
    background: C.white,
    borderRadius: RADIUS.section,
    border: `1px solid ${C.border}`,
    boxShadow: SHADOW.card,
  };

  return (
    <div
      className="final-ui-reference flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
      style={{ background: C.pageBg, padding: LAYOUT.sectionGap, gap: LAYOUT.sectionGap }}
    >
      {/* ── Page header card ─────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-4 px-6 py-3 shrink-0 flex-wrap"
        style={cardStyle}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            style={{ background: C.tealLight, borderRadius: RADIUS.icon }}
          >
            <InlineGlyphs.SctProjects className="w-5 h-5" color={C.teal} />
          </div>
          <div>
            <h1 className="text-[20px] font-bold leading-tight" style={{ color: C.text }}>
              Projects
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: C.textMuted }}>
              Browse, manage, and track all your lighting design projects.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            disabled={
              settings.isLoading ||
              settings.isError ||
              openRoot.isPending ||
              !window.scliDesktop?.openPath ||
              (!settings.data?.projectRoot && !window.scliDesktop?.selectFolder)
            }
            onClick={() => openRoot.mutate()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-[13px] font-medium transition-colors hover:bg-gray-50"
            style={{ borderColor: C.border, color: C.textDark }}
          >
            <InlineGlyphs.SctFolder className="w-4 h-4" color="currentColor" />
            Open Folder
          </button>
          <button
            onClick={binding.newProject}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ background: C.teal }}
          >
            <InlineGlyphs.SctAdd className="w-4 h-4" color="currentColor" />
            New Project
          </button>
        </div>
      </div>

      {/* ── Filter bar card ───────────────────────────────── */}
      <div className="flex items-end gap-4 px-6 py-3.5 shrink-0 flex-wrap" style={cardStyle}>
        <div className="relative flex-1 min-w-[220px] max-w-[340px]">
          <InlineGlyphs.SctSearch
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            color={C.textMuted}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search projects"
            maxLength={200}
            placeholder="Search by name, code, client..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-[12px] placeholder-gray-400 focus:outline-none transition-all"
            style={{ border: `1px solid ${C.border}`, color: C.textDark, background: C.white }}
          />
        </div>
        <FilterSelect
          value={filters['Status'] ?? 'All Statuses'}
          onChange={(value) => updateFilter('Status', value)}
          label="Status"
          options={[
            'All Statuses',
            'Active Projects',
            ...new Set([...STATUS_ORDER, ...projects.map((project) => project.status)]),
          ]}
        />
        <FilterSelect
          value={filters['Priority'] ?? 'All Priorities'}
          onChange={(value) => updateFilter('Priority', value)}
          label="Priority"
          options={['All Priorities', 'Urgent', 'High', 'Normal', 'Low']}
        />
        <FilterSelect
          value={filters['Project Type'] ?? 'All Types'}
          onChange={(value) => updateFilter('Project Type', value)}
          label="Project Type"
          options={['All Types', ...new Set(projects.map((project) => project.type))]}
        />
        <FilterSelect
          value={filters['Due Date'] ?? 'Any Date'}
          onChange={(value) => updateFilter('Due Date', value)}
          label="Due Date"
          options={['Any Date', 'This Week', 'This Month', 'Overdue']}
        />
        <FilterSelect
          value={filters['Sort By'] ?? 'Due Date'}
          onChange={(value) => updateFilter('Sort By', value)}
          label="Sort By"
          options={['Due Date', 'Name', 'Progress', 'Last Updated', 'Priority']}
        />
        <button
          onClick={() => {
            setFilters({});
            setSearch('');
            setPage(1);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors hover:bg-gray-50 mt-auto"
          style={{ borderColor: C.border, color: C.textMuted }}
        >
          <InlineGlyphs.SctClear className="w-3.5 h-3.5" color="currentColor" />
          Clear
        </button>
      </div>

      {/* ── Content card (toolbar + view + pagination) ────── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={cardStyle}>
        {/* Toolbar row */}
        <div
          className="flex items-center justify-between px-5 py-2.5 border-b shrink-0"
          style={{ borderColor: C.border }}
        >
          <div className="flex items-center gap-3">
            <InlineGlyphs.SctColumns className="w-4 h-4" color={C.textMuted} />
            <span className="text-[13px] font-semibold" style={{ color: C.text }}>
              {filtered.length} Projects found
            </span>
            <span className="text-[12px]" style={{ color: C.textMuted }}>
              Active filters:{' '}
              <span style={{ color: C.textDark }}>{activeFilterCount || 'None'}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {viewMode === 'kanban' && (
              <div className="flex items-center gap-2 mr-3">
                <span className="text-[12px]" style={{ color: C.textMuted }}>
                  Group by:
                </span>
                <div className="relative">
                  <select
                    aria-label="Group by"
                    value={group}
                    onChange={(event) => setGroup(event.target.value as typeof group)}
                    className="appearance-none pl-2.5 pr-6 py-1.5 rounded border text-[12px] font-medium cursor-pointer focus:outline-none"
                    style={{ borderColor: C.border, color: C.textDark, background: C.white }}
                  >
                    <option value="status">Status</option>
                    <option value="priority">Priority</option>
                    <option value="client">Client</option>
                  </select>
                  <InlineGlyphs.SctExpand
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                    color={C.textMuted}
                  />
                </div>
              </div>
            )}
            <div
              className="flex rounded-lg border overflow-hidden"
              style={{ borderColor: C.border }}
            >
              {(['table', 'kanban', 'cards'] as ViewMode[]).map((mode) => {
                const icons: Record<ViewMode, React.ReactElement> = {
                  table: <InlineGlyphs.SctColumns className="w-3.5 h-3.5" color="currentColor" />,
                  kanban: <InlineGlyphs.SctColumns className="w-3.5 h-3.5" color="currentColor" />,
                  cards: (
                    <InlineGlyphs.SctDistribution className="w-3.5 h-3.5" color="currentColor" />
                  ),
                };
                const labels: Record<ViewMode, string> = {
                  table: 'Table',
                  kanban: 'Board',
                  cards: 'Cards',
                };
                return (
                  <button
                    key={mode}
                    aria-pressed={viewMode === mode}
                    onClick={() => selectViewMode(mode)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors"
                    style={{
                      background: viewMode === mode ? C.white : C.lightBg,
                      color: viewMode === mode ? C.teal : C.textMuted,
                      boxShadow: viewMode === mode ? SHADOW.card : 'none',
                    }}
                  >
                    {icons[mode]}
                    {labels[mode]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* View content */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          {feedback ? <p role="status">{feedback}</p> : null}
          {binding.loading ? <p role="status">Loading projects…</p> : null}
          {binding.error ? <button onClick={binding.retry}>Retry</button> : null}
          {!binding.loading && !binding.error && filtered.length === 0 ? (
            <p role="status">No projects match these filters.</p>
          ) : null}
          {viewMode === 'table' && (
            <TableView
              onEdit={(project) => binding.callbacks.onEdit(original(project))}
              onOpenFolder={(project) => binding.callbacks.onOpenFolder(original(project))}
              projects={pageProjects}
              onToggleStar={toggleStar}
              onOpenProject={onOpenProject}
            />
          )}
          {viewMode === 'kanban' && (
            <KanbanView
              group={group}
              onNew={binding.newProject}
              onOpenProject={onOpenProject}
              projects={filtered}
              onProjectsChange={setProjects}
            />
          )}
          {viewMode === 'cards' && (
            <CardsView
              projects={filtered}
              onToggleStar={toggleStar}
              onProjectsChange={setProjects}
              onOpenProject={onOpenProject}
            />
          )}
        </div>

        {/* Pagination footer (table only) */}
        {viewMode === 'table' && (
          <div
            className="flex items-center justify-between px-6 py-2.5 border-t shrink-0"
            style={{ borderColor: C.border }}
          >
            <div className="flex items-center gap-2 text-[12px]" style={{ color: C.textMuted }}>
              Show
              <select
                aria-label="Rows per page"
                value={PER_PAGE}
                onChange={(event) => {
                  setPerPage(Number(event.target.value));
                  setPage(1);
                }}
                className="border rounded px-2 py-1 text-[12px] focus:outline-none"
                style={{ borderColor: C.border }}
              >
                <option>10</option>
                <option>20</option>
                <option>50</option>
              </select>
              per page
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="w-7 h-7 rounded border flex items-center justify-center transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: C.border, color: C.textMuted }}
              >
                <InlineGlyphs.SctBack className="w-3 h-3" color="currentColor" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setPage(i + 1)}
                  className="w-7 h-7 rounded border text-[12px] font-medium transition-colors"
                  style={
                    page === i + 1
                      ? {
                          background: C.teal,
                          borderColor: C.teal,
                          color: 'var(--v4-action-primary-foreground)',
                        }
                      : { borderColor: C.border, color: C.textDark, background: C.white }
                  }
                >
                  {i + 1}
                </button>
              ))}
              <button
                aria-label="Next page"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="w-7 h-7 rounded border flex items-center justify-center transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: C.border, color: C.textMuted }}
              >
                <InlineGlyphs.SctNext className="w-3 h-3" color="currentColor" />
              </button>
            </div>
            <div className="text-[12px]" style={{ color: C.textMuted }}>
              {filtered.length ? (page - 1) * PER_PAGE + 1 : 0}–
              {Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} projects
            </div>
          </div>
        )}

        {/* Bottom hint */}
        <div
          className="px-6 py-2 border-t shrink-0"
          style={{ borderColor: C.borderLight, background: C.lightBg }}
        >
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: C.textMuted }}>
            <InlineGlyphs.SctInfo className="w-3 h-3 flex-shrink-0" color="currentColor" />
            Drag & drop to reorder · Click a project to open · Use filters to focus on what matters
          </p>
        </div>
      </div>
    </div>
  );
}
