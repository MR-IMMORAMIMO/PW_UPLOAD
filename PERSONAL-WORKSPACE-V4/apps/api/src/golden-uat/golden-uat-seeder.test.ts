import { PRODUCTION_SCHEMA_TARGET_VERSION } from '../infrastructure/migration/registry/production-migration-registry';
/**
 * Golden UAT fixture — focused seeder tests.
 *
 * Uses isolated test storage (a temp migrated DB) and never touches the user's real
 * Personal UAT database. Covers the mandatory test matrix:
 *   - fixture identity / collision guard
 *   - dry-run (PLAN) has no mutation
 *   - non-fixture collision refusal
 *   - idempotent second apply
 *   - no unrelated project mutation
 *   - canonical luminaire tag identity (uppercase)
 *   - expected relative date calculations from anchor date
 *   - no active WorkSession after seed
 *   - manifest reflects actual read-back values (not hard-coded IDs)
 *   - unsupported capabilities are reported, not fabricated
 *   - timeline raw timestamp evidence preserved in manifest
 */

import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createGoldenUatHarness, type GoldenUatHarness } from './golden-uat-harness';
import { GoldenUatSeeder, requireUniqueGoldenCommentsProjectDocument } from './golden-uat-seeder';
import { runGoldenUatPreflight } from './golden-uat-preflight';
import {
  GOLDEN_UAT_CRM_REFERENCE,
  GOLDEN_UAT_FIXTURE_MARKER,
  GOLDEN_UAT_MANIFEST_FILE_NAME,
  GOLDEN_UAT_PROJECT_NAME,
  addCalendarDays,
  buildAnchorContract,
  deriveObservedPrecision,
} from './golden-uat-types';

const temporaryDirectories: string[] = [];

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-uat-'));
  temporaryDirectories.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'golden.sqlite');
}

function removeGoldenCommentsGraph(harness: GoldenUatHarness, projectId: string): void {
  const database = harness.store.getSharedDatabase();
  database.prepare('DELETE FROM project_review_attachments WHERE project_id = ?').run(projectId);
  database.prepare('DELETE FROM project_review_replies WHERE project_id = ?').run(projectId);
  database.prepare('DELETE FROM project_review_items WHERE project_id = ?').run(projectId);
  database
    .prepare(
      `DELETE FROM workspace_activity
       WHERE project_id = ?
         AND entity_type IN ('Review', 'ReviewReply', 'ReviewAttachment')`,
    )
    .run(projectId);
}

async function makeHarness(): Promise<{
  harness: GoldenUatHarness;
  databasePath: string;
  fixtureRoot: string;
}> {
  const dir = newTempDir();
  const databasePath = dbPathIn(dir);
  const fixtureRoot = path.join(dir, 'fixture-files');
  const harness = await createGoldenUatHarness({
    databasePath,
    clock: () => new Date('2026-08-11T08:00:00.000Z'),
  });
  return { harness, databasePath, fixtureRoot };
}

afterEach(async () => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Golden UAT fixture — anchor-date contract', () => {
  it('builds relative business dates from an anchor date', () => {
    const contract = buildAnchorContract('2026-08-11');
    expect(contract.anchorDate).toBe('2026-08-11');
    expect(contract.overdue).toBe('2026-08-09');
    expect(contract.dueToday).toBe('2026-08-11');
    expect(contract.dueSoon).toBe('2026-08-13');
    expect(contract.normalDue).toBe('2026-08-21');
  });

  it('addCalendarDays rolls across month boundaries', () => {
    expect(addCalendarDays('2026-08-30', 5)).toBe('2026-09-04');
    expect(addCalendarDays('2026-08-11', -2)).toBe('2026-08-09');
  });
});

describe('Golden UAT fixture — collision guard', () => {
  it('refuses to touch a non-fixture project that shares the display name', async () => {
    const { harness } = await makeHarness();
    try {
      const seeder = new GoldenUatSeeder(harness);
      // Create a normal user project with the SAME display name but no marker.
      await harness.service.createProject(harness.admin, {
        projectName: GOLDEN_UAT_PROJECT_NAME,
        clientName: 'Real Client',
        projectType: 'Lighting Layout',
        description: 'A real project that happens to share the name.',
        collaboratorDesignerIds: [],
        siteLocation: 'Dubai',
        designStage: 'Concept',
        lightingScope: 'Interior lighting.',
        luxRequirements: '',
        drawingReference: '',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 8,
        requiredDeliveryDate: '2026-08-21',
        createFolders: false,
        services: ['LuminaireSchedule'],
        idempotencyKey: randomUUID(),
      });
      // PLAN must refuse because the name matches but the marker does not.
      await expect(seeder.seed({ mode: 'PLAN', anchorDate: '2026-08-11' })).rejects.toThrow(
        /does not carry the GOLDEN_UAT_PROJECT marker/,
      );
    } finally {
      await harness.close();
    }
  });

  it('dry-run (PLAN) performs no mutation', async () => {
    const { harness, databasePath } = await makeHarness();
    try {
      const seeder = new GoldenUatSeeder(harness);
      const result = await seeder.seed({ mode: 'PLAN', anchorDate: '2026-08-11' });
      expect(result.mode).toBe('PLAN');
      // No fixture project exists after PLAN.
      const projects = await harness.provider.listProjects();
      expect(projects.filter((p) => p.crmReference === GOLDEN_UAT_CRM_REFERENCE)).toHaveLength(0);
      // Manifest is plan-mode (empty project identity).
      expect(result.manifest.fixture.projectId).toBe('');
    } finally {
      await harness.close();
      void databasePath;
    }
  });
});

describe('Golden UAT fixture — apply + read-back manifest', () => {
  it('applies the fixture and produces a read-back manifest reflecting actual data', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      const seeder = new GoldenUatSeeder(harness);
      const result = await seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot });
      expect(result.mode).toBe('APPLY');
      expect(result.manifest.fixture.marker).toBe(GOLDEN_UAT_FIXTURE_MARKER);
      expect(result.manifest.fixture.projectId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.manifest.fixture.projectCode).toMatch(/^\d{3}_SCT\d{6}_/);

      // Canonical luminaire tag identity (uppercase).
      const workspace = harness.store.getWorkspace(result.manifest.fixture.projectId);
      for (const luminaire of workspace.luminaires) {
        expect(luminaire.tag).toBe(luminaire.tag.toUpperCase());
      }

      const meetings = harness.store.operations.listMeetingReadModels(
        result.manifest.fixture.projectId,
      );
      const featured = meetings.find((meeting) => meeting.title === 'Current Revision Review');
      const pastA = meetings.find((meeting) => meeting.title === 'Client Kickoff');
      const pastB = meetings.find((meeting) => meeting.title === 'Concept Lighting Review');
      if (!featured || !pastA || !pastB)
        throw new Error('Golden Meeting read model is incomplete.');
      expect(meetings.map((meeting) => meeting.id).sort()).toEqual(
        [...result.manifest.entityIds.meetings].sort(),
      );
      expect(featured).toMatchObject({
        status: 'Planned',
        purpose: 'Review the current REV02 package and confirm next actions.',
        participantsCount: 6,
        notesCount: 2,
        linkedActionsCount: 3,
        actionsCreatedCount: 1,
        latestNoteSummary: {
          authorName: 'Youssef Amin',
          content: 'Technical review pack will be circulated before the meeting.',
          createdAt: '2026-07-12T04:05:00.000Z',
          updatedAt: '2026-07-12T04:05:00.000Z',
        },
      });
      expect(featured.participantPreview.map((participant) => participant.id)).toEqual([
        '90000004-0000-4000-8000-000000000001',
        '90000004-0000-4000-8000-000000000002',
        '90000004-0000-4000-8000-000000000003',
        '90000004-0000-4000-8000-000000000004',
      ]);
      expect(pastA).toMatchObject({
        status: 'Held',
        decisions: 'Proceed with detailed design.',
        notesCount: 3,
        actionsCreatedCount: 2,
      });
      expect(pastB).toMatchObject({
        status: 'Held',
        decisions: 'Adopt 3000K in guest rooms.',
        notesCount: 1,
        actionsCreatedCount: 1,
      });
      const featuredDetail = harness.store.operations.getMeetingDetail(
        result.manifest.fixture.projectId,
        featured.id,
      );
      expect(featuredDetail.participants.map((participant) => participant.id)).toEqual([
        '90000004-0000-4000-8000-000000000001',
        '90000004-0000-4000-8000-000000000002',
        '90000004-0000-4000-8000-000000000003',
        '90000004-0000-4000-8000-000000000004',
        '90000004-0000-4000-8000-000000000005',
        '90000004-0000-4000-8000-000000000006',
      ]);
      expect(featuredDetail.agendaItems.map((item) => item.id)).toEqual([
        '91000004-0000-4000-8000-000000000001',
        '91000004-0000-4000-8000-000000000002',
        '91000004-0000-4000-8000-000000000003',
        '91000004-0000-4000-8000-000000000004',
      ]);
      expect(featuredDetail.linkedActions.map((action) => action.relationType).sort()).toEqual([
        'CreatedFromMeeting',
        'Linked',
        'Linked',
      ]);
      const created = workspace.actions.filter(
        (action) => action.sourceType === 'Meeting' && action.sourceId === featured.id,
      );
      expect(created).toHaveLength(1);

      // Expected counts from read-back.
      expect(result.manifest.expectedCounts.luminaires).toBe(8);
      expect(result.manifest.expectedCounts.missingDatasheets).toBe(3); // DL02, LN01, FL01
      expect(result.manifest.expectedCounts.missingImages).toBe(3); // WL01, LN01, FL01
      expect(result.manifest.expectedCounts.revisions).toBe(2);

      // Manifest entity IDs are actual read-back values, not hard-coded.
      expect(result.manifest.entityIds.luminaires.length).toBe(8);
      expect(result.manifest.entityIds.actions.length).toBe(12);
      expect(result.manifest.entityIds.meetings.length).toBe(4);
      expect(result.manifest.entityIds.reviews.length).toBe(4);
      expect(result.manifest.entityIds.reviewReplies.length).toBe(6);
      expect(result.manifest.entityIds.reviewAttachments.length).toBe(2);
      expect(result.manifest.entityIds.revisions.length).toBe(2);
      expect(result.manifest.entityIds.workSessions.length).toBe(3);
      expect(result.manifest.entityIds.requirements.length).toBe(4);
      expect(result.manifest.entityIds.contacts.length).toBe(6);

      // Health is derived (not seeded directly): a score exists and checks are populated.
      expect(typeof result.manifest.health.score).toBe('number');
      expect(result.manifest.health.checks.length).toBeGreaterThan(0);

      // No active WorkSession after seed.
      expect(result.manifest.activeWorkSessionAfterSeed).toBe(false);
      expect(harness.store.getActiveWorkSession()).toBeNull();

      // Unsupported capabilities are reported, not fabricated.
      expect(result.manifest.unsupportedCanonicalCapabilities.length).toBeGreaterThan(0);
      expect(
        result.manifest.unsupportedCanonicalCapabilities.some((item) =>
          item.includes('NOT_CANONICALLY_SEEDABLE_YET'),
        ),
      ).toBe(true);

      // Timeline raw timestamp evidence is preserved (Workflow/Revision/Meeting/Action).
      const sources = new Set(result.manifest.timelineEvidence.map((item) => item.source));
      expect(sources).toContain('Workflow');
      expect(sources).toContain('Revision');
      expect(sources).toContain('Meeting');
      expect(sources).toContain('Action');
      expect(result.manifest.timelineEvidence.length).toBeGreaterThan(0);

      // Timestamp sources are explicitly classified (anchor vs canonical runtime clock).
      const clockSources = new Set(
        result.manifest.timestampSources.map((item) => item.clockSource),
      );
      expect(clockSources).toContain('ANCHOR_CONTROLLED');
      expect(clockSources).toContain('CANONICAL_RUNTIME_WALL_CLOCK');
      const actionSource = result.manifest.timestampSources.find(
        (item) => item.source === 'Action.createdAt',
      );
      expect(actionSource?.clockSource).toBe('CANONICAL_RUNTIME_WALL_CLOCK');
      expect(actionSource?.declaredPrecision).toBe('FULL_TIMESTAMP');
      const healthSource = result.manifest.timestampSources.find(
        (item) => item.source === 'Health.today',
      );
      expect(healthSource?.declaredPrecision).toBe('DATE_ONLY');
      const issuedAtSource = result.manifest.timestampSources.find(
        (item) => item.source === 'Revision.issuedAt',
      );
      expect(issuedAtSource?.declaredPrecision).toBe('DATE_ONLY');
      expect(issuedAtSource?.clockSource).toBe('CANONICAL_RUNTIME_WALL_CLOCK');
      // In APPLY mode observedPrecision is derived from the raw persisted value.
      expect(issuedAtSource?.observedPrecision).not.toBe('UNKNOWN');

      // Revision createdAt is a full timestamp; issuedAt may be null (chronology evidence).
      for (const revision of result.manifest.revisions) {
        expect(revision.createdAtRaw).toMatch(/T\d{2}:\d{2}:\d{2}/);
      }
    } finally {
      await harness.close();
    }
  });

  it('seeds the deterministic canonical Comments graph through v10 thread context', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      const result = await new GoldenUatSeeder(harness).seed({
        mode: 'APPLY',
        anchorDate: '2026-08-11',
        fixtureRoot,
      });
      const projectId = result.manifest.fixture.projectId;
      const workspace = harness.store.getWorkspace(projectId);
      const context = harness.store.operations.listReviewThreadContext(projectId);
      const expectedRootIds = [
        '70000004-0000-4000-8000-000000000001',
        '70000004-0000-4000-8000-000000000002',
        '70000004-0000-4000-8000-000000000003',
        '70000004-0000-4000-8000-000000000004',
      ];
      const expectedReplyIds = [
        '72000004-0000-4000-8000-000000000001',
        '72000004-0000-4000-8000-000000000002',
        '72000004-0000-4000-8000-000000000003',
        '72000004-0000-4000-8000-000000000004',
        '72000004-0000-4000-8000-000000000005',
        '72000004-0000-4000-8000-000000000006',
      ];

      expect(workspace.reviewItems.map((item) => item.id)).toEqual(expectedRootIds);
      expect(workspace.reviewItems.map((item) => item.reference)).toEqual([
        'G-CMT-01',
        'G-CMT-02',
        'G-CMT-03',
        'G-CMT-04',
      ]);
      expect(workspace.reviewItems.map((item) => [item.origin, item.status])).toEqual([
        ['Client', 'Open'],
        ['Internal', 'InProgress'],
        ['Client', 'Resolved'],
        ['Internal', 'Accepted'],
      ]);
      expect(workspace.reviewItems.map((item) => item.createdAt)).toEqual([
        '2026-08-11T10:14:00.000Z',
        '2026-08-09T09:10:00.000Z',
        '2026-08-04T08:30:00.000Z',
        '2026-07-24T08:00:00.000Z',
      ]);
      expect(Math.ceil(workspace.reviewItems.length / 3)).toBe(2);
      expect(workspace.reviewItems.filter((item) => item.origin === 'Client')).toHaveLength(2);
      expect(workspace.reviewItems.filter((item) => item.origin === 'Internal')).toHaveLength(2);
      expect(workspace.reviewItems.filter((item) => item.status === 'Resolved')).toHaveLength(1);

      const featured = workspace.reviewItems[0]!;
      expect(featured).toMatchObject({
        authorId: '71000004-0000-4000-8000-000000000001',
        authorNameSnapshot: 'Aisha Rahman',
        authorRoleSnapshot: 'Client Representative',
      });
      expect(workspace.revisions.some((item) => item.id === featured.revisionId)).toBe(true);
      expect(
        workspace.luminaires.some(
          (item) => item.id === featured.luminaireId && item.tag === featured.luminaireTag,
        ),
      ).toBe(true);

      expect(context.replies.map((item) => item.id)).toEqual([
        '72000004-0000-4000-8000-000000000006',
        '72000004-0000-4000-8000-000000000005',
        ...expectedReplyIds.slice(0, 4),
      ]);
      const featuredReplies = context.replies.filter((item) => item.reviewItemId === featured.id);
      expect(featuredReplies.map((item) => item.id)).toEqual(expectedReplyIds.slice(0, 4));
      expect(featuredReplies.map((item) => item.createdAt)).toEqual([
        '2026-08-11T10:28:00.000Z',
        '2026-08-11T10:35:00.000Z',
        '2026-08-11T10:42:00.000Z',
        '2026-08-11T10:50:00.000Z',
      ]);
      expect(featuredReplies[1]?.authorId).toBe(featured.authorId);
      expect(featuredReplies[2]?.authorId).toBe('71000004-0000-4000-8000-000000000003');
      const participants = new Set([
        featured.authorId,
        ...featuredReplies.map((item) => item.authorId),
      ]);
      expect(participants).toEqual(
        new Set([
          '71000004-0000-4000-8000-000000000001',
          '75000004-0000-4000-8000-000000000001',
          '71000004-0000-4000-8000-000000000003',
          '75000004-0000-4000-8000-000000000002',
        ]),
      );

      expect(context.attachments.map((item) => item.id)).toEqual([
        '73000004-0000-4000-8000-000000000002',
        '73000004-0000-4000-8000-000000000001',
      ]);
      const rootAttachment = context.attachments.find(
        (item) => item.id === '73000004-0000-4000-8000-000000000001',
      )!;
      const replyAttachment = context.attachments.find(
        (item) => item.id === '73000004-0000-4000-8000-000000000002',
      )!;
      expect(rootAttachment.reviewItemId).toBe(featured.id);
      expect(
        workspace.documents.some(
          (item) => item.id === rootAttachment.documentId && item.documentNumber === 'L-101',
        ),
      ).toBe(true);
      expect(replyAttachment.replyId).toBe('72000004-0000-4000-8000-000000000005');
      expect(
        workspace.documents.some(
          (item) => item.id === replyAttachment.documentId && item.documentNumber === 'MM-01',
        ),
      ).toBe(true);

      expect(result.manifest.expectedCounts).toMatchObject({
        commentsOrReviews: 4,
        reviewReplies: 6,
        reviewAttachments: 2,
      });
      expect(result.manifest.entityIds.reviews).toEqual(expectedRootIds);
      expect(result.manifest.entityIds.reviewReplies).toEqual(
        context.replies.map((item) => item.id),
      );
      expect(result.manifest.entityIds.reviewAttachments).toEqual(
        context.attachments.map((item) => item.id),
      );
      expect(result.manifest.comments.roots.map((item) => item.id)).toEqual(expectedRootIds);
      expect(result.manifest.comments.roots.map((item) => item.status)).toEqual([
        'Open',
        'InProgress',
        'Resolved',
        'Accepted',
      ]);
      expect(result.manifest.comments.replies.map((item) => item.id)).toEqual(
        context.replies.map((item) => item.id),
      );
      expect(result.manifest.comments.attachments.map((item) => item.id)).toEqual(
        context.attachments.map((item) => item.id),
      );
    } finally {
      await harness.close();
    }
  });

  it('rejects an ambiguous required document before creating any Comments graph', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      const seeder = new GoldenUatSeeder(harness);
      const initial = await seeder.seed({
        mode: 'APPLY',
        anchorDate: '2026-08-11',
        fixtureRoot,
      });
      const projectId = initial.manifest.fixture.projectId;
      removeGoldenCommentsGraph(harness, projectId);
      const duplicate = harness.store.operations.createDocument(projectId, {
        category: 'MeetingMinutes',
        documentNumber: 'MM-01',
        title: 'Ambiguous MM-01 test document',
        revision: 'REV_02',
        status: 'Working',
        filePath: path.join(fixtureRoot, 'ambiguous-MM-01.pdf'),
        issuedTo: 'Internal',
        issueDate: null,
        notes: 'Temporary database ambiguity regression.',
      });
      const beforeAttempt = harness.store.getWorkspace(projectId);
      const preservedIds = {
        luminaires: beforeAttempt.luminaires.map((item) => item.id).sort(),
        actions: beforeAttempt.actions.map((item) => item.id).sort(),
        meetings: beforeAttempt.meetings.map((item) => item.id).sort(),
        revisions: beforeAttempt.revisions.map((item) => item.id).sort(),
        requirements: beforeAttempt.requirements.map((item) => item.id).sort(),
        contacts: beforeAttempt.contacts.map((item) => item.id).sort(),
        documents: beforeAttempt.documents.map((item) => item.id).sort(),
      };
      expect(
        beforeAttempt.documents.filter((item) => item.documentNumber === 'MM-01'),
      ).toHaveLength(2);
      expect(beforeAttempt.documents.some((item) => item.id === duplicate.id)).toBe(true);

      await expect(
        seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot }),
      ).rejects.toThrow(
        'Golden Comments fixture requires exactly one ProjectDocument "MM-01" in the Golden project; found 2.',
      );

      const afterAttempt = harness.store.getWorkspace(projectId);
      const threadContext = harness.store.operations.listReviewThreadContext(projectId);
      expect(afterAttempt.reviewItems).toHaveLength(0);
      expect(threadContext.replies).toHaveLength(0);
      expect(threadContext.attachments).toHaveLength(0);
      expect(
        afterAttempt.activity.filter((entry) =>
          ['Review', 'ReviewReply', 'ReviewAttachment'].includes(entry.entityType),
        ),
      ).toHaveLength(0);
      expect({
        luminaires: afterAttempt.luminaires.map((item) => item.id).sort(),
        actions: afterAttempt.actions.map((item) => item.id).sort(),
        meetings: afterAttempt.meetings.map((item) => item.id).sort(),
        revisions: afterAttempt.revisions.map((item) => item.id).sort(),
        requirements: afterAttempt.requirements.map((item) => item.id).sort(),
        contacts: afterAttempt.contacts.map((item) => item.id).sort(),
        documents: afterAttempt.documents.map((item) => item.id).sort(),
      }).toEqual(preservedIds);
    } finally {
      await harness.close();
    }
  });

  it('rejects a missing required document with the same exact-one resolver', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      const result = await new GoldenUatSeeder(harness).seed({
        mode: 'APPLY',
        anchorDate: '2026-08-11',
        fixtureRoot,
      });
      const projectId = result.manifest.fixture.projectId;
      const workspace = harness.store.getWorkspace(projectId);
      const documentsWithoutMinutes = workspace.documents.filter(
        (item) => item.documentNumber !== 'MM-01',
      );
      const before = harness.store.operations.listReviewThreadContext(projectId);

      expect(() =>
        requireUniqueGoldenCommentsProjectDocument(documentsWithoutMinutes, projectId, 'MM-01'),
      ).toThrow(
        'Golden Comments fixture requires exactly one ProjectDocument "MM-01" in the Golden project; found 0.',
      );

      expect(harness.store.operations.listReviewThreadContext(projectId)).toEqual(before);
    } finally {
      await harness.close();
    }
  });

  it('is idempotent: a second apply does not duplicate the project or its children', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      const seeder = new GoldenUatSeeder(harness);
      const first = await seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot });
      const projectId = first.manifest.fixture.projectId;
      const commentActivityIds = harness.store
        .getWorkspace(projectId)
        .activity.filter((entry) =>
          ['Review', 'ReviewReply', 'ReviewAttachment'].includes(entry.entityType),
        )
        .map((entry) => entry.id)
        .sort();

      const second = await seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot });
      expect(second.manifest.fixture.projectId).toBe(projectId);

      // No duplicate project.
      const projects = await harness.provider.listProjects();
      expect(projects.filter((p) => p.crmReference === GOLDEN_UAT_CRM_REFERENCE)).toHaveLength(1);

      // No duplicate fixture children beyond reconciliation.
      const workspace = harness.store.getWorkspace(projectId);
      expect(workspace.luminaires.length).toBe(8);
      expect(workspace.actions.length).toBe(12);
      expect(workspace.meetings.length).toBe(4);
      expect(workspace.reviewItems.length).toBe(4);
      const threadContext = harness.store.operations.listReviewThreadContext(projectId);
      expect(threadContext.replies.length).toBe(6);
      expect(threadContext.attachments.length).toBe(2);
      expect(
        workspace.activity
          .filter((entry) =>
            ['Review', 'ReviewReply', 'ReviewAttachment'].includes(entry.entityType),
          )
          .map((entry) => entry.id)
          .sort(),
      ).toEqual(commentActivityIds);
      expect(workspace.requirements.length).toBe(4);
      expect(workspace.contacts.length).toBe(6);
      expect(harness.store.listWorkSessions(projectId).length).toBe(3);

      // Second apply did not leave an active session.
      expect(harness.store.getActiveWorkSession()).toBeNull();
    } finally {
      await harness.close();
    }
  });

  it('refuses APPLY and leaves an unrelated active WorkSession untouched', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      // Create a real unrelated project with an ACTIVE WorkSession.
      const unrelated = await harness.service.createProject(harness.admin, {
        projectName: 'Unrelated Active Project',
        clientName: 'Real Client',
        projectType: 'Lighting Layout',
        description: 'Owns the global active slot.',
        collaboratorDesignerIds: [],
        siteLocation: 'Dubai',
        designStage: 'Concept',
        lightingScope: 'Interior lighting.',
        luxRequirements: '',
        drawingReference: '',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 4,
        requiredDeliveryDate: '2026-09-01',
        createFolders: false,
        services: ['LuminaireSchedule'],
        idempotencyKey: randomUUID(),
      });
      const started = await harness.workSessionCoordinator.start({
        projectId: unrelated.project.id,
        now: '2026-08-01T09:00:00.000Z',
        idempotencyKey: randomUUID(),
      });

      // APPLY must refuse the entire fixture (no partial mutation).
      const seeder = new GoldenUatSeeder(harness);
      await expect(
        seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot }),
      ).rejects.toThrow(/already has an active WorkSession/);

      // The unrelated active session is completely untouched.
      const active = harness.store.getActiveWorkSession();
      expect(active).not.toBeNull();
      expect(active!.id).toBe(started.session.id);
      expect(active!.projectId).toBe(unrelated.project.id);
      expect(active!.endedAt).toBeNull();
      expect(active!.pausedAt).toBeNull();
      // No fixture project was created.
      const projects = await harness.provider.listProjects();
      expect(projects.filter((p) => p.crmReference === GOLDEN_UAT_CRM_REFERENCE)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('does not mutate an unrelated project during apply', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      // Create a real unrelated project first.
      const unrelated = await harness.service.createProject(harness.admin, {
        projectName: 'Unrelated Real Project',
        clientName: 'Real Client',
        projectType: 'Lighting Layout',
        description: 'Should be untouched.',
        collaboratorDesignerIds: [],
        siteLocation: 'Dubai',
        designStage: 'Concept',
        lightingScope: 'Interior lighting.',
        luxRequirements: '',
        drawingReference: '',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 4,
        requiredDeliveryDate: '2026-09-01',
        createFolders: false,
        services: ['LuminaireSchedule'],
        idempotencyKey: randomUUID(),
      });
      // Initialize the unrelated project's canonical workspace so it is a real project.
      harness.store.initializeProject(
        unrelated.project.id,
        ['LuminaireSchedule'],
        'Full Lighting Design',
        'Manual',
        '2026-09-01',
      );
      const unrelatedBefore = {
        id: unrelated.project.id,
        name: unrelated.project.projectName,
        code: unrelated.project.projectCode,
        status: unrelated.project.status,
      };

      const seeder = new GoldenUatSeeder(harness);
      await seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot });

      const after = await harness.provider.getProject(unrelated.project.id);
      expect(after).not.toBeNull();
      expect(after!.projectName).toBe(unrelatedBefore.name);
      expect(after!.projectCode).toBe(unrelatedBefore.code);
      expect(after!.status).toBe(unrelatedBefore.status);
      // No fixture children leaked onto the unrelated project.
      const unrelatedWorkspace = harness.store.getWorkspace(unrelated.project.id);
      expect(unrelatedWorkspace.luminaires.length).toBe(0);
      expect(unrelatedWorkspace.actions.length).toBe(0);
    } finally {
      await harness.close();
    }
  });
});

describe('Golden UAT fixture — synthetic assets', () => {
  it('generates fixture-owned datasheet and image files at apply time', async () => {
    const { harness } = await makeHarness();
    try {
      const fixtureRoot = path.join(process.cwd(), 'data', 'golden-uat-fixture');
      const seeder = new GoldenUatSeeder(harness);
      const result = await seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot });
      const workspace = harness.store.getWorkspace(result.manifest.fixture.projectId);
      const withDatasheet = workspace.luminaires.filter((item) => item.datasheetPath);
      expect(withDatasheet.length).toBe(5);
      for (const luminaire of withDatasheet) {
        expect(existsSync(luminaire.datasheetPath)).toBe(true);
      }
    } finally {
      await harness.close();
    }
  });
});

describe('Golden UAT fixture — PLAN zero-mutation', () => {
  it('PLAN does not migrate an older-schema database (zero DB mutation)', async () => {
    const dir = newTempDir();
    const databasePath = dbPathIn(dir);
    const fixtureRoot = path.join(dir, 'fixture-files');

    // Build an older-schema (v3) database with a schema_migrations history table.
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA user_version = 3');
    db.exec(
      'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
    );
    db.exec(
      "INSERT INTO schema_migrations (migration_id, from_version, to_version, checksum, description, app_version, backup_id, started_at, completed_at, duration_ms, validation_result) VALUES ('m1', 0, 1, 'abc', 'd', '3.3.0', 'b', 't', 't', 0, 'ok')",
    );
    db.exec(
      "INSERT INTO schema_migrations (migration_id, from_version, to_version, checksum, description, app_version, backup_id, started_at, completed_at, duration_ms, validation_result) VALUES ('m2', 1, 2, 'abc', 'd', '3.3.0', 'b', 't', 't', 0, 'ok')",
    );
    db.exec(
      "INSERT INTO schema_migrations (migration_id, from_version, to_version, checksum, description, app_version, backup_id, started_at, completed_at, duration_ms, validation_result) VALUES ('m3', 2, 3, 'abc', 'd', '3.3.0', 'b', 't', 't', 0, 'ok')",
    );
    db.close();

    const beforeVersion = readUserVersion(databasePath);
    const beforeFiles = readdirSync(dir).sort();

    // PLAN must NOT enter production startup and must NOT migrate.
    const preflight = runGoldenUatPreflight(databasePath);
    expect(preflight.databaseExists).toBe(true);
    expect(preflight.detectedSchemaVersion).toBe(3);
    expect(preflight.expectedSchemaVersion).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(preflight.schemaOlderThanTarget).toBe(true);
    expect(preflight.applyEligibility).toBe('REQUIRES_CANONICAL_STARTUP_MIGRATION');

    // The seeder's PLAN path (no harness) must not mutate the DB.
    const seeder = new GoldenUatSeeder(null as never);
    const result = seeder.seedPlanOnly('2026-08-11', preflight);
    expect(result.mode).toBe('PLAN');

    // After PLAN: user_version unchanged, no migration applied, no Golden project,
    // no new fixture rows, no migration backup, no fixture root, no manifest file.
    expect(readUserVersion(databasePath)).toBe(beforeVersion);
    expect(readUserVersion(databasePath)).toBe(3);
    expect(existsSync(fixtureRoot)).toBe(false);
    expect(existsSync(path.join(dir, GOLDEN_UAT_MANIFEST_FILE_NAME))).toBe(false);
    const afterFiles = readdirSync(dir).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });

  it('PLAN performs zero filesystem mutation (no fixture root, no assets, no manifest)', async () => {
    const dir = newTempDir();
    const databasePath = dbPathIn(dir);
    const fixtureRoot = path.join(dir, 'fixture-files');

    // Create a valid current database via the harness (so PLAN sees a real target).
    const harness = await createGoldenUatHarness({ databasePath });
    await harness.close();

    const beforeFiles = readdirSync(dir).sort();
    const preflight = runGoldenUatPreflight(databasePath);
    expect(preflight.databaseExists).toBe(true);
    expect(preflight.detectedSchemaVersion).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(preflight.applyEligibility).toBe('READY');

    const seeder = new GoldenUatSeeder(null as never);
    const result = seeder.seedPlanOnly('2026-08-11', preflight);
    expect(result.mode).toBe('PLAN');

    // No fixture root, no synthetic assets, no manifest, no project folder created.
    expect(existsSync(fixtureRoot)).toBe(false);
    expect(existsSync(path.join(dir, GOLDEN_UAT_MANIFEST_FILE_NAME))).toBe(false);
    const afterFiles = readdirSync(dir).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });
});

describe('Golden UAT fixture — timestamp precision truth', () => {
  it('derives observed precision from the raw persisted value, not the schema', () => {
    expect(deriveObservedPrecision('2026-08-11')).toBe('DATE_ONLY');
    expect(deriveObservedPrecision('2026-08-11T20:38:55.756Z')).toBe('FULL_TIMESTAMP');
    expect(deriveObservedPrecision(null)).toBe('NULL');
    expect(deriveObservedPrecision('')).toBe('NULL');
  });

  it('preserves raw issuedAt and reports declared vs observed precision honestly', async () => {
    const { harness, fixtureRoot } = await makeHarness();
    try {
      const seeder = new GoldenUatSeeder(harness);
      const result = await seeder.seed({ mode: 'APPLY', anchorDate: '2026-08-11', fixtureRoot });

      // Raw issuedAt is preserved exactly in the manifest.
      const rev01 = result.manifest.revisions.find((r) => r.revisionNumber === 1);
      expect(rev01).toBeDefined();
      expect(rev01!.issuedAtRaw).toBeDefined();

      // The timestamp source reports declaredPrecision=DATE_ONLY (schema) and derives
      // observedPrecision from the actual persisted value (which may be FULL_TIMESTAMP).
      const issuedAtSource = result.manifest.timestampSources.find(
        (item) => item.source === 'Revision.issuedAt',
      );
      expect(issuedAtSource?.declaredPrecision).toBe('DATE_ONLY');
      expect(issuedAtSource?.clockSource).toBe('CANONICAL_RUNTIME_WALL_CLOCK');
      expect(issuedAtSource?.observedPrecision).not.toBe('UNKNOWN');
      expect(issuedAtSource?.observedPrecision).toBe(deriveObservedPrecision(rev01!.issuedAtRaw));

      // Revision.createdAt is anchor-controlled and observed as a full timestamp.
      const createdAtSource = result.manifest.timestampSources.find(
        (item) => item.source === 'Revision.createdAt',
      );
      expect(createdAtSource?.declaredPrecision).toBe('FULL_TIMESTAMP');
      expect(createdAtSource?.clockSource).toBe('ANCHOR_CONTROLLED');
      expect(createdAtSource?.observedPrecision).toBe('FULL_TIMESTAMP');
    } finally {
      await harness.close();
    }
  });
});

function readUserVersion(databasePath: string): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return row.user_version;
  } finally {
    db.close();
  }
}
