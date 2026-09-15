import { useRef, useState } from 'react';
import {
  SctBack as ArrowLeft,
  SctLive as CircleDot,
  SctRestore as RotateCcw,
  SctNotes as ScrollText,
} from '../../components/common/SctIcons';
import { Check, FileText, Lightbulb, MapPin, X } from '../../components/common/SctIcons';
import type { ProjectReviewItem } from '@scli/domain';
import {
  formatCommentStatus,
  type LinkedThreadItem,
  type ThreadParticipant,
} from './commentsViewModel';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

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

type InspectorSubview = 'base' | 'linked' | 'participants' | 'description';

interface ThreadDetailsInspectorProps {
  item: ProjectReviewItem;
  linkedItems: readonly LinkedThreadItem[];
  participants: readonly ThreadParticipant[];
  lifecyclePending: boolean;
  onClose: () => void;
  onLifecycle: () => void;
  embedded?: boolean;
  onOpenLink?: (item: LinkedThreadItem) => void;
}

export function ThreadDetailsInspector({
  item,
  linkedItems,
  participants,
  lifecyclePending,
  onClose,
  onLifecycle,
  embedded = false,
  onOpenLink,
}: ThreadDetailsInspectorProps) {
  const [subview, setSubview] = useState<InspectorSubview>('base');
  const initiatingRef = useRef<HTMLButtonElement | null>(null);
  const openSubview = (next: InspectorSubview, button: HTMLButtonElement) => {
    initiatingRef.current = button;
    setSubview(next);
  };
  const back = () => {
    setSubview('base');
    requestAnimationFrame(() => initiatingRef.current?.focus());
  };

  if (subview !== 'base') {
    const title =
      subview === 'linked'
        ? 'All Linked Items'
        : subview === 'participants'
          ? 'All Participants'
          : 'Description';
    return (
      <aside
        className="v4-comments__inspector v4-comments__inspector--subview"
        aria-label="Thread details"
      >
        <header className="v4-comments__inspector-header">
          <button
            type="button"
            className="v4-comments__inspector-back"
            aria-label="Back to thread details"
            onClick={back}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <h2>{title}</h2>
          <button type="button" aria-label="Close thread details" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="v4-comments__inspector-subview-body">
          {subview === 'description' ? (
            <p>{item.description || 'No description provided.'}</p>
          ) : null}
          {subview === 'linked'
            ? linkedItems.map((linked) => (
                <LinkedRow key={`${linked.kind}-${linked.id}`} item={linked} onOpen={onOpenLink} />
              ))
            : null}
          {subview === 'participants'
            ? participants.map((participant) => (
                <ParticipantRow key={participant.authorId} participant={participant} />
              ))
            : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="v4-comments__inspector" aria-label="Thread details">
      {!embedded && (
        <section className="v4-comments__inspector-header">
          <h2>Thread Details</h2>
          <button type="button" aria-label="Close thread details" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </section>
      )}
      <section className="v4-comments__inspector-identity">
        <div>
          <strong>{item.title}</strong>
          <span className="v4-comments__status" data-status={item.status}>
            {item.status === 'Resolved' ? (
              <Check aria-hidden="true" />
            ) : (
              <CircleDot aria-hidden="true" />
            )}{' '}
            {formatCommentStatus(item.status)}
          </span>
        </div>
        <span className="v4-comments__origin" data-origin={item.origin ?? 'Legacy'}>
          {item.origin ?? 'Legacy'}
        </span>
        <div className="v4-comments__inspector-created-by">
          <span>Created by {item.authorNameSnapshot ?? 'legacy author unavailable'}</span>
          <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
        </div>
      </section>
      <section className="v4-comments__inspector-description">
        <h3>Description</h3>
        <p>{item.description || 'No description provided.'}</p>
        {item.description.length > 180 ? (
          <button
            type="button"
            onClick={(event) => openSubview('description', event.currentTarget)}
          >
            View all
          </button>
        ) : null}
      </section>
      <section className="v4-comments__inspector-linked">
        <h3>Linked Items</h3>
        <div className="v4-comments__inspector-preview">
          {linkedItems.length ? (
            linkedItems
              .slice(0, 2)
              .map((linked) => (
                <LinkedRow key={`${linked.kind}-${linked.id}`} item={linked} onOpen={onOpenLink} />
              ))
          ) : (
            <p>No linked items.</p>
          )}
        </div>
        {linkedItems.length > 2 ? (
          <button type="button" onClick={(event) => openSubview('linked', event.currentTarget)}>
            View all ({linkedItems.length})
          </button>
        ) : null}
      </section>
      <section className="v4-comments__inspector-participants">
        <h3>Thread Participants ({participants.length})</h3>
        <div className="v4-comments__inspector-preview">
          {participants.length ? (
            participants
              .slice(0, 3)
              .map((participant) => (
                <ParticipantRow key={participant.authorId} participant={participant} />
              ))
          ) : (
            <p>No canonical participants.</p>
          )}
        </div>
        {participants.length > 3 ? (
          <button
            type="button"
            onClick={(event) => openSubview('participants', event.currentTarget)}
          >
            View all ({participants.length})
          </button>
        ) : null}
      </section>
      <section className="v4-comments__inspector-actions">
        <h3>Status &amp; Actions</h3>
        <button type="button" disabled={lifecyclePending} onClick={onLifecycle}>
          {item.status === 'Resolved' ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          {item.status === 'Resolved' ? 'Reopen Thread' : 'Resolve Thread'}
        </button>
      </section>
      <section className="v4-comments__inspector-footer">
        <span>Created</span>
        <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
      </section>
    </aside>
  );
}

function LinkedRow({
  item,
  onOpen,
}: {
  item: LinkedThreadItem;
  onOpen?: ((item: LinkedThreadItem) => void) | undefined;
}) {
  const actionable = !!onOpen && ['revision', 'luminaire', 'document'].includes(item.kind);
  const extra =
    item.kind === 'revision'
      ? item.date
      : item.kind === 'luminaire' || item.kind === 'document'
        ? item.meta
        : '';
  return (
    <button
      type="button"
      className="v4-comments__linked-row"
      disabled={!actionable}
      style={{
        cursor: actionable ? 'pointer' : 'default',
        width: '100%',
        textAlign: 'left',
        color: 'inherit',
        background: 'transparent',
      }}
      onClick={() => {
        if (actionable) onOpen?.(item);
      }}
    >
      <span>{linkedIcon(item.kind)}</span>
      <div>
        <strong>{item.title}</strong>
        <small>{item.detail}</small>
        {extra ? <small>{extra}</small> : null}
      </div>
    </button>
  );
}

function ParticipantRow({ participant }: { participant: ThreadParticipant }) {
  return (
    <article className="v4-comments__participant-row">
      <span
        className="v4-comments__avatar v4-comments__avatar--small"
        data-origin={participant.origin}
      >
        {initials(participant.name)}
      </span>
      <div>
        <strong>{participant.name}</strong>
        <small>{participant.role || 'Role not recorded'}</small>
      </div>
      <span className="v4-comments__origin" data-origin={participant.origin}>
        {participant.origin}
      </span>
    </article>
  );
}
