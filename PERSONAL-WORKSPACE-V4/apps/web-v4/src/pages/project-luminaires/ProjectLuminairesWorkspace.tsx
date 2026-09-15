import { studioDocumentSchema } from '@scli/contracts';
import { v4Decisions } from '../../components/interaction/V4Decisions';
import { useWindowPageSize } from '../../components/common/useWindowPageSize';
import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import FinalLuminairesView from '../../components/final-ui/FinalLuminairesView';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SctDownload as ArrowDownToLine,
  SctSort as ArrowUpDown,
  SctFilter as Filter,
  SctMore as MoreVertical,
} from '../../components/common/SctIcons';
import {
  ChevronDown,
  Columns3,
  Lamp,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from '../../components/common/SctIcons';
import type { LuminaireRecord } from '@scli/domain';
import type { LuminaireRecordInput } from '@scli/contracts';
import { api } from '../../api/environment';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { displayLuminaireTechnicalValue } from '../../components/common/luminaireTechnicalDisplay';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
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
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
  ROUTE_LUMINAIRE_LIBRARY,
} from '../../router/routes';
import { LuminaireEditor, emptyLuminaire, luminaireInput } from './LuminaireEditor';
import { BulkLuminaireEditor } from './BulkLuminaireEditor';
import { LuminaireImage } from './LuminaireImage';
import { LuminaireImportDialog } from './LuminaireImportDialog';
import { LuminaireInspector } from './LuminaireInspector';
import { FromLibraryDialog } from './FromLibraryDialog';
import { LibraryUpdateDialog } from './LibraryUpdateDialog';
import { CreateLibraryDraftDialog } from './CreateLibraryDraftDialog';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Button } from '../../components/common/V4Button';
import {
  filterLuminaires,
  luminaireCompleteness,
  nextSelectionAfterDelete,
  type LuminaireFilter,
} from './luminairesViewModel';

type EditorState = { mode: 'add' | 'edit' | 'duplicate'; item: LuminaireRecord | null } | null;
type ColumnKey =
  | 'category'
  | 'description'
  | 'manufacturer'
  | 'model'
  | 'orderingCode'
  | 'wattage'
  | 'lumens'
  | 'lightColor'
  | 'cri'
  | 'beamAngle'
  | 'ipRating'
  | 'quantity'
  | 'mounting'
  | 'cutout'
  | 'dimensions'
  | 'bodyColorFinish'
  | 'driver'
  | 'control'
  | 'emergency'
  | 'unit'
  | 'location'
  | 'sourceName'
  | 'notes';
type ColumnGroup = 'Identity' | 'Photometric' | 'Installation' | 'Electrical' | 'Project';
type ColumnOption = { key: ColumnKey; label: string; short: string; group: ColumnGroup };
const columnOptions: ColumnOption[] = [
  { key: 'manufacturer', label: 'Manufacturer', short: 'Manufacturer', group: 'Identity' },
  { key: 'model', label: 'Model', short: 'Model', group: 'Identity' },
  { key: 'orderingCode', label: 'Ordering Code', short: 'Ordering Code', group: 'Identity' },
  { key: 'category', label: 'Category', short: 'Category', group: 'Identity' },
  { key: 'description', label: 'Description', short: 'Description', group: 'Identity' },
  { key: 'wattage', label: 'Power', short: 'Power', group: 'Photometric' },
  { key: 'lumens', label: 'Lumens', short: 'Lumens', group: 'Photometric' },
  { key: 'lightColor', label: 'CCT', short: 'CCT', group: 'Photometric' },
  { key: 'cri', label: 'CRI', short: 'CRI', group: 'Photometric' },
  { key: 'beamAngle', label: 'Beam / Optic', short: 'Beam', group: 'Photometric' },
  { key: 'ipRating', label: 'IP', short: 'IP', group: 'Installation' },
  { key: 'mounting', label: 'Mounting', short: 'Mounting', group: 'Installation' },
  { key: 'cutout', label: 'Cut-out', short: 'Cut-out', group: 'Installation' },
  { key: 'dimensions', label: 'Dimensions', short: 'Dimensions', group: 'Installation' },
  { key: 'bodyColorFinish', label: 'Finish', short: 'Finish', group: 'Installation' },
  { key: 'driver', label: 'Driver', short: 'Driver', group: 'Electrical' },
  { key: 'control', label: 'Control', short: 'Control', group: 'Electrical' },
  { key: 'emergency', label: 'Emergency', short: 'Emergency', group: 'Electrical' },
  { key: 'quantity', label: 'Quantity', short: 'Qty', group: 'Project' },
  { key: 'unit', label: 'Unit', short: 'Unit', group: 'Project' },
  { key: 'location', label: 'Location', short: 'Location', group: 'Project' },
  { key: 'sourceName', label: 'Source Name', short: 'Source', group: 'Project' },
  { key: 'notes', label: 'Notes', short: 'Notes', group: 'Project' },
];
const defaultColumnKeys: ColumnKey[] = [
  'manufacturer',
  'model',
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'quantity',
  'mounting',
];
const finalColumnKeys: ColumnKey[] = [
  'manufacturer',
  'model',
  'wattage',
  'lightColor',
  'beamAngle',
  'ipRating',
  'quantity',
  'mounting',
];
const columnGroups: ColumnGroup[] = [
  'Identity',
  'Photometric',
  'Installation',
  'Electrical',
  'Project',
];

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function ProjectLuminairesWorkspace({ finalView = false }: { finalView?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const deepLinkApplied = useRef<string | null>(null);
  const addLuminaireButtonRef = useRef<HTMLButtonElement>(null);
  const addToLibraryButtonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [sort, setSort] = useState<{ key: keyof LuminaireRecord; direction: 1 | -1 } | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LuminaireFilter>('all');
  const [category, setCategory] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState<false | 'menu' | 'AutoCadCsv' | 'DialuxCsv'>(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryCompareOpen, setLibraryCompareOpen] = useState(false);
  const [libraryDraftOpen, setLibraryDraftOpen] = useState(false);
  const [descriptionEditor, setDescriptionEditor] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set(finalView ? finalColumnKeys : defaultColumnKeys),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [removeItem, setRemoveItem] = useState<LuminaireRecord | null>(null);
  const [bulk, setBulk] = useState<{ mode: 'edit' | 'remove'; records: LuminaireRecord[] } | null>(
    null,
  );
  const closeMenus = () => {
    setFilterOpen(false);
    setColumnsOpen(false);
    setAddMenuOpen(false);
    setImportOpen((current) => (current === 'menu' ? false : current));
  };
  useEffect(() => {
    if (!filterOpen && !columnsOpen && !addMenuOpen && importOpen !== 'menu') return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.final-luminaire-menu,.v4-luminaires__menu'))
        closeMenus();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [filterOpen, columnsOpen, addMenuOpen, importOpen]);
  const [page, setPage] = useState(0);
  const [requestedPageSize, setPageSize] = useState(finalView ? 0 : 10);
  const estimatedCapacity = useWindowPageSize(0, finalView, 330, 52);
  const [measuredCapacity, setMeasuredCapacity] = useState<number | null>(null);
  const pageSize = requestedPageSize || measuredCapacity || estimatedCapacity || 10;

  const projectQuery = useQuery({
    queryKey: ['v4', 'luminaires', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'luminaires', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const studioImages = useQuery({
    queryKey: ['v4', 'luminaires', 'images', projectId, workspaceQuery.dataUpdatedAt],
    queryFn: async () => {
      const state = await api.projectStudio(projectId!);
      const document = studioDocumentSchema.parse(state.document);
      return Object.fromEntries(
        document.luminaires.flatMap((row) =>
          typeof row.image === 'string' && row.image.startsWith('data:image/')
            ? [[row.id, row.image]]
            : [],
        ),
      );
    },
    enabled: finalView && Boolean(projectId) && Boolean(workspaceQuery.data),
    retry: false,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['v4', 'luminaires', 'workspace', projectId] });
  };
  const luminaires = workspaceQuery.data?.luminaires ?? [];
  const categories = useMemo(
    () => [...new Set(luminaires.map((item) => item.category).filter(Boolean))].sort(),
    [luminaires],
  );
  const filtered = useMemo(
    () =>
      filterLuminaires(luminaires, query, filter, category).sort((a, b) =>
        sort
          ? String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'en', {
              numeric: true,
            }) * sort.direction
          : 0,
      ),
    [luminaires, query, filter, category, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const selected = luminaires.find((item) => item.id === selectedId) ?? null;
  const attachmentQuery = useQuery({
    queryKey: [
      'v4',
      'luminaires',
      'asset-versions',
      projectId,
      selected?.id,
      workspaceQuery.dataUpdatedAt,
    ],
    queryFn: () => api.luminaireAssetVersions(projectId!, selected!.id),
    enabled: finalView && Boolean(projectId && selected),
    retry: false,
  });
  const selectedAttachments = useMemo(() => {
    if (!Array.isArray(attachmentQuery.data)) return undefined;
    const latest = new Map<string, (typeof attachmentQuery.data)[number]>();
    for (const version of attachmentQuery.data) {
      const old = latest.get(version.assetType);
      if (!old || version.versionSequence > old.versionSequence)
        latest.set(version.assetType, version);
    }
    const files = [...latest.values()].map((version) => ({
      label: version.assetType === 'ProductImage' ? 'Product image' : version.assetType,
      path: version.filePath,
      name: version.fileName,
    }));
    for (const known of [
      { label: 'Datasheet', path: selected?.datasheetPath },
      { label: 'Product image', path: selected?.imagePath },
    ])
      if (known.path && !files.some((file) => file.label === known.label))
        files.push({
          label: known.label,
          path: known.path,
          name: known.path.split(/[\\/]/).pop() ?? '',
        });
    return files;
  }, [attachmentQuery.data, selected]);
  const libraryDraftCandidateQuery = useQuery({
    queryKey: ['v4', 'luminaires', 'library-draft-candidate', projectId, selected?.id],
    queryFn: () => api.projectLuminaireLibraryDraftCandidate(projectId as string, selected!.id),
    enabled: Boolean(projectId && selected),
    retry: false,
  });
  const libraryStatusQuery = useQuery({
    queryKey: ['v4', 'luminaires', 'library-status', projectId, selected?.id],
    queryFn: () => api.projectLuminaireLibraryStatus(projectId as string, selected!.id),
    enabled: Boolean(
      projectId &&
      selected &&
      libraryDraftCandidateQuery.data?.eligibility?.reasonCode === 'ALREADY_LINKED',
    ),
    retry: false,
  });

  useEffect(() => {
    const requestKey = `${projectId}:${searchParams.toString()}`;
    if (deepLinkApplied.current === requestKey || !workspaceQuery.data) return;
    const requested = searchParams.get('luminaireId');
    const item = requested
      ? luminaires.find(
          (candidate) => candidate.id === requested && candidate.projectId === projectId,
        )
      : luminaires[0];
    if (!item) {
      if (!requested) return;
      setSelectedId(null);
      setAssetError('The linked luminaire is not available in this project.');
      deepLinkApplied.current = requestKey;
      return;
    }
    setSelectedId(item.id);
    if (requested && searchParams.get('edit') === 'notes') {
      setEditor({ mode: 'edit', item });
    }
    deepLinkApplied.current = requestKey;
  }, [luminaires, searchParams, projectId, workspaceQuery.data]);
  useEffect(() => {
    setPage(0);
  }, [query, filter, category, pageSize]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const saveMutation = useMutation({
    mutationFn: ({
      state,
      draft,
    }: {
      state: NonNullable<EditorState>;
      draft: LuminaireRecordInput;
    }) =>
      state.mode === 'edit' && state.item
        ? api.updateLuminaire(projectId as string, state.item.id, draft)
        : api.addLuminaire(projectId as string, draft),
  });
  const deleteMutation = useMutation({
    mutationFn: (item: LuminaireRecord) => api.deleteLuminaire(projectId as string, item.id),
  });
  const analyzeDatasheetMutation = useMutation({
    mutationFn: (item: LuminaireRecord) =>
      api.analyzeLuminaireDatasheet(projectId as string, item.id),
    onSuccess: refresh,
  });
  const descriptionOverrideMutation = useMutation({
    mutationFn: (value: string | null) =>
      api.updateProjectLuminaireLibraryDescription(projectId as string, selected!.id, {
        descriptionOverride: value,
        expectedBindingRowVersion: libraryStatusQuery.data!.binding.rowVersion,
      }),
    onSuccess: async () => {
      await Promise.all([refresh(), libraryStatusQuery.refetch()]);
      setDescriptionEditor(null);
    },
  });

  const saveEditor = async (draft: LuminaireRecordInput) => {
    if (!editor) return;
    setEditorError(null);
    try {
      const saved = await saveMutation.mutateAsync({ state: editor, draft });
      await refresh();
      setSelectedId(saved.id);
      setEditor(null);
    } catch (error) {
      setEditorError(errorMessage(error, 'Luminaire could not be saved.'));
    }
  };
  const remove = async () => {
    if (!removeItem) return;
    const nextId = nextSelectionAfterDelete(luminaires, removeItem.id);
    try {
      await deleteMutation.mutateAsync(removeItem);
      await refresh();
      setSelectedId(nextId);
      setRemoveItem(null);
    } catch (error) {
      setEditorError(errorMessage(error, 'Luminaire could not be removed.'));
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
  const openEditor = (next: EditorState) => {
    setEditorError(null);
    setEditor(next);
  };
  const editorInitial = editor?.item
    ? {
        ...luminaireInput(editor.item),
        ...(editor.mode === 'duplicate' ? { tag: '', orderingCode: '' } : {}),
      }
    : emptyLuminaire;
  const existingTags = luminaires
    .filter((item) => editor?.mode !== 'edit' || item.id !== editor.item?.id)
    .map((item) => item.tag);
  const start = filtered.length ? page * pageSize + 1 : 0;
  const end = Math.min((page + 1) * pageSize, filtered.length);

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
      activeSectionId="luminaires"
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
      projectLoading={projectQuery.isLoading || workspaceQuery.isLoading}
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
              projectQueryKey={['v4', 'luminaires', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <V4PageHeader
          icon={Lamp}
          title="Luminaires"
          description="Manage tags, technical data, and luminaire records for this project."
        />
      }
    >
      <main
        className={finalView ? 'final-ui-reference' : 'v4-luminaires v4-bounded-page'}
        style={finalView ? { flexDirection: 'column', minHeight: 0 } : undefined}
        data-testid="v4-project-luminaires"
      >
        {finalView ? <FinalProjectHeader /> : null}
        {projectQuery.isLoading || workspaceQuery.isLoading ? (
          <div className="v4-luminaires__state" aria-busy="true">
            Loading luminaires…
          </div>
        ) : null}
        {projectQuery.isError || workspaceQuery.isError ? (
          <div className="v4-luminaires__state" role="alert">
            <strong>Luminaires could not be loaded.</strong>
            <button
              type="button"
              onClick={() => void Promise.all([projectQuery.refetch(), workspaceQuery.refetch()])}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!projectQuery.isLoading &&
        !workspaceQuery.isLoading &&
        !projectQuery.isError &&
        !workspaceQuery.isError ? (
          finalView ? (
            <FinalLuminairesView
              addButtonRef={addLuminaireButtonRef}
              binding={{
                imageSources: studioImages.data ?? {},
                attachments: selectedAttachments,
                attachmentsError: attachmentQuery.isError,
                requestedPageSize,
                libraryActions: selected ? (
                  <details key={selected.id} className="v4-library-actions">
                    <summary>Library actions</summary>
                    <div>
                      {libraryStatusQuery.data ? (
                        <>
                          <V4Button variant="secondary" onClick={() => setLibraryCompareOpen(true)}>
                            Compare / Update from Library
                          </V4Button>
                          <V4Button
                            variant="tertiary"
                            onClick={() => {
                              descriptionOverrideMutation.reset();
                              setDescriptionEditor(
                                libraryStatusQuery.data!.binding.descriptionOverride ?? '',
                              );
                            }}
                          >
                            Project description
                          </V4Button>
                        </>
                      ) : (
                        <V4Button
                          variant="secondary"
                          disabled={!libraryDraftCandidateQuery.data?.eligibility?.eligible}
                          onClick={() => setLibraryDraftOpen(true)}
                        >
                          Add to Library
                        </V4Button>
                      )}
                      {libraryDraftCandidateQuery.isError || libraryStatusQuery.isError ? (
                        <p role="status">
                          Library availability could not be checked. Reselect the luminaire to
                          retry.
                        </p>
                      ) : null}
                    </div>
                  </details>
                ) : null,
                items: pageItems,
                allItems: luminaires,
                bulk: (ids, mode) =>
                  setBulk({ mode, records: luminaires.filter((item) => ids.has(item.id)) }),
                selected,
                query,
                setQuery,
                page,
                pages: pageCount,
                total: filtered.length,
                pageSize,
                reportCapacity: setMeasuredCapacity,
                setPage,
                setPageSize,
                select: setSelectedId,
                edit: (item) =>
                  openEditor({
                    mode: 'edit',
                    item: luminaires.find((row) => row.id === item.id) ?? item,
                  }),
                duplicate: (item) =>
                  openEditor({
                    mode: 'duplicate',
                    item: luminaires.find((row) => row.id === item.id) ?? item,
                  }),
                remove: setRemoveItem,
                add: () => {
                  const next = !addMenuOpen;
                  closeMenus();
                  setAddMenuOpen(next);
                },
                filters: () => {
                  const next = !filterOpen;
                  closeMenus();
                  setFilterOpen(next);
                },
                columns: () => {
                  const next = !columnsOpen;
                  closeMenus();
                  setColumnsOpen(next);
                },
                import: () => {
                  const next = importOpen !== 'menu';
                  closeMenus();
                  setImportOpen(next ? 'menu' : false);
                },
                summaryHref: generatePath(ROUTE_PROJECT_SUMMARY, { projectId: projectId! }),
                openAsset: (path) => {
                  setAssetError(null);
                  const version = attachmentQuery.data?.find((asset) => asset.filePath === path);
                  if (version && selected && window.scliDesktop?.executeDesktopHandoff) {
                    void api
                      .luminaireAssetFileHandoff(projectId!, selected.id, version.id, 'OPEN')
                      .then((handoff) =>
                        window.scliDesktop!.executeDesktopHandoff!(
                          handoff.handoffId,
                          handoff.action,
                        ),
                      )
                      .catch(() => setAssetError('Unable to open asset.'));
                    return;
                  }
                  if (window.scliDesktop?.openPath) {
                    void window.scliDesktop
                      .openPath(path)
                      .then((result) => {
                        if (result) setAssetError(result);
                      })
                      .catch(() => setAssetError('Unable to open asset.'));
                  } else if (/^https:\/\//i.test(path))
                    window.open(path, '_blank', 'noopener,noreferrer');
                  else setAssetError('Open this local asset in the desktop application.');
                },
                columnsShown: columnOptions
                  .filter((column) => visibleColumns.has(column.key))
                  .sort(
                    (a, b) =>
                      (finalColumnKeys.includes(a.key) ? finalColumnKeys.indexOf(a.key) : 99) -
                      (finalColumnKeys.includes(b.key) ? finalColumnKeys.indexOf(b.key) : 99),
                  )
                  .map((column) => ({
                    key: column.key,
                    label: column.key === 'wattage' ? 'Watt' : column.short,
                  })),
                sort: (key) =>
                  setSort((current) => ({
                    key,
                    direction: current?.key === key && current.direction === 1 ? -1 : 1,
                  })),
                toolbar: null,
                notice: assetError ? <p role="alert">{assetError}</p> : null,
                filterMenu: filterOpen ? (
                  <div role="listbox" aria-label="Luminaire filters">
                    {[
                      { value: 'all', label: 'All luminaires' },
                      { value: 'missing-datasheet', label: 'Missing Datasheet' },
                      { value: 'missing-image', label: 'Missing Image' },
                      { value: 'complete-assets', label: 'Complete Assets' },
                    ].map((option) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={filter === option.value}
                        key={option.value}
                        onClick={() => {
                          setFilter(option.value as LuminaireFilter);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                    {categories.length ? (
                      <label>
                        <span>Category</span>
                        <select
                          aria-label="Filter luminaires by category"
                          value={category}
                          onChange={(event) => {
                            setCategory(event.target.value);
                            setFilter(event.target.value ? 'category' : 'all');
                          }}
                        >
                          <option value="">All categories</option>
                          {categories.map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null,
                columnMenu: columnsOpen ? (
                  <div className="v4-luminaires__columns" aria-label="Visible columns">
                    <div className="v4-luminaires__columns-core">
                      <strong>Core identity</strong>
                      <span>Tag and Image stay visible</span>
                    </div>
                    {columnGroups.map((group) => (
                      <section key={group} aria-label={`${group} columns`}>
                        <h3>{group}</h3>
                        {columnOptions
                          .filter((option) => option.group === group)
                          .map((option) => (
                            <label key={option.key}>
                              <input
                                type="checkbox"
                                checked={visibleColumns.has(option.key)}
                                onChange={() =>
                                  setVisibleColumns((current) => {
                                    const next = new Set(current);
                                    if (next.has(option.key)) next.delete(option.key);
                                    else next.add(option.key);
                                    return next;
                                  })
                                }
                              />
                              {option.label}
                            </label>
                          ))}
                      </section>
                    ))}
                    <button
                      type="button"
                      className="v4-luminaires__columns-reset"
                      onClick={() =>
                        setVisibleColumns(new Set(finalView ? finalColumnKeys : defaultColumnKeys))
                      }
                    >
                      Reset to Default
                    </button>
                  </div>
                ) : null,
                importMenu:
                  importOpen === 'menu' ? (
                    <div role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setImportOpen('AutoCadCsv')}
                      >
                        AutoCAD CSV
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setImportOpen('DialuxCsv')}
                      >
                        DIALux CSV
                      </button>
                    </div>
                  ) : null,
                addMenu: addMenuOpen ? (
                  <div role="menu" aria-label="Add Luminaire options">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setLibraryOpen(true);
                      }}
                    >
                      From Master Library
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false);
                        openEditor({ mode: 'add', item: null });
                      }}
                    >
                      Custom / Project-only
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setImportOpen('menu');
                      }}
                    >
                      Import
                    </button>
                  </div>
                ) : null,
              }}
            />
          ) : (
            <div
              className={`v4-luminaires__workspace${selected ? '' : ' v4-luminaires__workspace--closed'}`}
            >
              <section className="v4-luminaires__schedule" aria-label="Luminaire schedule">
                <div className="v4-luminaires__toolbar">
                  <label className="v4-luminaires__search">
                    <span className="v4-visually-hidden">Search luminaires</span>
                    <input
                      type="search"
                      aria-label="Search luminaires"
                      placeholder="Search luminaires..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <Search aria-hidden="true" />
                    {query ? (
                      <button
                        type="button"
                        aria-label="Clear luminaire search"
                        onClick={() => setQuery('')}
                      >
                        <X />
                      </button>
                    ) : null}
                  </label>
                  <div className="v4-luminaires__menu">
                    <button
                      ref={addLuminaireButtonRef}
                      type="button"
                      aria-expanded={filterOpen}
                      onClick={() => setFilterOpen((open) => !open)}
                    >
                      <Filter /> Filters <ChevronDown />
                    </button>
                    {filterOpen ? (
                      <div role="listbox" aria-label="Luminaire filters">
                        {[
                          { value: 'all', label: 'All luminaires' },
                          { value: 'missing-datasheet', label: 'Missing Datasheet' },
                          { value: 'missing-image', label: 'Missing Image' },
                          { value: 'complete-assets', label: 'Complete Assets' },
                        ].map((option) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={filter === option.value}
                            key={option.value}
                            onClick={() => {
                              setFilter(option.value as LuminaireFilter);
                              setFilterOpen(false);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                        {categories.length ? (
                          <label>
                            <span>Category</span>
                            <select
                              aria-label="Filter luminaires by category"
                              value={category}
                              onChange={(event) => {
                                setCategory(event.target.value);
                                setFilter(event.target.value ? 'category' : 'all');
                              }}
                            >
                              <option value="">All categories</option>
                              {categories.map((item) => (
                                <option key={item}>{item}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="v4-luminaires__menu">
                    <button
                      type="button"
                      aria-expanded={columnsOpen}
                      onClick={() => setColumnsOpen((open) => !open)}
                    >
                      <Columns3 /> Columns
                    </button>
                    {columnsOpen ? (
                      <div className="v4-luminaires__columns" aria-label="Visible columns">
                        <div className="v4-luminaires__columns-core">
                          <strong>Core identity</strong>
                          <span>Tag and Image stay visible</span>
                        </div>
                        {columnGroups.map((group) => (
                          <section key={group} aria-label={`${group} columns`}>
                            <h3>{group}</h3>
                            {columnOptions
                              .filter((option) => option.group === group)
                              .map((option) => (
                                <label key={option.key}>
                                  <input
                                    type="checkbox"
                                    checked={visibleColumns.has(option.key)}
                                    onChange={() =>
                                      setVisibleColumns((current) => {
                                        const next = new Set(current);
                                        if (next.has(option.key)) next.delete(option.key);
                                        else next.add(option.key);
                                        return next;
                                      })
                                    }
                                  />
                                  {option.label}
                                </label>
                              ))}
                          </section>
                        ))}
                        <button
                          type="button"
                          className="v4-luminaires__columns-reset"
                          onClick={() =>
                            setVisibleColumns(
                              new Set(finalView ? finalColumnKeys : defaultColumnKeys),
                            )
                          }
                        >
                          Reset to Default
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="v4-luminaires__menu">
                    <button
                      type="button"
                      aria-expanded={importOpen === 'menu'}
                      onClick={() => setImportOpen((open) => (open === 'menu' ? false : 'menu'))}
                    >
                      <ArrowDownToLine /> Import <ChevronDown />
                    </button>
                    {importOpen === 'menu' ? (
                      <div role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => setImportOpen('AutoCadCsv')}
                        >
                          AutoCAD CSV
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => setImportOpen('DialuxCsv')}
                        >
                          DIALux CSV
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="v4-luminaires__menu">
                    <button
                      type="button"
                      className="v4-luminaires__primary v4-luminaires__add"
                      aria-expanded={addMenuOpen}
                      onClick={() => setAddMenuOpen((open) => !open)}
                    >
                      <Plus /> Add Luminaire <ChevronDown />
                    </button>
                    {addMenuOpen ? (
                      <div role="menu" aria-label="Add Luminaire options">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAddMenuOpen(false);
                            setLibraryOpen(true);
                          }}
                        >
                          From Master Library
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAddMenuOpen(false);
                            openEditor({ mode: 'add', item: null });
                          }}
                        >
                          Custom / Project-only
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAddMenuOpen(false);
                            setImportOpen('menu');
                          }}
                        >
                          Import
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="v4-luminaires__table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Select all visible luminaires"
                            checked={
                              pageItems.length > 0 &&
                              pageItems.every((item) => item.id === selectedId)
                            }
                            readOnly
                          />
                        </th>
                        <th>
                          Tag <ArrowUpDown />
                        </th>
                        <th>Image</th>
                        {columnOptions.map((column) =>
                          visibleColumns.has(column.key) ? (
                            <th key={column.key}>
                              {column.short} <ArrowUpDown />
                            </th>
                          ) : null,
                        )}
                        <th>
                          Status <ArrowUpDown />
                        </th>
                        <th>
                          <SlidersHorizontal aria-label="Row actions" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((item) => {
                        const state = luminaireCompleteness(item);
                        return (
                          <tr
                            key={item.id}
                            className={
                              item.id === selectedId ? 'v4-luminaires__row--selected' : undefined
                            }
                            onClick={() => setSelectedId(item.id)}
                          >
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${item.tag}`}
                                checked={item.id === selectedId}
                                onChange={() => setSelectedId(item.id)}
                              />
                            </td>
                            <td>
                              <button type="button" onClick={() => setSelectedId(item.id)}>
                                {item.tag}
                              </button>
                            </td>
                            <td>
                              <span className="v4-luminaires__thumb">
                                <LuminaireImage
                                  path={item.imagePath}
                                  alt={`${item.tag} thumbnail`}
                                />
                              </span>
                            </td>
                            {columnOptions.map((column) =>
                              visibleColumns.has(column.key) ? (
                                <td key={column.key}>
                                  {column.key === 'quantity'
                                    ? `${item.quantity.toLocaleString('en-AE')} ${item.unit}`
                                    : displayLuminaireTechnicalValue(
                                        column.key,
                                        String(item[column.key] ?? ''),
                                      )}
                                </td>
                              ) : null,
                            )}
                            <td>
                              <span className="v4-luminaires__status" data-state={state}>
                                {state}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                aria-label={`More actions for ${item.tag}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(item.id);
                                }}
                              >
                                <MoreVertical />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!pageItems.length ? (
                    <div className="v4-luminaires__empty">
                      <strong>
                        {luminaires.length ? 'No luminaires found' : 'No luminaires yet'}
                      </strong>
                      <p>
                        {luminaires.length
                          ? 'Try changing the search or filters.'
                          : 'Add or import the first luminaire.'}
                      </p>
                    </div>
                  ) : null}
                </div>
                <footer className="v4-luminaires__pagination">
                  <span>
                    Showing {start} to {end} of {filtered.length} luminaires
                  </span>
                  <div className="v4-luminaires__page-controls">
                    <button
                      type="button"
                      aria-label="First page"
                      disabled={page === 0}
                      onClick={() => setPage(0)}
                    >
                      ‹|
                    </button>
                    <V4Pagination
                      pageCount={pageCount}
                      currentPage={page}
                      onChange={setPage}
                      ariaLabel="Luminaire pages"
                    />
                    <button
                      type="button"
                      aria-label="Last page"
                      disabled={page === pageCount - 1}
                      onClick={() => setPage(pageCount - 1)}
                    >
                      |›
                    </button>
                  </div>
                  <label>
                    Rows per page
                    <select
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(event) => setPageSize(Number(event.target.value))}
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                    </select>
                  </label>
                </footer>
              </section>
              {selected ? (
                <LuminaireInspector
                  item={selected}
                  onClose={() => setSelectedId(null)}
                  onEdit={() => openEditor({ mode: 'edit', item: selected })}
                  onDuplicate={() => openEditor({ mode: 'duplicate', item: selected })}
                  onRemove={() => setRemoveItem(selected)}
                  analysisPending={analyzeDatasheetMutation.isPending}
                  libraryStatus={libraryStatusQuery.data ?? null}
                  onOpenLibrary={() => {
                    const binding = libraryStatusQuery.data?.binding;
                    if (binding)
                      navigate(
                        `${ROUTE_LUMINAIRE_LIBRARY}?productId=${encodeURIComponent(binding.productId)}&variantId=${encodeURIComponent(binding.variantId)}`,
                      );
                  }}
                  onCompareLibrary={() => setLibraryCompareOpen(true)}
                  onEditLibraryDescription={async () => {
                    const current = libraryStatusQuery.data?.binding.descriptionOverride ?? '';
                    const value = await v4Decisions.prompt(
                      'Project Description Override (leave blank to use the published Library description)',
                      current,
                    );
                    if (value !== null) descriptionOverrideMutation.mutate(value.trim() || null);
                  }}
                  promotionEligible={
                    libraryDraftCandidateQuery.data?.eligibility?.eligible === true
                  }
                  onAddToLibrary={() => setLibraryDraftOpen(true)}
                  addToLibraryButtonRef={addToLibraryButtonRef}
                  onAnalyzeDatasheet={() => analyzeDatasheetMutation.mutate(selected)}
                  onOpenAsset={(path) => {
                    if (window.scliDesktop?.openPath) void window.scliDesktop.openPath(path);
                    else if (/^https:\/\//i.test(path))
                      window.open(path, '_blank', 'noopener,noreferrer');
                  }}
                />
              ) : null}
            </div>
          )
        ) : null}
      </main>
      {bulk && (
        <BulkLuminaireEditor
          projectId={projectId!}
          records={bulk.records}
          mode={bulk.mode}
          onClose={() => setBulk(null)}
          onChanged={refresh}
        />
      )}
      <LuminaireEditor
        open={Boolean(editor)}
        title={
          editor?.mode === 'edit'
            ? 'Edit Luminaire'
            : editor?.mode === 'duplicate'
              ? 'Duplicate Luminaire'
              : 'Add Luminaire'
        }
        initial={editorInitial}
        pending={saveMutation.isPending}
        error={editorError}
        duplicate={editor?.mode === 'duplicate'}
        existingTags={existingTags}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
      />
      <V4FloatingWorkspace
        open={descriptionEditor !== null}
        title="Project description"
        panelClassName="v4-description-workspace"
        onRequestClose={() => setDescriptionEditor(null)}
        dismissible={!descriptionOverrideMutation.isPending}
        footer={
          <V4Button
            variant="primary"
            disabled={descriptionOverrideMutation.isPending}
            onClick={() => descriptionOverrideMutation.mutate(descriptionEditor?.trim() || null)}
          >
            Save description
          </V4Button>
        }
      >
        <div className="v4-p5a-workspace-body">
          <label htmlFor="v4-project-description">Project description</label>
          <textarea
            id="v4-project-description"
            value={descriptionEditor ?? ''}
            maxLength={1000}
            onChange={(event) => setDescriptionEditor(event.target.value)}
          />
          <p>
            Leave blank to use the published Library description. Library records and finalized
            Revisions remain unchanged.
          </p>
          {descriptionOverrideMutation.isError ? (
            <p role="alert">{descriptionOverrideMutation.error.message}</p>
          ) : null}
        </div>
      </V4FloatingWorkspace>
      {libraryOpen && projectId ? (
        <FromLibraryDialog
          projectId={projectId}
          returnFocusRef={addLuminaireButtonRef}
          onClose={() => setLibraryOpen(false)}
          onAdded={(luminaireId) => {
            setLibraryOpen(false);
            void refresh().then(() => setSelectedId(luminaireId));
          }}
        />
      ) : null}
      {libraryCompareOpen && projectId && selected && libraryStatusQuery.data ? (
        <LibraryUpdateDialog
          projectId={projectId}
          luminaireId={selected.id}
          status={libraryStatusQuery.data}
          onClose={() => setLibraryCompareOpen(false)}
          onUpdated={() => {
            setLibraryCompareOpen(false);
            void Promise.all([
              refresh(),
              queryClient.invalidateQueries({
                queryKey: ['v4', 'luminaires', 'library-status', projectId, selected.id],
              }),
            ]);
          }}
        />
      ) : null}
      {libraryDraftOpen && projectId && selected && libraryDraftCandidateQuery.data?.eligibility ? (
        <CreateLibraryDraftDialog
          projectId={projectId}
          luminaireId={selected.id}
          candidate={libraryDraftCandidateQuery.data}
          returnFocusRef={addToLibraryButtonRef}
          onClose={() => setLibraryDraftOpen(false)}
          onCreated={(result) => {
            setLibraryDraftOpen(false);
            navigate(
              `${ROUTE_LUMINAIRE_LIBRARY}?productId=${encodeURIComponent(result.product.productId)}&variantId=${encodeURIComponent(result.variant.variantId)}`,
            );
          }}
        />
      ) : null}
      {importOpen === 'AutoCadCsv' || importOpen === 'DialuxCsv' ? (
        <LuminaireImportDialog
          projectId={projectId as string}
          initialSource={importOpen}
          onClose={() => setImportOpen(false)}
          onCommitted={refresh}
        />
      ) : null}
      {removeItem ? (
        <div className="v4-luminaires__modal-backdrop" role="presentation">
          <section
            className="v4-luminaires__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Remove luminaire"
          >
            <h2>Remove {removeItem.tag}?</h2>
            <p>This removes the luminaire from this project. This action cannot be undone.</p>
            {editorError ? <p role="alert">{editorError}</p> : null}
            <footer>
              <button type="button" onClick={() => setRemoveItem(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => void remove()}
              >
                Remove Luminaire
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </V4AppShell>
  );
}
