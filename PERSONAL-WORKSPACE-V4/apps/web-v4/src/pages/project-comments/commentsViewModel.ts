import type {
  LuminaireRecord,
  ProjectDocument,
  ProjectReviewAttachment,
  ProjectReviewItem,
  ProjectReviewReply,
  ProjectRevision,
  ReviewItemStatus,
} from '@scli/domain';

export const COMMENTS_PER_PAGE = 3;

export type CommentPrimaryFilter = 'All' | 'Client' | 'Internal' | 'Resolved';
export type CommentStatusFilter = '' | ReviewItemStatus;

export interface CommentFilterInput {
  primary: CommentPrimaryFilter;
  query: string;
  status: CommentStatusFilter;
  sourceType: string;
  due: '' | 'Due' | 'NoDueDate';
}

export interface CommentFilterCounts {
  All: number;
  Client: number;
  Internal: number;
  Resolved: number;
}

/** Human-readable ReviewItemStatus labels; canonical values remain unchanged. */
export function formatCommentStatus(status: ReviewItemStatus): string {
  return status === 'InProgress' ? 'In Progress' : status;
}

export interface ThreadParticipant {
  authorId: string;
  name: string;
  role: string;
  origin: 'Client' | 'Internal';
}

export type LinkedThreadItem =
  | { kind: 'revision'; id: string; title: string; detail: string; date: string | null }
  | { kind: 'luminaire'; id: string; title: string; detail: string; meta: string }
  | { kind: 'document'; id: string; title: string; detail: string; meta: string }
  | { kind: 'legacy-tag'; id: string; title: string; detail: string }
  | { kind: 'drawing'; id: string; title: string; detail: string }
  | { kind: 'area'; id: string; title: string; detail: string };

export function sortedRoots(items: readonly ProjectReviewItem[]): ProjectReviewItem[] {
  return [...items].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

export function repliesForThread(
  replies: readonly ProjectReviewReply[],
  reviewItemId: string,
): ProjectReviewReply[] {
  return replies
    .filter((reply) => reply.reviewItemId === reviewItemId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function attachmentsForThread(
  attachments: readonly ProjectReviewAttachment[],
  reviewItemId: string,
  replyIds: ReadonlySet<string>,
): ProjectReviewAttachment[] {
  return attachments.filter(
    (item) => item.reviewItemId === reviewItemId || (item.replyId && replyIds.has(item.replyId)),
  );
}

export function commentFilterCounts(items: readonly ProjectReviewItem[]): CommentFilterCounts {
  return {
    All: items.length,
    Client: items.filter((item) => item.origin === 'Client').length,
    Internal: items.filter((item) => item.origin === 'Internal').length,
    Resolved: items.filter((item) => item.status === 'Resolved').length,
  };
}

export function filterComments(
  items: readonly ProjectReviewItem[],
  replies: readonly ProjectReviewReply[],
  input: CommentFilterInput,
): ProjectReviewItem[] {
  const needle = input.query.trim().toLocaleLowerCase();
  return sortedRoots(items).filter((item) => {
    if (input.primary === 'Client' && item.origin !== 'Client') return false;
    if (input.primary === 'Internal' && item.origin !== 'Internal') return false;
    if (input.primary === 'Resolved' && item.status !== 'Resolved') return false;
    if (input.status && item.status !== input.status) return false;
    if (input.sourceType && item.sourceType !== input.sourceType) return false;
    if (input.due === 'Due' && !item.dueDate) return false;
    if (input.due === 'NoDueDate' && item.dueDate) return false;
    if (!needle) return true;
    const replyText = repliesForThread(replies, item.id)
      .flatMap((reply) => [reply.body, reply.authorNameSnapshot, reply.authorRoleSnapshot])
      .join(' ');
    return [
      item.title,
      item.description,
      item.authorNameSnapshot ?? '',
      item.authorRoleSnapshot ?? '',
      item.reference,
      item.area,
      item.drawingReference,
      item.luminaireTag,
      replyText,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle);
  });
}

export function effectiveCommentPage(requested: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / COMMENTS_PER_PAGE) - 1);
  return Math.min(Math.max(0, requested), last);
}

export function deriveParticipants(
  root: ProjectReviewItem,
  replies: readonly ProjectReviewReply[],
): ThreadParticipant[] {
  const result: ThreadParticipant[] = [];
  const seen = new Set<string>();
  const add = (
    authorId: string | null,
    name: string | null,
    role: string | null,
    origin: 'Client' | 'Internal' | null,
  ) => {
    if (!authorId || !name || !origin || seen.has(authorId)) return;
    seen.add(authorId);
    result.push({ authorId, name, role: role ?? '', origin });
  };
  add(root.authorId, root.authorNameSnapshot, root.authorRoleSnapshot, root.origin);
  repliesForThread(replies, root.id).forEach((reply) =>
    add(reply.authorId, reply.authorNameSnapshot, reply.authorRoleSnapshot, reply.origin),
  );
  return result;
}

export function linkedItemsForThread(
  root: ProjectReviewItem,
  attachments: readonly ProjectReviewAttachment[],
  revisions: readonly ProjectRevision[],
  luminaires: readonly LuminaireRecord[],
  documents: readonly ProjectDocument[],
): LinkedThreadItem[] {
  const result: LinkedThreadItem[] = [];
  const revision = root.revisionId
    ? revisions.find((candidate) => candidate.id === root.revisionId)
    : undefined;
  if (revision) {
    result.push({
      kind: 'revision',
      id: revision.id,
      title: `REV${String(revision.revisionNumber).padStart(2, '0')}`,
      detail: revision.title || 'Revision',
      date: revision.dueDate ?? revision.issuedAt,
    });
  }
  const luminaire = root.luminaireId
    ? luminaires.find((candidate) => candidate.id === root.luminaireId)
    : undefined;
  if (luminaire) {
    result.push({
      kind: 'luminaire',
      id: luminaire.id,
      title: luminaire.tag,
      detail: luminaire.description || 'Luminaire',
      meta: [luminaire.manufacturer, luminaire.model].filter(Boolean).join(' '),
    });
  } else if (!root.luminaireId && root.luminaireTag.trim()) {
    result.push({
      kind: 'legacy-tag',
      id: `tag-${root.id}`,
      title: root.luminaireTag,
      detail: 'Legacy luminaire tag',
    });
  }
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const seenDocuments = new Set<string>();
  attachments.forEach((attachment) => {
    if (seenDocuments.has(attachment.documentId)) return;
    const document = documentMap.get(attachment.documentId);
    if (!document) return;
    seenDocuments.add(document.id);
    result.push({
      kind: 'document',
      id: document.id,
      title: document.title,
      detail: document.documentNumber || document.category,
      meta: document.revision ? `Revision ${document.revision}` : document.status,
    });
  });
  if (root.drawingReference.trim()) {
    result.push({
      kind: 'drawing',
      id: `drawing-${root.id}`,
      title: root.drawingReference,
      detail: 'Drawing reference',
    });
  }
  if (root.area.trim()) {
    result.push({ kind: 'area', id: `area-${root.id}`, title: root.area, detail: 'Area' });
  }
  return result;
}

export function reviewUpdateInput(item: ProjectReviewItem, changes: Partial<ProjectReviewItem>) {
  const next = { ...item, ...changes };
  return {
    reference: next.reference,
    title: next.title,
    description: next.description,
    area: next.area,
    luminaireTag: next.luminaireTag,
    drawingReference: next.drawingReference,
    sourceType: next.sourceType,
    sourceId: next.sourceId,
    status: next.status,
    response: next.response,
    revisionId: next.revisionId,
    luminaireId: next.luminaireId,
    receivedAt: next.receivedAt,
    dueDate: next.dueDate,
  };
}
