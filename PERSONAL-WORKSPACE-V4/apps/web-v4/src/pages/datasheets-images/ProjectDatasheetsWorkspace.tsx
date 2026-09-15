import { V4TextEditor } from '../../components/common/V4TextEditor';
import { luminaireInput } from '../project-luminaires/LuminaireEditor';
import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import FinalDatasheetsView from '../../components/final-ui/FinalDatasheetsView';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SctImage as FileImage,
  SctFilter as Filter,
  SctImage as ImageOff,
  SctMore as MoreVertical,
} from '../../components/common/SctIcons';
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Paperclip,
  Search,
  X,
} from '../../components/common/SctIcons';
import type { LuminaireAssetType, LuminaireAssetVersion, LuminaireRecord } from '@scli/domain';
import { api } from '../../api/environment';
import { formatBusinessDateOnly, formatBusinessDateTime } from '../../date-time/businessDateTime';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4OutputPresentationLauncher } from '../../components/outputs/V4OutputPresentationLauncher';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_CONTACTS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import { LuminaireImage } from '../project-luminaires/LuminaireImage';
import {
  assetCounts,
  assetRows,
  filterAssetRows,
  type AssetFilter,
} from './datasheetsImagesViewModel';

type AttachableLuminaireAssetType = Extract<LuminaireAssetType, 'Datasheet' | 'ProductImage'>;
type AttachState = { luminaireId: string; assetType: AttachableLuminaireAssetType } | null;
type SelectedLuminaireAsset = {
  assetType: AttachableLuminaireAssetType;
  fileName: string;
  filePath: string;
};

const filterLabels: Record<AssetFilter, string> = {
  all: 'All',
  missing: 'Missing Only',
  'missing-datasheet': 'Missing Datasheet',
  'missing-image': 'Missing Image',
  complete: 'Complete',
};

function displayDate(value: string): string {
  return (
    formatBusinessDateOnly(value.slice(0, 10), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }) || '—'
  );
}

function displayDateTime(value: string): string {
  return (
    formatBusinessDateTime(value, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) || '—'
  );
}

function formatBytes(value: number | null): string | null {
  if (value === null) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function versionMeta(version: LuminaireAssetVersion): string {
  return version.backfilled
    ? `v${version.versionSequence} · Migrated`
    : `v${version.versionSequence} · ${displayDate(version.attachedAt)}`;
}

function StatusCell({
  version,
  image = false,
}: {
  version: LuminaireAssetVersion | null;
  image?: boolean;
}) {
  return version ? (
    <span className="v4-datasheets__status v4-datasheets__status--complete">
      <span>
        <Check aria-hidden="true" /> Complete
      </span>
      <small>{versionMeta(version)}</small>
    </span>
  ) : (
    <span
      className={`v4-datasheets__status v4-datasheets__status--missing${image ? '-image' : ''}`}
    >
      <span>
        {image ? <ImageOff aria-hidden="true" /> : <FileText aria-hidden="true" />} Missing
      </span>
      <small>Not attached</small>
    </span>
  );
}

function LinkedFileRow({
  version,
  onHistory,
}: {
  version: LuminaireAssetVersion;
  onHistory: () => void;
}) {
  const image = version.assetType === 'ProductImage';
  const size = formatBytes(version.sizeBytes);
  return (
    <div className="v4-datasheets__linked-row">
      <span
        className={`v4-datasheets__file-icon${image ? ' v4-datasheets__file-icon--image' : ''}`}
      >
        {image ? <FileImage aria-hidden="true" /> : <FileText aria-hidden="true" />}
      </span>
      <span className="v4-datasheets__file-copy">
        <strong title={version.fileName}>{version.fileName}</strong>
        <small>
          {[version.mimeType.split('/').at(-1)?.toUpperCase(), size, `v${version.versionSequence}`]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      <time
        title={version.backfilled ? `Observed ${displayDateTime(version.attachedAt)}` : undefined}
      >
        {version.backfilled ? 'Migrated' : displayDate(version.attachedAt)}
      </time>
      <button
        type="button"
        aria-label={`Open ${version.fileName}`}
        onClick={() => void window.scliDesktop?.openPath?.(version.filePath)}
      >
        <Download aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`View ${image ? 'image' : 'datasheet'} versions`}
        onClick={onHistory}
      >
        <MoreVertical aria-hidden="true" />
      </button>
    </div>
  );
}

function AttachmentDialog({
  state,
  luminaires,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  state: NonNullable<AttachState>;
  luminaires: readonly LuminaireRecord[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (
    luminaireId: string,
    assetType: AttachableLuminaireAssetType,
    filePath: string,
  ) => void;
}) {
  const [luminaireId, setLuminaireId] = useState(state.luminaireId);
  const [assetType, setAssetType] = useState<AttachableLuminaireAssetType>(state.assetType);
  const [selectedFile, setSelectedFile] = useState<SelectedLuminaireAsset | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const browse = async () => {
    setBrowseError(null);
    const picker = window.scliDesktop?.selectLuminaireAssetFile;
    if (!picker) {
      setBrowseError('The Desktop file picker is unavailable.');
      return;
    }
    try {
      const selected = await picker(assetType);
      if (selected?.assetType === assetType) setSelectedFile(selected);
    } catch {
      setBrowseError('The Desktop file picker could not be opened.');
    }
  };
  return (
    <div className="v4-datasheets__modal-backdrop" role="presentation">
      <section
        className="v4-datasheets__modal"
        role="dialog"
        aria-modal="true"
        aria-label="Attach document"
      >
        <header>
          <div>
            <h2>Attach Document</h2>
            <p>Create a new immutable asset version.</p>
          </div>
          <button type="button" aria-label="Close attachment editor" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="v4-datasheets__modal-body">
          <label>
            Target Luminaire
            <select value={luminaireId} onChange={(event) => setLuminaireId(event.target.value)}>
              {luminaires.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.tag} — {item.category || 'Uncategorized'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Asset Type
            <select
              value={assetType}
              onChange={(event) => {
                setAssetType(event.target.value as AttachableLuminaireAssetType);
                setSelectedFile(null);
                setBrowseError(null);
              }}
            >
              <option value="Datasheet">Datasheet PDF</option>
              <option value="ProductImage">Product Image</option>
            </select>
          </label>
          <label>
            Local file
            <div className="v4-datasheets__browse">
              <input
                value={selectedFile?.fileName ?? ''}
                readOnly
                placeholder="Choose a local file…"
              />
              <button type="button" onClick={() => void browse()}>
                Browse
              </button>
            </div>
          </label>
          {browseError || error ? (
            <p className="v4-datasheets__error" role="alert">
              {browseError ?? error}
            </p>
          ) : null}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="v4-datasheets__primary"
            disabled={!selectedFile || pending}
            onClick={() => selectedFile && onSubmit(luminaireId, assetType, selectedFile.filePath)}
          >
            {pending ? 'Attaching…' : 'Attach as New Version'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function HistoryDialog({
  type,
  versions,
  currentVersion,
  onClose,
  onOpen,
}: {
  type: LuminaireAssetType;
  versions: readonly LuminaireAssetVersion[];
  currentVersion: LuminaireAssetVersion | null;
  onClose: () => void;
  onOpen: (version: LuminaireAssetVersion) => void;
}) {
  const rows = versions.filter((version) => version.assetType === type);
  return (
    <div className="v4-datasheets__modal-backdrop" role="presentation">
      <section
        className="v4-datasheets__modal v4-datasheets__history"
        role="dialog"
        aria-modal="true"
        aria-label={`${type} version history`}
      >
        <header>
          <div>
            <h2>{type === 'Datasheet' ? 'Datasheet' : 'Product Image'} Versions</h2>
            <p>Immutable attachment history</p>
          </div>
          <button type="button" aria-label="Close version history" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="v4-datasheets__history-list">
          {rows.map((version) => (
            <div key={version.id} className="v4-datasheets__history-row">
              <strong>v{version.versionSequence}</strong>
              <span>
                <b>{version.fileName.replace(/^[a-f0-9]{64}[-_]/i, '')}</b>
                {version.backfilled ? (
                  <>
                    <small>Migrated legacy asset</small>
                    <small>Observed: {displayDateTime(version.attachedAt)}</small>
                    <small>Attached by: Unknown / Legacy</small>
                  </>
                ) : (
                  <>
                    <small>Attached: {displayDateTime(version.attachedAt)}</small>
                    <small>Attached by: {version.attachedByNameSnapshot ?? 'Unknown'}</small>
                  </>
                )}
              </span>
              {currentVersion?.id === version.id ? (
                <em>Current</em>
              ) : (
                <em className="v4-asset-previous">Previous</em>
              )}
              <button type="button" onClick={() => onOpen(version)}>
                Open
              </button>
            </div>
          ))}
          {!rows.length ? <p className="v4-datasheets__quiet">No versions attached.</p> : null}
        </div>
      </section>
    </div>
  );
}

export function ProjectDatasheetsWorkspace({ finalView = false }: { finalView?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const initialSelection = useRef<string | null>(null);
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attach, setAttach] = useState<AttachState>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [historyType, setHistoryType] = useState<LuminaireAssetType | null>(null);
  const [page, setPage] = useState(0);
  const [requestedPageSize, setPageSize] = useState(finalView ? 25 : 4);
  const pageSize = requestedPageSize;
  const [notesRecord, setNotesRecord] = useState<LuminaireRecord | null>(null);
  const projectQuery = useQuery({
    queryKey: ['v4', 'datasheets', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'datasheets', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const assetsQuery = useQuery({
    queryKey: ['v4', 'datasheets', 'assets', projectId],
    queryFn: () => api.luminaireAssets(projectId as string),
    enabled: Boolean(projectId),
  });
  const luminaires = workspaceQuery.data?.luminaires ?? [];
  const rows = useMemo(
    () => assetRows(luminaires, assetsQuery.data ?? []),
    [luminaires, assetsQuery.data],
  );
  const counts = useMemo(() => assetCounts(rows), [rows]);
  const filtered = useMemo(
    () =>
      filterAssetRows(rows, query, filter).sort((a, b) =>
        finalView
          ? a.luminaire.tag.localeCompare(b.luminaire.tag, 'en', { numeric: true }) * sortDirection
          : 0,
      ),
    [rows, query, filter, sortDirection, finalView],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const selected = filtered.find((row) => row.luminaire.id === selectedId) ?? null;
  const historyQuery = useQuery({
    queryKey: ['v4', 'datasheets', 'history', projectId, selectedId],
    queryFn: () => api.luminaireAssetVersions(projectId as string, selectedId as string),
    enabled: Boolean(projectId && selectedId),
  });
  useEffect(() => {
    const requestKey = `${projectId}:${searchParams.toString()}`;
    if (initialSelection.current !== requestKey && rows[0]) {
      const requested = searchParams.get('luminaireId');
      const target = requested
        ? rows.find(
            (row) => row.luminaire.id === requested && row.luminaire.projectId === projectId,
          )
        : rows[0];
      setSelectedId(target?.luminaire.id ?? null);
      if (!target) setAssetError('The linked luminaire is not available in this project.');
      initialSelection.current = requestKey;
    }
  }, [rows, selectedId, searchParams, projectId]);
  useEffect(() => {
    setPage(0);
  }, [query, filter, pageSize]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v4', 'datasheets', 'workspace', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'datasheets', 'assets', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'datasheets', 'history', projectId] }),
    ]);
  };
  const attachMutation = useMutation({
    mutationFn: ({
      luminaireId,
      assetType,
      filePath,
    }: {
      luminaireId: string;
      assetType: LuminaireAssetType;
      filePath: string;
    }) => api.attachLuminaireAsset(projectId as string, luminaireId, { assetType, filePath }),
  });
  const submitAttachment = async (
    luminaireId: string,
    assetType: LuminaireAssetType,
    filePath: string,
  ) => {
    setAttachError(null);
    try {
      await attachMutation.mutateAsync({ luminaireId, assetType, filePath });
      await refresh();
      setSelectedId(luminaireId);
      setAttach(null);
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : 'The asset could not be attached.');
    }
  };
  const actOnAsset = async (version: LuminaireAssetVersion, action: 'OPEN' | 'SAVE_COPY') => {
    setAssetError(null);
    try {
      if (!window.scliDesktop?.executeDesktopHandoff)
        throw new Error('Use the desktop application to open or save this local file.');
      const handoff = await api.luminaireAssetFileHandoff(
        projectId!,
        version.luminaireId,
        version.id,
        action,
      );
      await window.scliDesktop.executeDesktopHandoff(handoff.handoffId, handoff.action);
    } catch (error) {
      setAssetError(
        error instanceof Error ? error.message : 'The asset action could not be completed.',
      );
    }
  };
  const routes: Record<string, string> = {
    summary: ROUTE_PROJECT_SUMMARY,
    workflow: ROUTE_PROJECT_WORKFLOW_TIMELINE,
    scope: ROUTE_PROJECT_SCOPE,
    actions: ROUTE_PROJECT_ACTIONS,
    meetings: ROUTE_PROJECT_MEETINGS,
    comments: ROUTE_PROJECT_COMMENTS,
    contacts: ROUTE_PROJECT_CONTACTS,
    luminaires: ROUTE_PROJECT_LUMINAIRES,
    datasheets: ROUTE_PROJECT_DATASHEETS_IMAGES,
    'technical-check': ROUTE_PROJECT_TECHNICAL_CHECK,
    'lighting-schedule': ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
    'technical-boq': ROUTE_PROJECT_TECHNICAL_BOQ,
  };
  const loading = projectQuery.isLoading || workspaceQuery.isLoading || assetsQuery.isLoading;
  const failed = projectQuery.isError || workspaceQuery.isError || assetsQuery.isError;
  const start = filtered.length ? page * pageSize + 1 : 0;
  const end = Math.min((page + 1) * pageSize, filtered.length);
  const selectedMissingCount = selected
    ? Number(!selected.assets.datasheet) + Number(!selected.assets.productImage)
    : 0;
  return (
    <V4AppShell
      finalContacts={finalView}
      context="project"
      boundedPage
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="datasheets"
      onSelectSection={(id) => {
        if (projectId && routes[id]) navigate(generatePath(routes[id], { projectId }));
      }}
      project={
        projectQuery.data
          ? {
              projectCode: projectQuery.data.projectCode,
              projectName: projectQuery.data.projectName,
              status: projectQuery.data.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: projectQuery.data?.projectCode ?? '',
            projectName: projectQuery.data?.projectName ?? '',
            clientName: projectQuery.data?.clientName ?? null,
            projectType: projectQuery.data?.projectType ?? null,
            designStage: projectQuery.data?.designStage ?? null,
            requiredDeliveryDate: projectQuery.data?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={projectQuery.data}
              projectQueryKey={['v4', 'datasheets', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <V4PageHeader
          icon={FileText}
          title="Datasheets & Images"
          description="Track datasheet and product image completeness for all luminaires."
          actions={
            <V4OutputPresentationLauncher
              projectId={projectId as string}
              outputKind="DatasheetRegister"
              disabled={loading || failed}
              label="Preview Register"
            />
          }
        />
      }
    >
      {notesRecord && (
        <V4TextEditor
          key={notesRecord.id}
          title="Luminaire notes"
          value={notesRecord.notes}
          onClose={() => setNotesRecord(null)}
          onSave={async (notes) => {
            const fresh = (await api.projectWorkspace(projectId!)).luminaires.find(
              (item) => item.id === notesRecord.id,
            );
            if (!fresh) throw new Error('Luminaire no longer exists.');
            await api.updateLuminaire(projectId!, fresh.id, { ...luminaireInput(fresh), notes });
            await refresh();
          }}
        />
      )}
      <main
        className={finalView ? 'final-ui-reference' : 'v4-datasheets v4-bounded-page'}
        style={finalView ? { flexDirection: 'column', minHeight: 0 } : undefined}
        data-testid="v4-project-datasheets-images"
      >
        {finalView ? <FinalProjectHeader /> : null}
        {loading ? (
          <div className="v4-datasheets__state" aria-busy="true">
            Loading datasheets and images…
          </div>
        ) : null}
        {failed ? (
          <div className="v4-datasheets__state" role="alert">
            <strong>Datasheets & Images could not be loaded.</strong>
            <button
              type="button"
              onClick={() =>
                void Promise.all([
                  projectQuery.refetch(),
                  workspaceQuery.refetch(),
                  assetsQuery.refetch(),
                ])
              }
            >
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !failed ? (
          finalView ? (
            <FinalDatasheetsView
              binding={{
                items: pageRows,
                selected,
                counts,
                query,
                setQuery,
                filter,
                setFilter,
                page,
                pages: pageCount,
                total: filtered.length,
                pageSize,
                setPage,
                setPageSize,
                select: setSelectedId,
                attach: (id, assetType) => {
                  const target = id ?? rows[0]?.luminaire.id;
                  if (target) setAttach({ luminaireId: target, assetType });
                },
                history: (id, type) => {
                  setSelectedId(id);
                  setHistoryType(type);
                },
                openAsset: (version) => void actOnAsset(version, 'OPEN'),
                saveAsset: (version) => void actOnAsset(version, 'SAVE_COPY'),
                editNotes: (row) => setNotesRecord(row.luminaire),
                luminaireHref: (id, edit) =>
                  generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId: projectId! }) +
                  '?luminaireId=' +
                  encodeURIComponent(id) +
                  (edit ? '&edit=notes' : ''),
                sort: () => setSortDirection((current) => (current === 1 ? -1 : 1)),
                notice: assetError ? (
                  <p role="alert">{assetError}</p>
                ) : historyQuery.isError ? (
                  <p role="alert">
                    Asset history could not be loaded.{' '}
                    <button onClick={() => void historyQuery.refetch()}>Retry asset history</button>
                  </p>
                ) : null,
              }}
            />
          ) : (
            <div
              className={`v4-datasheets__workspace${selected ? '' : ' v4-datasheets__workspace--closed'}`}
            >
              <section className="v4-datasheets__main">
                <div className="v4-datasheets__kpis" aria-label="Asset completeness summary">
                  <article>
                    <span className="v4-datasheets__kpi-icon v4-datasheets__kpi-icon--danger">
                      <FileText />
                    </span>
                    <div>
                      <strong>{counts.missingDatasheets}</strong>
                      <span>Missing Datasheets</span>
                    </div>
                  </article>
                  <article>
                    <span className="v4-datasheets__kpi-icon v4-datasheets__kpi-icon--warning">
                      <FileImage />
                    </span>
                    <div>
                      <strong>{counts.missingImages}</strong>
                      <span>Images Missing</span>
                    </div>
                  </article>
                  <article>
                    <span className="v4-datasheets__kpi-icon v4-datasheets__kpi-icon--success">
                      <Check />
                    </span>
                    <div>
                      <strong>{counts.complete}</strong>
                      <span>Complete</span>
                    </div>
                  </article>
                </div>
                <section
                  className="v4-datasheets__table-card"
                  aria-label="Luminaire asset completeness"
                >
                  <div className="v4-datasheets__toolbar">
                    <label>
                      <Search />
                      <input
                        type="search"
                        aria-label="Search by tag, type, manufacturer"
                        placeholder="Search by tag, type, manufacturer…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <label className="v4-datasheets__filter">
                      <Filter />
                      <select
                        aria-label="Asset completeness filter"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value as AssetFilter)}
                      >
                        {Object.entries(filterLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown />
                    </label>
                    <button
                      type="button"
                      className="v4-datasheets__primary"
                      disabled={!luminaires.length}
                      onClick={() =>
                        setAttach({
                          luminaireId: selected?.luminaire.id ?? luminaires[0]!.id,
                          assetType: 'Datasheet',
                        })
                      }
                    >
                      <Paperclip />
                      Attach Document
                    </button>
                  </div>
                  <div className="v4-datasheets__table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th aria-label="Selection" />
                          <th>Tag</th>
                          <th>Type</th>
                          <th>Datasheet Status</th>
                          <th>Image Status</th>
                          <th>Preview</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row) => (
                          <tr
                            key={row.luminaire.id}
                            className={
                              row.luminaire.id === selectedId
                                ? 'v4-datasheets__row--selected'
                                : undefined
                            }
                            onClick={() => setSelectedId(row.luminaire.id)}
                          >
                            <td>
                              <input
                                type="radio"
                                name="selected-luminaire"
                                aria-label={`Select ${row.luminaire.tag}`}
                                checked={row.luminaire.id === selectedId}
                                onChange={() => setSelectedId(row.luminaire.id)}
                              />
                            </td>
                            <td>
                              <strong>{row.luminaire.tag}</strong>
                              <small>{row.luminaire.category || 'Uncategorized'}</small>
                            </td>
                            <td>
                              <strong>{row.luminaire.category || '—'}</strong>
                              {row.luminaire.description ? (
                                <small>{row.luminaire.description}</small>
                              ) : null}
                            </td>
                            <td>
                              <StatusCell version={row.assets.datasheet} />
                            </td>
                            <td>
                              <StatusCell version={row.assets.productImage} image />
                            </td>
                            <td>
                              <span className="v4-datasheets__thumb">
                                <LuminaireImage
                                  path={row.assets.productImage?.filePath ?? ''}
                                  alt={`${row.luminaire.tag} product`}
                                />
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                aria-label={`Actions for ${row.luminaire.tag}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(row.luminaire.id);
                                  setAttach({
                                    luminaireId: row.luminaire.id,
                                    assetType: row.assets.datasheet ? 'ProductImage' : 'Datasheet',
                                  });
                                }}
                              >
                                <MoreVertical />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!pageRows.length ? (
                      <div className="v4-datasheets__empty">No luminaires match this view.</div>
                    ) : null}
                  </div>
                  <footer className="v4-datasheets__pagination">
                    <span>
                      Showing {start} to {end} of {filtered.length} luminaires
                    </span>
                    <V4Pagination
                      pageCount={pageCount}
                      currentPage={page}
                      onChange={setPage}
                      ariaLabel="Datasheets and Images pages"
                    />
                    <label>
                      <select
                        aria-label="Rows per page"
                        value={pageSize}
                        onChange={(event) => setPageSize(Number(event.target.value))}
                      >
                        <option value={4}>4 / page</option>
                        <option value={8}>8 / page</option>
                        <option value={12}>12 / page</option>
                      </select>
                    </label>
                  </footer>
                </section>
              </section>
              {selected ? (
                <aside
                  className="v4-datasheets__inspector"
                  aria-label={`${selected.luminaire.tag} asset inspector`}
                >
                  <header className="v4-datasheets__inspector-header">
                    <div>
                      <h2>{selected.luminaire.tag}</h2>
                      <p>{selected.luminaire.category || 'Uncategorized'}</p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close asset inspector"
                      onClick={() => setSelectedId(null)}
                    >
                      <X />
                    </button>
                  </header>
                  <div className="v4-datasheets__inspector-scroll">
                    <section className="v4-datasheets__product">
                      <div className="v4-datasheets__product-image">
                        <LuminaireImage
                          path={selected.assets.productImage?.filePath ?? ''}
                          alt={`${selected.luminaire.tag} product`}
                        />
                      </div>
                      <dl>
                        {[
                          ['Type', selected.luminaire.category],
                          ['Manufacturer', selected.luminaire.manufacturer],
                          ['Series / Model', selected.luminaire.model],
                          ['Wattage', selected.luminaire.wattage],
                          ['CCT', selected.luminaire.lightColor],
                        ]
                          .filter(([, value]) => value)
                          .map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `${generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId: projectId as string })}?luminaireId=${encodeURIComponent(selected.luminaire.id)}`,
                            )
                          }
                        >
                          View in Luminaires <ExternalLink />
                        </button>
                      </dl>
                    </section>
                    <section className="v4-datasheets__inspector-card">
                      <header>
                        <h3>Linked Files</h3>
                        {selected.assets.datasheet && selected.assets.productImage ? (
                          <span className="v4-datasheets__complete-pill">Complete</span>
                        ) : null}
                      </header>
                      {selected.assets.datasheet ? (
                        <LinkedFileRow
                          version={selected.assets.datasheet}
                          onHistory={() => setHistoryType('Datasheet')}
                        />
                      ) : null}
                      {selected.assets.productImage ? (
                        <LinkedFileRow
                          version={selected.assets.productImage}
                          onHistory={() => setHistoryType('ProductImage')}
                        />
                      ) : null}
                      {!selected.assets.datasheet && !selected.assets.productImage ? (
                        <p className="v4-datasheets__quiet">No current files linked.</p>
                      ) : null}
                    </section>
                    <section className="v4-datasheets__inspector-card">
                      <header>
                        <h3>Missing Items</h3>
                        <span
                          className="v4-datasheets__count-pill"
                          aria-label={`${selectedMissingCount} missing item${selectedMissingCount === 1 ? '' : 's'}`}
                        >
                          {selectedMissingCount}
                        </span>
                      </header>
                      {!selected.assets.datasheet ? (
                        <div className="v4-datasheets__missing-row">
                          <span className="v4-datasheets__file-icon">
                            <FileText />
                          </span>
                          <span>
                            <strong>Datasheet</strong>
                            <small>No datasheet attached</small>
                          </span>
                          <span className="v4-datasheets__missing-actions">
                            <button type="button" onClick={() => setHistoryType('Datasheet')}>
                              History
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAttach({
                                  luminaireId: selected.luminaire.id,
                                  assetType: 'Datasheet',
                                })
                              }
                            >
                              Attach
                            </button>
                          </span>
                        </div>
                      ) : null}
                      {!selected.assets.productImage ? (
                        <div className="v4-datasheets__missing-row">
                          <span className="v4-datasheets__file-icon v4-datasheets__file-icon--image">
                            <FileImage />
                          </span>
                          <span>
                            <strong>Product Image</strong>
                            <small>No product image attached</small>
                          </span>
                          <span className="v4-datasheets__missing-actions">
                            <button type="button" onClick={() => setHistoryType('ProductImage')}>
                              History
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAttach({
                                  luminaireId: selected.luminaire.id,
                                  assetType: 'ProductImage',
                                })
                              }
                            >
                              Attach
                            </button>
                          </span>
                        </div>
                      ) : null}
                      {selected.assets.datasheet && selected.assets.productImage ? (
                        <p className="v4-datasheets__quiet">
                          <Check /> All required assets are complete.
                        </p>
                      ) : null}
                    </section>
                    <section className="v4-datasheets__inspector-card v4-datasheets__notes">
                      <header>
                        <h3>Notes</h3>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `${generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId: projectId as string })}?luminaireId=${encodeURIComponent(selected.luminaire.id)}&edit=notes`,
                            )
                          }
                        >
                          Edit
                        </button>
                      </header>
                      <p>{selected.luminaire.notes || 'No notes added.'}</p>
                    </section>
                  </div>
                  {(() => {
                    const latest = [selected.assets.datasheet, selected.assets.productImage]
                      .filter((item): item is LuminaireAssetVersion => Boolean(item))
                      .sort((a, b) => b.attachedAt.localeCompare(a.attachedAt))[0];
                    return (
                      <footer className="v4-datasheets__inspector-footer">
                        {latest ? (
                          <>
                            <span>
                              {latest.backfilled ? 'Legacy asset observed' : 'Last updated'}{' '}
                              {displayDateTime(latest.attachedAt)}
                            </span>
                            {latest.backfilled ? (
                              <span>Legacy / unknown</span>
                            ) : latest.attachedByNameSnapshot ? (
                              <span>
                                <b>
                                  {latest.attachedByNameSnapshot
                                    .split(/\s+/)
                                    .map((part) => part[0])
                                    .join('')
                                    .slice(0, 2)}
                                </b>{' '}
                                by {latest.attachedByNameSnapshot}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span>No asset updates recorded.</span>
                        )}
                      </footer>
                    );
                  })()}
                </aside>
              ) : null}
            </div>
          )
        ) : null}
      </main>
      {attach ? (
        <AttachmentDialog
          state={attach}
          luminaires={luminaires}
          pending={attachMutation.isPending}
          error={attachError}
          onClose={() => {
            setAttach(null);
            setAttachError(null);
          }}
          onSubmit={(luminaireId, assetType, filePath) =>
            void submitAttachment(luminaireId, assetType, filePath)
          }
        />
      ) : null}
      {historyType ? (
        <HistoryDialog
          type={historyType}
          versions={historyQuery.data ?? []}
          currentVersion={
            historyType === 'Datasheet'
              ? (selected?.assets.datasheet ?? null)
              : (selected?.assets.productImage ?? null)
          }
          onClose={() => setHistoryType(null)}
          onOpen={(version) => void actOnAsset(version, 'OPEN')}
        />
      ) : null}
    </V4AppShell>
  );
}
