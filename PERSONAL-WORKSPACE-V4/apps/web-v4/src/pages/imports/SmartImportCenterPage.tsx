import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { ImportLibraryComparison } from './ImportLibraryComparison';
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SctBack as ArrowLeft,
  SctCompare as ArrowLeftRight,
  SctNext as ArrowRight,
  SctExclusion as EyeOff,
  SctQueue as List,
  SctQueue as Rows3,
} from '../../components/common/SctIcons';
import { type LucideIcon } from 'lucide-react';
import {
  SctFilter as Filter,
  ChevronDown,
  CircleCheck,
  CircleX,
  Columns3,
  Eye,
  FileSearch,
  SctCsv as FileText,
  FolderOpen,
  History,
  Search,
  Table2,
  Target,
  TriangleAlert,
  Upload,
  Play,
  X,
} from '../../components/common/SctIcons';
import type {
  ImportColumnMapping,
  ImportCanonicalField,
  ImportLibraryAction,
  ImportProjectAction,
} from '@scli/domain';
import { importCanonicalFields } from '@scli/domain';
import type {
  ImportHistoryPage,
  ImportRowRead,
  ImportRowsPage,
  ImportSessionRead,
  ImportSourceTableRead,
  ImportApplyAttemptRead,
} from '@scli/contracts';
import type { Project } from '@scli/domain';
import { api } from '../../api/environment';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Button } from '../../components/common/V4Button';
import { V4AnchoredSurface } from '../../components/interaction/V4AnchoredSurface';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { executeImportSourceHandoff } from '../../desktop/integrations';
import {
  projectRoute,
  ROUTE_LUMINAIRE_LIBRARY,
  ROUTE_PROJECT_LUMINAIRES,
} from '../../router/routes';
import './smartImportCenter.css';

type RowFilter =
  'ALL' | 'READY' | 'NEEDS_REVIEW' | 'BLOCKED' | 'FAILED' | 'UNMAPPED' | 'MAPPING_CONFLICT';
type ImportViewStep = 'UPLOAD' | 'INSPECT' | 'MAP' | 'RECONCILE' | 'APPLY';
const FILTERS: Array<{ value: RowFilter; label: string; icon: LucideIcon; tone: string }> = [
  { value: 'ALL', label: 'All', icon: List, tone: 'neutral' },
  { value: 'READY', label: 'Ready', icon: CircleCheck, tone: 'ready' },
  { value: 'NEEDS_REVIEW', label: 'Needs Review', icon: TriangleAlert, tone: 'review' },
  { value: 'BLOCKED', label: 'Blocked', icon: CircleX, tone: 'blocked' },
  { value: 'FAILED', label: 'Failed', icon: CircleX, tone: 'blocked' },
  { value: 'UNMAPPED', label: 'Unmapped', icon: Columns3, tone: 'unmapped' },
  {
    value: 'MAPPING_CONFLICT',
    label: 'Mapping Conflict',
    icon: ArrowLeftRight,
    tone: 'conflict',
  },
];
const FIELD_LABELS: Record<ImportCanonicalField, string> = Object.fromEntries(
  importCanonicalFields.map((field) => [
    field,
    field.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
  ]),
) as Record<ImportCanonicalField, string>;

const PROJECT_EVIDENCE_FIELDS = new Set<ImportCanonicalField>([
  'TAG',
  'PROJECT_CATEGORY',
  'LOCATION',
  'UNIT',
  'QUANTITY',
  'NOTES',
  'DESCRIPTION_OVERRIDE',
  'PRODUCT_IMAGE',
  'DATASHEET',
  'IES',
  'LDT',
]);

type LibraryWorkflowStage =
  | 'MAPPING_REVIEW_REQUIRED'
  | 'READY_TO_RECONCILE'
  | 'RECONCILIATION_STALE'
  | 'OWNER_ACTION_REQUIRED'
  | 'BLOCKED'
  | 'APPLY_READY'
  | 'APPLIED';

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function rowTitle(row: ImportRowRead): string {
  const mapped = row.mappedCandidate as Record<
    string,
    { normalizedValue?: unknown; rawValue?: unknown }
  >;
  return String(
    mapped.TAG?.normalizedValue ??
      mapped.ORDERING_CODE?.normalizedValue ??
      mapped.PRODUCT_FAMILY?.normalizedValue ??
      `Source row ${row.sourceRowNumber}`,
  );
}

function mappedValue(row: ImportRowRead, field: ImportCanonicalField): string {
  const candidate = row.mappedCandidate[field] as
    { normalizedValue?: unknown; rawValue?: unknown } | undefined;
  const value = candidate?.normalizedValue ?? candidate?.rawValue;
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function proposedMatch(row: ImportRowRead): string {
  const reconciliation = row.reconciliation;
  if (reconciliation?.schemaVersion === 1) {
    if (reconciliation.exactLibraryMatch)
      return `${reconciliation.exactLibraryMatch.manufacturerName} · ${reconciliation.exactLibraryMatch.productName}`;
    if (reconciliation.possibleLibraryMatches.length)
      return `${reconciliation.possibleLibraryMatches.length} possible matches`;
  }
  if (reconciliation?.schemaVersion === 2) {
    if (reconciliation.variant.exactMatch) return reconciliation.variant.exactMatch.variantLabel;
    if (reconciliation.variant.possibleMatches.length)
      return `${reconciliation.variant.possibleMatches.length} possible matches`;
  }
  return 'No authoritative match';
}

function matchQuality(row: ImportRowRead): string {
  const reconciliation = row.reconciliation;
  if (
    (reconciliation?.schemaVersion === 1 && reconciliation.exactLibraryMatch) ||
    (reconciliation?.schemaVersion === 2 && reconciliation.variant.exactMatch)
  )
    return 'Exact';
  if (
    (reconciliation?.schemaVersion === 1 && reconciliation.possibleLibraryMatches.length) ||
    (reconciliation?.schemaVersion === 2 && reconciliation.variant.possibleMatches.length)
  )
    return 'Candidate';
  return 'Unresolved';
}

type ImportSelectOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
};

function ImportSelectControl({
  label,
  value,
  options,
  icon: Icon,
  onChange,
  disabled = false,
  compact = false,
}: {
  label: string;
  value: string;
  options: readonly ImportSelectOption[];
  icon: LucideIcon;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex] ?? { value: '', label: 'Unavailable' };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const viewportPadding = 12;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(160, Math.min(380, openAbove ? spaceAbove - gap : spaceBelow));
      const width = Math.min(
        Math.max(rect.width, compact ? 240 : 280),
        window.innerWidth - viewportPadding * 2,
      );
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        window.innerWidth - width - viewportPadding,
      );
      setMenuStyle({
        left,
        top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap,
        width,
        maxHeight,
      });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [compact, open]);

  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = window.setTimeout(() => optionRefs.current[selectedIndex]?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open, selectedIndex]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (option: ImportSelectOption) => {
    onChange(option.value);
    close();
  };
  const moveFocus = (index: number, offset: number) => {
    const nextIndex = (index + offset + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };
  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(index, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      optionRefs.current[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    }
  };

  return (
    <div ref={rootRef} className={`v4-imports__select-control${compact ? ' is-compact' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${selected.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          }
        }}
      >
        <Icon aria-hidden="true" data-control-icon={label} />
        <span>
          <small>{label}</small>
          <strong>{selected.label}</strong>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      <V4AnchoredSurface
        open={open}
        id={listboxId}
        ownerRef={rootRef}
        triggerRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        className="v4-imports__select-menu"
        role="listbox"
        ariaLabel={`${label} options`}
        style={menuStyle}
      >
        {options.map((option, index) => (
          <Fragment key={option.value || '__empty'}>
            {option.group && option.group !== options[index - 1]?.group ? (
              <div className="v4-imports__select-group" role="presentation">
                {option.group}
              </div>
            ) : null}
            <button
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => choose(option)}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
            >
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          </Fragment>
        ))}
      </V4AnchoredSurface>
    </div>
  );
}

function rowStatusIcon(status: ImportRowRead['rowStatus'] | LibraryWorkflowStage): LucideIcon {
  if (['READY', 'APPLIED', 'SKIPPED', 'READY_TO_RECONCILE', 'APPLY_READY'].includes(status))
    return CircleCheck;
  if (status === 'BLOCKED') return CircleX;
  return TriangleAlert;
}

function libraryWorkflowStage(
  row: ImportRowRead,
  session: ImportSessionRead | null,
  table: ImportSourceTableRead | undefined,
): LibraryWorkflowStage {
  if (row.applyState === 'APPLIED' || row.rowStatus === 'APPLIED') return 'APPLIED';
  const reconciliation = row.reconciliation?.schemaVersion === 2 ? row.reconciliation : null;
  if (!reconciliation) {
    if (row.rowStatus === 'BLOCKED') return 'BLOCKED';
    return row.rowStatus === 'READY' ? 'READY_TO_RECONCILE' : 'MAPPING_REVIEW_REQUIRED';
  }
  if (
    reconciliation.inspectionFingerprint !== session?.previewFingerprint ||
    reconciliation.destinationFingerprint !== session?.destinationFingerprint ||
    reconciliation.mappingFingerprint !== table?.mappingFingerprint
  )
    return 'RECONCILIATION_STALE';
  if (row.intendedAction && (row.rowStatus === 'READY' || row.rowStatus === 'SKIPPED'))
    return 'APPLY_READY';
  if (row.rowStatus === 'BLOCKED') return 'BLOCKED';
  return 'OWNER_ACTION_REQUIRED';
}

function workflowFilterLabel(
  filter: RowFilter,
  session: ImportSessionRead | null,
  rows: ImportRowsPage | null,
): string {
  const hasLibraryReconciliation =
    session?.destinationMode === 'MASTER_LIBRARY' &&
    Boolean(rows?.items.some((row) => row.reconciliation?.schemaVersion === 2));
  if (session?.destinationMode !== 'MASTER_LIBRARY')
    return FILTERS.find((item) => item.value === filter)?.label ?? statusLabel(filter);
  if (filter === 'READY') return hasLibraryReconciliation ? 'Apply ready' : 'Ready to reconcile';
  if (filter === 'NEEDS_REVIEW')
    return hasLibraryReconciliation ? 'Owner action required' : 'Mapping review required';
  return FILTERS.find((item) => item.value === filter)?.label ?? statusLabel(filter);
}

function filterCount(filter: RowFilter, rows: ImportRowsPage | null): number {
  if (!rows) return 0;
  if (filter === 'ALL') return rows.counts.all;
  if (filter === 'READY') return rows.counts.ready;
  if (filter === 'NEEDS_REVIEW') return rows.counts.needsReview;
  if (filter === 'BLOCKED') return rows.counts.blocked;
  if (filter === 'FAILED') return rows.counts.failed;
  if (filter === 'UNMAPPED') return rows.counts.unmapped;
  return rows.counts.mappingConflict;
}

export function SmartImportCenterPage() {
  const navigate = useNavigate();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [destinationMode, setDestinationMode] = useState<'PROJECT' | 'MASTER_LIBRARY'>('PROJECT');
  const [projectId, setProjectId] = useState('');
  const [session, setSession] = useState<ImportSessionRead | null>(null);
  const [tables, setTables] = useState<ImportSourceTableRead[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRowsPage | null>(null);
  const [selectedRow, setSelectedRow] = useState<ImportRowRead | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkFields, setBulkFields] = useState({
    category: '',
    location: '',
    unit: '',
    quantity: '',
  });
  const [filter, setFilter] = useState<RowFilter>('ALL');
  const [rowSearch, setRowSearch] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [page, setPage] = useState(0);
  const [viewStep, setViewStep] = useState<ImportViewStep>('RECONCILE');
  const [history, setHistory] = useState<ImportHistoryPage | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState<'HISTORY' | 'QUEUE' | 'SOURCES'>('HISTORY');
  const [manufacturers, setManufacturers] = useState<{ manufacturerId: string; name: string }[]>(
    [],
  );
  const [attempts, setAttempts] = useState<ImportApplyAttemptRead[]>([]);
  const [confirmApply, setConfirmApply] = useState<'ALL' | 'READY_ONLY' | null>(null);
  const [applyProgress, setApplyProgress] = useState<{ applied: number; total: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const historyClose = useRef<HTMLButtonElement>(null);
  const refreshSequence = useRef(0);

  const loadHistory = async () => {
    const first = await api.importHistory({ limit: '50' });
    const items = [...first.items];
    for (let nextPage = 1; items.length < first.totalCount; nextPage += 1) {
      const next = await api.importHistory({ limit: '50', page: String(nextPage) });
      if (!next.items.length) break;
      items.push(...next.items);
    }
    setHistory({ ...first, items });
  };
  const openHistory = async (mode: 'HISTORY' | 'QUEUE' | 'SOURCES' = 'HISTORY') => {
    setError(null);
    try {
      await loadHistory();
      setHistoryMode(mode);
      setHistoryOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import History could not load.');
    }
  };
  useEffect(() => {
    void Promise.all([
      api.projects({}).then((items) => {
        setProjects(items);
        setProjectId((current) => current || items[0]?.id || '');
      }),
      loadHistory(),
    ]).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Smart Import could not load.'),
    );
  }, []);

  useEffect(() => {
    if (!historyOpen) return undefined;
    historyClose.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryOpen(false);
        historyTrigger.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOpen]);

  const refreshSession = async (
    id: string,
    nextFilter = filter,
    nextPage = page,
    sourceTableId = session?.importSessionId === id ? (activeTableId ?? undefined) : undefined,
    search = rowSearch,
    quality = qualityFilter,
  ) => {
    const sequence = ++refreshSequence.current;
    const isDifferentSession = session?.importSessionId !== id;
    if (isDifferentSession) {
      nextFilter = 'ALL';
      nextPage = 0;
      sourceTableId = undefined;
      search = '';
      quality = '';
    }
    const [nextSession, nextTables, nextRows, nextAttempts] = await Promise.all([
      api.importSession(id),
      api.importTables(id),
      api.importRows(id, {
        filter: nextFilter,
        page: String(nextPage),
        limit: '50',
        ...(sourceTableId ? { sourceTableId } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(quality ? { matchQuality: quality } : {}),
      }),
      api.importApplyAttempts(id),
    ]);
    if (sequence !== refreshSequence.current) return;
    if (isDifferentSession) {
      setFilter('ALL');
      setPage(0);
      setRowSearch('');
      setQualityFilter('');
    }
    const hasTerminalAttempt = nextAttempts.some((attempt) =>
      ['SUCCEEDED', 'PARTIALLY_APPLIED', 'FAILED', 'ABANDONED'].includes(attempt.state),
    );
    if (session?.importSessionId && isDifferentSession) setSelectedRowIds(new Set());
    if (hasTerminalAttempt && isDifferentSession) setViewStep('APPLY');
    else if (isDifferentSession) setViewStep(nextSession.sourceFileName ? 'RECONCILE' : 'UPLOAD');
    setSession(nextSession);
    setDestinationMode(nextSession.destinationMode);
    if (nextSession.projectId) setProjectId(nextSession.projectId);
    setTables(nextTables);
    setActiveTableId((current) =>
      nextTables.some((table) => table.sourceTableId === current)
        ? current
        : (nextTables.find((table) => table.selected)?.sourceTableId ??
          nextTables[0]?.sourceTableId ??
          null),
    );
    setRows(nextRows);
    setAttempts(nextAttempts);
    setSelectedRow(
      (current) =>
        nextRows.items.find((row) => row.importRowId === current?.importRowId) ??
        nextRows.items[0] ??
        null,
    );
  };

  const createAndSelectSource = async () => {
    setViewStep('UPLOAD');
    setBusy(true);
    setError(null);
    let createdId: string | null = null;
    try {
      const created = await api.createImportSession({
        destinationMode,
        projectId: destinationMode === 'PROJECT' ? projectId : null,
      });
      setSession(created);
      createdId = created.importSessionId;
      if (window.scliDesktop?.executeDesktopHandoff) {
        const handoff = await api.createImportSourceHandoff(created.importSessionId);
        const result = await executeImportSourceHandoff(handoff);
        if (result === 'accepted') {
          const inspected = await api.completeImportSourceHandoff(created.importSessionId);
          await refreshSession(inspected.importSessionId);
          await loadHistory();
          return;
        }
        if (result === 'cancelled') {
          await api.cancelImportSelection(created.importSessionId);
          setSession(null);
          setTables([]);
          setRows(null);
          await loadHistory();
          return;
        }
      }
      fileInput.current?.click();
    } catch (reason) {
      if (createdId) {
        try {
          // The server permits cancellation only before source admission. Never discard an accepted source.
          await api.cancelImportSelection(createdId);
          setSession(null);
          setTables([]);
          setRows(null);
          await loadHistory();
        } catch {
          // Keep an admitted or uncertain session available for inspection and retry.
        }
      }
      setError(reason instanceof Error ? reason.message : 'The source could not be selected.');
    } finally {
      setBusy(false);
    }
  };

  const uploadBrowserSource = async (file: File | undefined) => {
    if (!file || !session) return;
    setBusy(true);
    setError(null);
    try {
      const inspected = await api.uploadImportSource(session.importSessionId, file.name, file);
      await refreshSession(inspected.importSessionId);
      await loadHistory();
      setViewStep('RECONCILE');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The source could not be inspected.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const cancelBrowserSelection = async () => {
    if (!session || session.sourceSha256) return;
    try {
      await api.cancelImportSelection(session.importSessionId);
      setSession(null);
      setTables([]);
      setRows(null);
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Selection could not be cancelled.');
    }
  };

  useEffect(() => {
    const input = fileInput.current;
    const cancel = () => {
      void cancelBrowserSelection();
    };
    input?.addEventListener('cancel', cancel);
    return () => input?.removeEventListener('cancel', cancel);
  });

  const applyTableUpdate = async (
    table: ImportSourceTableRead,
    change: Partial<{ selected: boolean; headerRow: number; mapping: ImportColumnMapping[] }>,
  ) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateImportTable(session.importSessionId, table.sourceTableId, {
        ...change,
        expectedRowVersion: table.rowVersion,
        expectedSessionRevision: session.sessionRevision,
      });
      const reinspected = await api.reinspectImportSession(session.importSessionId, {
        expectedSessionRevision: session.sessionRevision + 1,
      });
      await refreshSession(reinspected.importSessionId);
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The mapping could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const setRowFilter = async (next: RowFilter) => {
    setFilter(next);
    setPage(0);
    if (!session) return;
    setBusy(true);
    try {
      await refreshSession(session.importSessionId, next, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rows could not be filtered.');
    } finally {
      setBusy(false);
    }
  };
  const setRowPage = async (nextPage: number) => {
    if (!session || nextPage < 0) return;
    setPage(nextPage);
    setBusy(true);
    try {
      await refreshSession(session.importSessionId, filter, nextPage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rows could not be paged.');
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    if (!session?.previewFingerprint) return;
    setBusy(true);
    setError(null);
    try {
      await api.reconcileImportSession(session.importSessionId, {
        expectedSessionRevision: session.sessionRevision,
        expectedPreviewFingerprint: session.previewFingerprint,
      });
      await refreshSession(session.importSessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rows could not be reconciled.');
    } finally {
      setBusy(false);
    }
  };

  const chooseRowAction = async (
    type: ImportProjectAction | ImportLibraryAction,
    versionId?: string,
  ) => {
    if (!session || !selectedRow) return;
    setBusy(true);
    setError(null);
    try {
      const action =
        type === 'PROJECT_ADD_FROM_LIBRARY'
          ? {
              type,
              versionId:
                versionId ??
                (selectedRow.reconciliation?.schemaVersion === 1
                  ? selectedRow.reconciliation.selectedLibraryVersionId
                  : '') ??
                '',
            }
          : type === 'SKIP'
            ? { type, reason: 'Owner skipped during Project Apply review.' }
            : { type };
      await api.updateImportRowAction(session.importSessionId, selectedRow.importRowId, {
        expectedSessionRevision: session.sessionRevision,
        expectedRowVersion: selectedRow.rowVersion,
        action,
      });
      await refreshSession(session.importSessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The row action could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const toggleRowSelection = (rowId: string) => {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else if (next.size < 500) next.add(rowId);
      return next;
    });
  };

  const selectVisibleRows = () => {
    if (!rows) return;
    setSelectedRowIds((current) => {
      const next = new Set(current);
      for (const row of rows.items) {
        if (next.size >= 500) break;
        if (row.applyState !== 'APPLIED') next.add(row.importRowId);
      }
      return next;
    });
  };

  const applyBulkAction = async (
    action:
      | 'PROJECT_CREATE_ONLY'
      | 'PROJECT_ADD_FROM_LIBRARY'
      | 'LIBRARY_CREATE_DRAFT'
      | 'LIBRARY_USE_EXISTING'
      | 'SKIP',
  ) => {
    if (!session || selectedRowIds.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.bulkUpdateImportRowActions(session.importSessionId, {
        expectedSessionRevision: session.sessionRevision,
        rowIds: [...selectedRowIds],
        action,
      });
      setSelectedRowIds(new Set());
      setBulkAction('');
      await refreshSession(session.importSessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The bulk action could not be saved.');
      setBulkAction('');
    } finally {
      setBusy(false);
    }
  };

  const decideManufacturerCreate = async (manufacturerGroupId: string, manufacturerId?: string) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.decideImportLibraryGroup(session.importSessionId, {
        kind: 'MANUFACTURER',
        expectedSessionRevision: session.sessionRevision,
        manufacturerGroupId,
        decision: manufacturerId ? { mode: 'USE_EXISTING', manufacturerId } : { mode: 'CREATE' },
      });
      await refreshSession(session.importSessionId);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'The Manufacturer decision could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };

  const loadManufacturers = async () => {
    try {
      const first = await api.luminaireLibraryManufacturers({ status: 'ACTIVE', limit: '100' });
      const items = [...first.items];
      let cursor = first.nextCursor;
      while (cursor) {
        const next = await api.luminaireLibraryManufacturers({
          status: 'ACTIVE',
          limit: '100',
          cursor,
        });
        items.push(...next.items);
        cursor = next.nextCursor;
      }
      setManufacturers(items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Manufacturers could not load.');
    }
  };

  const decideProductMetadata = async (
    productGroupId: string,
    field: 'productType' | 'description',
    value: string,
  ) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.decideImportLibraryGroup(session.importSessionId, {
        kind: 'PRODUCT',
        expectedSessionRevision: session.sessionRevision,
        productGroupId,
        decision: { [field]: value },
      });
      await refreshSession(session.importSessionId);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'The Product decision could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };

  const applyBulkFields = async () => {
    if (!session || selectedRowIds.size === 0) return;
    const projectFields: {
      category?: string;
      location?: string;
      unit?: string;
      quantity?: number;
    } = {};
    if (bulkFields.category.trim()) projectFields.category = bulkFields.category.trim();
    if (bulkFields.location.trim()) projectFields.location = bulkFields.location.trim();
    if (bulkFields.unit.trim()) projectFields.unit = bulkFields.unit.trim();
    if (bulkFields.quantity.trim()) {
      const quantity = Number(bulkFields.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        setError('Bulk Quantity must be a non-negative number.');
        return;
      }
      projectFields.quantity = quantity;
    }
    if (Object.keys(projectFields).length === 0) {
      setError('Enter at least one planned Project field.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.bulkUpdateImportRowActions(session.importSessionId, {
        expectedSessionRevision: session.sessionRevision,
        rowIds: [...selectedRowIds],
        projectFields,
      });
      setSelectedRowIds(new Set());
      setBulkFields({ category: '', location: '', unit: '', quantity: '' });
      await refreshSession(session.importSessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The bulk fields could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async () => {
    if (
      !session?.previewFingerprint ||
      !session.destinationFingerprint ||
      !session.applyPlanFingerprint ||
      !confirmApply
    )
      return;
    setBusy(true);
    const total =
      (session.applyPlan.readyMutations ?? 0) +
      (session.applyPlan.useExistingLibrary ?? 0) +
      (session.applyPlan.skip ?? 0);
    setApplyProgress({ applied: 0, total });
    setError(null);
    try {
      await api.applyImportSession(session.importSessionId, {
        expectedSessionRevision: session.sessionRevision,
        previewFingerprint: session.previewFingerprint,
        destinationFingerprint: session.destinationFingerprint,
        applyPlanFingerprint: session.applyPlanFingerprint,
        idempotencyKey: crypto.randomUUID(),
        mode: confirmApply,
        confirmPartial: confirmApply === 'READY_ONLY',
      });
      setApplyProgress({
        applied: total,
        total,
      });
      setConfirmApply(null);
      await refreshSession(session.importSessionId);
      setViewStep('APPLY');
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import Apply did not complete.');
    } finally {
      setBusy(false);
      setApplyProgress(null);
    }
  };
  const selectedTable =
    tables.find((table) => table.sourceTableId === activeTableId) ??
    tables.find((table) => table.selected) ??
    tables[0] ??
    null;
  const activeDestination = session?.destinationMode ?? destinationMode;
  const summary = session?.sourceFileName
    ? `${session.sourceExtension?.slice(1).toUpperCase()} · ${selectedTable?.tableName ?? 'No table selected'} · ${selectedTable?.headerRow ? `Header row ${selectedTable.headerRow}` : 'Header review required'} · ${session.counts.total} rows`
    : 'Choose a bounded CSV, TSV, or XLSX source to begin inspection.';
  const mappingDecisions = useMemo(
    () =>
      tables
        .flatMap((table) => table.mapping)
        .filter((mapping) => mapping.confidence === 'CONFLICT' || mapping.confidence === 'MEDIUM')
        .length,
    [tables],
  );
  const mappingOptions: ImportSelectOption[] = [
    ...importCanonicalFields
      .filter((field) => !PROJECT_EVIDENCE_FIELDS.has(field))
      .map((field) => ({ value: field, label: FIELD_LABELS[field], group: 'Library fields' })),
    ...importCanonicalFields
      .filter((field) => PROJECT_EVIDENCE_FIELDS.has(field))
      .map((field) => ({
        value: field,
        label: FIELD_LABELS[field],
        group: 'Project-only evidence',
      })),
    { value: '', label: 'Unmapped', group: 'Unmapped' },
  ];
  const terminalAttempt = attempts.find((item) =>
    ['SUCCEEDED', 'PARTIALLY_APPLIED', 'FAILED', 'ABANDONED'].includes(item.state),
  );
  const queuedSessions =
    history?.items.filter(
      (item) =>
        item.sourceFileName && !['COMPLETED', 'FAILED', 'ABANDONED'].includes(item.sessionStatus),
    ) ?? [];
  const queuedRows = queuedSessions.reduce((total, item) => total + item.counts.total, 0);
  const needsMapping =
    rows?.counts.needsMapping ??
    Math.max(rows?.counts.unmapped ?? 0, rows?.counts.mappingConflict ?? 0);
  const mappingHighCount =
    selectedTable?.mapping.filter((mapping) => mapping.confidence === 'HIGH').length ?? 0;
  const mappingConfidence = selectedTable?.mapping.length
    ? Math.round((mappingHighCount / selectedTable.mapping.length) * 100)
    : 0;
  const selectedProjectReconciliation =
    selectedRow?.reconciliation?.schemaVersion === 1 ? selectedRow.reconciliation : null;
  const selectedLibraryReconciliation =
    selectedRow?.reconciliation?.schemaVersion === 2 ? selectedRow.reconciliation : null;
  const selectedLibraryResult =
    selectedRow?.resultIdentity?.schemaVersion === 2 ? selectedRow.resultIdentity : null;
  const libraryGroups = useMemo(() => {
    const libraryRows = rows?.items.filter((row) => row.reconciliation?.schemaVersion === 2) ?? [];
    const manufacturers = new Map<
      string,
      {
        reconciliation: Extract<NonNullable<ImportRowRead['reconciliation']>, { schemaVersion: 2 }>;
        rowCount: number;
        products: Map<
          string,
          {
            rowCount: number;
            reconciliation: Extract<
              NonNullable<ImportRowRead['reconciliation']>,
              { schemaVersion: 2 }
            >;
          }
        >;
      }
    >();
    for (const row of libraryRows) {
      const reconciliation = row.reconciliation;
      if (!reconciliation || reconciliation.schemaVersion !== 2) continue;
      const group = manufacturers.get(reconciliation.manufacturer.manufacturerGroupId) ?? {
        reconciliation,
        rowCount: 0,
        products: new Map(),
      };
      group.rowCount += 1;
      const product = group.products.get(reconciliation.product.productGroupId) ?? {
        rowCount: 0,
        reconciliation,
      };
      product.rowCount += 1;
      group.products.set(reconciliation.product.productGroupId, product);
      manufacturers.set(reconciliation.manufacturer.manufacturerGroupId, group);
    }
    return [...manufacturers.values()];
  }, [rows]);
  const plannedApplyRows = session
    ? (session.applyPlan.readyMutations ?? 0) +
      (session.applyPlan.useExistingLibrary ?? 0) +
      (session.applyPlan.skip ?? 0)
    : 0;
  const selectedVisibleRows =
    rows?.items.filter((row) => selectedRowIds.has(row.importRowId)) ?? [];
  const selectedLibraryRowsReconciled =
    selectedVisibleRows.length > 0 &&
    selectedVisibleRows.every((row) => row.reconciliation?.schemaVersion === 2);
  const eligibleLibraryBulkActions = (
    ['LIBRARY_CREATE_DRAFT', 'LIBRARY_USE_EXISTING', 'SKIP'] as const
  ).filter((action) =>
    selectedVisibleRows.every(
      (row) =>
        row.reconciliation?.schemaVersion === 2 &&
        row.reconciliation.allowedActions.includes(action),
    ),
  );
  const selectedWorkflowStage =
    selectedRow && session?.destinationMode === 'MASTER_LIBRARY'
      ? libraryWorkflowStage(
          selectedRow,
          session,
          tables.find((table) => table.sourceTableId === selectedRow.sourceTableId),
        )
      : null;
  const hasLibraryReconciliation = Boolean(
    rows?.items.some((row) => row.reconciliation?.schemaVersion === 2),
  );
  const workflowSummary =
    session?.destinationMode !== 'MASTER_LIBRARY' || !session.sourceSha256
      ? null
      : !hasLibraryReconciliation
        ? session.counts.ready > 0
          ? `Ready to reconcile · ${session.counts.ready} rows. Reconcile Library before choosing an action.`
          : `Mapping review required · ${session.counts.review} rows need mapping decisions.`
        : plannedApplyRows > 0
          ? `Apply ready · ${plannedApplyRows} rows have eligible Owner actions.`
          : `Owner action required · ${session.applyPlan.unresolved} unresolved and ${session.applyPlan.blocked} blocked.`;

  return (
    <V4AppShell
      context="global"
      sidebarMode={sidebarMode}
      activeSectionId="imports"
      boundedPage
      onToggleSidebarMode={() =>
        setSidebarMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      pageHeader={
        <V4PageHeader
          title="Smart Import Center"
          description={
            activeDestination === 'MASTER_LIBRARY'
              ? 'Master Library Draft import with Owner reconciliation. Publish: NO · Published Versions created: 0.'
              : 'Persistent inspection, Owner reconciliation, and verified Project Apply.'
          }
          icon={FileSearch}
          actions={
            <>
              <V4Button
                variant="primary"
                leadingIcon={<Upload />}
                onClick={() => void createAndSelectSource()}
                disabled={busy || (destinationMode === 'PROJECT' && !projectId)}
              >
                New Import
              </V4Button>
              <V4Button
                ref={historyTrigger}
                leadingIcon={<History />}
                onClick={() => void openHistory()}
              >
                Import History
              </V4Button>
            </>
          }
        />
      }
    >
      <main className="v4-imports">
        <div className="v4-imports__shell">
          <aside className="v4-imports__rail" aria-label="Smart Import navigation">
            <h3>Smart Import</h3>
            <nav className="v4-imports__nav" aria-label="Smart Import sections">
              <button type="button" className="is-active" aria-current="page">
                <FileSearch aria-hidden="true" /> Import Center
              </button>
              <button type="button" onClick={() => void openHistory('QUEUE')}>
                <Upload aria-hidden="true" /> File Queue
                {history?.items.length ? (
                  <span className="v4-imports__badge">{queuedSessions.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                disabled={!session?.sourceSha256}
                onClick={() => setViewStep('MAP')}
              >
                <Columns3 aria-hidden="true" /> Mapping Rules
              </button>
              <button type="button" onClick={() => void openHistory()}>
                <History aria-hidden="true" /> Import History
              </button>
              <button type="button" onClick={() => void openHistory('SOURCES')}>
                <FolderOpen aria-hidden="true" /> Data Sources
              </button>
            </nav>
            <div className="v4-imports__recent">
              <span className="v4-imports__panel-title">Recent Imports</span>
              {history?.items.slice(0, 4).map((item) => (
                <button
                  key={item.importSessionId}
                  type="button"
                  className="v4-imports__recent-card"
                  onClick={() => void refreshSession(item.importSessionId)}
                >
                  <span className="v4-imports__file-badge">
                    <FileText aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{item.sourceFileName ?? 'New inspection'}</strong>
                    <small>
                      {item.counts.total} rows · {formatBusinessDateTime(item.createdAt)}
                    </small>
                  </span>
                  <span
                    className={`v4-imports__pill is-${item.sessionStatus === 'COMPLETED' ? 'green' : item.sessionStatus === 'FAILED' ? 'red' : 'amber'}`}
                  >
                    {statusLabel(item.sessionStatus)}
                  </span>
                </button>
              ))}
              {history?.items.length ? (
                <button
                  type="button"
                  className="v4-imports__recent-all"
                  onClick={() => void openHistory()}
                >
                  View all history
                </button>
              ) : null}
            </div>
            <div className="v4-imports__settings">
              <span className="v4-imports__panel-title">Import Settings</span>
              <label>
                <span>Destination</span>
                <strong>
                  {session?.destinationMode === 'MASTER_LIBRARY'
                    ? 'Master Library'
                    : session?.destinationMode === 'PROJECT'
                      ? 'Project'
                      : destinationMode === 'MASTER_LIBRARY'
                        ? 'Master Library'
                        : 'Project'}
                </strong>
              </label>
            </div>
          </aside>
          <div className="v4-imports__main">
            {viewStep === 'UPLOAD' || !session ? (
              <section className="v4-imports__source" aria-label="Import source and destination">
                <div className="v4-imports__source-action">
                  <V4Button
                    variant="primary"
                    leadingIcon={<Upload />}
                    onClick={() => void createAndSelectSource()}
                    disabled={busy || (destinationMode === 'PROJECT' && !projectId)}
                  >
                    {busy
                      ? 'Please wait…'
                      : destinationMode === 'MASTER_LIBRARY'
                        ? 'Select import source'
                        : 'Select Source'}
                  </V4Button>
                </div>
                <input
                  ref={fileInput}
                  className="v4-imports__file"
                  type="file"
                  accept=".csv,.tsv,.xlsx"
                  aria-label="Upload import source"

                  onChange={(event) => void uploadBrowserSource(event.target.files?.[0])}
                />
                <ImportSelectControl
                  label="Destination"
                  value={destinationMode}
                  icon={Target}
                  options={[
                    { value: 'PROJECT', label: 'Project' },
                    { value: 'MASTER_LIBRARY', label: 'Master Library' },
                  ]}
                  onChange={(next) => setDestinationMode(next as typeof destinationMode)}
                />
                {destinationMode === 'PROJECT' ? (
                  <ImportSelectControl
                    label="Project"
                    value={projectId}
                    icon={FolderOpen}
                    options={[
                      { value: '', label: 'Select Project' },
                      ...projects.map((project) => ({
                        value: project.id,
                        label: `${project.projectCode} · ${project.projectName}`,
                      })),
                    ]}
                    onChange={setProjectId}
                  />
                ) : (
                  <p className="v4-imports__mode-note">
                    Project-only fields remain visible as evidence and are excluded from Library
                    Apply.
                  </p>
                )}
              </section>
            ) : (
              <input
                ref={fileInput}
                className="v4-imports__file"
                type="file"
                accept=".csv,.tsv,.xlsx"
                aria-label="Upload import source"

                onChange={(event) => void uploadBrowserSource(event.target.files?.[0])}
              />
            )}
            {error ? (
              <div className="v4-imports__error" role="alert">
                {error}
              </div>
            ) : null}
            <section className="v4-imports__kpis" aria-label="Import status summary">
              <button type="button" data-tone="neutral" onClick={() => void openHistory('QUEUE')}>
                <span>
                  <FileText aria-hidden="true" />
                </span>
                <div>
                  <small>Files Queued</small>
                  <strong>{queuedSessions.length}</strong>
                  <em>
                    {session?.detectedAdapterId
                      ? `${statusLabel(session.detectedAdapterId)} · ${queuedRows} rows`
                      : `${queuedRows} rows`}
                  </em>
                </div>
              </button>
              <button
                type="button"
                data-tone="ready"
                onClick={() => setViewStep('APPLY')}
                disabled={!session}
              >
                <span>
                  <CircleCheck aria-hidden="true" />
                </span>
                <div>
                  <small>Ready to Apply</small>
                  <strong>{plannedApplyRows}</strong>
                  <em>Current session</em>
                </div>
              </button>
              <button
                type="button"
                data-tone="review"
                onClick={() => setViewStep('MAP')}
                disabled={!session}
              >
                <span>
                  <Columns3 aria-hidden="true" />
                </span>
                <div>
                  <small>Needs Mapping</small>
                  <strong>{needsMapping}</strong>
                  <em>Current session</em>
                </div>
              </button>
              <button
                type="button"
                data-tone="applied"
                onClick={() => setViewStep('APPLY')}
                disabled={!session}
              >
                <span>
                  <CircleCheck aria-hidden="true" />
                </span>
                <div>
                  <small>Applied</small>
                  <strong>{terminalAttempt?.counts.applied ?? 0}</strong>
                  <em>Latest terminal attempt</em>
                </div>
              </button>
            </section>
            <nav className="v4-imports__workflow" aria-label="Import workflow">
              {(
                [
                  ['UPLOAD', 'Upload', 'Add files to queue'],
                  ['INSPECT', 'Inspect', 'Analyze and detect'],
                  ['MAP', 'Map', 'Map fields and validate'],
                  ['RECONCILE', 'Reconcile', 'Match and resolve'],
                  ['APPLY', 'Apply', 'Apply changes safely'],
                ] as const
              ).map(([step, label, description], index) => (
                <button
                  key={step}
                  type="button"
                  aria-pressed={viewStep === step}
                  data-complete={
                    step === 'UPLOAD'
                      ? Boolean(session?.sourceSha256)
                      : step === 'INSPECT'
                        ? Boolean(rows)
                        : step === 'MAP'
                          ? Boolean(selectedTable?.mapping.length && !needsMapping)
                          : step === 'RECONCILE'
                            ? Boolean(rows?.items.some((row) => row.reconciliation))
                            : Boolean(terminalAttempt)
                  }
                  onClick={() => setViewStep(step)}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </div>
                  {index < 4 ? <ChevronDown aria-hidden="true" /> : null}
                </button>
              ))}
            </nav>
            {viewStep === 'INSPECT' || !session ? (
              <section className="v4-imports__summary" aria-live="polite">
                <FileSearch aria-hidden="true" />
                <div>
                  <strong>{summary}</strong>
                  <span>
                    {session?.detectedAdapterId
                      ? `${statusLabel(session.detectedAdapterId)} · SHA-256 ${session.sourceSha256?.slice(0, 12)}…`
                      : 'Inspection only'}
                  </span>
                </div>
                {mappingDecisions ? <span>{mappingDecisions} mapping decisions</span> : null}
                {workflowSummary ? (
                  <strong className="v4-imports__workflow-next">{workflowSummary}</strong>
                ) : null}
                {session?.sourceSha256 ? (
                  <V4Button
                    variant="secondary"
                    leadingIcon={<Target />}
                    disabled={busy}
                    onClick={() => void reconcile()}
                  >
                    Reconcile {session.destinationMode === 'PROJECT' ? 'Project' : 'Library'}
                  </V4Button>
                ) : null}
              </section>
            ) : null}
            {(viewStep === 'INSPECT' || viewStep === 'APPLY') && session && (
              <section
                className="v4-imports__step-preview"
                aria-label={
                  viewStep === 'INSPECT' ? 'Imported source preview' : 'Apply plan details'
                }
              >
                <header>
                  <h2>{viewStep === 'INSPECT' ? 'Imported rows' : 'Review the apply plan'}</h2>
                  <V4Button
                    onClick={() => setViewStep(viewStep === 'INSPECT' ? 'MAP' : 'RECONCILE')}
                  >
                    {viewStep === 'INSPECT' ? 'Review field mapping' : 'Review row decisions'}
                  </V4Button>
                </header>
                <p>
                  {rows?.items.length ?? 0} loaded rows · {session.counts.total} in this import.
                  Select a row to review its evidence and available actions.
                </p>
                <div className="v4-imports__step-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Source row</th>
                        <th>Manufacturer</th>
                        <th>Ordering code</th>
                        <th>State</th>
                        <th>Planned action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows?.items.map((row) => (
                        <tr key={row.importRowId}>
                          <td>
                            <V4Button
                              onClick={() => {
                                setSelectedRow(row);
                                setActiveTableId(row.sourceTableId);
                                setViewStep('RECONCILE');
                              }}
                            >
                              Row {row.sourceRowNumber} · {rowTitle(row)}
                            </V4Button>
                          </td>
                          <td>{mappedValue(row, 'MANUFACTURER') || '—'}</td>
                          <td>{mappedValue(row, 'ORDERING_CODE') || '—'}</td>
                          <td>
                            {statusLabel(
                              session.destinationMode === 'MASTER_LIBRARY'
                                ? libraryWorkflowStage(
                                    row,
                                    session,
                                    tables.find(
                                      (table) => table.sourceTableId === row.sourceTableId,
                                    ),
                                  )
                                : row.rowStatus,
                            )}
                          </td>
                          <td>
                            {statusLabel(
                              row.intendedAction?.type ??
                                row.reconciliation?.recommendedAction ??
                                'OWNER_REVIEW',
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows?.items.length && (
                  <p role="status">
                    No rows in the current worksheet or filter. Open Reconcile to change the
                    selection.
                  </p>
                )}
              </section>
            )}
            {viewStep === 'MAP' && tables.length ? (
              <section className="v4-imports__mapping" aria-label="Source table mapping">
                <div className="v4-imports__mapping-toolbar">
                  <ImportSelectControl
                    label="Worksheet"
                    value={selectedTable?.sourceTableId ?? ''}
                    icon={Table2}
                    compact
                    options={tables.map((table) => ({
                      value: table.sourceTableId,
                      label: table.tableName,
                      description: `${statusLabel(table.visibilityState)} · ${table.headerRow ? `Header row ${table.headerRow}` : 'Header unresolved'}`,
                    }))}
                    onChange={setActiveTableId}
                  />
                  {selectedTable ? (
                    <button
                      type="button"
                      className="v4-imports__include-control"
                      aria-label={`${selectedTable.selected ? 'Exclude' : 'Include'} ${selectedTable.tableName}`}
                      aria-pressed={selectedTable.selected}
                      onClick={() =>
                        void applyTableUpdate(selectedTable, { selected: !selectedTable.selected })
                      }
                    >
                      {selectedTable.selected ? (
                        <Eye aria-hidden="true" />
                      ) : (
                        <EyeOff aria-hidden="true" />
                      )}
                      <span>
                        <small>Worksheet state</small>
                        <strong>{selectedTable.selected ? 'Included' : 'Excluded'}</strong>
                      </span>
                    </button>
                  ) : null}
                </div>
                {selectedTable ? (
                  <>
                    {Array.isArray(selectedTable.detectedRegion.candidateHeaderRows) ? (
                      <label className="v4-imports__header-row">
                        <Rows3 aria-hidden="true" />
                        <span>
                          <small>Header row</small>
                          <strong>{selectedTable.headerRow ?? 'Review required'}</strong>
                        </span>
                        <input
                          key={`${selectedTable.sourceTableId}-${selectedTable.headerRow}`}
                          type="number"
                          min="1"
                          max="10000"
                          defaultValue={selectedTable.headerRow ?? ''}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                          onBlur={(event) => {
                            const next = Number(event.currentTarget.value);
                            if (
                              Number.isInteger(next) &&
                              next > 0 &&
                              next !== selectedTable.headerRow
                            )
                              void applyTableUpdate(selectedTable, { headerRow: next });
                          }}
                        />
                        <small className="v4-imports__header-row-note">
                          Choose a persisted worksheet row, then review regenerated mappings.
                        </small>
                      </label>
                    ) : null}
                    <div className="v4-imports__mapping-grid">
                      {selectedTable.mapping.map((mapping, index) => (
                        <div key={mapping.sourceColumnKey} className="v4-imports__mapping-control">
                          <span>
                            <strong>{mapping.sourceHeader || mapping.sourceColumnKey}</strong>
                            <small>
                              Confidence: {statusLabel(mapping.confidence)}
                              {mapping.unitHint ? ` · ${mapping.unitHint}` : ''}
                            </small>
                            {mapping.evidence[0] ? <em>{mapping.evidence[0]}</em> : null}
                          </span>
                          <ImportSelectControl
                            label={`Map ${mapping.sourceHeader || mapping.sourceColumnKey}`}
                            value={mapping.canonicalField ?? ''}
                            icon={Columns3}
                            compact
                            options={mappingOptions}
                            onChange={(value) => {
                              const next = [...selectedTable.mapping];
                              next[index] = {
                                ...mapping,
                                canonicalField: (value || null) as ImportCanonicalField | null,
                                confidence: value ? 'HIGH' : 'UNMAPPED',
                                evidence: ['Owner-reviewed mapping.'],
                              };
                              void applyTableUpdate(selectedTable, { mapping: next });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}
            {(viewStep === 'MAP' || viewStep === 'RECONCILE') &&
            session?.destinationMode === 'MASTER_LIBRARY' &&
            libraryGroups.length ? (
              <section className="v4-imports__library-groups" aria-label="Library group review">
                <header className="v4-imports__panel-header">
                  <div>
                    <Rows3 aria-hidden="true" />
                    <h2>Manufacturer Groups</h2>
                  </div>
                  <span>Publish: NO · Assets: evidence only</span>
                </header>
                <div className="v4-imports__manufacturer-groups">
                  {libraryGroups.map((group) => {
                    const maker = group.reconciliation.manufacturer;
                    return (
                      <section
                        key={maker.manufacturerGroupId}
                        id={`import-manufacturer-${maker.manufacturerGroupId}`}
                        className="v4-imports__manufacturer-group"
                      >
                        <header>
                          <div>
                            <strong>{maker.name || 'Unknown Manufacturer'}</strong>
                            <span>
                              {group.rowCount} rows · {group.products.size} Product Families ·{' '}
                              {statusLabel(maker.state)}
                            </span>
                          </div>
                          {maker.state === 'MISSING_REQUIRES_DECISION' && maker.name ? (
                            <>
                              <V4Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void decideManufacturerCreate(maker.manufacturerGroupId)
                                }
                              >
                                Create Manufacturer
                              </V4Button>
                              <V4Button disabled={busy} onClick={() => void loadManufacturers()}>
                                Choose existing manufacturer
                              </V4Button>
                              {manufacturers.length > 0 ? (
                                <label>
                                  Link manufacturer for {maker.name}
                                  <select
                                    aria-label={`Link manufacturer for ${maker.name}`}
                                    defaultValue=""
                                    disabled={busy}
                                    onChange={(event) => {
                                      if (event.target.value)
                                        void decideManufacturerCreate(
                                          maker.manufacturerGroupId,
                                          event.target.value,
                                        );
                                    }}
                                  >
                                    <option value="">Select existing manufacturer</option>
                                    {manufacturers.map((item) => (
                                      <option key={item.manufacturerId} value={item.manufacturerId}>
                                        {item.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null}
                            </>
                          ) : null}
                        </header>
                        <div className="v4-imports__product-groups">
                          {[...group.products.values()].map((productGroup) => {
                            const product = productGroup.reconciliation.product;
                            return (
                              <div
                                key={product.productGroupId}
                                className="v4-imports__product-group"
                              >
                                <div>
                                  <strong>{product.family || 'Product Family required'}</strong>
                                  <span>
                                    {productGroup.rowCount} Variants · {statusLabel(product.state)}
                                  </span>
                                </div>
                                <dl>
                                  <dt>Product Type</dt>
                                  <dd>
                                    {product.productType.resolvedValue ||
                                      statusLabel(product.productType.state)}
                                  </dd>
                                </dl>
                                <dl>
                                  <dt>Description</dt>
                                  <dd>
                                    {product.description.resolvedValue ||
                                      statusLabel(product.description.state)}
                                  </dd>
                                </dl>
                                {product.productType.state === 'CONFLICTING' ? (
                                  <div
                                    className="v4-imports__group-decisions"
                                    aria-label="Resolve Product Type"
                                  >
                                    {product.productType.values.map((value) => (
                                      <button
                                        key={value}
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void decideProductMetadata(
                                            product.productGroupId,
                                            'productType',
                                            value,
                                          )
                                        }
                                      >
                                        Use {value}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                                {product.description.state === 'CONFLICTING' ? (
                                  <div
                                    className="v4-imports__group-decisions"
                                    aria-label="Resolve Product Description"
                                  >
                                    {product.description.values.map((value) => (
                                      <button
                                        key={value}
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                          void decideProductMetadata(
                                            product.productGroupId,
                                            'description',
                                            value,
                                          )
                                        }
                                      >
                                        Use {value.slice(0, 60)}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {viewStep === 'RECONCILE' ? (
              <>
                <section className="v4-imports__primary-filters" aria-label="Import row filters">
                  <label
                    className="v4-imports__search-filter"
                    title="Search all source rows. Press Enter to search."
                  >
                    <Search aria-hidden="true" />
                    <input
                      value={rowSearch}
                      onChange={(event) => {
                        const search = event.target.value;
                        setRowSearch(search);
                        setPage(0);
                        if (session)
                          void refreshSession(
                            session.importSessionId,
                            filter,
                            0,
                            activeTableId ?? undefined,
                            search,
                          ).catch((reason: unknown) =>
                            setError(reason instanceof Error ? reason.message : 'Search failed.'),
                          );
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || !session) return;
                        setPage(0);
                        void refreshSession(session.importSessionId, filter, 0).catch(
                          (reason: unknown) =>
                            setError(reason instanceof Error ? reason.message : 'Search failed.'),
                        );
                      }}
                      placeholder="Search by ordering code, manufacturer…"
                      aria-label="Search import rows"
                    />
                  </label>
                  <ImportSelectControl
                    label="Source"
                    value={activeTableId ?? ''}
                    icon={Table2}
                    compact
                    options={tables.map((table) => ({
                      value: table.sourceTableId,
                      label: table.tableName,
                    }))}
                    onChange={(next) => {
                      setActiveTableId(next);
                      setPage(0);
                      if (session)
                        void refreshSession(session.importSessionId, filter, 0, next).catch(
                          (reason: unknown) =>
                            setError(
                              reason instanceof Error ? reason.message : 'Source could not load.',
                            ),
                        );
                    }}
                  />
                  <ImportSelectControl
                    label="Status"
                    value={filter}
                    icon={List}
                    compact
                    options={FILTERS.map((item) => ({
                      value: item.value,
                      label: `${workflowFilterLabel(item.value, session, rows)} · ${filterCount(item.value, rows)}`,
                    }))}
                    onChange={(next) => void setRowFilter(next as RowFilter)}
                  />
                  <ImportSelectControl
                    label="Match Quality"
                    value={qualityFilter}
                    icon={Filter}
                    compact
                    options={[
                      { value: '', label: 'All matches' },
                      { value: 'EXACT', label: 'Exact' },
                      { value: 'CANDIDATE', label: 'Candidate' },
                      { value: 'UNRESOLVED', label: 'Unresolved' },
                    ]}
                    onChange={(next) => {
                      setQualityFilter(next);
                      setPage(0);
                      if (session)
                        void refreshSession(
                          session.importSessionId,
                          filter,
                          0,
                          activeTableId ?? undefined,
                          rowSearch,
                          next,
                        ).catch((reason: unknown) =>
                          setError(reason instanceof Error ? reason.message : 'Filtering failed.'),
                        );
                    }}
                  />
                  <span title="Fixed destination for this import">
                    {session?.destinationMode === 'MASTER_LIBRARY'
                      ? 'Master Library'
                      : (projects.find((project) => project.id === session?.projectId)
                          ?.projectName ?? 'Project')}
                  </span>{' '}
                  {session?.sourceSha256 ? (
                    <button type="button" disabled={busy} onClick={() => void reconcile()}>
                      Reconcile {session.destinationMode === 'PROJECT' ? 'Project' : 'Library'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setRowSearch('');
                      setQualityFilter('');
                      setFilter('ALL');
                      setPage(0);
                      if (session)
                        void refreshSession(
                          session.importSessionId,
                          'ALL',
                          0,
                          activeTableId ?? undefined,
                          '',
                          '',
                        ).catch((reason: unknown) =>
                          setError(reason instanceof Error ? reason.message : 'Reset failed.'),
                        );
                    }}
                  >
                    Clear filters
                  </button>
                  {rowSearch || qualityFilter || filter !== 'ALL' ? (
                    <span role="status">
                      Active filters:{' '}
                      {[
                        rowSearch ? `Search: ${rowSearch}` : '',
                        qualityFilter,
                        filter !== 'ALL' ? statusLabel(filter) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}{' '}
                      · {rows?.totalCount ?? 0} rows
                    </span>
                  ) : null}
                </section>
                <section className="v4-imports__workspace">
                  <div className="v4-imports__rows" role="region" aria-label="Import rows">
                    <header className="v4-imports__panel-header">
                      <div>
                        <List aria-hidden="true" />
                        <h2>Import Rows</h2>
                      </div>
                      <div className="v4-imports__selection-actions">
                        <span>{rows?.totalCount ?? 0} shown</span>
                        <button
                          type="button"
                          disabled={!rows?.items.length}
                          onClick={selectVisibleRows}
                        >
                          Select visible
                        </button>
                        {selectedRowIds.size ? (
                          <button type="button" onClick={() => setSelectedRowIds(new Set())}>
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </header>
                    {selectedRowIds.size ? (
                      <div className="v4-imports__bulk-toolbar" aria-label="Bulk Import review">
                        <strong>{selectedRowIds.size} selected</strong>
                        <label>
                          <span>Action</span>
                          <select
                            aria-label="Bulk row action"
                            value={bulkAction}
                            disabled={
                              busy ||
                              (session?.destinationMode === 'MASTER_LIBRARY' &&
                                (!selectedLibraryRowsReconciled ||
                                  eligibleLibraryBulkActions.length === 0))
                            }
                            onChange={(event) => {
                              const value = event.currentTarget.value as
                                | ''
                                | 'PROJECT_CREATE_ONLY'
                                | 'PROJECT_ADD_FROM_LIBRARY'
                                | 'LIBRARY_CREATE_DRAFT'
                                | 'LIBRARY_USE_EXISTING'
                                | 'SKIP';
                              setBulkAction(value);
                              if (value) void applyBulkAction(value);
                            }}
                          >
                            <option value="">Action…</option>
                            {session?.destinationMode === 'PROJECT' ? (
                              <>
                                <option value="PROJECT_CREATE_ONLY">Create Project-only</option>
                                <option value="PROJECT_ADD_FROM_LIBRARY">
                                  Use exact Library match
                                </option>
                              </>
                            ) : (
                              eligibleLibraryBulkActions.map((action) => (
                                <option key={action} value={action}>
                                  {action === 'LIBRARY_CREATE_DRAFT'
                                    ? 'Create Library Drafts'
                                    : action === 'LIBRARY_USE_EXISTING'
                                      ? 'Use exact existing Variants'
                                      : 'Skip selected'}
                                </option>
                              ))
                            )}
                            {session?.destinationMode === 'PROJECT' ? (
                              <option value="SKIP">Skip selected</option>
                            ) : null}
                          </select>
                        </label>
                        {session?.destinationMode === 'MASTER_LIBRARY' &&
                        !selectedLibraryRowsReconciled ? (
                          <p className="v4-imports__bulk-guidance">
                            Reconcile Library before choosing an action.
                          </p>
                        ) : null}
                        {session?.destinationMode === 'PROJECT'
                          ? (['category', 'location', 'unit', 'quantity'] as const).map((field) => (
                              <label key={field}>
                                <span>
                                  {field === 'category' ? 'Project Category' : statusLabel(field)}
                                </span>
                                <input
                                  aria-label={`Bulk ${field === 'category' ? 'Project Category' : statusLabel(field)}`}
                                  type={field === 'quantity' ? 'number' : 'text'}
                                  min={field === 'quantity' ? 0 : undefined}
                                  step={field === 'quantity' ? 'any' : undefined}
                                  value={bulkFields[field]}
                                  disabled={busy}
                                  placeholder={
                                    field === 'category' ? 'Project Category' : statusLabel(field)
                                  }
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setBulkFields((current) => ({ ...current, [field]: value }));
                                  }}
                                />
                              </label>
                            ))
                          : null}
                        {session?.destinationMode === 'PROJECT' ? (
                          <V4Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void applyBulkFields()}
                          >
                            Set fields
                          </V4Button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="v4-imports__rows-scroll">
                      {rows?.items.length ? (
                        <div className="v4-imports__table-head" role="row">
                          <span aria-hidden="true" />
                          <span role="columnheader">Source Row</span>
                          <span role="columnheader">Manufacturer</span>
                          <span role="columnheader">Ordering Code</span>
                          <span role="columnheader">Proposed Match</span>
                          <span role="columnheader">Match Quality</span>
                          <span role="columnheader">Mapping Status</span>
                          <span role="columnheader">Action Preview</span>
                          <span role="columnheader">Result</span>
                        </div>
                      ) : null}
                      {rows?.items.length ? (
                        rows.items.map((row) => {
                          const workflowStage =
                            session?.destinationMode === 'MASTER_LIBRARY'
                              ? libraryWorkflowStage(
                                  row,
                                  session,
                                  tables.find((table) => table.sourceTableId === row.sourceTableId),
                                )
                              : row.rowStatus;
                          const RowStateIcon = rowStatusIcon(workflowStage);
                          const actionPreview =
                            row.intendedAction?.type ??
                            row.reconciliation?.recommendedAction ??
                            'OWNER_REVIEW';
                          return (
                            <div key={row.importRowId} className="v4-imports__row">
                              <input
                                type="checkbox"
                                aria-label={`Select import row ${row.sourceRowNumber}`}
                                checked={selectedRowIds.has(row.importRowId)}
                                disabled={busy || row.applyState === 'APPLIED'}
                                onChange={() => toggleRowSelection(row.importRowId)}
                              />
                              <button
                                type="button"
                                className={
                                  selectedRow?.importRowId === row.importRowId ? 'is-selected' : ''
                                }
                                onClick={() => setSelectedRow(row)}
                              >
                                <span>
                                  <strong>{String(row.sourceRowNumber).padStart(3, '0')}</strong>
                                  <small>{rowTitle(row)}</small>
                                </span>
                                <span>{mappedValue(row, 'MANUFACTURER')}</span>
                                <span>{mappedValue(row, 'ORDERING_CODE')}</span>
                                <span>
                                  <strong>{proposedMatch(row)}</strong>
                                </span>
                                <span
                                  className={`v4-imports__quality is-${matchQuality(row).toLowerCase()}`}
                                >
                                  {matchQuality(row)}
                                </span>
                                <span
                                  className={`v4-imports__status is-${workflowStage.toLowerCase()}`}
                                >
                                  <RowStateIcon aria-hidden="true" />
                                  {statusLabel(workflowStage)}
                                </span>
                                <span>{statusLabel(actionPreview)}</span>
                                <span>
                                  {row.applyState === 'NOT_APPLIED'
                                    ? '—'
                                    : statusLabel(row.applyState)}
                                </span>
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="v4-imports__empty">
                          <FileSearch aria-hidden="true" />
                          <strong>No inspected rows yet</strong>
                          <span>Choose a source to preserve raw values and review mappings.</span>
                        </div>
                      )}
                    </div>
                    {rows && rows.totalCount > rows.pageSize ? (
                      <nav className="v4-imports__pagination" aria-label="Import row pages">
                        <button
                          type="button"
                          disabled={busy || page === 0}
                          onClick={() => void setRowPage(page - 1)}
                        >
                          Previous
                        </button>
                        <span>
                          Page {page + 1} of {Math.ceil(rows.totalCount / rows.pageSize)}
                        </span>
                        <button
                          type="button"
                          disabled={busy || (page + 1) * rows.pageSize >= rows.totalCount}
                          onClick={() => void setRowPage(page + 1)}
                        >
                          Next
                        </button>
                      </nav>
                    ) : null}
                  </div>
                  <aside className="v4-imports__inspector" aria-label="Row Inspector">
                    <header className="v4-imports__panel-header">
                      <div>
                        <Search aria-hidden="true" />
                        <h2>
                          {selectedRow
                            ? `Row ${selectedRow.sourceRowNumber} · ${rowTitle(selectedRow)}`
                            : 'Row Inspector'}
                        </h2>
                      </div>
                    </header>
                    <div className="v4-imports__inspector-scroll">
                      {selectedRow ? (
                        <>
                          <section
                            className="v4-imports__next-action"
                            aria-label="Required row action"
                          >
                            <h3>{statusLabel(selectedWorkflowStage ?? selectedRow.rowStatus)}</h3>
                            {selectedRow.validationReasons.map((reason, index) => (
                              <p key={index}>{reason.message}</p>
                            ))}
                            {selectedLibraryReconciliation?.manufacturer.state ===
                            'MISSING_REQUIRES_DECISION' ? (
                              <>
                                <p>
                                  Create {selectedLibraryReconciliation.manufacturer.name} or link
                                  this group to an existing manufacturer.
                                </p>
                                <V4Button
                                  onClick={() =>
                                    document
                                      .getElementById(
                                        `import-manufacturer-${selectedLibraryReconciliation.manufacturer.manufacturerGroupId}`,
                                      )
                                      ?.scrollIntoView({ block: 'center' })
                                  }
                                >
                                  Review manufacturer group
                                </V4Button>
                              </>
                            ) : !selectedRow.reconciliation ? (
                              <V4Button disabled={busy} onClick={() => void reconcile()}>
                                Reconcile rows
                              </V4Button>
                            ) : (
                              <p>
                                {selectedRow.applyState === 'APPLIED'
                                  ? 'This row has been applied. Open the result below.'
                                  : 'Review the comparison, then choose a row action below.'}
                              </p>
                            )}
                          </section>
                          <section className="v4-imports__comparison-card">
                            <h3>Source Values</h3>
                            {selectedRow.rawCells.slice(0, 5).map((cell, index) => (
                              <dl key={String(cell.sourceColumnKey ?? index)}>
                                <dt>{String(cell.header ?? cell.sourceColumnKey)}</dt>
                                <dd>
                                  {String(cell.rawValue ?? '—')}
                                  {cell.formula ? (
                                    <small>
                                      Formula retained; not evaluated: {String(cell.formula)}
                                    </small>
                                  ) : null}
                                </dd>
                              </dl>
                            ))}
                            {selectedRow.rawCells.length > 5 ? (
                              <details>
                                <summary>View all ({selectedRow.rawCells.length})</summary>
                                {selectedRow.rawCells.slice(5).map((cell, index) => (
                                  <dl key={String(cell.sourceColumnKey ?? index + 5)}>
                                    <dt>{String(cell.header ?? cell.sourceColumnKey)}</dt>
                                    <dd>{String(cell.rawValue ?? '—')}</dd>
                                  </dl>
                                ))}
                              </details>
                            ) : null}
                          </section>
                          <section className="v4-imports__comparison-card">
                            <h3>Proposed (Normalized)</h3>
                            {selectedRow.normalizationEvidence.slice(0, 4).map((item, index) => (
                              <dl key={`${String(item.canonicalField)}-${index}`}>
                                <dt>
                                  {FIELD_LABELS[item.canonicalField as ImportCanonicalField] ??
                                    String(item.canonicalField)}
                                </dt>
                                <dd>
                                  {item.normalizedValue === null
                                    ? 'Review required'
                                    : String(item.normalizedValue)}
                                  {item.unit ? ` ${String(item.unit)}` : ''}
                                  <small>
                                    {item.basis ? `Basis: ${String(item.basis)} · ` : ''}
                                    {item.success ? 'Normalized' : String(item.reason)}
                                  </small>
                                </dd>
                              </dl>
                            ))}
                            {selectedRow.normalizationEvidence.length > 4 ? (
                              <details>
                                <summary>
                                  View all ({selectedRow.normalizationEvidence.length})
                                </summary>
                                {selectedRow.normalizationEvidence.slice(4).map((item, index) => (
                                  <dl key={`${String(item.canonicalField)}-${index + 4}`}>
                                    <dt>
                                      {FIELD_LABELS[item.canonicalField as ImportCanonicalField] ??
                                        String(item.canonicalField)}
                                    </dt>
                                    <dd>
                                      {item.normalizedValue === null
                                        ? 'Review required'
                                        : String(item.normalizedValue)}
                                      {item.unit ? ` ${String(item.unit)}` : ''}
                                    </dd>
                                  </dl>
                                ))}
                              </details>
                            ) : null}
                          </section>
                          <section className="v4-imports__confidence">
                            <h3>Worksheet mapping coverage</h3>
                            <div className="v4-imports__confidence-score">
                              <strong>{mappingConfidence}%</strong>
                              <span>
                                <b>Worksheet mapping coverage</b>
                                <small>
                                  {mappingHighCount} of {selectedTable?.mapping.length ?? 0} fields
                                  have HIGH mapping confidence.
                                </small>
                              </span>
                            </div>
                            <div className="v4-imports__confidence-bar">
                              <span style={{ width: `${mappingConfidence}%` }} />
                            </div>
                          </section>
                          <section className="v4-imports__comparison-card v4-imports__evidence">
                            <h3>Evidence &amp; Notes</h3>
                            {selectedRow.validationReasons.length ? (
                              selectedRow.validationReasons.map((item, index) => (
                                <p
                                  key={`${item.code}-${String(item.field)}-${index}`}
                                  data-severity={item.severity}
                                >
                                  <strong>{statusLabel(item.severity)}</strong>
                                  {item.message}
                                </p>
                              ))
                            ) : (
                              <p data-severity="INFO">
                                <strong>Ready</strong>No review reasons.
                              </p>
                            )}
                          </section>
                          {selectedRow.reconciliation ? (
                            <>
                              <section className="v4-imports__reconciliation">
                                <h3>Reconciliation Outcome</h3>
                                <dl>
                                  <dt>
                                    {selectedProjectReconciliation
                                      ? 'Project Tag'
                                      : 'Manufacturer Group'}
                                  </dt>
                                  <dd>
                                    {selectedProjectReconciliation?.canonicalTag ??
                                      selectedLibraryReconciliation?.manufacturer.name ??
                                      'Missing'}
                                  </dd>
                                </dl>
                                <dl>
                                  <dt>
                                    {selectedProjectReconciliation ? 'Project' : 'Product Group'}
                                  </dt>
                                  <dd>
                                    {selectedProjectReconciliation
                                      ? statusLabel(selectedProjectReconciliation.projectState)
                                      : `${selectedLibraryReconciliation?.product.family || 'Missing'} · ${statusLabel(selectedLibraryReconciliation?.product.state ?? 'NEW')}`}
                                  </dd>
                                </dl>
                                <dl>
                                  <dt>{selectedProjectReconciliation ? 'Library' : 'Variant'}</dt>
                                  <dd>
                                    {selectedProjectReconciliation?.exactLibraryMatch
                                      ? `${selectedProjectReconciliation.exactLibraryMatch.manufacturerName} · ${selectedProjectReconciliation.exactLibraryMatch.productName} · Published v${selectedProjectReconciliation.exactLibraryMatch.versionSequence}`
                                      : selectedProjectReconciliation?.possibleLibraryMatches.length
                                        ? `${selectedProjectReconciliation.possibleLibraryMatches.length} possible matches`
                                        : selectedLibraryReconciliation?.variant.exactMatch
                                          ? `${selectedLibraryReconciliation.variant.exactMatch.variantLabel} · ${statusLabel(selectedLibraryReconciliation.variant.state)}`
                                          : selectedLibraryReconciliation?.variant.possibleMatches
                                                .length
                                            ? `${selectedLibraryReconciliation.variant.possibleMatches.length} advisory possible matches`
                                            : selectedLibraryReconciliation
                                              ? statusLabel(
                                                  selectedLibraryReconciliation.variant.state,
                                                )
                                              : 'No authoritative match'}
                                  </dd>
                                </dl>
                                {selectedRow.reconciliation.warnings.map((warning) => (
                                  <p key={warning} data-severity="WARNING">
                                    <strong>Review</strong>
                                    {warning}
                                  </p>
                                ))}
                              </section>
                              <section className="v4-imports__impact">
                                <h3>Comparison</h3>
                                {selectedRow.intendedAction?.type === 'PROJECT_UPDATE_EXISTING' ? (
                                  selectedRow.intendedAction.changes.length ? (
                                    selectedRow.intendedAction.changes.map((change) => (
                                      <dl key={change.field}>
                                        <dt>{statusLabel(change.field)}</dt>
                                        <dd>
                                          <span>{String(change.before)}</span>
                                          <ArrowRight
                                            aria-hidden="true"
                                            className="v4-imports__change-arrow"
                                          />
                                          <span>{String(change.after)}</span>
                                        </dd>
                                      </dl>
                                    ))
                                  ) : (
                                    <p data-severity="INFO">
                                      <strong>No change</strong>Blank, unmapped, and unchanged
                                      values are preserved.
                                    </p>
                                  )
                                ) : selectedProjectReconciliation?.projectState ===
                                  'TAG_LIBRARY_LINKED' ? (
                                  selectedProjectReconciliation.ignoredLinkedChanges.length ? (
                                    <>
                                      {selectedProjectReconciliation.ignoredLinkedChanges.map(
                                        (change) => (
                                          <dl key={change.field}>
                                            <dt>{statusLabel(change.field)} · ignored</dt>
                                            <dd>
                                              <span>{String(change.current)}</span>
                                              <ArrowLeft
                                                aria-hidden="true"
                                                className="v4-imports__change-arrow"
                                              />
                                              <span>imported {String(change.imported)}</span>
                                            </dd>
                                          </dl>
                                        ),
                                      )}
                                      <p data-severity="INFO">
                                        <strong>Library owned</strong>These imported technical
                                        differences are visible and will not be changed.
                                      </p>
                                    </>
                                  ) : (
                                    <p data-severity="INFO">
                                      <strong>Library owned</strong>No imported technical
                                      differences will change Published Library data.
                                    </p>
                                  )
                                ) : selectedLibraryReconciliation ? (
                                  <>
                                    <ImportLibraryComparison
                                      key={selectedRow.importRowId}
                                      row={selectedRow}
                                    />
                                    <p data-severity="INFO">
                                      <strong>Publish: NO</strong>Apply can create a mutable Draft
                                      or record use of an exact existing Variant. Published Versions
                                      created: 0.
                                    </p>
                                    {selectedLibraryReconciliation.blockingReasons.map((reason) => (
                                      <p key={reason.code} data-severity="BLOCKING">
                                        <strong>{statusLabel(reason.code)}</strong>
                                        {reason.message}
                                      </p>
                                    ))}
                                  </>
                                ) : (
                                  <p data-severity="INFO">
                                    <strong>Planned</strong>Select an action to materialize exact
                                    impact.
                                  </p>
                                )}
                              </section>
                              <section className="v4-imports__action">
                                <h3>Actions</h3>
                                <ImportSelectControl
                                  label="Row action"
                                  value={selectedRow.intendedAction?.type ?? ''}
                                  icon={Play}
                                  disabled={
                                    busy ||
                                    selectedRow.applyState === 'APPLIED' ||
                                    selectedWorkflowStage === 'RECONCILIATION_STALE'
                                  }
                                  options={[
                                    { value: '', label: 'Owner decision required' },
                                    ...selectedRow.reconciliation.allowedActions.map((action) => ({
                                      value: action,
                                      label:
                                        action === 'PROJECT_CREATE_ONLY'
                                          ? 'Create Project-only'
                                          : action === 'PROJECT_UPDATE_EXISTING'
                                            ? 'Update Existing'
                                            : action === 'PROJECT_ADD_FROM_LIBRARY'
                                              ? 'Use Library Variant'
                                              : action === 'LIBRARY_CREATE_DRAFT'
                                                ? 'Create Library Draft'
                                                : action === 'LIBRARY_USE_EXISTING'
                                                  ? 'Use Existing Variant'
                                                  : action === 'LIBRARY_REVIEW_EXISTING'
                                                    ? 'Review Existing Variant'
                                                    : 'Skip Row',
                                    })),
                                  ]}
                                  onChange={(value) => {
                                    if (value)
                                      void chooseRowAction(
                                        value as ImportProjectAction | ImportLibraryAction,
                                      );
                                  }}
                                />
                                {selectedRow.intendedAction?.type === 'PROJECT_ADD_FROM_LIBRARY' &&
                                selectedProjectReconciliation &&
                                selectedProjectReconciliation.availableLibraryVersions.length >
                                  1 ? (
                                  <ImportSelectControl
                                    label="Published version"
                                    value={selectedRow.intendedAction.versionId}
                                    icon={History}
                                    compact
                                    options={selectedProjectReconciliation.availableLibraryVersions.map(
                                      (version) => ({
                                        value: version.versionId,
                                        label: `Published v${version.versionSequence}${version.isLatest ? ' · Latest' : ' · Older version'}`,
                                        description: version.orderingCode,
                                      }),
                                    )}
                                    onChange={(versionId) =>
                                      void chooseRowAction('PROJECT_ADD_FROM_LIBRARY', versionId)
                                    }
                                  />
                                ) : null}
                                {selectedRow.intendedAction?.type === 'PROJECT_ADD_FROM_LIBRARY' &&
                                selectedRow.intendedAction.olderPublishedVersion ? (
                                  <p data-severity="WARNING">
                                    <strong>Review</strong>Older published version selected.
                                  </p>
                                ) : null}
                                {selectedWorkflowStage === 'RECONCILIATION_STALE' ? (
                                  <p data-severity="WARNING">
                                    <strong>Reconciliation stale</strong>
                                    Reconcile Library before choosing an action.
                                  </p>
                                ) : null}
                              </section>
                            </>
                          ) : session?.destinationMode === 'MASTER_LIBRARY' ? (
                            <section className="v4-imports__action">
                              <h3>Actions</h3>
                              <ImportSelectControl
                                label="Row action"
                                value=""
                                icon={Play}
                                disabled
                                options={[{ value: '', label: 'Owner decision required' }]}
                                onChange={() => undefined}
                              />
                              <p data-severity="WARNING">
                                <strong>Next step</strong>
                                Reconcile Library before choosing an action.
                              </p>
                            </section>
                          ) : null}
                        </>
                      ) : (
                        <div className="v4-imports__inspector-empty">
                          <Search aria-hidden="true" />
                          <strong>No row selected</strong>
                          <p>
                            Select a row to compare source values, mapped and normalized values, and
                            validation.
                          </p>
                        </div>
                      )}
                    </div>
                  </aside>
                </section>
              </>
            ) : null}
            {viewStep === 'APPLY' && terminalAttempt ? (
              <section
                className="v4-imports__terminal-result"
                data-state={terminalAttempt.state}
                aria-label="Apply terminal result"
              >
                <div>
                  <strong>
                    {terminalAttempt.state === 'PARTIALLY_APPLIED'
                      ? `Partially applied ${terminalAttempt.counts.applied} rows`
                      : `${statusLabel(terminalAttempt.state)} · ${terminalAttempt.counts.applied} applied`}
                  </strong>
                  <div
                    className="v4-imports__terminal-counts"
                    role="list"
                    aria-label="Apply result counts"
                  >
                    {session?.destinationMode === 'MASTER_LIBRARY' ? (
                      <>
                        <span role="listitem">
                          Unique Manufacturers created:{' '}
                          {terminalAttempt.counts.uniqueManufacturersCreated}
                        </span>
                        <span role="listitem">
                          Unique Products created: {terminalAttempt.counts.uniqueProductsCreated}
                        </span>
                        <span role="listitem">
                          Variant Drafts created: {terminalAttempt.counts.variantDraftsCreated}
                        </span>
                        <span role="listitem">
                          Existing Variants used: {terminalAttempt.counts.existingVariantsUsed}
                        </span>
                        <span role="listitem">
                          Published Versions created:{' '}
                          {terminalAttempt.counts.publishedVersionsCreated}
                        </span>
                      </>
                    ) : (
                      <>
                        <span role="listitem">
                          Created Project-only: {terminalAttempt.counts.created}
                        </span>
                        <span role="listitem">
                          Updated Project-only: {terminalAttempt.counts.updatedProjectOnlyResult}
                        </span>
                        <span role="listitem">
                          Updated linked Project-owned fields:{' '}
                          {terminalAttempt.counts.updatedLinkedProjectFieldsResult}
                        </span>
                        <span role="listitem">
                          Added from Library: {terminalAttempt.counts.addedFromLibrary}
                        </span>
                      </>
                    )}
                    <span role="listitem">Skipped: {terminalAttempt.counts.skippedResult}</span>
                    <span role="listitem">Failed: {terminalAttempt.counts.failed}</span>
                    <span role="listitem">
                      Remaining Blocked: {terminalAttempt.counts.remainingBlocked}
                    </span>
                    <span role="listitem">
                      Remaining Unresolved: {terminalAttempt.counts.remainingUnresolved}
                    </span>
                  </div>
                  <small>
                    {terminalAttempt.backupId
                      ? `Verified backup ${terminalAttempt.backupId}`
                      : session?.destinationMode === 'MASTER_LIBRARY' &&
                          terminalAttempt.counts.variantDraftsCreated === 0
                        ? 'No backup required for this non-mutating attempt'
                        : 'No backup identity recorded'}
                    {terminalAttempt.state === 'PARTIALLY_APPLIED'
                      ? ' · Remaining rows were not silently skipped.'
                      : ''}
                  </small>
                </div>
                <div className="v4-imports__terminal-actions">
                  {terminalAttempt.counts.failed ? (
                    <V4Button
                      variant="secondary"
                      onClick={() => {
                        setViewStep('RECONCILE');
                        setFilter('FAILED');
                        setPage(0);
                        if (session) void refreshSession(session.importSessionId, 'FAILED', 0);
                      }}
                    >
                      View Failed Rows
                    </V4Button>
                  ) : null}
                  {selectedLibraryResult?.variantId && selectedLibraryResult.productId ? (
                    <V4Button
                      variant="secondary"
                      onClick={() => {
                        const { productId, variantId } = selectedLibraryResult;
                        if (!productId || !variantId) return;
                        navigate(
                          `${ROUTE_LUMINAIRE_LIBRARY}?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}`,
                        );
                      }}
                    >
                      {selectedLibraryResult.outcome === 'DRAFT_CREATED'
                        ? 'Open Created Draft'
                        : 'Open Existing Variant'}
                    </V4Button>
                  ) : null}
                  <V4Button
                    variant="secondary"
                    disabled={session?.destinationMode === 'PROJECT' && !session.projectId}
                    onClick={() => {
                      if (session?.destinationMode === 'MASTER_LIBRARY')
                        navigate(ROUTE_LUMINAIRE_LIBRARY);
                      else if (session?.projectId)
                        navigate(projectRoute(ROUTE_PROJECT_LUMINAIRES, session.projectId));
                    }}
                  >
                    {session?.destinationMode === 'MASTER_LIBRARY'
                      ? 'Open Master Library'
                      : 'Open Project Luminaires'}
                  </V4Button>
                  <V4Button variant="secondary" onClick={() => void openHistory()}>
                    Reopen Import History
                  </V4Button>
                </div>
              </section>
            ) : null}
            {viewStep === 'APPLY' && session?.sessionStatus !== 'COMPLETED' ? (
              <footer className="v4-imports__footer">
                <div className="v4-imports__plan-summary">
                  <strong>
                    {session?.destinationMode === 'MASTER_LIBRARY'
                      ? !hasLibraryReconciliation
                        ? `${workflowSummary} · Publish: NO`
                        : plannedApplyRows
                          ? `${session.applyPlan.createLibraryDraft} Drafts will be created · Apply ready · Publish: NO`
                          : `Owner action required · Publish: NO`
                      : `${session?.applyPlan.readyMutations ?? 0} rows will change`}
                  </strong>
                  <span>
                    {session?.destinationMode === 'MASTER_LIBRARY' ? (
                      <>
                        {session.applyPlan.createLibraryDraft} Draft ·{' '}
                        {session.applyPlan.useExistingLibrary} use existing ·{' '}
                        {session.applyPlan.reviewExistingLibrary} review existing · Published
                        Versions: 0
                      </>
                    ) : (
                      <>
                        {session?.applyPlan.createProjectOnly ?? 0} create ·{' '}
                        {session?.applyPlan.updateProjectOnly ?? 0} update ·{' '}
                        {session?.applyPlan.addFromLibrary ?? 0} Library ·{' '}
                        {session?.applyPlan.updateLinkedProjectFields ?? 0} linked
                      </>
                    )}
                    {' · '}
                    {session?.applyPlan.skip ?? 0} skip · {session?.applyPlan.blocked ?? 0} blocked
                    · {session?.applyPlan.unresolved ?? 0} unresolved
                  </span>
                  {applyProgress ? (
                    <small>
                      Applying {applyProgress.applied} / {applyProgress.total}
                    </small>
                  ) : null}
                  {session?.destinationMode === 'MASTER_LIBRARY' ? (
                    <small className="v4-imports__apply-guidance">
                      {!hasLibraryReconciliation
                        ? 'Apply disabled · Reconcile Library before choosing actions.'
                        : !plannedApplyRows
                          ? 'Apply disabled · Choose an eligible Owner action for each row.'
                          : (session.applyPlan.blocked ?? 0) + (session.applyPlan.unresolved ?? 0) >
                              0
                            ? `Ready-only Apply is available for ${plannedApplyRows} eligible rows.`
                            : `${plannedApplyRows} rows are Apply ready.`}
                    </small>
                  ) : null}
                  {attempts[0] && !terminalAttempt ? (
                    <small>
                      {statusLabel(attempts[0].state)} · {attempts[0].counts.applied} applied ·{' '}
                      {attempts[0].counts.failed} failed
                    </small>
                  ) : null}
                </div>
                <div className="v4-imports__apply-actions">
                  {(session?.applyPlan.blocked ?? 0) + (session?.applyPlan.unresolved ?? 0) > 0 ? (
                    <V4Button
                      variant="secondary"
                      disabled={busy || !session?.applyPlanFingerprint || !plannedApplyRows}
                      onClick={() => setConfirmApply('READY_ONLY')}
                    >
                      Apply Ready Rows Only
                    </V4Button>
                  ) : null}
                  <V4Button
                    variant="primary"
                    disabled={
                      busy ||
                      !session?.applyPlanFingerprint ||
                      !plannedApplyRows ||
                      Boolean(
                        (session?.applyPlan.blocked ?? 0) + (session?.applyPlan.unresolved ?? 0),
                      )
                    }
                    onClick={() => setConfirmApply('ALL')}
                  >
                    Apply {plannedApplyRows} rows
                  </V4Button>
                </div>
              </footer>
            ) : null}
            <V4ConfirmDialog
              open={confirmApply !== null}
              title={`Apply ${plannedApplyRows} rows?`}
              description={
                session?.destinationMode === 'MASTER_LIBRARY'
                  ? `${session.applyPlan.createLibraryDraft} Draft creates, ${session.applyPlan.useExistingLibrary} existing Variants used, and ${session.applyPlan.skip} skipped rows. Publish: NO. Published Versions created: 0. Assets remain evidence only. A verified backup is required only when Drafts will be created. Applied rows become immutable in this session.`
                  : `${session?.applyPlan.createProjectOnly ?? 0} Project-only creates, ${session?.applyPlan.updateProjectOnly ?? 0} Project updates, ${session?.applyPlan.addFromLibrary ?? 0} Library additions, and ${session?.applyPlan.updateLinkedProjectFields ?? 0} linked-field updates. ${session?.applyPlan.blocked ?? 0} blocked, ${session?.applyPlan.unresolved ?? 0} unresolved, and ${session?.applyPlan.skip ?? 0} skipped rows are outside the mutation count. Unapplied rows remain in this session. A verified workspace backup is required before any change. Applied rows become immutable in this session.`
              }
              cancelLabel="Cancel"
              confirmLabel={`Apply ${plannedApplyRows} rows`}
              pending={busy}
              onCancel={() => setConfirmApply(null)}
              onConfirm={() => void applyPlan()}
            />
            {historyOpen ? (
              <div
                className="v4-imports__history-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setHistoryOpen(false);
                }}
              >
                <aside
                  className="v4-imports__history"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="import-history-title"
                >
                  <header>
                    <div>
                      <h2 id="import-history-title">
                        {historyMode === 'QUEUE'
                          ? 'File Queue'
                          : historyMode === 'SOURCES'
                            ? 'Data Sources'
                            : 'Import History'}
                      </h2>
                      <p>
                        {historyMode === 'SOURCES'
                          ? 'CSV, TSV and XLSX sources retained with each import. Open a source to review its tables and mapping.'
                          : 'Reopen saved rows, decisions and results.'}
                      </p>
                    </div>
                    <button
                      ref={historyClose}
                      type="button"
                      aria-label="Close Import History"
                      onClick={() => {
                        setHistoryOpen(false);
                        historyTrigger.current?.focus();
                      }}
                    >
                      <X />
                    </button>
                  </header>
                  {(historyMode === 'QUEUE' ? queuedSessions : (history?.items ?? [])).length ===
                  0 ? (
                    <p>No {historyMode === 'QUEUE' ? 'queued files' : 'imports'}.</p>
                  ) : null}
                  {(historyMode === 'QUEUE' ? queuedSessions : (history?.items ?? [])).map(
                    (item) => (
                      <button
                        key={item.importSessionId}
                        type="button"
                        onClick={() => {
                          setHistoryOpen(false);
                          void refreshSession(item.importSessionId)
                            .then(() => {
                              if (historyMode === 'SOURCES') setViewStep('INSPECT');
                            })
                            .catch((reason: unknown) =>
                              setError(
                                reason instanceof Error
                                  ? reason.message
                                  : 'Import could not reopen.',
                              ),
                            );
                        }}
                      >
                        <strong>{item.sourceFileName ?? 'New inspection'}</strong>
                        <span>
                          {item.detectedAdapterId
                            ? statusLabel(item.detectedAdapterId)
                            : 'Awaiting source'}{' '}
                          · {item.destinationMode === 'PROJECT' ? 'Project' : 'Master Library'}
                        </span>
                        <small>
                          {formatBusinessDateTime(item.createdAt)} · {item.counts.total} rows ·{' '}
                          {statusLabel(item.sessionStatus)}
                          {item.sourceSha256 ? ` · ${item.sourceSha256.slice(0, 10)}…` : ''}
                        </small>
                      </button>
                    ),
                  )}
                </aside>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </V4AppShell>
  );
}
