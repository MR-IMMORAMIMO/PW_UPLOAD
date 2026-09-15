import { FileText } from '../../components/common/SctIcons';
import type { ProjectDocument, ProjectReviewAttachment, ProjectReviewReply } from '@scli/domain';

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

interface ThreadRepliesProps {
  replies: readonly ProjectReviewReply[];
  attachments: readonly ProjectReviewAttachment[];
  documents: readonly ProjectDocument[];
}

export function ThreadReplies({ replies, attachments, documents }: ThreadRepliesProps) {
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  return (
    <div className="v4-comments__replies" aria-label="Thread replies">
      {replies.map((reply) => {
        const linked = attachments
          .filter((attachment) => attachment.replyId === reply.id)
          .map((attachment) => documentMap.get(attachment.documentId))
          .filter((document): document is ProjectDocument => Boolean(document));
        return (
          <article key={reply.id} className="v4-comments__reply">
            <span
              className="v4-comments__avatar v4-comments__avatar--small"
              data-origin={reply.origin}
            >
              {initials(reply.authorNameSnapshot)}
            </span>
            <div className="v4-comments__reply-copy">
              <div className="v4-comments__reply-meta">
                <strong>{reply.authorNameSnapshot}</strong>
                <span className="v4-comments__origin" data-origin={reply.origin}>
                  {reply.origin}
                </span>
                <span aria-hidden="true">•</span>
                <time dateTime={reply.createdAt} title={dateTime(reply.createdAt)}>
                  {dateTime(reply.createdAt)}
                </time>
              </div>
              <p>{reply.body}</p>
              {linked.map((document) => (
                <span key={document.id} className="v4-comments__reply-document">
                  <FileText aria-hidden="true" /> {document.title}
                </span>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
