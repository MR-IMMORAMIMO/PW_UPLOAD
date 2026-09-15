import type { LinkedThreadItem } from './commentsViewModel';
import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SctFilter as Filter } from '../../components/common/SctIcons';
import { MessageSquareText, Plus, Search, X } from '../../components/common/SctIcons';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ProjectReviewItem, ProjectReviewReply, ReviewItemStatus } from '@scli/domain';
import { ReplyEditor } from './ReplyEditor';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { api } from '../../api/environment';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
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
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import { CommentDrawer, type CommentDraft } from './CommentDrawer';
import {
  COMMENTS_PER_PAGE,
  attachmentsForThread,
  commentFilterCounts,
  deriveParticipants,
  effectiveCommentPage,
  filterComments,
  formatCommentStatus,
  linkedItemsForThread,
  repliesForThread,
  reviewUpdateInput,
  type CommentPrimaryFilter,
  type CommentStatusFilter,
} from './commentsViewModel';
import type { ReplySubmitInput } from './ReplyComposer';
import FinalCommentsView from '../../components/final-ui/FinalCommentsView';
import { V4Drawer } from '../../components/common/V4Drawer';
import { ReplyComposer } from './ReplyComposer';
import { ThreadCard } from './ThreadCard';
import { ThreadDetailsInspector } from './ThreadDetailsInspector';
import { pickWorkingFile } from '../../desktop/files';
import type { ContactDraft } from '../project-contacts/ContactDrawer';

const reviewStatuses: ReviewItemStatus[] = [
  'Open',
  'Accepted',
  'InProgress',
  'Resolved',
  'Rejected',
];
const sourceTypes = ['Manual', 'Email', 'Meeting', 'PDF', 'Drawing'] as const;

const messageFor = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type PendingAttachment = {
  kind: 'root' | 'reply';
  reviewItemId: string;
  replyId?: string;
  documentId: string;
  remaining?: string[];
};

export function ProjectCommentsWorkspace({ finalView = false }: { finalView?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedThreadId = searchParams.get('threadId');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [advancedReply, setAdvancedReply] = useState<ProjectReviewItem | null>(null);
  const [editingReply, setEditingReply] = useState<ProjectReviewReply | null>(null);
  const [replyCanSend, setReplyCanSend] = useState(false);
  const [linkedThread, setLinkedThread] = useState<ProjectReviewItem | null>(null);
  const [primary, setPrimary] = useState<CommentPrimaryFilter>('All');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CommentStatusFilter>('');
  const [sourceType, setSourceType] = useState('');
  const [due, setDue] = useState<'' | 'Due' | 'NoDueDate'>('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [drawerItem, setDrawerItem] = useState<ProjectReviewItem | null | undefined>(undefined);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingAttachment = pendingAttachments[0] ?? null;
  const attachmentWarning = pendingAttachment
    ? pendingAttachment.kind === 'reply'
      ? 'Reply posted, but the document could not be linked.'
      : 'Comment created, but the document could not be linked.'
    : null;
  const linkingTargets = useRef(new Set<string>());
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const initialSelectionAppliedRef = useRef<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['v4', 'comments', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'comments', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const contextQuery = useQuery({
    queryKey: ['v4', 'comments', 'thread-context', projectId],
    queryFn: () => api.listReviewThreadContext(projectId as string),
    enabled: Boolean(projectId),
  });

  const refreshWorkspace = () =>
    queryClient.invalidateQueries({ queryKey: ['v4', 'comments', 'workspace', projectId] });
  const refreshContext = () =>
    queryClient.invalidateQueries({ queryKey: ['v4', 'comments', 'thread-context', projectId] });

  const saveRoot = useMutation({
    mutationFn: async ({
      item,
      draft,
    }: {
      item: ProjectReviewItem | null;
      draft: CommentDraft;
    }) => {
      if (item) {
        return api.updateReviewItem(
          projectId as string,
          item.id,
          reviewUpdateInput(item, {
            title: draft.title.trim(),
            description: draft.description.trim(),
            sourceType: draft.sourceType,
            receivedAt: draft.receivedAt,
            dueDate: draft.dueDate || null,
            area: draft.area.trim(),
            drawingReference: draft.drawingReference.trim(),
            revisionId: draft.revisionId || null,
            luminaireId: draft.luminaireId || null,
          }),
        );
      }
      return api.createReviewThread(projectId as string, {
        reference: '',
        title: draft.title.trim(),
        description: draft.description.trim(),
        area: draft.area.trim(),
        luminaireTag: '',
        drawingReference: draft.drawingReference.trim(),
        sourceType: draft.sourceType,
        sourceId: null,
        status: 'Open',
        response: '',
        revisionId: draft.revisionId || null,
        luminaireId: draft.luminaireId || null,
        receivedAt: draft.receivedAt,
        dueDate: draft.dueDate || null,
        ...(draft.origin === 'Client'
          ? {
              origin: 'Client' as const,
              authorName: draft.authorName.trim(),
              authorRole: draft.authorRole.trim(),
            }
          : { origin: 'Internal' as const }),
      });
    },
  });

  const lifecycle = useMutation({
    mutationFn: ({ item, status: next }: { item: ProjectReviewItem; status: ReviewItemStatus }) =>
      api.updateReviewItem(projectId as string, item.id, reviewUpdateInput(item, { status: next })),
    onSuccess: () => refreshWorkspace(),
  });

  const createReply = useMutation({
    mutationFn: ({ reviewItemId, input }: { reviewItemId: string; input: ReplySubmitInput }) =>
      api.createReviewReply(projectId as string, reviewItemId, {
        body: input.body,
        ...input.author,
      }),
  });

  const workspace = workspaceQuery.data;
  const [replyDirty, setReplyDirty] = useState(false);
  const [discardReply, setDiscardReply] = useState(false);
  const replyNavigation = useRef<{ proceed: () => void; cancel: () => void } | null>(null);
  useV4DirtySurface(Boolean(advancedReply) && replyDirty, (_reason, proceed, cancel) => {
    if (createReply.isPending) {
      cancel();
      return;
    }
    replyNavigation.current = { proceed, cancel };
    setDiscardReply(true);
  });
  const addFile = async () => {
    if (!window.scliDesktop?.selectFile)
      throw new Error('Attach a local file in the desktop application.');
    const filePath = await pickWorkingFile();
    if (!filePath) return null;
    const normalize = (value: string) => value.replaceAll('\\', '/').toLowerCase();
    const fresh = await api.projectWorkspace(projectId as string);
    const existing = fresh.documents.find(
      (document) => normalize(document.filePath) === normalize(filePath),
    );
    if (existing) return existing;
    const document = await api.createDocument(projectId as string, {
      title: filePath.split(/[\\/]/).pop() || 'Attachment',
      category: 'Other',
      documentNumber: '',
      revision: '',
      status: 'Working',
      filePath,
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    await refreshWorkspace();
    return document;
  };
  const addContact = async (input: ContactDraft) => {
    const existing = workspace?.contacts.find(
      (contact) =>
        !contact.archived &&
        contact.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
        contact.email.trim().toLowerCase() === input.email.trim().toLowerCase(),
    );
    if (existing) return existing;
    const contact = await api.createContact(projectId as string, input);
    await refreshWorkspace();
    return contact;
  };
  const roots = workspace?.reviewItems ?? [];
  const replies = contextQuery.data?.replies ?? [];
  const attachments = contextQuery.data?.attachments ?? [];
  const counts = useMemo(() => commentFilterCounts(roots), [roots]);
  const filtered = useMemo(
    () => filterComments(roots, replies, { primary, query, status, sourceType, due }),
    [due, primary, query, replies, roots, sourceType, status],
  );
  const safePage = effectiveCommentPage(page, filtered.length);
  const pageItems = filtered.slice(
    safePage * COMMENTS_PER_PAGE,
    (safePage + 1) * COMMENTS_PER_PAGE,
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / COMMENTS_PER_PAGE));
  const selected = filtered.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    const requestKey = `${projectId}:${requestedThreadId ?? ''}`;
    if (initialSelectionAppliedRef.current === requestKey || pageItems.length === 0) return;
    initialSelectionAppliedRef.current = requestKey;
    const requested = roots.find(
      (item) => item.id === requestedThreadId && item.projectId === projectId,
    );
    if (requestedThreadId && !requested) {
      setSelectedId(null);
      setReplyError('The linked comment is not available in this project.');
      return;
    }
    setSelectedId(requested?.id ?? pageItems[0]!.id);
  }, [pageItems, roots, requestedThreadId, projectId]);

  useEffect(() => {
    if (selectedId && !filtered.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

  const selectPrimary = (next: CommentPrimaryFilter) => {
    setPrimary(next);
    setPage(0);
  };
  const submitReply = async (item: ProjectReviewItem, input: ReplySubmitInput) => {
    setReplyError(null);
    try {
      const created = await createReply.mutateAsync({ reviewItemId: item.id, input });
      await refreshContext();
      await linkAttachments({ kind: 'reply', reviewItemId: item.id, replyId: created.id }, [
        ...new Set(
          [input.documentId, ...(input.documentIds ?? [])].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      ]);
      setAdvancedReply(null);
      setReplyDirty(false);
      setDiscardReply(false);
      const next = replyNavigation.current;
      replyNavigation.current = null;
      next?.proceed();
      return true;
    } catch (error) {
      setReplyError(messageFor(error, 'Reply could not be posted. Your draft has been kept.'));
      return false;
    }
  };
  const linkAttachments = async (
    target: Omit<PendingAttachment, 'documentId' | 'remaining'>,
    ids: string[],
  ) => {
    if (!ids.length) return;
    const key = `${target.reviewItemId}:${target.replyId ?? 'root'}`;
    if (linkingTargets.current.has(key)) return;
    linkingTargets.current.add(key);
    const sameTarget = (item: PendingAttachment) =>
      item.reviewItemId === target.reviewItemId && item.replyId === target.replyId;
    const earlier = pendingAttachments.find(sameTarget);
    ids = [
      ...new Set([...(earlier ? [earlier.documentId, ...(earlier.remaining ?? [])] : []), ...ids]),
    ];
    try {
      for (let i = 0; i < ids.length; i++) {
        const documentId = ids[i]!;
        try {
          if (target.kind === 'reply' && target.replyId)
            await api.linkReviewReplyDocument(projectId!, target.reviewItemId, target.replyId, {
              documentId,
            });
          else await api.linkReviewItemDocument(projectId!, target.reviewItemId, { documentId });
        } catch {
          setPendingAttachments((previous) => [
            ...previous.filter((item) => !sameTarget(item)),
            { ...target, documentId, remaining: ids.slice(i + 1) },
          ]);
          await refreshContext();
          return;
        }
      }
      await refreshContext();
      setPendingAttachments((previous) => previous.filter((item) => !sameTarget(item)));
    } finally {
      linkingTargets.current.delete(key);
    }
  };
  const retryAttachment = async () => {
    for (const attachment of pendingAttachments)
      await linkAttachments(attachment, [attachment.documentId, ...(attachment.remaining ?? [])]);
  };
  const saveDrawer = async (draft: CommentDraft) => {
    setDrawerError(null);
    try {
      const wasNew = drawerItem === null;
      const saved = await saveRoot.mutateAsync({ item: drawerItem ?? null, draft });
      await refreshWorkspace();
      if (wasNew) setSelectedId(saved.id);
      await linkAttachments({ kind: 'root', reviewItemId: saved.id }, [
        ...new Set([draft.documentId, ...(draft.documentIds ?? [])].filter(Boolean)),
      ]);
      setDrawerItem(undefined);
      return true;
    } catch (error) {
      setDrawerError(messageFor(error, 'Comment could not be saved. Your draft has been kept.'));
      return false;
    }
  };

  const openLinkedItem = (link: LinkedThreadItem) => {
    if (link.kind === 'luminaire')
      navigate('/projects/' + projectId + '/luminaires?luminaireId=' + encodeURIComponent(link.id));
    else if (link.kind === 'revision')
      navigate('/projects/' + projectId + '/revisions?revisionId=' + encodeURIComponent(link.id));
    else if (link.kind === 'document')
      navigate('/projects/' + projectId + '/files?documentId=' + encodeURIComponent(link.id));
  };
  const routes: Record<string, string> = {
    summary: ROUTE_PROJECT_SUMMARY,
    workflow: ROUTE_PROJECT_WORKFLOW_TIMELINE,
    scope: ROUTE_PROJECT_SCOPE,
    actions: ROUTE_PROJECT_ACTIONS,
    meetings: ROUTE_PROJECT_MEETINGS,
    comments: ROUTE_PROJECT_COMMENTS,
    datasheets: ROUTE_PROJECT_DATASHEETS_IMAGES,
    'technical-check': ROUTE_PROJECT_TECHNICAL_CHECK,
    'lighting-schedule': ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
    'technical-boq': ROUTE_PROJECT_TECHNICAL_BOQ,
  };
  const loading = projectQuery.isLoading || workspaceQuery.isLoading;
  const pageError = projectQuery.isError || workspaceQuery.isError;
  const hasSecondaryFilters = Boolean(status || sourceType || due);

  return (
    <V4AppShell
      context="project"
      boundedPage
      finalContacts={finalView}
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="comments"
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
              projectQueryKey={['v4', 'comments', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        finalView ? undefined : (
          <V4PageHeader
            icon={MessageSquareText}
            title="Comments"
            description="Track internal notes, client feedback, and resolved discussion threads."
            actions={
              <button
                type="button"
                className="v4-comments__primary"
                onClick={() => {
                  setDrawerError(null);
                  setDrawerItem(null);
                }}
              >
                <Plus aria-hidden="true" /> Add Comment
              </button>
            }
          />
        )
      }
    >
      {finalView ? (
        <div
          className="final-ui-reference"
          data-testid="v4-project-comments"
          style={{ flexDirection: 'column', minHeight: 0 }}
        >
          <FinalProjectHeader />
          {loading ? (
            <p role="status">Loading comments…</p>
          ) : pageError ? (
            <div role="alert">
              Comments could not be loaded.
              <button
                onClick={() => {
                  void Promise.all([projectQuery.refetch(), workspaceQuery.refetch()]);
                }}
              >
                Retry
              </button>
            </div>
          ) : workspace ? (
            <FinalCommentsView
              binding={{
                workspace,
                items: filtered,
                replies,
                attachments,
                counts,
                primary,
                setPrimary: selectPrimary,
                query,
                setQuery,
                selectedId,
                select: setSelectedId,
                add: () => {
                  setDrawerError(null);
                  setDrawerItem(null);
                },
                edit: (item) => {
                  setDrawerError(null);
                  setDrawerItem(item);
                },
                resolve: (item) =>
                  lifecycle.mutate({
                    item,
                    status: item.status === 'Resolved' ? 'Open' : 'Resolved',
                  }),
                pending: lifecycle.isPending || createReply.isPending,
                submit: (item, body, documentIds) =>
                  submitReply(item, {
                    body,
                    author: { origin: 'Internal' },
                    documentId: null,
                    ...(documentIds ? { documentIds } : {}),
                  }),
                attachFile: addFile,
                openLink: openLinkedItem,
                advancedReply: setAdvancedReply,
                editReply: setEditingReply,
                linked: setLinkedThread,
                replyLinked: (item) => setLinkedThread(item),
                filter: () => setFilterOpen((current) => !current),
                filterContent: filterOpen ? (
                  <div className="v4-comments__filter-popover">
                    <label>
                      <span>Status</span>
                      <select
                        value={status}
                        onChange={(event) => {
                          setStatus(event.target.value as CommentStatusFilter);
                          setPage(0);
                        }}
                      >
                        <option value="">All statuses</option>
                        {reviewStatuses.map((value) => (
                          <option key={value} value={value}>
                            {formatCommentStatus(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Source</span>
                      <select
                        value={sourceType}
                        onChange={(event) => {
                          setSourceType(event.target.value);
                          setPage(0);
                        }}
                      >
                        <option value="">All sources</option>
                        {sourceTypes.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Due date</span>
                      <select
                        value={due}
                        onChange={(event) => {
                          setDue(event.target.value as typeof due);
                          setPage(0);
                        }}
                      >
                        <option value="">Any due state</option>
                        <option value="Due">Has due date</option>
                        <option value="NoDueDate">No due date</option>
                      </select>
                    </label>
                    {hasSecondaryFilters ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStatus('');
                          setSourceType('');
                          setDue('');
                          setPage(0);
                        }}
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                ) : null,
                notice: (
                  <>
                    {contextQuery.isError ? (
                      <div role="alert">
                        Replies and linked documents could not be loaded.
                        <button onClick={() => void contextQuery.refetch()}>Retry</button>
                      </div>
                    ) : null}
                    {replyError || lifecycle.error ? (
                      <p role="alert">
                        {replyError ?? messageFor(lifecycle.error, 'Status could not be saved.')}
                      </p>
                    ) : null}
                    {attachmentWarning ? (
                      <p role="status">
                        {attachmentWarning}
                        <button onClick={() => void retryAttachment()}>Retry link</button>
                      </p>
                    ) : null}
                  </>
                ),
              }}
            />
          ) : null}
        </div>
      ) : (
        <main className="v4-comments v4-bounded-page" data-testid="v4-project-comments">
          {loading ? (
            <div className="v4-comments__state" aria-busy="true">
              Loading comments…
            </div>
          ) : null}
          {pageError ? (
            <div className="v4-comments__state" role="alert">
              <strong>Comments could not be loaded.</strong>
              <button
                type="button"
                onClick={() => void Promise.all([projectQuery.refetch(), workspaceQuery.refetch()])}
              >
                Retry
              </button>
            </div>
          ) : null}
          {!loading && !pageError ? (
            <>
              <div className="v4-comments__toolbar" aria-label="Comment filters">
                <div className="v4-comments__primary-filters">
                  {(['All', 'Client', 'Internal', 'Resolved'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      aria-pressed={primary === filter}
                      onClick={() => selectPrimary(filter)}
                    >
                      {filter}
                      <span aria-label={`${counts[filter]} comments`}>{counts[filter]}</span>
                    </button>
                  ))}
                </div>
                <label className="v4-comments__search">
                  <Search aria-hidden="true" />
                  <span className="v4-visually-hidden">Search comments, people, or keywords</span>
                  <input
                    aria-label="Search comments, people, or keywords"
                    value={query}
                    placeholder="Search comments, people, or keywords..."
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(0);
                    }}
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear comment search"
                      onClick={() => setQuery('')}
                    >
                      <X aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <div className="v4-comments__filter-control">
                  <button
                    type="button"
                    aria-label="Filter comments"
                    aria-expanded={filterOpen}
                    data-active={hasSecondaryFilters || undefined}
                    onClick={() => setFilterOpen((current) => !current)}
                  >
                    <Filter aria-hidden="true" />
                  </button>
                  {filterOpen ? (
                    <div className="v4-comments__filter-popover">
                      <label>
                        <span>Status</span>
                        <select
                          value={status}
                          onChange={(event) => {
                            setStatus(event.target.value as CommentStatusFilter);
                            setPage(0);
                          }}
                        >
                          <option value="">All statuses</option>
                          {reviewStatuses.map((value) => (
                            <option key={value} value={value}>
                              {formatCommentStatus(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Source</span>
                        <select
                          value={sourceType}
                          onChange={(event) => {
                            setSourceType(event.target.value);
                            setPage(0);
                          }}
                        >
                          <option value="">All sources</option>
                          {sourceTypes.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Due date</span>
                        <select
                          value={due}
                          onChange={(event) => {
                            setDue(event.target.value as typeof due);
                            setPage(0);
                          }}
                        >
                          <option value="">Any due state</option>
                          <option value="Due">Has due date</option>
                          <option value="NoDueDate">No due date</option>
                        </select>
                      </label>
                      {hasSecondaryFilters ? (
                        <button
                          type="button"
                          onClick={() => {
                            setStatus('');
                            setSourceType('');
                            setDue('');
                            setPage(0);
                          }}
                        >
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {contextQuery.isError ? (
                <div className="v4-comments__context-error" role="alert">
                  <span>Replies and linked documents could not be loaded.</span>
                  <button type="button" onClick={() => void contextQuery.refetch()}>
                    Retry
                  </button>
                </div>
              ) : null}
              {attachmentWarning &&
              (pendingAttachment?.kind === 'root' || pendingAttachments.length > 1) ? (
                <div className="v4-comments__global-warning" role="status">
                  <span>{attachmentWarning}</span>
                  {pendingAttachment ? (
                    <button type="button" onClick={() => void retryAttachment()}>
                      Retry link
                    </button>
                  ) : null}
                </div>
              ) : null}
              {roots.length === 0 ? (
                <section className="v4-comments__empty">
                  <strong>No comments yet</strong>
                  <p>
                    Comments keeps client feedback and internal project review threads together.
                  </p>
                  <button
                    type="button"
                    className="v4-comments__primary"
                    onClick={() => setDrawerItem(null)}
                  >
                    <Plus aria-hidden="true" /> Add Comment
                  </button>
                </section>
              ) : filtered.length === 0 ? (
                <section className="v4-comments__empty">
                  <strong>No comments match the current filters.</strong>
                  <button
                    type="button"
                    onClick={() => {
                      selectPrimary('All');
                      setQuery('');
                      setStatus('');
                      setSourceType('');
                      setDue('');
                    }}
                  >
                    Clear Filters
                  </button>
                </section>
              ) : (
                <div
                  className={`v4-comments__workspace${selected ? ' v4-comments__workspace--inspector-open' : ''}`}
                >
                  <section className="v4-comments__collection" aria-label="Project comment threads">
                    <div className="v4-comments__thread-list">
                      {pageItems.map((item) => {
                        const itemReplies = repliesForThread(replies, item.id);
                        const replyIds = new Set(itemReplies.map((reply) => reply.id));
                        const itemAttachments = attachmentsForThread(
                          attachments,
                          item.id,
                          replyIds,
                        );
                        const linkedItems = linkedItemsForThread(
                          item,
                          itemAttachments,
                          workspace?.revisions ?? [],
                          workspace?.luminaires ?? [],
                          workspace?.documents ?? [],
                        );
                        const participants = deriveParticipants(item, itemReplies);
                        return (
                          <ThreadCard
                            key={item.id}
                            item={item}
                            selected={selectedId === item.id}
                            replies={itemReplies}
                            attachments={itemAttachments}
                            documents={workspace?.documents ?? []}
                            linkedItems={linkedItems}
                            participants={participants}
                            focusRequest={composerFocusRequest}
                            replyPending={createReply.isPending}
                            replyError={selectedId === item.id ? replyError : null}
                            replyWarning={
                              pendingAttachments.some(
                                (pending) =>
                                  pending.reviewItemId === item.id && pending.kind === 'reply',
                              )
                                ? attachmentWarning
                                : null
                            }
                            contextAvailable={!contextQuery.isError && !contextQuery.isLoading}
                            lifecyclePending={lifecycle.isPending}
                            onSelect={(button) => {
                              selectedTriggerRef.current = button;
                              setSelectedId(item.id);
                              setReplyError(null);
                            }}
                            onReply={() => {
                              setSelectedId(item.id);
                              setComposerFocusRequest((current) => current + 1);
                            }}
                            onEdit={() => {
                              setDrawerError(null);
                              setDrawerItem(item);
                            }}
                            onLifecycle={() =>
                              lifecycle.mutate({
                                item,
                                status: item.status === 'Resolved' ? 'Open' : 'Resolved',
                              })
                            }
                            onSubmitReply={(input) => submitReply(item, input)}
                            onRetryAttachment={
                              pendingAttachment?.kind === 'reply'
                                ? () => void retryAttachment()
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                    {pageCount > 1 ? (
                      <V4Pagination
                        pageCount={pageCount}
                        currentPage={safePage}
                        onChange={setPage}
                        ariaLabel="Comment pages"
                      />
                    ) : null}
                  </section>
                  {selected ? (
                    <ThreadDetailsInspector
                      item={selected}
                      linkedItems={linkedItemsForThread(
                        selected,
                        attachmentsForThread(
                          attachments,
                          selected.id,
                          new Set(repliesForThread(replies, selected.id).map((reply) => reply.id)),
                        ),
                        workspace?.revisions ?? [],
                        workspace?.luminaires ?? [],
                        workspace?.documents ?? [],
                      )}
                      participants={deriveParticipants(
                        selected,
                        repliesForThread(replies, selected.id),
                      )}
                      lifecyclePending={lifecycle.isPending}
                      onLifecycle={() =>
                        lifecycle.mutate({
                          item: selected,
                          status: selected.status === 'Resolved' ? 'Open' : 'Resolved',
                        })
                      }
                      onClose={() => {
                        setSelectedId(null);
                        requestAnimationFrame(() => selectedTriggerRef.current?.focus());
                      }}
                    />
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </main>
      )}
      {editingReply && (
        <ReplyEditor
          key={editingReply.id}
          reply={editingReply}
          attachments={
            <section aria-label="Reply attachments">
              {attachments
                .filter((a) => a.replyId === editingReply.id)
                .map((a) => {
                  const document = workspace?.documents.find((d) => d.id === a.documentId);
                  return document ? (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        openLinkedItem({
                          kind: 'document',
                          id: document.id,
                          title: document.title,
                          detail: '',
                          meta: '',
                        })
                      }
                    >
                      {document.title}
                    </button>
                  ) : null;
                })}
            </section>
          }
          onClose={() => setEditingReply(null)}
          onSave={async (body) => {
            await api.updateReviewReply(
              projectId as string,
              editingReply.reviewItemId,
              editingReply.id,
              { body, expectedUpdatedAt: editingReply.updatedAt },
            );
            await refreshContext();
          }}
        />
      )}
      <V4Drawer
        presentation="float"
        open={Boolean(advancedReply)}
        title="Reply"
        dismissible={!createReply.isPending}
        onClose={() => (replyDirty ? setDiscardReply(true) : setAdvancedReply(null))}
        footer={
          <>
            <button
              type="button"
              disabled={createReply.isPending}
              onClick={() => (replyDirty ? setDiscardReply(true) : setAdvancedReply(null))}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="advanced-comment-reply"
              disabled={!replyCanSend || createReply.isPending}
            >
              Send reply
            </button>
          </>
        }
      >
        <V4ConfirmDialog
          open={discardReply}
          destructive
          title="Unsent reply"
          description="Send your reply before closing?"
          cancelLabel="Continue editing"
          confirmLabel="Discard reply"
          additionalAction={
            <button
              type="submit"
              form="advanced-comment-reply"
              className="v4-comments__primary"
              disabled={!replyCanSend || createReply.isPending}
              onClick={() => setDiscardReply(false)}
            >
              Send reply
            </button>
          }
          onCancel={() => {
            replyNavigation.current?.cancel();
            replyNavigation.current = null;
            setDiscardReply(false);
          }}
          onConfirm={() => {
            const next = replyNavigation.current;
            replyNavigation.current = null;
            setDiscardReply(false);
            setReplyDirty(false);
            setAdvancedReply(null);
            next?.proceed();
          }}
        />
        {advancedReply ? (
          <ReplyComposer
            formId="advanced-comment-reply"
            onCanSendChange={setReplyCanSend}
            key={advancedReply.id}
            threadId={advancedReply.id}
            contacts={workspace?.contacts ?? []}
            onCreateContact={addContact}
            onAddFile={addFile}
            onDirtyChange={setReplyDirty}
            documents={workspace?.documents ?? []}
            clientParticipants={deriveParticipants(
              advancedReply,
              repliesForThread(replies, advancedReply.id),
            ).filter((person) => person.origin === 'Client')}
            pending={createReply.isPending}
            error={replyError}
            warning={attachmentWarning}
            focusRequest={1}
            onSubmit={(input) => submitReply(advancedReply, input)}
            onRetryAttachment={() => void retryAttachment()}
          />
        ) : null}
      </V4Drawer>
      <V4Drawer
        open={Boolean(linkedThread)}
        title="Linked thread details"
        onClose={() => setLinkedThread(null)}
      >
        {linkedThread ? (
          <ThreadDetailsInspector
            embedded
            onOpenLink={openLinkedItem}
            item={linkedThread}
            linkedItems={linkedItemsForThread(
              linkedThread,
              attachmentsForThread(
                attachments,
                linkedThread.id,
                new Set(repliesForThread(replies, linkedThread.id).map((reply) => reply.id)),
              ),
              workspace?.revisions ?? [],
              workspace?.luminaires ?? [],
              workspace?.documents ?? [],
            )}
            participants={deriveParticipants(
              linkedThread,
              repliesForThread(replies, linkedThread.id),
            )}
            lifecyclePending={lifecycle.isPending}
            onClose={() => setLinkedThread(null)}
            onLifecycle={() =>
              lifecycle.mutate({
                item: linkedThread,
                status: linkedThread.status === 'Resolved' ? 'Open' : 'Resolved',
              })
            }
          />
        ) : null}
      </V4Drawer>
      <CommentDrawer
        contacts={workspace?.contacts ?? []}
        onCreateContact={addContact}
        onAddFile={addFile}
        open={drawerItem !== undefined}
        item={drawerItem ?? null}
        revisions={workspace?.revisions ?? []}
        luminaires={workspace?.luminaires ?? []}
        documents={workspace?.documents ?? []}
        pending={saveRoot.isPending}
        error={drawerError}
        warning={null}
        onClose={() => {
          setDrawerItem(undefined);
          setDrawerError(null);
        }}
        onSave={saveDrawer}
        onRetryAttachment={
          pendingAttachment?.kind === 'root' ? () => void retryAttachment() : undefined
        }
      />
    </V4AppShell>
  );
}
