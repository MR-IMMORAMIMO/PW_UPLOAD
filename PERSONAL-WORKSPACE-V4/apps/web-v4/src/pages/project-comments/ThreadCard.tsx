import { useRef, useState } from 'react';
import {
  SctLive as CircleDot,
  SctComments as MessageCircle,
  SctMore as MoreVertical,
  SctComments as Reply,
  SctRestore as RotateCcw,
  SctNotes as ScrollText,
} from '../../components/common/SctIcons';
import { Check, FileText, Lightbulb, MapPin } from '../../components/common/SctIcons';
import type {
  ProjectDocument,
  ProjectReviewAttachment,
  ProjectReviewItem,
  ProjectReviewReply,
} from '@scli/domain';
import {
  formatCommentStatus,
  type LinkedThreadItem,
  type ThreadParticipant,
} from './commentsViewModel';
import { ReplyComposer, type ReplySubmitInput } from './ReplyComposer';
import { ThreadReplies } from './ThreadReplies';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

const statusIcon = (status: ProjectReviewItem['status']) =>
  status === 'Resolved' ? <Check aria-hidden="true" /> : <CircleDot aria-hidden="true" />;

const linkedIcon = (kind: LinkedThreadItem['kind']) =>
  kind === 'revision' ? (
    <ScrollText aria-hidden="true" />
  ) : kind === 'luminaire' || kind === 'legacy-tag' ? (
    <Lightbulb aria-hidden="true" />
  ) : kind === 'document' ? (
    <FileText aria-hidden="true" />
  ) : (
    <MapPin aria-hidden="true" />
  );

interface ThreadCardProps {
  item: ProjectReviewItem;
  selected: boolean;
  replies: readonly ProjectReviewReply[];
  attachments: readonly ProjectReviewAttachment[];
  documents: readonly ProjectDocument[];
  linkedItems: readonly LinkedThreadItem[];
  participants: readonly ThreadParticipant[];
  focusRequest: number;
  replyPending: boolean;
  replyError: string | null;
  replyWarning: string | null;
  contextAvailable: boolean;
  lifecyclePending: boolean;
  onSelect: (button: HTMLButtonElement) => void;
  onReply: () => void;
  onEdit: () => void;
  onLifecycle: () => void;
  onSubmitReply: (input: ReplySubmitInput) => Promise<boolean>;
  onRetryAttachment?: (() => void) | undefined;
}

export function ThreadCard({
  item,
  selected,
  replies,
  attachments,
  documents,
  linkedItems,
  participants,
  focusRequest,
  replyPending,
  replyError,
  replyWarning,
  contextAvailable,
  lifecyclePending,
  onSelect,
  onReply,
  onEdit,
  onLifecycle,
  onSubmitReply,
  onRetryAttachment,
}: ThreadCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootButtonRef = useRef<HTMLButtonElement>(null);
  const authorName = item.authorNameSnapshot?.trim() || 'Legacy author unavailable';
  const origin = item.origin ?? 'Legacy';
  const clientParticipants = participants.filter((participant) => participant.origin === 'Client');

  return (
    <article
      className={`v4-comments__thread${selected ? ' v4-comments__thread--selected' : ''}`}
      data-status={item.status}
    >
      <div className="v4-comments__thread-root">
        <span className="v4-comments__avatar" data-origin={origin}>
          {initials(authorName)}
        </span>
        <div className="v4-comments__thread-content">
          <div className="v4-comments__thread-heading">
            <div className="v4-comments__thread-title-line">
              <span className="v4-comments__origin" data-origin={origin}>
                {origin}
              </span>
              <button
                ref={rootButtonRef}
                type="button"
                className="v4-comments__thread-select"
                aria-pressed={selected}
                onClick={(event) => onSelect(event.currentTarget)}
              >
                {item.title}
              </button>
            </div>
            <div className="v4-comments__thread-trailing">
              <span className="v4-comments__status" data-status={item.status}>
                {statusIcon(item.status)} {formatCommentStatus(item.status)}
              </span>
              <div className="v4-comments__kebab">
                <button
                  type="button"
                  aria-label={`More actions for ${item.title}`}
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((current) => !current)}
                >
                  <MoreVertical aria-hidden="true" />
                </button>
                {menuOpen ? (
                  <div role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onEdit();
                      }}
                    >
                      Edit Comment
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="v4-comments__thread-meta">
            <strong>{authorName}</strong>
            {item.authorRoleSnapshot ? (
              <>
                <span aria-hidden="true">•</span>
                <span>{item.authorRoleSnapshot}</span>
              </>
            ) : null}
            <span aria-hidden="true">•</span>
            <time dateTime={item.createdAt} title={dateTime(item.createdAt)}>
              {dateTime(item.createdAt)}
            </time>
          </div>
          <p className="v4-comments__thread-description">
            {item.description || 'No description provided.'}
          </p>
          {linkedItems.length ? (
            <div className="v4-comments__context-chips" aria-label="Linked context">
              {linkedItems.slice(0, selected ? 5 : 3).map((linked) => (
                <span
                  key={`${linked.kind}-${linked.id}`}
                  className="v4-comments__context-chip"
                  data-kind={linked.kind}
                >
                  {linkedIcon(linked.kind)}
                  <strong>{linked.title}</strong>
                  <span>{linked.detail}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="v4-comments__thread-footer">
            <span>
              <MessageCircle aria-hidden="true" />{' '}
              {contextAvailable
                ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                : 'Replies unavailable'}
            </span>
            <button type="button" disabled={!contextAvailable} onClick={onReply}>
              <Reply aria-hidden="true" /> Reply
            </button>
            <button type="button" disabled={lifecyclePending} onClick={onLifecycle}>
              {item.status === 'Resolved' ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {item.status === 'Resolved' ? 'Reopen' : 'Resolve'}
            </button>
          </div>
        </div>
      </div>
      {selected && contextAvailable ? (
        <div className="v4-comments__thread-expanded">
          <ThreadReplies replies={replies} attachments={attachments} documents={documents} />
          {item.response.trim() ? (
            <div className="v4-comments__legacy-response">
              <strong>Legacy designer response</strong>
              <p>{item.response}</p>
            </div>
          ) : null}
          <ReplyComposer
            threadId={item.id}
            clientParticipants={clientParticipants}
            documents={documents}
            pending={replyPending}
            error={replyError}
            warning={replyWarning}
            focusRequest={focusRequest}
            onSubmit={onSubmitReply}
            onRetryAttachment={onRetryAttachment}
          />
        </div>
      ) : null}
    </article>
  );
}
