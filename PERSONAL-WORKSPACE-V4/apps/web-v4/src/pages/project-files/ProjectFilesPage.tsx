import { useEffect, useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SctWarning as AlertTriangle,
  SctFilter as Filter,
  SctFiles,
  SctPdf,
  SctFile,
  SctOpen,
  SctReveal,
  SctEdit,
} from '../../components/common/SctIcons';
import { File, FolderOpen, Plus, Search, Trash2, X } from '../../components/common/SctIcons';
import type { ProjectDocument } from '@scli/domain';
import type { P4cArtifactType } from '@scli/contracts';
import { api } from '../../api/environment';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4StatusPill, type V4StatusPillVariant } from '../../components/common/V4StatusPill';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4Button } from '../../components/common/V4Button';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { OutputActivity } from '../../components/automation/OutputActivity';
import { executeHandoff } from '../../desktop/integrations';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  hasFileBridge,
  openRegisteredFile,
  pickWorkingFile,
  revealRegisteredFile,
} from '../../desktop/files';
import {
  buildFileRows,
  documentCategoryOptions,
  filterFileRows,
  formatUpdatedAt,
  presenceOptions,
  type FilePresenceState,
  type FileRow,
} from './filesViewModel';

const messageFor = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function presenceVariant(state: FilePresenceState): V4StatusPillVariant {
  if (state === 'Present') return 'success';
  if (state === 'Missing') return 'danger';
  if (state === 'Outdated') return 'warning';
  return 'neutral';
}

function presenceLabel(state: FilePresenceState): string {
  if (state === 'Present') return 'Present';
  if (state === 'Missing') return 'Missing';
  if (state === 'Outdated') return 'Outdated';
  return 'No file linked';
}

interface FileDraft {
  title: string;
  category: ProjectDocument['category'];
  notes: string;
  filePath: string;
}

const EMPTY_DRAFT: FileDraft = { title: '', category: 'Other', notes: '', filePath: '' };
const FILES_PER_PAGE = 8;

export function ProjectFilesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedDocument = searchParams.get('documentId');
  const linkedDocumentApplied = useRef('');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectDocument['category'] | ''>('');
  const [presence, setPresence] = useState<FilePresenceState | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<FileDraft>(EMPTY_DRAFT);
  const [initialDraft, setInitialDraft] = useState<FileDraft>(EMPTY_DRAFT);
  const [leave, setLeave] = useState<{ proceed: () => void; cancel: () => void } | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [internalView, setInternalView] = useState<'working' | 'outputs'>('working');
  const [toolSessionRequest, setToolSessionRequest] = useState<{
    token: number;
    artifactType: P4cArtifactType;
    sourceDocumentId: string;
  } | null>(null);

  const projectQuery = useQuery({
    queryKey: ['v4', 'files', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'files', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });

  const refreshWorkspace = () =>
    queryClient.invalidateQueries({ queryKey: ['v4', 'files', 'workspace', projectId] });

  const documents = workspaceQuery.data?.documents ?? [];
  const fileCenter = workspaceQuery.data?.fileCenter ?? [];
  const rows = useMemo(() => buildFileRows(documents, fileCenter), [documents, fileCenter]);
  const filteredRows = useMemo(
    () => filterFileRows(rows, { query, category, presence }),
    [rows, query, category, presence],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / FILES_PER_PAGE));
  const pageRows = filteredRows.slice(
    page * FILES_PER_PAGE,
    page * FILES_PER_PAGE + FILES_PER_PAGE,
  );
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const selectedDocument = documents.find((document) => document.id === editingId) ?? null;
  const pageStart = filteredRows.length ? page * FILES_PER_PAGE + 1 : 0;
  const pageEnd = Math.min((page + 1) * FILES_PER_PAGE, filteredRows.length);

  useEffect(() => setPage(0), [category, presence, query]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  useEffect(() => {
    if (selectedId && !filteredRows.some((row) => row.id === selectedId)) setSelectedId(null);
  }, [filteredRows, selectedId]);
  useEffect(() => {
    const requestKey = `${projectId}:${requestedDocument ?? ''}`;
    if (!requestedDocument || !workspaceQuery.data || linkedDocumentApplied.current === requestKey)
      return;
    // A search link must reveal its record even when this page already has filters.
    // Apply selection after those filters settle so their page reset cannot hide it.
    if (query || category || presence || internalView !== 'working') {
      setQuery('');
      setCategory('');
      setPresence('');
      setInternalView('working');
      return;
    }
    linkedDocumentApplied.current = requestKey;
    const index = rows.findIndex((row) => row.id === requestedDocument);
    if (index < 0) {
      setOperationError('The linked file is not available in this project.');
      return;
    }
    setOperationError(null);
    setSelectedId(requestedDocument);
    setPage(Math.floor(index / FILES_PER_PAGE));
  }, [
    projectId,
    requestedDocument,
    rows,
    workspaceQuery.data,
    query,
    category,
    presence,
    internalView,
  ]);

  const saveFile = useMutation({
    mutationFn: ({ item, draft: d }: { item: ProjectDocument | null; draft: FileDraft }) => {
      const input = {
        category: d.category,
        documentNumber: item?.documentNumber ?? '',
        title: d.title.trim(),
        revision: item?.revision ?? '',
        status: item?.status ?? 'Working',
        filePath: d.filePath,
        issuedTo: item?.issuedTo ?? '',
        issueDate: item?.issueDate ?? null,
        notes: d.notes.trim(),
      };
      return item
        ? api.updateDocument(projectId as string, item.id, input)
        : api.createDocument(projectId as string, input);
    },
  });

  const removeFile = useMutation({
    mutationFn: (id: string) => api.removeDocument(projectId as string, id),
  });
  const dirty = drawerOpen && JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const closeDrawer = () => {
    setDrawerOpen(false);
    setDraft(EMPTY_DRAFT);
    setDrawerError(null);
  };
  const requestCloseDrawer = () => {
    if (saveFile.isPending) return;
    if (dirty) setLeave({ proceed: closeDrawer, cancel: () => {} });
    else closeDrawer();
  };
  useV4DirtySurface(dirty || saveFile.isPending, (_reason, proceed, cancel) => {
    if (saveFile.isPending) return cancel();
    setLeave({ proceed, cancel });
  });

  const loading = projectQuery.isLoading || workspaceQuery.isLoading;
  const pageError = projectQuery.isError || workspaceQuery.isError;

  const openAddDrawer = async () => {
    setDrawerError(null);
    setOperationMessage(null);
    setOperationError(null);
    const selected = await pickWorkingFile();
    if (!selected) return; // user cancelled the native picker
    setEditingId(null);
    setInitialDraft(EMPTY_DRAFT);
    setDraft({ ...EMPTY_DRAFT, title: selected.split(/[\\/]/).pop() ?? '', filePath: selected });
    setDrawerOpen(true);
  };

  const openEditDrawer = (row: FileRow) => {
    setEditingId(row.id);
    setDrawerError(null);
    setOperationMessage(null);
    setOperationError(null);
    setInitialDraft({
      title: row.title,
      category: row.category,
      notes: row.notes,
      filePath: row.filePath,
    });
    setDraft({
      title: row.title,
      category: row.category,
      notes: row.notes,
      filePath: row.filePath,
    });
    setDrawerOpen(true);
  };

  const saveDrawer = async () => {
    setDrawerError(null);
    if (!draft.title.trim()) {
      setDrawerError('Enter a title for the working file.');
      return;
    }
    if (!draft.filePath.trim()) {
      setDrawerError('Select a working file to register.');
      return;
    }
    try {
      await saveFile.mutateAsync({ item: selectedDocument ?? null, draft });
      await refreshWorkspace();
      setDrawerOpen(false);
      setDraft(EMPTY_DRAFT);
      const next = leave;
      setLeave(null);
      next?.proceed();
    } catch (error) {
      setDrawerError(messageFor(error, 'The working file could not be saved.'));
    }
  };

  const handleOpen = async (row: FileRow) => {
    setOperationMessage(null);
    setOperationError(null);
    if (row.presence.state === 'Missing' || row.presence.state === 'NotGenerated') {
      setOperationError('This working file is not available to open.');
      return;
    }
    if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(row.filePath)) {
      try {
        const handoff = await api.projectDocumentFileHandoff(projectId as string, row.id, {
          action: 'OPEN',
        });
        if (!(await executeHandoff(handoff)))
          setOperationError('Native file open is not available in this environment.');
      } catch (error) {
        setOperationError(messageFor(error, 'This managed file is unavailable.'));
      }
      return;
    }
    const result = await openRegisteredFile(row.filePath);
    if (!result.ok) {
      setOperationError(
        result.reason === 'bridge-unavailable'
          ? 'Native file open is not available in this environment.'
          : 'The registered path is not a valid local file.',
      );
    }
  };

  const handleReveal = async (row: FileRow) => {
    setOperationMessage(null);
    setOperationError(null);
    if (row.presence.state === 'Missing' || row.presence.state === 'NotGenerated') {
      setOperationError('This working file is not available to reveal.');
      return;
    }
    if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(row.filePath)) {
      try {
        const handoff = await api.projectDocumentFileHandoff(projectId as string, row.id, {
          action: 'REVEAL',
        });
        if (!(await executeHandoff(handoff)))
          setOperationError('Native reveal is not available in this environment.');
      } catch (error) {
        setOperationError(messageFor(error, 'This managed file is unavailable.'));
      }
      return;
    }
    const result = await revealRegisteredFile(row.filePath);
    if (!result.ok) {
      setOperationError(
        result.reason === 'bridge-unavailable'
          ? 'Native reveal is not available in this environment.'
          : 'The registered path is not a valid local file.',
      );
    }
  };

  const handleRemove = async (row: FileRow) => {
    setOperationMessage(null);
    setOperationError(null);
    try {
      await removeFile.mutateAsync(row.id);
      await refreshWorkspace();
      setConfirmRemoveId(null);
      if (selectedId === row.id) setSelectedId(null);
      setOperationMessage(
        `Removed "${row.title}" from the register. The source file was not deleted.`,
      );
    } catch (error) {
      setOperationError(
        messageFor(error, 'The working file could not be removed from the register.'),
      );
      setConfirmRemoveId(null);
    }
  };

  const routes: Record<string, string> = {
    summary: '/projects/:projectId/summary',
    workflow: '/projects/:projectId/workflow-timeline',
    scope: '/projects/:projectId/scope',
    actions: '/projects/:projectId/actions',
    meetings: '/projects/:projectId/meetings',
    comments: '/projects/:projectId/comments',
    contacts: '/projects/:projectId/contacts',
    luminaires: '/projects/:projectId/luminaires',
    datasheets: '/projects/:projectId/datasheets-images',
    'technical-check': '/projects/:projectId/technical-check',
    'lighting-schedule': '/projects/:projectId/luminaire-schedule',
    'technical-boq': '/projects/:projectId/technical-boq',
    revisions: '/projects/:projectId/revisions',
    packages: '/projects/:projectId/packages',
    files: '/projects/:projectId/files',
  };

  return (
    <V4AppShell
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
      activeSectionId="files"
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
              projectQueryKey={['v4', 'files', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <div className="v4-files__page-header">
          <V4PageHeader
            title="Project Files"
            description="Working files registered to this project. Revisions capture immutable snapshots separately."
            icon={SctFiles}
            actions={
              <div className="v4-files__header-actions">
                <label className="v4-files__search">
                  <Search aria-hidden="true" />
                  <span className="v4-visually-hidden">Search working files</span>
                  <input
                    aria-label="Search working files"
                    value={query}
                    placeholder="Search files"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear file search"
                      onClick={() => setQuery('')}
                    >
                      <X aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <label className="v4-files__filter">
                  <Filter aria-hidden="true" />
                  <span>Category</span>
                  <select
                    aria-label="Filter working files by category"
                    value={category}
                    onChange={(event) =>
                      setCategory(event.target.value as ProjectDocument['category'] | '')
                    }
                  >
                    <option value="">All categories</option>
                    {documentCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="v4-files__filter">
                  <span>State</span>
                  <select
                    aria-label="Filter working files by presence state"
                    value={presence}
                    onChange={(event) => setPresence(event.target.value as FilePresenceState | '')}
                  >
                    {presenceOptions().map((option) => (
                      <option key={option.value || '__all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="v4-files__primary"
                  onClick={() => void openAddDrawer()}
                  disabled={!hasFileBridge()}
                  title={
                    hasFileBridge() ? 'Add a working file' : 'Native file picker is unavailable'
                  }
                >
                  <Plus aria-hidden="true" /> Add File
                </button>
              </div>
            }
          />
        </div>
      }
    >
      <main className="v4-files v4-bounded-page" data-testid="v4-project-files">
        <nav className="v4-files__views" aria-label="Project Files views">
          <button
            type="button"
            aria-pressed={internalView === 'working'}
            onClick={() => setInternalView('working')}
          >
            Working Files
          </button>
          <button
            type="button"
            aria-pressed={internalView === 'outputs'}
            onClick={() => setInternalView('outputs')}
          >
            Output Activity
          </button>
        </nav>
        {loading ? (
          <div className="v4-files__state" aria-busy="true">
            Loading working files…
          </div>
        ) : null}
        {pageError ? (
          <div className="v4-files__state" role="alert">
            <strong>Working files could not be loaded.</strong>
            <button
              type="button"
              onClick={() => void Promise.all([projectQuery.refetch(), workspaceQuery.refetch()])}
            >
              Retry
            </button>
          </div>
        ) : null}
        {operationMessage ? (
          <div className="v4-files__notice" role="status">
            {operationMessage}
          </div>
        ) : null}
        {operationError ? (
          <div className="v4-files__error" role="alert">
            <AlertTriangle aria-hidden="true" />
            {operationError}
          </div>
        ) : null}
        {!loading && !pageError && internalView === 'working' ? (
          <div
            className={`v4-files__workspace${selectedRow ? ' v4-files__workspace--inspector-open' : ''}`}
          >
            <section className="v4-files__list" aria-label="Registered working files">
              {filteredRows.length === 0 ? (
                <div className="v4-files__empty">
                  <File aria-hidden="true" />
                  <strong>
                    {rows.length === 0 ? 'No working files yet' : 'No working files found'}
                  </strong>
                  <p>
                    {rows.length === 0
                      ? 'Add the first working file to begin building the project register.'
                      : 'Try changing the search or filters.'}
                  </p>
                </div>
              ) : (
                <div className="v4-files__rows">
                  {pageRows.map((row) => (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selectedId === row.id}
                      className={`v4-files__row${selectedId === row.id ? ' v4-files__row--selected' : ''}`}
                      data-presence={row.presence.state}
                      onClick={() => setSelectedId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(row.id);
                        }
                      }}
                    >
                      <div className="v4-files__row-icon" aria-hidden="true">
                        {row.filePath?.toLowerCase().endsWith('.pdf') ? <SctPdf /> : <SctFile />}
                      </div>
                      <div className="v4-files__row-main">
                        <div className="v4-files__row-title">{row.title}</div>
                        <div className="v4-files__row-meta">
                          <span>{row.categoryLabel}</span>
                          <span className="v4-files__row-dot" aria-hidden="true" />
                          <span>{row.fileName || 'No file linked'}</span>
                        </div>
                      </div>
                      <div className="v4-files__row-status">
                        <V4StatusPill variant={presenceVariant(row.presence.state)}>
                          {presenceLabel(row.presence.state)}
                        </V4StatusPill>
                      </div>
                      <div className="v4-files__row-updated">{formatUpdatedAt(row.updatedAt)}</div>
                      <div className="v4-files__row-actions">
                        <button
                          type="button"
                          className="v4-files__row-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleOpen(row);
                          }}
                          disabled={
                            row.presence.state === 'Missing' ||
                            row.presence.state === 'NotGenerated'
                          }
                          title="Open with default application"
                        >
                          <SctOpen aria-hidden="true" /> Open
                        </button>
                        <button
                          type="button"
                          className="v4-files__row-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleReveal(row);
                          }}
                          disabled={
                            row.presence.state === 'Missing' ||
                            row.presence.state === 'NotGenerated'
                          }
                          title="Reveal in folder"
                        >
                          <SctReveal aria-hidden="true" /> Reveal
                        </button>
                        <button
                          type="button"
                          className="v4-files__row-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditDrawer(row);
                          }}
                          title="Edit working file"
                        >
                          <SctEdit aria-hidden="true" /> Edit
                        </button>
                        <button
                          type="button"
                          className="v4-files__row-action v4-files__row-action--danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmRemoveId(row.id);
                          }}
                          title="Remove from register"
                        >
                          <Trash2 aria-hidden="true" /> Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {filteredRows.length ? (
                <footer className="v4-files__pagination">
                  <span>
                    Showing {pageStart}–{pageEnd} of {filteredRows.length} files
                  </span>
                  <V4Pagination
                    pageCount={pageCount}
                    currentPage={page}
                    onChange={setPage}
                    ariaLabel="Project files pages"
                  />
                </footer>
              ) : null}
            </section>
            {selectedRow ? (
              <aside className="v4-files__inspector" aria-label="Working file details">
                <section className="v4-files__side-card" aria-labelledby="file-inspector-title">
                  <header className="v4-files__side-header">
                    <span className="v4-files__side-icon" aria-hidden="true">
                      {selectedRow.filePath?.toLowerCase().endsWith('.pdf') ? (
                        <SctPdf />
                      ) : (
                        <SctFile />
                      )}
                    </span>
                    <h2 id="file-inspector-title">Working File</h2>
                    <button
                      type="button"
                      className="v4-files__inspector-close"
                      aria-label="Close working file details"
                      onClick={() => setSelectedId(null)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </header>
                  <div className="v4-files__detail-actions">
                    <button
                      type="button"
                      className="v4-files__button"
                      disabled={
                        selectedRow.presence.state !== 'Present' &&
                        selectedRow.presence.state !== 'Outdated'
                      }
                      onClick={() => void handleOpen(selectedRow)}
                    >
                      <SctOpen aria-hidden="true" /> Open
                    </button>
                    <button
                      type="button"
                      className="v4-files__button"
                      disabled={
                        selectedRow.presence.state !== 'Present' &&
                        selectedRow.presence.state !== 'Outdated'
                      }
                      onClick={() => void handleReveal(selectedRow)}
                    >
                      <SctReveal aria-hidden="true" /> Reveal
                    </button>
                    <button
                      type="button"
                      className="v4-files__button"
                      onClick={() => openEditDrawer(selectedRow)}
                    >
                      <SctEdit aria-hidden="true" /> Edit
                    </button>
                  </div>
                  <dl className="v4-files__summary-list">
                    <div>
                      <dt>File presence</dt>
                      <dd>{presenceLabel(selectedRow.presence.state)}</dd>
                    </div>
                    <div>
                      <dt>Title</dt>
                      <dd>{selectedRow.title}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{selectedRow.categoryLabel}</dd>
                    </div>
                    <div>
                      <dt>Document status</dt>
                      <dd>{selectedRow.statusLabel}</dd>
                    </div>
                    <div>
                      <dt>Revision</dt>
                      <dd>{selectedRow.revision || '—'}</dd>
                    </div>
                    <div>
                      <dt>Document Number</dt>
                      <dd>{selectedRow.documentNumber || '—'}</dd>
                    </div>
                    <div>
                      <dt>File name</dt>
                      <dd className="v4-files__summary-path" title={selectedRow.filePath}>
                        {selectedRow.fileName || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatUpdatedAt(selectedRow.updatedAt)}</dd>
                    </div>
                    {selectedRow.notes ? (
                      <div>
                        <dt>Notes</dt>
                        <dd>{selectedRow.notes}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {selectedRow.presence.state === 'Present' &&
                  /\.(?:dwg|dxf|dwt)$/i.test(selectedRow.filePath) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setToolSessionRequest({
                          token: Date.now(),
                          artifactType: 'CAD_WORKING_DRAWING',
                          sourceDocumentId: selectedRow.id,
                        });
                        setInternalView('outputs');
                      }}
                    >
                      Start AutoCAD Working Drawing Session
                    </button>
                  ) : null}
                  {selectedRow.presence.state === 'Present' &&
                  /\.(?:evo|dlx)$/i.test(selectedRow.filePath) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setToolSessionRequest({
                          token: Date.now(),
                          artifactType: 'DIALUX_REPORT',
                          sourceDocumentId: selectedRow.id,
                        });
                        setInternalView('outputs');
                      }}
                    >
                      Start DIALux Report Session
                    </button>
                  ) : null}
                  {selectedRow.presence.state === 'Missing' ? (
                    <p className="v4-files__missing-note" role="status">
                      <AlertTriangle aria-hidden="true" />
                      {selectedRow.presence.note}
                    </p>
                  ) : null}
                </section>
              </aside>
            ) : null}
          </div>
        ) : null}
        {!loading && !pageError && internalView === 'outputs' && projectQuery.data ? (
          <OutputActivity
            project={projectQuery.data}
            documents={documents}
            openRequest={toolSessionRequest}
            onAddSource={() => {
              setInternalView('working');
              void openAddDrawer();
            }}
          />
        ) : null}
      </main>

      <V4FloatingWorkspace
        panelClassName="v4-working-file-float"
        open={drawerOpen}
        title={selectedDocument ? 'Edit Working File' : 'Add Working File'}
        description="Register a local working file to this project. Revisions capture immutable snapshots separately."
        dismissible={!saveFile.isPending}
        onRequestClose={requestCloseDrawer}
        footer={
          <div className="v4-files__drawer-footer">
            <button
              type="button"
              className="v4-files__button v4-files__button--secondary"
              disabled={saveFile.isPending}
              onClick={requestCloseDrawer}
            >
              Cancel
            </button>
            <button
              type="button"
              className="v4-files__button v4-files__button--primary"
              onClick={() => void saveDrawer()}
              disabled={saveFile.isPending}
            >
              {saveFile.isPending ? 'Saving…' : editingId ? 'Save Changes' : 'Register File'}
            </button>
          </div>
        }
      >
        <V4ConfirmDialog
          open={Boolean(leave)}
          destructive
          title="Unsaved file changes"
          description="Save your changes before closing?"
          cancelLabel="Keep editing"
          confirmLabel="Discard"
          pending={saveFile.isPending}
          onCancel={() => {
            leave?.cancel();
            setLeave(null);
          }}
          onConfirm={() => {
            const next = leave;
            setLeave(null);
            closeDrawer();
            next?.proceed();
          }}
          additionalAction={
            <V4Button disabled={saveFile.isPending} onClick={() => void saveDrawer()}>
              Save changes
            </V4Button>
          }
        />
        <div className="v4-files__form">
          <label className="v4-files__field">
            <span>File</span>
            <div className="v4-files__file-picker">
              <input
                aria-label="Selected working file path"
                value={draft.filePath}
                readOnly
                placeholder="No file selected"
              />
              <button
                type="button"
                className="v4-files__button v4-files__button--secondary"
                onClick={async () => {
                  const selected = await pickWorkingFile();
                  if (selected) setDraft((current) => ({ ...current, filePath: selected }));
                }}
              >
                <FolderOpen aria-hidden="true" /> Choose File
              </button>
            </div>
          </label>
          <label className="v4-files__field">
            <span>Title</span>
            <input
              aria-label="Working file title"
              value={draft.title}
              placeholder="e.g. Ground Floor Lighting Layout"
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>
          <label className="v4-files__field">
            <span>Category</span>
            <select
              aria-label="Working file category"
              value={draft.category}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  category: event.target.value as ProjectDocument['category'],
                }))
              }
            >
              {documentCategoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="v4-files__field">
            <span>Notes</span>
            <textarea
              aria-label="Working file notes"
              value={draft.notes}
              rows={3}
              placeholder="Optional notes"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </label>
          {drawerError ? (
            <div className="v4-files__error" role="alert">
              <AlertTriangle aria-hidden="true" />
              {drawerError}
            </div>
          ) : null}
        </div>
      </V4FloatingWorkspace>

      <V4ConfirmDialog
        open={confirmRemoveId !== null}
        title="Remove from Register"
        description="Remove this working-file registration? The original file on disk will not be deleted."
        cancelLabel="Cancel"
        confirmLabel="Remove from Register"
        destructive
        pending={removeFile.isPending}
        onCancel={() => setConfirmRemoveId(null)}
        onConfirm={() => {
          const row = rows.find((item) => item.id === confirmRemoveId);
          if (row) void handleRemove(row);
        }}
      />
    </V4AppShell>
  );
}
