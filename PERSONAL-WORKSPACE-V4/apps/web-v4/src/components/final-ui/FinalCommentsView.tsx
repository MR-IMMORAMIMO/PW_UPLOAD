import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
import { useState, type ReactNode } from 'react';
import { useV4DirtySurface } from '../interaction/V4DirtyGuard';
import { V4ConfirmDialog } from '../common/V4ConfirmDialog';
import { V4Button } from '../common/V4Button';
import type {
  ProjectWorkspace,
  ProjectReviewItem,
  ProjectReviewReply,
  ProjectReviewAttachment,
  ProjectDocument,
} from '@scli/domain';
import {
  attachmentsForThread,
  repliesForThread,
  linkedItemsForThread,
  deriveParticipants,
  formatCommentStatus,
  type CommentPrimaryFilter,
  type LinkedThreadItem,
} from '../../pages/project-comments/commentsViewModel';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { useShellData } from './ShellData';
export interface FinalCommentsBinding {
  workspace: ProjectWorkspace;
  items: ProjectReviewItem[];
  replies: ProjectReviewReply[];
  attachments: ProjectReviewAttachment[];
  counts: Record<CommentPrimaryFilter, number>;
  primary: CommentPrimaryFilter;
  setPrimary: (value: CommentPrimaryFilter) => void;
  query: string;
  setQuery: (value: string) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  add: () => void;
  edit: (item: ProjectReviewItem) => void;
  resolve: (item: ProjectReviewItem) => void;
  pending: boolean;
  submit: (item: ProjectReviewItem, body: string, documentIds?: string[]) => Promise<boolean>;
  attachFile?: () => Promise<ProjectDocument | null>;
  openLink?: (item: LinkedThreadItem) => void;
  advancedReply: (item: ProjectReviewItem) => void;
  editReply?: (reply: ProjectReviewReply) => void;
  linked: (item: ProjectReviewItem) => void;
  replyLinked: (item: ProjectReviewItem, reply: ProjectReviewReply) => void;
  filter: () => void;
  filterContent: ReactNode;
  notice: ReactNode;
}
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';

// ── Icons ────────────────────────────────────────────────────────────────────

function IconSearch() {
  return <ApprovedIcons.search size={16} />;
}
function IconFilter() {
  return <ApprovedIcons.filter size={16} />;
}
function IconDots() {
  return <ApprovedIcons.more size={16} />;
}
function IconReply() {
  return <CustomGlyphs.SctComments size="13" style={{ color: '#6b7280' }} />;
}
function IconCheck() {
  return <ApprovedIcons.check size={16} />;
}
function IconChat() {
  return <CustomGlyphs.SctComments size="13" style={{ color: '#6b7280' }} />;
}
function IconDoc() {
  return <ApprovedIcons.file size={16} />;
}
function IconLuminaire() {
  return <ApprovedIcons.luminaires size={16} />;
}
function IconExtLink() {
  return <CustomGlyphs.SctOpen size="12" style={{ color: '#9ca3af' }} />;
}
function IconPaperclip() {
  return <ApprovedIcons.attachment size={16} />;
}
function IconSend() {
  return <CustomGlyphs.SctSend size="14" style={{ color: '#9ca3af' }} />;
}
function IconClose() {
  return <ApprovedIcons.close size={16} />;
}
function IconOpenLinked() {
  return <CustomGlyphs.SctOpen size="12" style={{ color: '#2563eb' }} />;
}

// ── Avatars ───────────────────────────────────────────────────────────────────

function Avatar({ initials, size = 32 }: { initials: string; size?: number; photo?: boolean }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#2563eb',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size < 28 ? 10 : 12,
        fontWeight: 700,
        color: 'var(--v4-action-primary-foreground)',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {initials}
    </div>
  );
}
// ── Data ─────────────────────────────────────────────────────────────────────

export default function FinalCommentsView({ binding: b }: { binding: FinalCommentsBinding }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyId, setReplyId] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, ProjectDocument[]>>({});
  const [fileError, setFileError] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [leave, setLeave] = useState<{ proceed: () => void; cancel: () => void } | null>(null);
  const dirty =
    Object.values(drafts).some((v) => v.trim()) || Object.values(files).some((v) => v.length);
  useV4DirtySurface(dirty, (_reason, proceed, cancel) => setLeave({ proceed, cancel }));
  const send = async (item: ProjectReviewItem) => {
    const body = drafts[item.id]?.trim();
    if (!body) return false;
    const saved = await b.submit(
      item,
      body,
      files[item.id]?.map((d) => d.id),
    );
    if (saved) {
      setDrafts((v) => ({ ...v, [item.id]: '' }));
      setFiles((v) => ({ ...v, [item.id]: [] }));
    }
    return saved;
  };
  const identity = useShellData().identity;
  const THREADS = b.items.map((item) => {
    const replies = repliesForThread(b.replies, item.id);
    const attachments = attachmentsForThread(
      b.attachments,
      item.id,
      new Set(replies.map((reply) => reply.id)),
    );
    const links = linkedItemsForThread(
      item,
      attachments,
      b.workspace.revisions,
      b.workspace.luminaires,
      b.workspace.documents,
    );
    return {
      record: item,
      id: item.id,
      initials: initials(item.authorNameSnapshot ?? ''),
      type: item.origin ?? 'Legacy',
      title: item.title,
      author: item.authorNameSnapshot ?? '—',
      role: item.authorRoleSnapshot ?? '',
      time: formatBusinessDateTime(item.createdAt),
      status: formatCommentStatus(item.status),
      body: item.description,
      linked: links.map((link) => ({
        record: link,
        actionable: ['revision', 'luminaire', 'document'].includes(link.kind),
        id: link.id,
        icon: link.kind === 'luminaire' ? 'lum' : link.kind === 'document' ? 'pdf' : 'doc',
        code: link.title,
        tag: link.detail,
        sub: link.detail,
        sub2: 'meta' in link ? link.meta : '',
        date: '',
      })),
      replyCount: replies.length,
      replies: replies.map((reply) => ({
        record: reply,
        id: reply.id,
        initials: initials(reply.authorNameSnapshot),
        photo: false,
        name: reply.authorNameSnapshot,
        type: reply.origin,
        time:
          formatBusinessDateTime(reply.createdAt) +
          (reply.updatedAt !== reply.createdAt ? ' · Edited' : ''),
        body: reply.body,
        hasLinks: b.attachments.some((attachment) => attachment.replyId === reply.id),
      })),
      showReplyBox: replyId === item.id,
      participants: deriveParticipants(item, replies).map((person) => ({
        id: person.authorId,
        initials: initials(person.name),
        name: person.name,
        role: person.role,
        badge: person.origin,
      })),
    };
  });
  const selected = THREADS.find((thread) => thread.id === b.selectedId);
  const DETAIL = selected
    ? {
        title: selected.title,
        status: selected.status,
        type: selected.type,
        createdBy: selected.author,
        createdAt: selected.time,
        description: selected.body,
        linkedItems: selected.linked,
        participants: selected.participants,
        threadId: selected.id,
        createdFull: selected.time,
      }
    : null;
  const activeTab = b.primary.toLowerCase();
  const tabs = (['All', 'Client', 'Internal', 'Resolved'] as const).map((label) => ({
    id: label.toLowerCase(),
    label,
    count: b.counts[label],
  }));
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: `12px ${LAYOUT.sectionGap}px ${LAYOUT.sectionGap}px`,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* ── Main area ── */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: C.white,
            borderRadius: RADIUS.section,
            border: `1px solid ${C.border}`,
            boxShadow: SHADOW.card,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 20px 0',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--v4-text-primary)',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                Comments
              </h1>
              <p
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: 'var(--v4-text-muted)',
                  margin: '3px 0 0',
                }}
              >
                Track internal notes, client feedback, and resolved discussion threads.
              </p>
            </div>
            <button
              onClick={b.add}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                background: 'var(--v4-action-primary)',
                color: 'var(--v4-action-primary-foreground)',
                border: 'none',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>
                +
              </span>
              Add Comment
            </button>
          </div>

          {/* Tabs + search */}
          <div
            style={{
              padding: '10px 20px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  aria-pressed={activeTab === t.id}
                  onClick={() => b.setPrimary(t.label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 11px',
                    borderRadius: 7,
                    border:
                      activeTab === t.id
                        ? '1.5px solid var(--v4-action-primary)'
                        : '1.5px solid #e5e7eb',
                    background:
                      activeTab === t.id ? 'var(--v4-action-primary)' : 'var(--v4-surface-raised)',
                    color: activeTab === t.id ? '#fff' : 'var(--v4-text-muted)',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                  <span
                    style={{
                      padding: '1px 5px',
                      borderRadius: 10,
                      background:
                        activeTab === t.id ? 'rgba(255,255,255,0.25)' : 'var(--v4-surface-subtle)',
                      fontSize: 10,
                      fontWeight: 600,
                      color: activeTab === t.id ? '#fff' : 'var(--v4-text-secondary)',
                    }}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 10px',
                background: 'var(--v4-surface-subtle)',
                border: '1.5px solid #e5e7eb',
                borderRadius: 7,
                width: 220,
              }}
            >
              <IconSearch />
              <input
                aria-label="Search comments, people, or keywords"
                value={b.query}
                onChange={(event) => b.setQuery(event.target.value)}
                placeholder="Search comments, people, or keywords..."
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: 'var(--v4-text-secondary)',
                  border: 0,
                  background: 'transparent',
                  minWidth: 0,
                  width: '100%',
                }}
              />
            </div>
            <button
              aria-label="Filter comments"
              onClick={b.filter}
              style={{
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1.5px solid #e5e7eb',
                borderRadius: 7,
                background: 'var(--v4-surface-raised)',
                cursor: 'pointer',
              }}
            >
              <IconFilter />
            </button>
          </div>

          {b.filterContent}
          {b.notice}
          {/* Threads list */}
          <div
            role="region"
            aria-label="Project comment threads"
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '12px 20px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {THREADS.length === 0 ? (
              <p role="status">No comments match the current filters.</p>
            ) : null}
            {THREADS.map((thread) => (
              <article
                key={thread.id}
                aria-label={thread.title}
                style={{
                  border:
                    thread.id === b.selectedId ? '1.5px solid #2563eb40' : `1px solid ${C.border}`,
                  borderRadius: 10,
                  background:
                    thread.id === b.selectedId
                      ? 'var(--v4-accent-selected)'
                      : 'var(--v4-surface-raised)',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Thread header */}
                {/* The title button supplies keyboard selection; the surrounding header is a pointer convenience. */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div
                  onClick={(event) => {
                    if (
                      !(event.target as HTMLElement).closest(
                        'button,a,input,textarea,[role="button"]',
                      )
                    )
                      b.select(thread.id);
                  }}
                  style={{
                    cursor: 'pointer',
                    padding: '11px 14px 10px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <Avatar initials={thread.initials} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <TypeBadge type={thread.type} />
                      <button
                        onClick={() => b.select(thread.id)}
                        style={{
                          textAlign: 'left',
                          border: 0,
                          background: 'transparent',
                          padding: 0,
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--v4-text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        {thread.title}
                      </button>
                      <div style={{ flex: 1 }} />
                      <StatusDot status={thread.status} />
                      <button
                        aria-label={`Edit ${thread.title}`}
                        onClick={() => b.edit(thread.record)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                        }}
                      >
                        <IconDots />
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                      <span
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--v4-text-secondary)',
                        }}
                      >
                        {thread.author}
                      </span>
                      {thread.role && (
                        <>
                          <span style={{ color: 'var(--v4-border-control)' }}>·</span>
                          <span
                            style={{
                              fontFamily: "'Inter', sans-serif",
                              fontSize: 11,
                              color: 'var(--v4-text-muted)',
                            }}
                          >
                            {thread.role}
                          </span>
                        </>
                      )}
                      <span style={{ color: 'var(--v4-border-control)' }}>·</span>
                      <span
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          color: 'var(--v4-text-disabled)',
                        }}
                      >
                        {thread.time}
                      </span>
                    </div>
                    <p
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12,
                        color: 'var(--v4-text-secondary)',
                        margin: '0 0 8px',
                        lineHeight: 1.5,
                      }}
                    >
                      {thread.body}
                    </p>
                    {/* Linked tags */}
                    {thread.linked.length > 0 && (
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}
                      >
                        {thread.linked.map((l) => (
                          <LinkedTag
                            key={l.id}
                            icon={l.icon}
                            code={l.code}
                            tag={l.tag}
                            open={l.actionable ? () => b.openLink?.(l.record) : undefined}
                          />
                        ))}
                      </div>
                    )}
                    {/* Actions row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {thread.replyCount > 0 && (
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 11,
                            color: 'var(--v4-text-muted)',
                          }}
                        >
                          <IconChat />
                          {thread.replyCount} replies
                        </span>
                      )}
                      <div style={{ flex: 1 }} />
                      <button
                        onClick={() => {
                          b.select(thread.id);
                          setReplyId(thread.id);
                          requestAnimationFrame(() =>
                            document.getElementById(`reply-${thread.id}`)?.focus(),
                          );
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 10px',
                          border: '1px solid #e5e7eb',
                          borderRadius: 6,
                          background: 'var(--v4-surface-raised)',
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--v4-text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        <IconReply />
                        &nbsp;Reply
                      </button>
                      <button
                        disabled={b.pending}
                        onClick={() => b.resolve(thread.record)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 10px',
                          border: '1px solid #e5e7eb',
                          borderRadius: 6,
                          background: 'var(--v4-surface-raised)',
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--v4-text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        <IconCheck />
                        &nbsp;{thread.record.status === 'Resolved' ? 'Reopen' : 'Resolve'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Replies */}
                {(thread.replies.length > 0 || thread.showReplyBox) && (
                  <div
                    style={{
                      borderTop: '1px solid var(--v4-border)',
                      background: 'var(--v4-surface-subtle)',
                    }}
                  >
                    {thread.replies.map((r, ri) => (
                      <div
                        key={r.id}
                        style={{
                          padding: '9px 14px 9px 58px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 9,
                          borderBottom:
                            ri < thread.replies.length - 1 ? '1px solid #f3f4f6' : 'none',
                        }}
                      >
                        <Avatar initials={r.initials} size={28} photo={r.photo} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginBottom: 3,
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--v4-text-primary)',
                              }}
                            >
                              {r.name}
                            </span>
                            <TypeBadge type={r.type} small />
                            <span style={{ color: 'var(--v4-border-control)' }}>·</span>
                            <span
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 11,
                                color: 'var(--v4-text-disabled)',
                              }}
                            >
                              {r.time}
                            </span>
                            <div style={{ flex: 1 }} />
                            <button
                              disabled={!r.hasLinks}
                              onClick={() => b.replyLinked(thread.record, r.record)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 11,
                                color: 'var(--v4-accent-ink)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              <IconOpenLinked /> Open Linked Item
                            </button>
                            <button
                              aria-label={`Edit reply by ${r.name}`}
                              disabled={!b.editReply}
                              onClick={() => b.editReply?.(r.record)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 2,
                              }}
                            >
                              <IconDots />
                            </button>
                          </div>
                          <p
                            style={{
                              fontFamily: "'Inter', sans-serif",
                              fontSize: 12,
                              color: 'var(--v4-text-secondary)',
                              margin: 0,
                              lineHeight: 1.5,
                            }}
                          >
                            {r.body}
                          </p>
                        </div>
                      </div>
                    ))}
                    {/* Reply box */}
                    {!!files[thread.id]?.length && (
                      <ul aria-label="Reply attachments">
                        {files[thread.id]!.map((file) => (
                          <li key={file.id}>
                            <InlineGlyphs.SctAttachment /> {file.title}
                            <button
                              type="button"
                              aria-label={'Remove attachment ' + file.title}
                              onClick={() =>
                                setFiles((v) => ({
                                  ...v,
                                  [thread.id]: v[thread.id]!.filter((d) => d.id !== file.id),
                                }))
                              }
                            >
                              <InlineGlyphs.SctRemove />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {fileError && thread.showReplyBox && <p role="alert">{fileError}</p>}
                    {thread.showReplyBox && (
                      <div
                        style={{
                          padding: '8px 14px 8px 58px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          borderTop: '1px solid #f3f4f6',
                        }}
                      >
                        <Avatar
                          initials={initials(identity.name === '—' ? '' : identity.name)}
                          size={28}
                        />
                        <div
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 10px',
                            background: 'var(--v4-surface-raised)',
                            border: '1px solid #e5e7eb',
                            borderRadius: 7,
                          }}
                        >
                          <input
                            id={`reply-${thread.id}`}
                            aria-label={`Reply to ${thread.title}`}
                            value={drafts[thread.id] ?? ''}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [thread.id]: event.target.value,
                              }))
                            }
                            placeholder="Write a reply..."
                            style={{
                              flex: 1,
                              minWidth: 0,
                              border: 0,
                              background: 'transparent',
                              fontFamily: "'Inter', sans-serif",
                              fontSize: 12,
                              color: 'var(--v4-text-secondary)',
                            }}
                          />
                          <button
                            aria-label="Attach files to reply"
                            disabled={attaching || !b.attachFile}
                            onClick={async () => {
                              setAttaching(true);
                              setFileError('');
                              try {
                                const document = await b.attachFile?.();
                                if (document)
                                  setFiles((v) => ({
                                    ...v,
                                    [thread.id]: [
                                      ...(v[thread.id] ?? []).filter((d) => d.id !== document.id),
                                      document,
                                    ],
                                  }));
                              } catch (cause) {
                                setFileError(
                                  cause instanceof Error ? cause.message : 'Could not attach file.',
                                );
                              } finally {
                                setAttaching(false);
                              }
                            }}
                            style={{
                              border: 0,
                              minWidth: 32,
                              minHeight: 32,
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            <IconPaperclip />
                          </button>
                          <button
                            aria-label="Reply options"
                            onClick={() => b.advancedReply(thread.record)}
                            title="Choose an internal or client author and link existing project files. Your inline draft is kept."
                            style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
                          >
                            <IconDots />
                          </button>
                          <button
                            aria-label="Send reply"
                            disabled={b.pending || !drafts[thread.id]?.trim()}
                            onClick={() => void send(thread.record)}
                            style={{ border: 0, padding: 0, background: 'transparent' }}
                          >
                            <IconSend />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        {/* ── Thread Details Panel ── */}
        {DETAIL && selected && (
          <div
            role="region"
            aria-label="Thread details"
            style={{
              width: '25%',
              minWidth: 260,
              overflowWrap: 'anywhere',
              flexShrink: 0,
              background: C.white,
              borderRadius: RADIUS.section,
              border: `1px solid ${C.border}`,
              boxShadow: SHADOW.card,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Panel header */}
            <div
              style={{
                padding: '12px 14px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #f3f4f6',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--v4-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                }}
              >
                THREAD DETAILS
              </span>
              <button
                aria-label="Close thread details"
                onClick={() => b.select(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <IconClose />
              </button>
            </div>

            {/* Panel content */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
              }}
            >
              {/* Title + status */}
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--v4-text-primary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {DETAIL.title}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: '#2563eb',
                        display: 'inline-block',
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#2563eb',
                      }}
                    >
                      {DETAIL.status}
                    </span>
                    <InlineGlyphs.SctComments width="10" height="10" color="#2563eb" />
                  </div>
                </div>
                <TypeBadge type={DETAIL.type} />
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11,
                    color: 'var(--v4-text-muted)',
                  }}
                >
                  Created by{' '}
                  <span style={{ fontWeight: 600, color: 'var(--v4-text-secondary)' }}>
                    {DETAIL.createdBy}
                  </span>
                  <span style={{ float: 'right', color: 'var(--v4-text-disabled)' }}>
                    {DETAIL.createdAt}
                  </span>
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', marginBottom: 10 }} />

              {/* Description */}
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--v4-text-disabled)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 5,
                  }}
                >
                  DESCRIPTION
                </div>
                <p
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    color: 'var(--v4-text-secondary)',
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {DETAIL.description}
                </p>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', marginBottom: 10 }} />

              {/* Linked items */}
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--v4-text-disabled)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                  }}
                >
                  LINKED ITEMS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {DETAIL.linkedItems.map((item) => (
                    <div
                      key={item.id}
                      role={item.actionable ? 'button' : undefined}
                      tabIndex={item.actionable ? 0 : undefined}
                      onClick={() => {
                        if (item.actionable) b.openLink?.(item.record);
                      }}
                      onKeyDown={(event) => {
                        if (item.actionable && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          b.openLink?.(item.record);
                        }
                      }}
                      style={{
                        cursor: item.actionable ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 9px',
                        border: '1px solid #e5e7eb',
                        borderRadius: 7,
                        background: 'var(--v4-surface-subtle)',
                      }}
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          background: 'var(--v4-surface-muted)',
                          border: '1px solid #e5e7eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {item.icon === 'pdf' ? (
                          <InlineGlyphs.SctPdf size={18} />
                        ) : item.icon === 'doc' ? (
                          <IconDoc />
                        ) : (
                          <IconLuminaire />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'var(--v4-text-primary)',
                          }}
                        >
                          {item.code}
                          <span
                            style={{
                              fontWeight: 400,
                              color: 'var(--v4-text-muted)',
                              marginLeft: 6,
                            }}
                          >
                            {item.sub}
                          </span>
                        </div>
                        {(item as { sub2?: string }).sub2 && (
                          <div
                            style={{
                              fontFamily: "'Inter', sans-serif",
                              fontSize: 10,
                              color: 'var(--v4-text-disabled)',
                            }}
                          >
                            {(item as { sub2?: string }).sub2}
                          </div>
                        )}
                        {(item as { date?: string }).date && (
                          <div
                            style={{
                              fontFamily: "'Inter', sans-serif",
                              fontSize: 10,
                              color: '#ef4444',
                            }}
                          >
                            Due {(item as { date?: string }).date}
                          </div>
                        )}
                      </div>
                      <IconExtLink />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', marginBottom: 10 }} />

              {/* Participants */}
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--v4-text-disabled)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                  }}
                >
                  THREAD PARTICIPANTS ({DETAIL.participants.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {DETAIL.participants.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar initials={p.initials} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--v4-text-primary)',
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 10,
                            color: 'var(--v4-text-muted)',
                          }}
                        >
                          {p.role}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: 20,
                          background: p.badge === 'Client' ? '#dbeafe' : '#f0fdf4',
                          color: p.badge === 'Client' ? '#1d4ed8' : '#15803d',
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        {p.badge}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', marginBottom: 10 }} />

              {/* Status & actions */}
              <div>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--v4-text-disabled)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 8,
                  }}
                >
                  STATUS & ACTIONS
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button
                    disabled={b.pending}
                    onClick={() => b.resolve(selected.record)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      padding: '8px 10px',
                      border: '1.5px solid #e5e7eb',
                      borderRadius: 8,
                      background: 'var(--v4-surface-raised)',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--v4-text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <IconCheck />{' '}
                    {selected.record.status === 'Resolved' ? 'Reopen Thread' : 'Resolve Thread'}
                  </button>
                  <button
                    disabled={!DETAIL.linkedItems.length}
                    onClick={() => b.linked(selected.record)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      padding: '8px 10px',
                      border: '1.5px solid #e5e7eb',
                      borderRadius: 8,
                      background: 'var(--v4-surface-raised)',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--v4-text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <IconOpenLinked /> Open Linked Item
                    <InlineGlyphs.SctCopy width="10" height="10" color="#374151" />
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  marginTop: 'auto',
                  paddingTop: 10,
                  borderTop: '1px solid #f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div style={{ flex: 1 }} />
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 10,
                    color: 'var(--v4-text-disabled)',
                  }}
                >
                  Created: {DETAIL.createdFull}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <V4ConfirmDialog
        open={!!leave}
        title="Unsent reply"
        description="Send your replies before leaving?"
        cancelLabel="Continue editing"
        confirmLabel="Discard replies"
        destructive
        onCancel={() => {
          leave?.cancel();
          setLeave(null);
        }}
        onConfirm={() => {
          const next = leave;
          setLeave(null);
          setDrafts({});
          setFiles({});
          next?.proceed();
        }}
        additionalAction={
          <V4Button
            variant="primary"
            disabled={
              b.pending ||
              Object.entries(files).some(([id, list]) => list.length && !drafts[id]?.trim())
            }
            onClick={async () => {
              for (const item of b.workspace.reviewItems.filter((i) => drafts[i.id]?.trim())) {
                if (!(await send(item))) return;
              }
              const next = leave;
              setLeave(null);
              next?.proceed();
            }}
          >
            <InlineGlyphs.Send />
            Send reply
          </V4Button>
        }
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  const isClient = type === 'Client';
  return (
    <span
      style={{
        padding: small ? '1px 6px' : '2px 7px',
        borderRadius: 20,
        background: isClient ? '#dbeafe' : '#f0fdf4',
        color: isClient ? '#1d4ed8' : '#15803d',
        fontFamily: "'Inter', sans-serif",
        fontSize: small ? 10 : 11,
        fontWeight: 600,
      }}
    >
      {type}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
        fontWeight: 600,
        color: '#2563eb',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#2563eb',
          display: 'inline-block',
        }}
      />
      {status}
    </span>
  );
}

function LinkedTag({
  icon,
  code,
  tag,
  open,
}: {
  icon: string;
  code: string;
  tag: string;
  open?: (() => void) | undefined;
}) {
  const isPdf = icon === 'pdf';
  return (
    <div
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          open();
        }
      }}
      style={{
        cursor: open ? 'pointer' : 'default',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px 3px 6px',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        background: 'var(--v4-surface-subtle)',
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
      }}
    >
      {isPdf ? (
        <InlineGlyphs.SctFile width="12" height="12" color="#ef4444" />
      ) : icon === 'lum' ? (
        <IconLuminaire />
      ) : (
        <IconDoc />
      )}
      <span style={{ fontWeight: 600, color: 'var(--v4-text-secondary)' }}>{code}</span>
      {tag && <span style={{ color: 'var(--v4-text-disabled)' }}>{tag}</span>}
    </div>
  );
}
