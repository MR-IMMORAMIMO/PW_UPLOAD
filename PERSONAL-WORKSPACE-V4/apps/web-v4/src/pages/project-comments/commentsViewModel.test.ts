import { describe, expect, it } from 'vitest';
import type {
  LuminaireRecord,
  ProjectDocument,
  ProjectReviewAttachment,
  ProjectReviewItem,
  ProjectReviewReply,
  ProjectRevision,
} from '@scli/domain';
import {
  COMMENTS_PER_PAGE,
  commentFilterCounts,
  deriveParticipants,
  effectiveCommentPage,
  filterComments,
  formatCommentStatus,
  linkedItemsForThread,
  repliesForThread,
  reviewUpdateInput,
} from './commentsViewModel';

const root = (patch: Partial<ProjectReviewItem> = {}): ProjectReviewItem => ({
  id: 'root-1',
  projectId: 'project-1',
  reference: 'CMT-A',
  title: 'Please revise the guest rooms',
  description: 'Use warmer light in the corridors.',
  area: 'Guest rooms',
  luminaireTag: '',
  drawingReference: 'L-101',
  sourceType: 'Manual',
  sourceId: null,
  status: 'Open',
  response: '',
  revisionId: null,
  origin: 'Client',
  authorId: 'author-a',
  authorNameSnapshot: 'Alex Lee',
  authorRoleSnapshot: 'Client Representative',
  luminaireId: null,
  receivedAt: '2026-08-15',
  dueDate: null,
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:00:00.000Z',
  ...patch,
});

describe('comment status presentation', () => {
  it('humanizes InProgress without changing canonical filter values', () => {
    expect(formatCommentStatus('InProgress')).toBe('In Progress');
    expect(formatCommentStatus('Resolved')).toBe('Resolved');
    expect(
      filterComments([root({ status: 'InProgress' })], [], {
        primary: 'All',
        query: '',
        status: 'InProgress',
        sourceType: '',
        due: '',
      }),
    ).toHaveLength(1);
  });
});

const reply = (patch: Partial<ProjectReviewReply> = {}): ProjectReviewReply => ({
  id: 'reply-1',
  projectId: 'project-1',
  reviewItemId: 'root-1',
  body: 'Lighting calculations updated.',
  authorId: 'author-b',
  authorNameSnapshot: 'Morgan Day',
  authorRoleSnapshot: 'Lighting Designer',
  origin: 'Internal',
  createdAt: '2026-08-15T11:00:00.000Z',
  updatedAt: '2026-08-15T11:00:00.000Z',
  ...patch,
});

describe('commentsViewModel', () => {
  it('uses exactly three roots per page and safely clamps an invalid page', () => {
    expect(COMMENTS_PER_PAGE).toBe(3);
    expect(effectiveCommentPage(4, 7)).toBe(2);
    expect(effectiveCommentPage(3, 0)).toBe(0);
  });

  it('counts complete root authority without counting replies', () => {
    const roots = [
      root(),
      root({ id: 'root-2', origin: 'Internal' }),
      root({ id: 'root-3', origin: null, status: 'Resolved' }),
    ];
    expect(commentFilterCounts(roots)).toEqual({ All: 3, Client: 1, Internal: 1, Resolved: 1 });
  });

  it('supports All, Client, Internal, Resolved and truthful secondary filters', () => {
    const roots = [
      root(),
      root({ id: 'root-2', origin: 'Internal', sourceType: 'Email', dueDate: '2026-08-20' }),
      root({ id: 'root-3', origin: null, status: 'Resolved' }),
    ];
    const base = { query: '', status: '' as const, sourceType: '', due: '' as const };
    expect(filterComments(roots, [], { ...base, primary: 'All' })).toHaveLength(3);
    expect(
      filterComments(roots, [], { ...base, primary: 'Client' }).map((item) => item.id),
    ).toEqual(['root-1']);
    expect(
      filterComments(roots, [], { ...base, primary: 'Internal' }).map((item) => item.id),
    ).toEqual(['root-2']);
    expect(
      filterComments(roots, [], { ...base, primary: 'Resolved' }).map((item) => item.id),
    ).toEqual(['root-3']);
    expect(
      filterComments(roots, [], { ...base, primary: 'All', sourceType: 'Email', due: 'Due' }).map(
        (item) => item.id,
      ),
    ).toEqual(['root-2']);
  });

  it('searches root and reply author/body fields case-insensitively', () => {
    const roots = [root(), root({ id: 'root-2', title: 'Other', description: '' })];
    const replies = [reply({ reviewItemId: 'root-2', body: 'RENDER rerun by Casey' })];
    const shown = filterComments(roots, replies, {
      primary: 'All',
      query: 'render',
      status: '',
      sourceType: '',
      due: '',
    });
    expect(shown.map((item) => item.id)).toEqual(['root-2']);
  });

  it('orders replies by createdAt then id', () => {
    const replies = [
      reply({ id: 'b', createdAt: '2026-08-15T12:00:00.000Z' }),
      reply({ id: 'c', createdAt: '2026-08-15T10:00:00.000Z' }),
      reply({ id: 'a', createdAt: '2026-08-15T12:00:00.000Z' }),
    ];
    expect(repliesForThread(replies, 'root-1').map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('derives participants by stable authorId and preserves same-name distinct identities', () => {
    const participants = deriveParticipants(root(), [
      reply({ id: 'r1', authorId: 'author-b', authorNameSnapshot: 'Alex Lee' }),
      reply({ id: 'r2', authorId: 'author-b', authorNameSnapshot: 'Changed snapshot' }),
      reply({ id: 'r3', authorId: 'author-c', authorNameSnapshot: 'Alex Lee', origin: 'Client' }),
    ]);
    expect(participants.map((item) => item.authorId)).toEqual(['author-a', 'author-b', 'author-c']);
    expect(participants.filter((item) => item.name === 'Alex Lee')).toHaveLength(3);
  });

  it('does not fabricate a participant for a legacy root or legacy response', () => {
    expect(
      deriveParticipants(
        root({ origin: null, authorId: null, authorNameSnapshot: null, response: 'Legacy text' }),
        [],
      ),
    ).toEqual([]);
  });

  it('resolves canonical linked items and keeps a legacy luminaire tag as text context', () => {
    const revision = {
      id: 'revision-1',
      revisionNumber: 3,
      title: 'Lighting revision',
      dueDate: '2026-08-20',
      issuedAt: null,
    } as ProjectRevision;
    const luminaire = {
      id: 'luminaire-1',
      tag: 'L-01',
      description: 'Downlight',
      manufacturer: 'SCLI',
      model: 'D1',
    } as LuminaireRecord;
    const document = {
      id: 'document-1',
      title: 'Datasheet',
      documentNumber: 'DOC-1',
      category: 'Datasheet',
      revision: '2',
      status: 'Working',
    } as ProjectDocument;
    const attachment = { documentId: 'document-1' } as ProjectReviewAttachment;
    const canonical = linkedItemsForThread(
      root({ revisionId: 'revision-1', luminaireId: 'luminaire-1' }),
      [attachment],
      [revision],
      [luminaire],
      [document],
    );
    expect(canonical.map((item) => item.kind)).toEqual([
      'revision',
      'luminaire',
      'document',
      'drawing',
      'area',
    ]);
    const legacy = linkedItemsForThread(
      root({ luminaireTag: 'OLD-TAG', drawingReference: '', area: '' }),
      [],
      [],
      [],
      [],
    );
    expect(legacy).toEqual([
      { kind: 'legacy-tag', id: 'tag-root-1', title: 'OLD-TAG', detail: 'Legacy luminaire tag' },
    ]);
  });

  it('builds a complete safe update payload and preserves hidden canonical fields', () => {
    const item = root({ response: 'Legacy', sourceId: 'source-1', luminaireTag: 'L-OLD' });
    expect(reviewUpdateInput(item, { status: 'Resolved' })).toMatchObject({
      status: 'Resolved',
      response: 'Legacy',
      sourceId: 'source-1',
      luminaireTag: 'L-OLD',
      receivedAt: item.receivedAt,
    });
  });
});
