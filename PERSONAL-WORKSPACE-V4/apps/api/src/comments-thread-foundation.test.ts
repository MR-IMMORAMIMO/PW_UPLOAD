import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '@scli/config';
import { luminaireRecordSchema } from '@scli/contracts';
import { seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

const config = loadConfig({
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  COMPANY_TIMEZONE: 'Asia/Dubai',
});
const project = seedProjects.find((item) => item.salesOwnerId === seedUserIds.salesOne)!;
const otherProject = seedProjects.find((item) => item.salesOwnerId === seedUserIds.salesTwo)!;
const mutationUser = seedUsers.find((item) => item.id === seedUserIds.salesOne)!;
const headers = { 'x-mock-user-id': mutationUser.id };

const rootPayload = {
  reference: 'C-01',
  title: 'Revise CCT',
  description: 'Use 3000K in guest rooms.',
  area: 'Guest rooms',
  luminaireTag: 'DL01',
  drawingReference: 'L-101',
  sourceType: 'Email' as const,
  sourceId: null,
  status: 'Open' as const,
  response: 'Preserved legacy designer response',
  revisionId: null,
  luminaireId: null,
  receivedAt: '2026-08-16',
  dueDate: '2026-08-20',
};

describe('Comments thread foundation', () => {
  let app: FastifyInstance;
  let store: PersonalWorkspaceStore;
  let provider: MockDataProvider;

  beforeEach(async () => {
    store = new PersonalWorkspaceStore(config);
    for (const projectId of [project.id, otherProject.id]) {
      store.initializeProject(
        projectId,
        ['LightingDesign'],
        'Full Lighting Design',
        'Later',
        '2026-08-30',
      );
    }
    provider = new MockDataProvider();
    app = await createApp({ config, provider, personalStore: store });
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  it('authorizes reply edits, rejects forged fields, and preserves original attribution', async () => {
    const root = store.operations.createReviewThread(
      project.id,
      { ...rootPayload, origin: 'Internal' },
      mutationUser,
    );
    const original = store.operations.createReviewReply(
      project.id,
      root.id,
      { origin: 'Internal', body: 'Original reply' },
      mutationUser,
    );
    const url = `/api/projects/${project.id}/review-items/${root.id}/replies/${original.id}`;
    const payload = { body: 'Updated reply', expectedUpdatedAt: original.updatedAt };
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: { 'x-mock-user-id': seedUserIds.salesTwo },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { ...payload, authorNameSnapshot: 'Forged' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({ method: 'PATCH', url, headers, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      body: 'Updated reply',
      authorId: original.authorId,
      authorNameSnapshot: original.authorNameSnapshot,
      createdAt: original.createdAt,
    });
    expect((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode).toBe(409);
  });

  it('derives Internal authors, preserves explicit Client snapshots, and keeps source medium independent', async () => {
    const internal = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-threads`,
      headers,
      payload: {
        ...rootPayload,
        origin: 'Internal',
        authorId: 'forged',
        authorName: 'Forged Person',
        authorRole: 'Forged Role',
      },
    });
    expect(internal.statusCode).toBe(201);
    expect(internal.json().data).toMatchObject({
      origin: 'Internal',
      authorId: mutationUser.id,
      authorNameSnapshot: mutationUser.displayName,
      authorRoleSnapshot: mutationUser.jobTitle,
      sourceType: 'Email',
      response: rootPayload.response,
    });

    const client = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-threads`,
      headers,
      payload: {
        ...rootPayload,
        title: 'Client authored root',
        sourceType: 'Manual',
        origin: 'Client',
        authorName: 'Sarah Ahmed',
        authorRole: 'Client Representative',
      },
    });
    expect(client.statusCode).toBe(201);
    expect(client.json().data).toMatchObject({
      origin: 'Client',
      authorNameSnapshot: 'Sarah Ahmed',
      authorRoleSnapshot: 'Client Representative',
      sourceType: 'Manual',
    });
    expect(client.json().data.authorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      store
        .getWorkspace(project.id)
        .activity.find((item) => item.entityId === client.json().data.id)?.detail,
    ).toContain(`mutation actor: ${mutationUser.displayName} (${mutationUser.id})`);
  });

  it('preserves an unchanged dangling legacy Revision while validating every changed Revision relation', () => {
    const danglingRevisionId = '91000000-0000-4000-8000-000000000001';
    const missingRevisionId = '91000000-0000-4000-8000-000000000002';
    const legacy = store.operations.createReview(project.id, rootPayload);
    store
      .getSharedDatabase()
      .prepare('UPDATE project_review_items SET revision_id = ? WHERE id = ?')
      .run(danglingRevisionId, legacy.id);

    const statusUpdated = store.operations.updateReview(project.id, legacy.id, {
      ...rootPayload,
      revisionId: danglingRevisionId,
      status: 'Resolved',
    });
    expect(statusUpdated).toMatchObject({
      status: 'Resolved',
      revisionId: danglingRevisionId,
      response: rootPayload.response,
    });
    const responseUpdated = store.operations.updateReview(project.id, legacy.id, {
      ...rootPayload,
      revisionId: danglingRevisionId,
      status: 'Resolved',
      response: 'Updated compatibility response',
    });
    expect(responseUpdated).toMatchObject({
      revisionId: danglingRevisionId,
      response: 'Updated compatibility response',
    });

    const validRevision = store.operations.createRevision(project.id, {
      revisionNumber: 8,
      reissueNumber: 0,
      title: 'Valid replacement',
      status: 'Draft',
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: '',
      changeLog: '',
      sourceType: 'Manual',
      sourceReference: '',
    });
    const foreignRevision = store.operations.createRevision(otherProject.id, {
      revisionNumber: 9,
      reissueNumber: 0,
      title: 'Foreign replacement',
      status: 'Draft',
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: '',
      changeLog: '',
      sourceType: 'Manual',
      sourceReference: '',
    });
    expect(
      store.operations.updateReview(project.id, legacy.id, {
        ...rootPayload,
        revisionId: validRevision.id,
        response: responseUpdated.response,
      }).revisionId,
    ).toBe(validRevision.id);
    expect(() =>
      store.operations.updateReview(project.id, legacy.id, {
        ...rootPayload,
        revisionId: missingRevisionId,
      }),
    ).toThrow(/Revision not found/i);
    expect(() =>
      store.operations.updateReview(project.id, legacy.id, {
        ...rootPayload,
        revisionId: foreignRevision.id,
      }),
    ).toThrow(/Revision not found/i);
    expect(
      store.operations.updateReview(project.id, legacy.id, {
        ...rootPayload,
        revisionId: null,
      }).revisionId,
    ).toBeNull();
    expect(() =>
      store.operations.createReview(project.id, {
        ...rootPayload,
        revisionId: missingRevisionId,
      }),
    ).toThrow(/Revision not found/i);
    expect(() =>
      store.operations.createReview(project.id, {
        ...rootPayload,
        revisionId: foreignRevision.id,
      }),
    ).toThrow(/Revision not found/i);
  });

  it('reuses only server-issued Client authors from the same Review thread', async () => {
    const root = store.operations.createReviewThread(
      project.id,
      {
        ...rootPayload,
        origin: 'Client',
        authorName: 'Sarah Ahmed',
        authorRole: 'Client Representative',
      },
      mutationUser,
    );
    const createReply = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/review-items/${root.id}/replies`,
        headers,
        payload,
      });

    const sarahOne = await createReply({
      body: 'Sarah first',
      origin: 'Client',
      existingClientAuthorId: root.authorId,
      authorName: 'Forged Sarah',
      authorRole: 'Forged Role',
    });
    const sarahTwo = await createReply({
      body: 'Sarah second',
      origin: 'Client',
      existingClientAuthorId: root.authorId,
    });
    expect([sarahOne.statusCode, sarahTwo.statusCode]).toEqual([201, 201]);
    for (const reply of [sarahOne.json().data, sarahTwo.json().data]) {
      expect(reply).toMatchObject({
        authorId: root.authorId,
        authorNameSnapshot: root.authorNameSnapshot,
        authorRoleSnapshot: root.authorRoleSnapshot,
        origin: 'Client',
      });
    }

    const secondPerson = await createReply({
      body: 'Omar first',
      origin: 'Client',
      authorName: 'Omar Saleh',
      authorRole: 'MEP Consultant',
    });
    expect(secondPerson.statusCode).toBe(201);
    const secondPersonReuse = await createReply({
      body: 'Omar second',
      origin: 'Client',
      existingClientAuthorId: secondPerson.json().data.authorId,
    });
    expect(secondPersonReuse.json().data).toMatchObject({
      authorId: secondPerson.json().data.authorId,
      authorNameSnapshot: 'Omar Saleh',
      authorRoleSnapshot: 'MEP Consultant',
    });
    expect(secondPerson.json().data.authorId).not.toBe(root.authorId);

    const sameNameDistinct = await createReply({
      body: 'Different Sarah',
      origin: 'Client',
      authorName: 'Sarah Ahmed',
      authorRole: 'Client Representative',
    });
    expect(sameNameDistinct.statusCode).toBe(201);
    expect(sameNameDistinct.json().data.authorId).not.toBe(root.authorId);

    const otherThread = store.operations.createReviewThread(
      project.id,
      {
        ...rootPayload,
        title: 'Other thread',
        origin: 'Client',
        authorName: 'Other Thread Client',
        authorRole: 'Client',
      },
      mutationUser,
    );
    const otherProjectRoot = store.operations.createReviewThread(
      otherProject.id,
      {
        ...rootPayload,
        title: 'Other project thread',
        origin: 'Client',
        authorName: 'Other Project Client',
        authorRole: 'Client',
      },
      mutationUser,
    );
    const internal = await createReply({ body: 'Internal', origin: 'Internal' });
    expect(internal.statusCode).toBe(201);

    for (const existingClientAuthorId of [
      otherThread.authorId,
      otherProjectRoot.authorId,
      internal.json().data.authorId,
      '92000000-0000-4000-8000-000000000001',
    ]) {
      const rejected = await createReply({
        body: 'Must reject',
        origin: 'Client',
        existingClientAuthorId,
      });
      expect(rejected.statusCode).toBe(404);
    }

    const replies = store.operations
      .listReviewThreadContext(project.id)
      .replies.filter((reply) => reply.reviewItemId === root.id);
    expect(replies.filter((reply) => reply.authorId === root.authorId)).toHaveLength(2);
    expect(
      replies.filter((reply) => reply.authorId === secondPerson.json().data.authorId),
    ).toHaveLength(2);
  });

  it('validates Revision and Luminaire relations and preserves enriched fields through resolve/reopen', async () => {
    const revision = store.operations.createRevision(project.id, {
      revisionNumber: 3,
      reissueNumber: 0,
      title: 'REV03',
      status: 'InProgress',
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: '',
      changeLog: '',
      sourceType: 'Manual',
      sourceReference: '',
    });
    const foreignRevision = store.operations.createRevision(otherProject.id, {
      revisionNumber: 4,
      reissueNumber: 0,
      title: 'Foreign',
      status: 'Draft',
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: '',
      changeLog: '',
      sourceType: 'Manual',
      sourceReference: '',
    });
    const luminaire = store.addLuminaire(
      project.id,
      luminaireRecordSchema.parse({ tag: 'DL01', description: 'Downlight' }),
    );
    const foreignLuminaire = store.addLuminaire(
      otherProject.id,
      luminaireRecordSchema.parse({ tag: 'FL01' }),
    );
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-threads`,
      headers,
      payload: {
        ...rootPayload,
        origin: 'Internal',
        revisionId: revision.id,
        luminaireId: luminaire.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const root = created.json().data;
    for (const [field, value] of [
      ['revisionId', foreignRevision.id],
      ['revisionId', '00000000-0000-4000-8000-000000000001'],
      ['luminaireId', foreignLuminaire.id],
      ['luminaireId', '00000000-0000-4000-8000-000000000002'],
    ] as const) {
      const invalid = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/review-threads`,
        headers,
        payload: { ...rootPayload, origin: 'Internal', [field]: value },
      });
      expect(invalid.statusCode).toBe(404);
    }
    const resolved = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/review-items/${root.id}`,
      headers,
      payload: {
        ...rootPayload,
        revisionId: revision.id,
        luminaireId: luminaire.id,
        status: 'Resolved',
      },
    });
    expect(resolved.json().data).toMatchObject({
      status: 'Resolved',
      origin: 'Internal',
      authorId: mutationUser.id,
      revisionId: revision.id,
      luminaireId: luminaire.id,
      luminaireTag: 'DL01',
      response: rootPayload.response,
    });
    const reopenPayload: Record<string, unknown> = {
      ...rootPayload,
      revisionId: revision.id,
      status: 'Open',
      luminaireTag: 'DL01-RENAMED',
    };
    delete reopenPayload.luminaireId;
    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/review-items/${root.id}`,
      headers,
      payload: reopenPayload,
    });
    expect(reopened.json().data).toMatchObject({
      status: 'Open',
      origin: 'Internal',
      luminaireId: luminaire.id,
      luminaireTag: 'DL01-RENAMED',
    });
  });

  it('creates immutable ordered replies, links only registered same-project documents, and isolates context', async () => {
    const localRoot = store.operations.createReviewThread(
      project.id,
      { ...rootPayload, origin: 'Client', authorName: 'Sarah Ahmed', authorRole: 'Client' },
      mutationUser,
    );
    const foreignRoot = store.operations.createReviewThread(
      otherProject.id,
      { ...rootPayload, origin: 'Internal' },
      mutationUser,
    );
    const foreignReply = store.operations.createReviewReply(
      otherProject.id,
      foreignRoot.id,
      { body: 'Foreign reply', origin: 'Internal' },
      mutationUser,
    );
    const document = store.operations.createDocument(project.id, {
      category: 'Datasheet',
      documentNumber: 'DS-01',
      title: 'DL01 Datasheet',
      revision: '1',
      status: 'Working',
      filePath: 'registered/project/path.pdf',
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    const foreignDocument = store.operations.createDocument(otherProject.id, {
      category: 'Datasheet',
      documentNumber: 'DS-X',
      title: 'Foreign',
      revision: '1',
      status: 'Working',
      filePath: 'foreign.pdf',
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    const internal = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-items/${localRoot.id}/replies`,
      headers,
      payload: { body: ' Internal reply ', origin: 'Internal', authorName: 'Forged' },
    });
    expect(internal.statusCode).toBe(201);
    expect(internal.json().data).toMatchObject({
      body: 'Internal reply',
      authorId: mutationUser.id,
      authorNameSnapshot: mutationUser.displayName,
      authorRoleSnapshot: mutationUser.jobTitle,
      origin: 'Internal',
    });
    const client = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-items/${localRoot.id}/replies`,
      headers,
      payload: {
        body: 'Client reply',
        origin: 'Client',
        authorName: 'Sarah Ahmed',
        authorRole: 'Client Representative',
      },
    });
    expect(client.statusCode).toBe(201);
    expect(client.json().data).toMatchObject({
      authorNameSnapshot: 'Sarah Ahmed',
      authorRoleSnapshot: 'Client Representative',
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/review-items/${localRoot.id}/replies`,
          headers,
          payload: { body: '   ', origin: 'Internal' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/review-items/${foreignRoot.id}/replies`,
          headers,
          payload: { body: 'No', origin: 'Internal' },
        })
      ).statusCode,
    ).toBe(404);

    const rootLink = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-items/${localRoot.id}/attachments`,
      headers,
      payload: {
        documentId: document.id,
        filePath: 'over-posted.exe',
        url: 'https://example.test',
      },
    });
    expect(rootLink.statusCode).toBe(201);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-items/${localRoot.id}/attachments`,
      headers,
      payload: { documentId: document.id },
    });
    expect(duplicate.json().data.id).toBe(rootLink.json().data.id);
    const replyLink = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/review-items/${localRoot.id}/replies/${client.json().data.id}/attachments`,
      headers,
      payload: { documentId: document.id },
    });
    expect(replyLink.statusCode).toBe(201);
    for (const url of [
      `/api/projects/${project.id}/review-items/${localRoot.id}/attachments`,
      `/api/projects/${project.id}/review-items/${localRoot.id}/replies/${client.json().data.id}/attachments`,
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers,
            payload: { documentId: foreignDocument.id },
          })
        ).statusCode,
      ).toBe(404);
    }
    for (const url of [
      `/api/projects/${project.id}/review-items/${foreignRoot.id}/attachments`,
      `/api/projects/${project.id}/review-items/${localRoot.id}/replies/${foreignReply.id}/attachments`,
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers,
            payload: { documentId: document.id },
          })
        ).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/review-items/${localRoot.id}/attachments`,
          headers,
          payload: { documentId: '00000000-0000-4000-8000-000000000099' },
        })
      ).statusCode,
    ).toBe(404);
    const context = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/review-thread-context`,
      headers,
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().data.replies).toHaveLength(2);
    expect(context.json().data.attachments).toHaveLength(2);
    expect(
      context
        .json()
        .data.replies.every((item: { projectId: string }) => item.projectId === project.id),
    ).toBe(true);
    expect(context.json().data).not.toHaveProperty('reviewItems');
    expect(context.json().data).not.toHaveProperty('participants');
    expect(context.json().data.replies).toEqual(
      [...context.json().data.replies].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    );
    expect(store.getWorkspace(project.id).reviewItems[0]?.response).toBe(rootPayload.response);
    expect(await provider.listComments(project.id)).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/projects/${project.id}/review-items/${localRoot.id}/replies/${client.json().data.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);

    const database = store.getSharedDatabase();
    expect(() =>
      database
        .prepare(
          `INSERT INTO project_review_attachments
           (id, project_id, document_id, review_item_id, reply_id,
            created_by_id, created_by_name_snapshot, created_at)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          '90000000-0000-4000-8000-000000000001',
          project.id,
          document.id,
          mutationUser.id,
          mutationUser.displayName,
          '2026-08-16T00:00:00.000Z',
        ),
    ).toThrow();
  });
});
