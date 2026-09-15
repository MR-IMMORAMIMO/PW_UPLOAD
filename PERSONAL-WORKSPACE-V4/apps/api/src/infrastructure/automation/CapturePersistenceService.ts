import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, type ArtifactVersion, type CaptureLedgerEntry } from '@scli/domain';
import { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { CaptureLedgerService } from '../managed-artifact/CaptureLedgerService.js';
import { ManagedArtifactStore } from '../managed-artifact/ManagedArtifactStore.js';
import { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore.js';
import type { P4bCapturePolicy } from './CapturePolicy.js';

export interface CapturePersistenceInput {
  capture: CaptureLedgerEntry;
  policy: P4bCapturePolicy;
  relativeLocator: string;
  revisionLabel: string | null;
  now: string;
}

export class CapturePersistenceService {
  private readonly database: DatabaseSync;

  public constructor(
    workspaceStore: PersonalWorkspaceStore,
    private readonly artifacts: ManagedArtifactStore,
    private readonly captures: CaptureLedgerService,
    private readonly revisions: CanonicalOutputRegistryStore,
  ) {
    this.database = workspaceStore.getSharedDatabase();
  }

  public admit(input: CapturePersistenceInput): CaptureLedgerEntry {
    const artifactId = lineageUuid(
      'artifact',
      input.capture.projectId,
      input.policy.artifactType,
      input.policy.level === 'REVISION' ? input.capture.targetRevisionId : null,
    );
    const documentId = lineageUuid(
      'document',
      input.capture.projectId,
      input.policy.artifactType,
      input.policy.level === 'REVISION' ? input.capture.targetRevisionId : null,
    );
    this.upsertProjectDocument(documentId, input);
    this.artifacts.upsertCaptureManagedArtifact({
      artifactId,
      projectId: input.capture.projectId,
      artifactType: input.policy.artifactType,
      sourceTool: input.policy.application,
      canonicalPath: input.relativeLocator,
      projectDocumentId: documentId,
      now: input.now,
    });
    return this.captures.advance(input.capture.captureId, input.now, {
      finalArtifactId: artifactId,
    }).entry;
  }

  public admitVersion(input: CapturePersistenceInput): ArtifactVersion {
    const current = this.captures.get(input.capture.captureId);
    if (current.state !== 'MATERIALIZING' || !current.finalArtifactId) {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Artifact Version admission requires a MATERIALIZING capture with an exact artifact.',
        409,
      );
    }
    if (!current.contentHash || current.sizeBytes === null) {
      throw new DomainError('CONFLICT', 'Capture staged proof is missing.', 409);
    }
    return this.artifacts.admitArtifactVersion({
      artifactId: current.finalArtifactId,
      contentHash: current.contentHash,
      sizeBytes: current.sizeBytes,
      locatorValue: input.relativeLocator,
      captureId: current.captureId,
      now: input.now,
    });
  }

  public admitRevisionSnapshot(input: CapturePersistenceInput, version: ArtifactVersion): void {
    if (!input.policy.createRevisionSnapshot) return;
    if (!input.capture.targetRevisionId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Revision Snapshot requires an exact Revision UUID.',
        400,
      );
    }
    const revision = this.revisions.getRevision(input.capture.targetRevisionId);
    if (revision.projectId !== input.capture.projectId || revision.lifecycleState !== 'PREPARING') {
      throw new DomainError(
        'CONFLICT',
        'TARGET_REVISION_FINALIZED: Revision Snapshot admission requires the exact PREPARING Revision.',
        409,
      );
    }
    const artifact = this.artifacts.getManagedArtifact(version.artifactId);
    if (!artifact.projectDocumentId) {
      throw new DomainError('CONFLICT', 'Managed Artifact has no source Project Document.', 409);
    }
    const existing = this.revisions
      .listDocumentSnapshotsForRevision(revision.revisionId)
      .find(
        (snapshot) =>
          snapshot.sourceArtifactVersionId === version.versionId ||
          (snapshot.sourceDocumentId === artifact.projectDocumentId &&
            snapshot.contentHash === version.contentHash),
      );
    if (existing) return;
    try {
      this.revisions.createDocumentSnapshot({
        projectId: input.capture.projectId,
        revisionId: revision.revisionId,
        category: input.policy.documentCategory,
        title: documentTitle(input.policy, input.revisionLabel),
        fileName: path.posix.basename(input.relativeLocator),
        sourceRelativePath: input.relativeLocator,
        locatorValue: input.relativeLocator,
        contentHash: version.contentHash,
        sizeBytes: version.sizeBytes ?? input.capture.sizeBytes ?? 0,
        createdBy: null,
        sourceArtifactVersionId: version.versionId,
        sourceDocumentId: artifact.projectDocumentId,
      });
    } catch (error) {
      const raced = this.revisions
        .listDocumentSnapshotsForRevision(revision.revisionId)
        .some(
          (snapshot) =>
            snapshot.sourceArtifactVersionId === version.versionId ||
            (snapshot.sourceDocumentId === artifact.projectDocumentId &&
              snapshot.contentHash === version.contentHash),
        );
      if (!raced) throw error;
    }
  }

  private upsertProjectDocument(documentId: string, input: CapturePersistenceInput): void {
    const title = documentTitle(input.policy, input.revisionLabel);
    const documentNumber = path.posix.basename(
      input.relativeLocator,
      path.posix.extname(input.relativeLocator),
    );
    const revision = input.revisionLabel ?? 'WORKING';
    const existing = this.database
      .prepare('SELECT project_id FROM project_documents WHERE id = ?')
      .get(documentId) as { project_id?: string } | undefined;
    if (existing && existing.project_id !== input.capture.projectId) {
      throw new DomainError(
        'CONFLICT',
        'Project Document lineage belongs to another Project.',
        409,
      );
    }
    this.database
      .prepare(
        `INSERT INTO project_documents
         (id, project_id, category, document_number, title, revision, status, file_path,
          issued_to, issue_date, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           category = excluded.category,
           document_number = excluded.document_number,
           title = excluded.title,
           revision = excluded.revision,
           status = excluded.status,
           file_path = excluded.file_path,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .run(
        documentId,
        input.capture.projectId,
        input.policy.documentCategory,
        documentNumber,
        title,
        revision,
        input.policy.documentStatus,
        input.relativeLocator,
        `Automatically captured from ${input.policy.application} controlled session ingress.`,
        input.now,
        input.now,
      );
    if (!existing) {
      this.database
        .prepare(
          `INSERT INTO workspace_activity
           (id, project_id, entity_type, entity_id, action, title, detail, created_at)
           VALUES (?, ?, 'Document', ?, 'Created', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.capture.projectId,
          documentId,
          title,
          input.relativeLocator,
          input.now,
        );
    }
  }
}

function lineageUuid(
  kind: 'artifact' | 'document',
  projectId: string,
  artifactType: string,
  revisionId: string | null,
): string {
  const bytes = createHash('sha256')
    .update(`P4B\0${kind}\0${projectId}\0${artifactType}\0${revisionId ?? 'PROJECT'}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function documentTitle(policy: P4bCapturePolicy, revisionLabel: string | null): string {
  const label =
    policy.artifactType === 'DIALUX_REPORT'
      ? 'DIALux Report'
      : policy.artifactType === 'CAD_LAYOUT_PDF'
        ? 'Lighting Layout'
        : 'CAD Working Drawing';
  return revisionLabel ? `${label} ${revisionLabel}` : label;
}
