import type {
  CreateProjectReviewReplyInput,
  CreateProjectReviewThreadInput,
} from '@scli/contracts';
import type {
  AppUser,
  ProjectReviewAttachment,
  ProjectReviewItem,
  ProjectReviewReply,
} from '@scli/domain';
import { dateKeyAtUtc, type GoldenAnchorContract } from './golden-uat-types';

export const GOLDEN_COMMENT_IDS = Object.freeze({
  users: Object.freeze({
    sara: '75000004-0000-4000-8000-000000000001',
    youssef: '75000004-0000-4000-8000-000000000002',
  }),
  roots: Object.freeze([
    '70000004-0000-4000-8000-000000000001',
    '70000004-0000-4000-8000-000000000002',
    '70000004-0000-4000-8000-000000000003',
    '70000004-0000-4000-8000-000000000004',
  ]),
  clientAuthors: Object.freeze({
    aisha: '71000004-0000-4000-8000-000000000001',
    lina: '71000004-0000-4000-8000-000000000002',
    omar: '71000004-0000-4000-8000-000000000003',
  }),
  replies: Object.freeze([
    '72000004-0000-4000-8000-000000000001',
    '72000004-0000-4000-8000-000000000002',
    '72000004-0000-4000-8000-000000000003',
    '72000004-0000-4000-8000-000000000004',
    '72000004-0000-4000-8000-000000000005',
    '72000004-0000-4000-8000-000000000006',
  ]),
  attachments: Object.freeze([
    '73000004-0000-4000-8000-000000000001',
    '73000004-0000-4000-8000-000000000002',
  ]),
  activities: Object.freeze([
    '74000004-0000-4000-8000-000000000001',
    '74000004-0000-4000-8000-000000000002',
    '74000004-0000-4000-8000-000000000003',
    '74000004-0000-4000-8000-000000000004',
    '74000004-0000-4000-8000-000000000005',
    '74000004-0000-4000-8000-000000000006',
    '74000004-0000-4000-8000-000000000007',
    '74000004-0000-4000-8000-000000000008',
    '74000004-0000-4000-8000-000000000009',
    '74000004-0000-4000-8000-000000000010',
    '74000004-0000-4000-8000-000000000011',
    '74000004-0000-4000-8000-000000000012',
  ]),
});

export const GOLDEN_COMMENT_REFERENCES = Object.freeze([
  'G-CMT-01',
  'G-CMT-02',
  'G-CMT-03',
  'G-CMT-04',
] as const);

export interface GoldenCommentsOperations {
  withServerClock<T>(now: () => string, operation: () => T): T;
  withServerIdentity<T>(ids: readonly string[], operation: () => T): T;
  createReviewThread(
    projectId: string,
    input: CreateProjectReviewThreadInput,
    actor: AppUser,
  ): ProjectReviewItem;
  listReviewThreadContext(projectId: string): {
    readonly replies: readonly ProjectReviewReply[];
    readonly attachments: readonly ProjectReviewAttachment[];
  };
  createReviewReply(
    projectId: string,
    reviewItemId: string,
    input: CreateProjectReviewReplyInput,
    actor: AppUser,
  ): ProjectReviewReply;
  linkReviewItemDocument(
    projectId: string,
    reviewItemId: string,
    documentId: string,
    actor: AppUser,
  ): ProjectReviewAttachment;
  linkReviewReplyDocument(
    projectId: string,
    reviewItemId: string,
    replyId: string,
    documentId: string,
    actor: AppUser,
  ): ProjectReviewAttachment;
}

interface TargetIdentity {
  readonly id: string;
}

interface LuminaireTarget extends TargetIdentity {
  readonly tag: string;
}

interface DocumentTarget extends TargetIdentity {
  readonly projectId: string;
  readonly documentNumber: string;
}

export interface GoldenCommentsGraphBuilderInput {
  readonly projectId: string;
  readonly contract: GoldenAnchorContract;
  readonly operations: GoldenCommentsOperations;
  readonly readReviewItems: () => readonly ProjectReviewItem[];
  readonly revision: TargetIdentity;
  readonly downlight: LuminaireTarget;
  readonly wallWasher: LuminaireTarget;
  readonly drawing: DocumentTarget;
  readonly minutes: DocumentTarget;
  readonly actors: {
    readonly sara: AppUser;
    readonly youssef: AppUser;
  };
}

export interface GoldenCommentsGraphBuilderResult {
  readonly roots: readonly ProjectReviewItem[];
  readonly replies: readonly ProjectReviewReply[];
  readonly attachments: readonly ProjectReviewAttachment[];
}

export function goldenCommentActorSeeds(contract: GoldenAnchorContract): {
  readonly sara: AppUser;
  readonly youssef: AppUser;
} {
  const timestamp = dateKeyAtUtc(contract.pastMeetingKickoff, 4);
  return Object.freeze({
    sara: Object.freeze({
      id: GOLDEN_COMMENT_IDS.users.sara,
      entraObjectId: `golden:${GOLDEN_COMMENT_IDS.users.sara}`,
      displayName: 'Sara Khalil',
      email: 'sara.khalil@scientechnic-uat.test',
      jobTitle: 'Lighting Designer',
      department: 'Lighting Solutions',
      role: 'Designer',
      weeklyCapacityHours: 40,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    youssef: Object.freeze({
      id: GOLDEN_COMMENT_IDS.users.youssef,
      entraObjectId: `golden:${GOLDEN_COMMENT_IDS.users.youssef}`,
      displayName: 'Youssef Amin',
      email: 'youssef.amin@scientechnic-uat.test',
      jobTitle: 'Technical Lead',
      department: 'Lighting Solutions',
      role: 'LineManager',
      weeklyCapacityHours: 40,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  });
}

interface RootDefinition {
  readonly id: string;
  readonly activityId: string;
  readonly clientAuthorId: string | null;
  readonly input: CreateProjectReviewThreadInput;
  readonly actor: AppUser;
  readonly timestamp: string;
}

interface ReplyDefinition {
  readonly id: string;
  readonly activityId: string;
  readonly clientAuthorId: string | null;
  readonly rootIndex: number;
  readonly input: CreateProjectReviewReplyInput;
  readonly actor: AppUser;
  readonly timestamp: string;
}

interface AttachmentDefinition {
  readonly id: string;
  readonly activityId: string;
  readonly kind: 'root' | 'reply';
  readonly rootIndex: number;
  readonly replyIndex: number | null;
  readonly document: DocumentTarget;
  readonly actor: AppUser;
  readonly timestamp: string;
}

interface GoldenCommentsDefinition {
  readonly roots: readonly RootDefinition[];
  readonly replies: readonly ReplyDefinition[];
  readonly attachments: readonly AttachmentDefinition[];
}

export type GoldenCommentsAuthorityInput = Omit<
  GoldenCommentsGraphBuilderInput,
  'operations' | 'readReviewItems'
>;

function graphDefinition(input: GoldenCommentsAuthorityInput): GoldenCommentsDefinition {
  const { contract, actors } = input;
  const roots: readonly RootDefinition[] = [
    {
      id: GOLDEN_COMMENT_IDS.roots[0]!,
      activityId: GOLDEN_COMMENT_IDS.activities[0]!,
      clientAuthorId: GOLDEN_COMMENT_IDS.clientAuthors.aisha,
      input: {
        reference: GOLDEN_COMMENT_REFERENCES[0],
        title: 'Guest room corridor CCT review',
        description:
          'Please revise the guest rooms and corridors to 3000K for a warmer hospitality ambience.',
        area: 'Guest Rooms and Corridors',
        luminaireTag: input.downlight.tag,
        drawingReference: 'L-102',
        sourceType: 'Email',
        sourceId: null,
        status: 'Open',
        response: '',
        revisionId: input.revision.id,
        luminaireId: input.downlight.id,
        receivedAt: contract.dueToday,
        dueDate: contract.dueSoon,
        origin: 'Client',
        authorName: 'Aisha Rahman',
        authorRole: 'Client Representative',
      },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.dueToday, 10, 14),
    },
    {
      id: GOLDEN_COMMENT_IDS.roots[1]!,
      activityId: GOLDEN_COMMENT_IDS.activities[1]!,
      clientAuthorId: null,
      input: {
        reference: GOLDEN_COMMENT_REFERENCES[1],
        title: 'Coordinate REV02 wall-washer datasheet',
        description:
          'Confirm the current WL01 optical data and update the technical submission before the REV02 issue.',
        area: 'Façade',
        luminaireTag: input.wallWasher.tag,
        drawingReference: 'L-110',
        sourceType: 'Manual',
        sourceId: null,
        status: 'InProgress',
        response: 'Datasheet requested from manufacturer.',
        revisionId: null,
        luminaireId: input.wallWasher.id,
        receivedAt: contract.overdue,
        dueDate: contract.dueSoon,
        origin: 'Internal',
      },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.overdue, 9, 10),
    },
    {
      id: GOLDEN_COMMENT_IDS.roots[2]!,
      activityId: GOLDEN_COMMENT_IDS.activities[2]!,
      clientAuthorId: GOLDEN_COMMENT_IDS.clientAuthors.lina,
      input: {
        reference: GOLDEN_COMMENT_REFERENCES[2],
        title: 'Entrance feature wall brightness accepted',
        description:
          'The client confirmed that the adjusted entrance feature-wall brightness meets the agreed visual intent.',
        area: 'Entrance Lobby',
        luminaireTag: '',
        drawingReference: 'L-101',
        sourceType: 'Meeting',
        sourceId: null,
        status: 'Resolved',
        response: '',
        revisionId: null,
        luminaireId: null,
        receivedAt: contract.pastMeetingTechnical,
        dueDate: null,
        origin: 'Client',
        authorName: 'Lina Farouk',
        authorRole: 'Lighting Consultant',
      },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.pastMeetingTechnical, 8, 30),
    },
    {
      id: GOLDEN_COMMENT_IDS.roots[3]!,
      activityId: GOLDEN_COMMENT_IDS.activities[3]!,
      clientAuthorId: null,
      input: {
        reference: GOLDEN_COMMENT_REFERENCES[3],
        title: 'Emergency lighting circuit note',
        description:
          'Record the emergency circuit designation before the coordinated drawing package is issued.',
        area: 'Back of House',
        luminaireTag: '',
        drawingReference: 'L-118',
        sourceType: 'Drawing',
        sourceId: null,
        status: 'Accepted',
        response: '',
        revisionId: null,
        luminaireId: null,
        receivedAt: contract.pastMeetingConcept,
        dueDate: contract.normalDue,
        origin: 'Internal',
      },
      actor: actors.youssef,
      timestamp: dateKeyAtUtc(contract.pastMeetingConcept, 8),
    },
  ];
  const replies: readonly ReplyDefinition[] = [
    {
      id: GOLDEN_COMMENT_IDS.replies[0]!,
      activityId: GOLDEN_COMMENT_IDS.activities[4]!,
      clientAuthorId: null,
      rootIndex: 0,
      input: {
        body: 'Noted. I will update REV02 and recheck the corridor calculations.',
        origin: 'Internal',
      },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.dueToday, 10, 28),
    },
    {
      id: GOLDEN_COMMENT_IDS.replies[1]!,
      activityId: GOLDEN_COMMENT_IDS.activities[5]!,
      clientAuthorId: GOLDEN_COMMENT_IDS.clientAuthors.aisha,
      rootIndex: 0,
      input: {
        body: 'Thank you. Please keep the guest-room decorative layer warm as well.',
        origin: 'Client',
        existingClientAuthorId: GOLDEN_COMMENT_IDS.clientAuthors.aisha,
      },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.dueToday, 10, 35),
    },
    {
      id: GOLDEN_COMMENT_IDS.replies[2]!,
      activityId: GOLDEN_COMMENT_IDS.activities[6]!,
      clientAuthorId: GOLDEN_COMMENT_IDS.clientAuthors.omar,
      rootIndex: 0,
      input: {
        body: 'The operator agrees with 3000K provided the dimming scene remains unchanged.',
        origin: 'Client',
        authorName: 'Omar Haddad',
        authorRole: 'Client Operations Representative',
      },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.dueToday, 10, 42),
    },
    {
      id: GOLDEN_COMMENT_IDS.replies[3]!,
      activityId: GOLDEN_COMMENT_IDS.activities[7]!,
      clientAuthorId: null,
      rootIndex: 0,
      input: {
        body: 'Confirmed. The revised calculation and render review are included in the issue plan.',
        origin: 'Internal',
      },
      actor: actors.youssef,
      timestamp: dateKeyAtUtc(contract.dueToday, 10, 50),
    },
    {
      id: GOLDEN_COMMENT_IDS.replies[4]!,
      activityId: GOLDEN_COMMENT_IDS.activities[8]!,
      clientAuthorId: null,
      rootIndex: 1,
      input: {
        body: 'The manufacturer data is registered; I will verify the beam and lumen values.',
        origin: 'Internal',
      },
      actor: actors.youssef,
      timestamp: dateKeyAtUtc(contract.overdue, 9, 25),
    },
    {
      id: GOLDEN_COMMENT_IDS.replies[5]!,
      activityId: GOLDEN_COMMENT_IDS.activities[9]!,
      clientAuthorId: null,
      rootIndex: 2,
      input: { body: 'Resolved in the current coordination record.', origin: 'Internal' },
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.pastMeetingTechnical, 8, 45),
    },
  ];
  const attachments: readonly AttachmentDefinition[] = [
    {
      id: GOLDEN_COMMENT_IDS.attachments[0]!,
      activityId: GOLDEN_COMMENT_IDS.activities[10]!,
      kind: 'root',
      rootIndex: 0,
      replyIndex: null,
      document: input.drawing,
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.dueToday, 10, 55),
    },
    {
      id: GOLDEN_COMMENT_IDS.attachments[1]!,
      activityId: GOLDEN_COMMENT_IDS.activities[11]!,
      kind: 'reply',
      rootIndex: 1,
      replyIndex: 4,
      document: input.minutes,
      actor: actors.sara,
      timestamp: dateKeyAtUtc(contract.overdue, 9, 30),
    },
  ];
  return Object.freeze({
    roots: Object.freeze(roots),
    replies: Object.freeze(replies),
    attachments: Object.freeze(attachments),
  });
}

export interface GoldenCommentsExpectedPersistence {
  readonly roots: readonly Record<string, unknown>[];
  readonly replies: readonly Record<string, unknown>[];
  readonly attachments: readonly Record<string, unknown>[];
  readonly activities: readonly Record<string, unknown>[];
}

function activityDetail(actor: AppUser, detail: string): string {
  return `${detail} | mutation actor: ${actor.displayName} (${actor.id})`;
}

export function buildGoldenCommentsExpectedPersistence(
  input: GoldenCommentsAuthorityInput,
): GoldenCommentsExpectedPersistence {
  const definition = graphDefinition(input);
  const roots = definition.roots.map((item) => ({
    id: item.id,
    project_id: input.projectId,
    reference: item.input.reference,
    title: item.input.title,
    description: item.input.description,
    area: item.input.area,
    luminaire_tag: item.input.luminaireTag,
    drawing_reference: item.input.drawingReference,
    source_type: item.input.sourceType,
    source_id: item.input.sourceId,
    status: item.input.status,
    response: item.input.response,
    revision_id: item.input.revisionId,
    received_at: item.input.receivedAt,
    due_date: item.input.dueDate,
    created_at: item.timestamp,
    updated_at: item.timestamp,
    origin: item.input.origin,
    author_id: item.input.origin === 'Client' ? item.clientAuthorId : item.actor.id,
    author_name_snapshot:
      item.input.origin === 'Client' ? item.input.authorName : item.actor.displayName,
    author_role_snapshot:
      item.input.origin === 'Client' ? item.input.authorRole : item.actor.jobTitle,
    luminaire_id: item.input.luminaireId ?? null,
  }));
  const replies = definition.replies.map((item) => {
    const root = definition.roots[item.rootIndex]!;
    const clientSnapshot =
      item.clientAuthorId === GOLDEN_COMMENT_IDS.clientAuthors.aisha
        ? { name: 'Aisha Rahman', role: 'Client Representative' }
        : { name: 'Omar Haddad', role: 'Client Operations Representative' };
    return {
      id: item.id,
      project_id: input.projectId,
      review_item_id: root.id,
      body: item.input.body,
      author_id: item.input.origin === 'Client' ? item.clientAuthorId : item.actor.id,
      author_name_snapshot:
        item.input.origin === 'Client' ? clientSnapshot.name : item.actor.displayName,
      author_role_snapshot:
        item.input.origin === 'Client' ? clientSnapshot.role : item.actor.jobTitle,
      origin: item.input.origin,
      created_at: item.timestamp,
      updated_at: item.timestamp,
    };
  });
  const attachments = definition.attachments.map((item) => ({
    id: item.id,
    project_id: input.projectId,
    document_id: item.document.id,
    review_item_id: item.kind === 'root' ? definition.roots[item.rootIndex]!.id : null,
    reply_id:
      item.kind === 'reply' && item.replyIndex !== null
        ? definition.replies[item.replyIndex]!.id
        : null,
    created_by_id: item.actor.id,
    created_by_name_snapshot: item.actor.displayName,
    created_at: item.timestamp,
  }));
  const rootActivities = definition.roots.map((item) => ({
    id: item.activityId,
    project_id: input.projectId,
    entity_type: 'Review',
    entity_id: item.id,
    action: 'Created',
    title: item.input.title,
    detail: activityDetail(item.actor, item.input.sourceType),
    created_at: item.timestamp,
  }));
  const replyActivities = definition.replies.map((item) => ({
    id: item.activityId,
    project_id: input.projectId,
    entity_type: 'ReviewReply',
    entity_id: item.id,
    action: 'Created',
    title: definition.roots[item.rootIndex]!.input.title,
    detail: activityDetail(item.actor, 'Reply added'),
    created_at: item.timestamp,
  }));
  const attachmentActivities = definition.attachments.map((item) => ({
    id: item.activityId,
    project_id: input.projectId,
    entity_type: 'ReviewAttachment',
    entity_id: item.id,
    action: 'Linked',
    title: item.document.id,
    detail: activityDetail(item.actor, 'Registered document linked'),
    created_at: item.timestamp,
  }));
  return Object.freeze({
    roots: Object.freeze(roots),
    replies: Object.freeze(replies),
    attachments: Object.freeze(attachments),
    activities: Object.freeze([...rootActivities, ...replyActivities, ...attachmentActivities]),
  });
}

export function buildGoldenCommentsGraph(
  input: GoldenCommentsGraphBuilderInput,
): GoldenCommentsGraphBuilderResult {
  const { operations, projectId } = input;
  const definition = graphDefinition(input);
  const write = <T>(timestamp: string, ids: readonly string[], operation: () => T): T =>
    operations.withServerClock(
      () => timestamp,
      () => operations.withServerIdentity(ids, operation),
    );
  const roots = definition.roots.map((item) => {
    const existing = input
      .readReviewItems()
      .find((candidate) => candidate.reference === item.input.reference);
    if (existing) {
      if (existing.id !== item.id || existing.origin !== item.input.origin) {
        throw new Error(`Golden Comments root collision for ${item.input.reference}.`);
      }
      return existing;
    }
    const ids = [...(item.clientAuthorId ? [item.clientAuthorId] : []), item.id, item.activityId];
    return write(item.timestamp, ids, () =>
      operations.createReviewThread(projectId, item.input, item.actor),
    );
  });
  if (!roots[0]?.authorId) {
    throw new Error('Golden Comments featured client root requires a stable author identity.');
  }
  const replies = definition.replies.map((item) => {
    const root = roots[item.rootIndex]!;
    const existing = operations
      .listReviewThreadContext(projectId)
      .replies.find((candidate) => candidate.id === item.id);
    if (existing) {
      if (existing.reviewItemId !== root.id) {
        throw new Error(`Golden Comments reply collision for ${item.id}.`);
      }
      return existing;
    }
    const createsClientIdentity =
      item.input.origin === 'Client' && 'authorName' in item.input && item.clientAuthorId;
    const ids = [
      ...(createsClientIdentity ? [item.clientAuthorId!] : []),
      item.id,
      item.activityId,
    ];
    return write(item.timestamp, ids, () =>
      operations.createReviewReply(projectId, root.id, item.input, item.actor),
    );
  });
  const attachments = definition.attachments.map((item) => {
    const root = roots[item.rootIndex]!;
    const reply = item.replyIndex === null ? null : replies[item.replyIndex]!;
    const expected = {
      documentId: item.document.id,
      reviewItemId: item.kind === 'root' ? root.id : null,
      replyId: item.kind === 'reply' ? reply!.id : null,
    };
    const current = operations.listReviewThreadContext(projectId).attachments;
    const matches = (candidate: ProjectReviewAttachment): boolean =>
      candidate.documentId === expected.documentId &&
      candidate.reviewItemId === expected.reviewItemId &&
      candidate.replyId === expected.replyId;
    const byId = current.find((candidate) => candidate.id === item.id);
    const byRelationship = current.find(matches);
    if (byId && !matches(byId)) {
      throw new Error(`Golden Comments attachment collision for ${item.id}.`);
    }
    if (byRelationship && byRelationship.id !== item.id) {
      throw new Error(`Golden Comments attachment relationship collision for ${item.id}.`);
    }
    if (byId) return byId;
    return write(item.timestamp, [item.id, item.activityId], () =>
      item.kind === 'root'
        ? operations.linkReviewItemDocument(projectId, root.id, item.document.id, item.actor)
        : operations.linkReviewReplyDocument(
            projectId,
            root.id,
            reply!.id,
            item.document.id,
            item.actor,
          ),
    );
  });
  return Object.freeze({
    roots: Object.freeze(roots),
    replies: Object.freeze(replies),
    attachments: Object.freeze(attachments),
  });
}
