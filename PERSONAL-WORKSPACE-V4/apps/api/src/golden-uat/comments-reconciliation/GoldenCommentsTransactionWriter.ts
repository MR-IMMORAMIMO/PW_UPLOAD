import type { DatabaseSync } from 'node:sqlite';
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
import type { GoldenCommentsOperations } from '../golden-comments-graph-builder';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function reviewFromRow(row: Row): ProjectReviewItem {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    reference: text(row.reference),
    title: text(row.title),
    description: text(row.description),
    area: text(row.area),
    luminaireTag: text(row.luminaire_tag),
    drawingReference: text(row.drawing_reference),
    sourceType: text(row.source_type) as ProjectReviewItem['sourceType'],
    sourceId: nullableText(row.source_id),
    status: text(row.status) as ProjectReviewItem['status'],
    response: text(row.response),
    revisionId: nullableText(row.revision_id),
    origin: nullableText(row.origin) as ProjectReviewItem['origin'],
    authorId: nullableText(row.author_id),
    authorNameSnapshot: nullableText(row.author_name_snapshot),
    authorRoleSnapshot: nullableText(row.author_role_snapshot),
    luminaireId: nullableText(row.luminaire_id),
    receivedAt: text(row.received_at),
    dueDate: nullableText(row.due_date),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function replyFromRow(row: Row): ProjectReviewReply {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    reviewItemId: text(row.review_item_id),
    body: text(row.body),
    authorId: text(row.author_id),
    authorNameSnapshot: text(row.author_name_snapshot),
    authorRoleSnapshot: text(row.author_role_snapshot),
    origin: text(row.origin) as ProjectReviewReply['origin'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function attachmentFromRow(row: Row): ProjectReviewAttachment {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    documentId: text(row.document_id),
    reviewItemId: nullableText(row.review_item_id),
    replyId: nullableText(row.reply_id),
    createdById: text(row.created_by_id),
    createdByNameSnapshot: text(row.created_by_name_snapshot),
    createdAt: text(row.created_at),
  };
}

/**
 * Transaction-bound deterministic Comments writer. The caller owns the connection and transaction;
 * this class performs no schema/bootstrap work and touches only Comments rows and Comments activity.
 */
export class GoldenCommentsTransactionWriter implements GoldenCommentsOperations {
  private nowProvider: () => string = () => new Date().toISOString();
  private idProvider: () => string = () => {
    throw new Error('A deterministic Golden Comments identity scope is required.');
  };

  public constructor(private readonly database: DatabaseSync) {}

  public withServerClock<T>(now: () => string, operation: () => T): T {
    const previous = this.nowProvider;
    this.nowProvider = now;
    try {
      return operation();
    } finally {
      this.nowProvider = previous;
    }
  }

  public withServerIdentity<T>(ids: readonly string[], operation: () => T): T {
    const previous = this.idProvider;
    let index = 0;
    this.idProvider = () => {
      const id = ids[index];
      if (!id) throw new Error('Deterministic Golden Comments identity sequence was exhausted.');
      index += 1;
      return id;
    };
    try {
      return operation();
    } finally {
      this.idProvider = previous;
    }
  }

  public createReviewThread(
    projectId: string,
    input: CreateProjectReviewThreadInput,
    actor: AppUser,
  ): ProjectReviewItem {
    this.requireProjectRelation('project_revisions', projectId, input.revisionId);
    this.requireProjectRelation('project_luminaires', projectId, input.luminaireId ?? null);
    const author =
      input.origin === 'Client'
        ? {
            id: this.idProvider(),
            name: input.authorName,
            role: input.authorRole,
          }
        : { id: actor.id, name: actor.displayName, role: actor.jobTitle };
    const id = this.idProvider();
    const now = this.nowProvider();
    this.database
      .prepare(
        `INSERT INTO project_review_items
        (id, project_id, reference, title, description, area, luminaire_tag,
         drawing_reference, source_type, source_id, status, response, revision_id,
         origin, author_id, author_name_snapshot, author_role_snapshot, luminaire_id,
         received_at, due_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.reference,
        input.title,
        input.description,
        input.area,
        input.luminaireTag,
        input.drawingReference,
        input.sourceType,
        input.sourceId,
        input.status,
        input.response,
        input.revisionId,
        input.origin,
        author.id,
        author.name,
        author.role,
        input.luminaireId ?? null,
        input.receivedAt,
        input.dueDate,
        now,
        now,
      );
    this.activity(
      projectId,
      'Review',
      id,
      'Created',
      input.title,
      this.auditDetail(actor, input.sourceType),
      now,
    );
    return this.getReview(projectId, id);
  }

  public listReviewThreadContext(projectId: string): {
    readonly replies: readonly ProjectReviewReply[];
    readonly attachments: readonly ProjectReviewAttachment[];
  } {
    const replies = (
      this.database
        .prepare(
          `SELECT * FROM project_review_replies
           WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(projectId) as Row[]
    ).map(replyFromRow);
    const attachments = (
      this.database
        .prepare(
          `SELECT * FROM project_review_attachments
           WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(projectId) as Row[]
    ).map(attachmentFromRow);
    return { replies, attachments };
  }

  public createReviewReply(
    projectId: string,
    reviewItemId: string,
    input: CreateProjectReviewReplyInput,
    actor: AppUser,
  ): ProjectReviewReply {
    const review = this.getReview(projectId, reviewItemId);
    const author = this.replyAuthor(projectId, review, input, actor);
    const id = this.idProvider();
    const now = this.nowProvider();
    this.database
      .prepare(
        `INSERT INTO project_review_replies
         (id, project_id, review_item_id, body, author_id, author_name_snapshot,
          author_role_snapshot, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        reviewItemId,
        input.body,
        author.id,
        author.name,
        author.role,
        input.origin,
        now,
        now,
      );
    this.activity(
      projectId,
      'ReviewReply',
      id,
      'Created',
      review.title,
      this.auditDetail(actor, 'Reply added'),
      now,
    );
    return this.getReply(projectId, reviewItemId, id);
  }

  public linkReviewItemDocument(
    projectId: string,
    reviewItemId: string,
    documentId: string,
    actor: AppUser,
  ): ProjectReviewAttachment {
    this.getReview(projectId, reviewItemId);
    return this.linkDocument(projectId, documentId, reviewItemId, null, actor);
  }

  public linkReviewReplyDocument(
    projectId: string,
    reviewItemId: string,
    replyId: string,
    documentId: string,
    actor: AppUser,
  ): ProjectReviewAttachment {
    this.getReply(projectId, reviewItemId, replyId);
    return this.linkDocument(projectId, documentId, null, replyId, actor);
  }

  private linkDocument(
    projectId: string,
    documentId: string,
    reviewItemId: string | null,
    replyId: string | null,
    actor: AppUser,
  ): ProjectReviewAttachment {
    this.requireProjectRelation('project_documents', projectId, documentId);
    const existing = this.database
      .prepare(
        reviewItemId
          ? `SELECT * FROM project_review_attachments
             WHERE project_id = ? AND review_item_id = ? AND document_id = ?`
          : `SELECT * FROM project_review_attachments
             WHERE project_id = ? AND reply_id = ? AND document_id = ?`,
      )
      .get(projectId, reviewItemId ?? replyId, documentId) as Row | undefined;
    if (existing) return attachmentFromRow(existing);
    const id = this.idProvider();
    const now = this.nowProvider();
    this.database
      .prepare(
        `INSERT INTO project_review_attachments
         (id, project_id, document_id, review_item_id, reply_id,
          created_by_id, created_by_name_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, documentId, reviewItemId, replyId, actor.id, actor.displayName, now);
    this.activity(
      projectId,
      'ReviewAttachment',
      id,
      'Linked',
      documentId,
      this.auditDetail(actor, 'Registered document linked'),
      now,
    );
    const row = this.database
      .prepare('SELECT * FROM project_review_attachments WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row;
    return attachmentFromRow(row);
  }

  private replyAuthor(
    projectId: string,
    review: ProjectReviewItem,
    input: CreateProjectReviewReplyInput,
    actor: AppUser,
  ): { readonly id: string; readonly name: string; readonly role: string } {
    if (input.origin === 'Internal') {
      return { id: actor.id, name: actor.displayName, role: actor.jobTitle };
    }
    if ('authorName' in input) {
      return { id: this.idProvider(), name: input.authorName, role: input.authorRole };
    }
    if (
      review.origin === 'Client' &&
      review.authorId === input.existingClientAuthorId &&
      review.authorNameSnapshot !== null &&
      review.authorRoleSnapshot !== null
    ) {
      return {
        id: input.existingClientAuthorId,
        name: review.authorNameSnapshot,
        role: review.authorRoleSnapshot,
      };
    }
    const row = this.database
      .prepare(
        `SELECT author_id, author_name_snapshot, author_role_snapshot
         FROM project_review_replies
         WHERE project_id = ? AND review_item_id = ? AND origin = 'Client' AND author_id = ?
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get(projectId, review.id, input.existingClientAuthorId) as Row | undefined;
    if (!row) throw new Error('Client author not found in this Golden Comments thread.');
    return {
      id: text(row.author_id),
      name: text(row.author_name_snapshot),
      role: text(row.author_role_snapshot),
    };
  }

  private getReview(projectId: string, id: string): ProjectReviewItem {
    const row = this.database
      .prepare('SELECT * FROM project_review_items WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new Error('Golden Comments root not found.');
    return reviewFromRow(row);
  }

  private getReply(projectId: string, reviewItemId: string, id: string): ProjectReviewReply {
    const row = this.database
      .prepare(
        `SELECT * FROM project_review_replies
         WHERE id = ? AND review_item_id = ? AND project_id = ?`,
      )
      .get(id, reviewItemId, projectId) as Row | undefined;
    if (!row) throw new Error('Golden Comments reply not found.');
    return replyFromRow(row);
  }

  private requireProjectRelation(table: string, projectId: string, id: string | null): void {
    if (id === null) return;
    const escapedTable = table.replaceAll('"', '""');
    const row = this.database
      .prepare(`SELECT id FROM "${escapedTable}" WHERE id = ? AND project_id = ?`)
      .get(id, projectId);
    if (!row) throw new Error(`Golden Comments relation ${table}/${id} was not found.`);
  }

  private activity(
    projectId: string,
    entityType: string,
    entityId: string,
    action: string,
    title: string,
    detail: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO workspace_activity
         (id, project_id, entity_type, entity_id, action, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.idProvider(), projectId, entityType, entityId, action, title, detail, createdAt);
  }

  private auditDetail(actor: AppUser, detail: string): string {
    return `${detail} | mutation actor: ${actor.displayName} (${actor.id})`;
  }
}
