import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';
import { CaptureInboxCoordinator } from './infrastructure/automation/CaptureInboxCoordinator';
import { contextInboxPath } from './infrastructure/automation/CaptureInboxBoundary';
import type { CaptureRoutingCoordinator } from './infrastructure/automation/CaptureRoutingCoordinator';
import { VersionedMigrationFixtureBuilder } from './infrastructure/migration/testing/VersionedMigrationFixtureBuilder';
import {
  applyV20AutomationRevisionBindingAudit,
  applyV21OutputPresentationFamily,
} from './infrastructure/migration/registry/production-migration-registry';
import { builtInFolderProfiles } from './personal-workspace-store';

const roots: string[] = [];
const handles: DatabaseSync[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness() {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p4b-persistence-'));
  roots.push(root);
  const databasePath = path.join(root, 'workspace.sqlite');
  VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: 19 });
  const database = new DatabaseSync(databasePath);
  handles.push(database);
  database.exec('BEGIN IMMEDIATE');
  applyV20AutomationRevisionBindingAudit(database);
  applyV21OutputPresentationFamily(database, '2026-08-25T00:00:00.000Z');
  database.exec('PRAGMA user_version = 21; COMMIT');
  database.exec('PRAGMA foreign_keys = ON');
  const artifacts = new ManagedArtifactStore(database);
  const captures = new CaptureLedgerService(artifacts);
  return { root, database, artifacts, captures, projectId: randomUUID() };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('P4B durable dedupe and artifact lineage', () => {
  it('finds or creates one capture per context, normalized path, and stable hash', () => {
    const h = harness();
    const context = h.artifacts.createToolContext({
      projectId: h.projectId,
      targetRevisionId: null,
      tool: 'AUTOCAD',
      expectedArtifactType: 'CAD_WORKING_DRAWING',
      mode: 'EXTERNAL_OUTPUT_SESSION',
      channel: 'DEDICATED_SESSION_INBOX',
      openedAt: '2026-08-24T08:00:00.000Z',
    });
    const input = {
      projectId: h.projectId,
      targetRevisionId: null,
      toolContextId: context.toolContextId,
      sourcePath: 'C:\\Data\\Inbox\\Layout.dwg',
      sourceChannel: 'DEDICATED_SESSION_INBOX',
      expectedArtifactType: 'CAD_WORKING_DRAWING',
      detectedAt: '2026-08-24T08:00:00.000Z',
      contentHash: hash('v1'),
      sizeBytes: 2,
    } as const;
    const first = h.captures.findOrCreateProvenDetectedCapture(input);
    const duplicate = h.captures.findOrCreateProvenDetectedCapture({
      ...input,
      sourcePath: 'c:\\data\\inbox\\layout.dwg',
    });
    const changed = h.captures.findOrCreateProvenDetectedCapture({
      ...input,
      contentHash: hash('v2'),
    });
    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({
      created: false,
      entry: { captureId: first.entry.captureId },
    });
    expect(changed.created).toBe(true);
    expect(changed.entry.captureId).not.toBe(first.entry.captureId);
  });

  it('reuses identical versions and atomically allocates changed version sequences', () => {
    const h = harness();
    const documentId = randomUUID();
    h.database
      .prepare(
        `INSERT INTO project_documents
         (id, project_id, category, document_number, title, revision, status, file_path,
          issued_to, issue_date, notes, created_at, updated_at)
         VALUES (?, ?, 'Drawing', 'CAD', 'CAD Working Drawing', 'WORKING', 'Working',
                 '03_DRAWINGS/WORKING/CAD.dwg', '', NULL, '', ?, ?)`,
      )
      .run(documentId, h.projectId, '2026-08-24T08:00:00.000Z', '2026-08-24T08:00:00.000Z');
    const artifactId = randomUUID();
    h.artifacts.upsertCaptureManagedArtifact({
      artifactId,
      projectId: h.projectId,
      artifactType: 'CAD_WORKING_DRAWING',
      sourceTool: 'AUTOCAD',
      canonicalPath: '03_DRAWINGS/WORKING/CAD.dwg',
      projectDocumentId: documentId,
      now: '2026-08-24T08:00:00.000Z',
    });
    const first = h.artifacts.admitArtifactVersion({
      artifactId,
      contentHash: hash('first'),
      sizeBytes: 5,
      locatorValue: '03_DRAWINGS/WORKING/CAD.dwg',
      captureId: randomUUID(),
      now: '2026-08-24T08:00:01.000Z',
    });
    const replay = h.artifacts.admitArtifactVersion({
      artifactId,
      contentHash: hash('first'),
      sizeBytes: 5,
      locatorValue: '03_DRAWINGS/WORKING/CAD.dwg',
      captureId: randomUUID(),
      now: '2026-08-24T08:00:02.000Z',
    });
    const changed = h.artifacts.admitArtifactVersion({
      artifactId,
      contentHash: hash('second'),
      sizeBytes: 6,
      locatorValue: '03_DRAWINGS/WORKING/CAD_A02.dwg',
      captureId: randomUUID(),
      now: '2026-08-24T08:00:03.000Z',
    });
    expect(replay.versionId).toBe(first.versionId);
    expect(first.version).toBe(1);
    expect(changed.version).toBe(2);
    expect(h.artifacts.listArtifactVersions(artifactId)).toHaveLength(2);
  });

  it('declares the bounded factory capture defaults without inventing Tender or Site routes', () => {
    const byKey = new Map(
      builtInFolderProfiles.map((profile) => [profile.factoryProfileKey, profile]),
    );
    expect(byKey.get('full-lighting-design')?.additionalOutputDefaults).toEqual({
      dialuxReport: '02_DESIGN/DIALUX',
      cadLayoutPdf: '03_DRAWINGS/PDF',
      cadWorkingDrawing: '03_DRAWINGS/WORKING',
    });
    expect(byKey.get('classic-scli')?.additionalOutputDefaults?.dialuxReport).toBe(
      '03_SUBMITTAL/REPORTS',
    );
    expect(byKey.get('dialux-cad-layout')?.additionalOutputDefaults?.cadLayoutPdf).toBe(
      '03_CAD_LAYOUT/PDF',
    );
    expect(byKey.get('essential')?.additionalOutputDefaults?.cadWorkingDrawing).toBe('02_WORKING');
    expect(byKey.get('tender-boq')?.additionalOutputDefaults).toBeUndefined();
    expect(byKey.get('site-commissioning')?.additionalOutputDefaults).toBeUndefined();
  });

  it('reconciles only the exact Project A session inbox and ignores unrelated filesystem files', async () => {
    const h = harness();
    const contexts = new ToolContextService(h.artifacts);
    const context = contexts.open({
      projectId: h.projectId,
      targetRevisionId: null,
      tool: 'AUTOCAD',
      expectedArtifactType: 'CAD_WORKING_DRAWING',
      mode: 'EXTERNAL_OUTPUT_SESSION',
      channel: 'DEDICATED_SESSION_INBOX',
      openedAt: '2026-08-24T08:00:00.000Z',
    });
    const inbox = contextInboxPath(h.root, context.toolContextId);
    mkdirSync(inbox, { recursive: true });
    const valid = path.join(inbox, 'A-layout.dwg');
    writeFileSync(valid, 'valid-a');
    const downloads = path.join(h.root, 'Downloads');
    const projectB = path.join(h.root, 'Project-B');
    mkdirSync(downloads);
    mkdirSync(projectB);
    writeFileSync(path.join(downloads, 'random.pdf'), 'random');
    writeFileSync(path.join(projectB, 'B-output.dwg'), 'project-b');

    const admitted = new Set<string>();
    const routing = {
      recoverNonterminal: async () => undefined,
      admitInboxCandidate: async (_context: unknown, sourcePath: string) => {
        admitted.add(path.resolve(sourcePath));
        return null;
      },
    } as unknown as CaptureRoutingCoordinator;
    const coordinator = new CaptureInboxCoordinator(h.root, contexts, routing, 60_000);
    coordinator.activate(context);
    await coordinator.reconcileContext(context.toolContextId);
    await coordinator.close();
    expect([...admitted]).toEqual([path.resolve(valid)]);
  });
});
