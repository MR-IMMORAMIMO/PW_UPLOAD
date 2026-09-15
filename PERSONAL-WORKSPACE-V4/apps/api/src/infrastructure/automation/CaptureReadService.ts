import path from 'node:path';
import type { CaptureListQuery, CaptureListResponse, CaptureReadModel } from '@scli/contracts';
import type { CaptureLedgerEntry, DataProvider } from '@scli/domain';
import { CaptureLedgerService } from '../managed-artifact/CaptureLedgerService.js';
import { ManagedArtifactStore } from '../managed-artifact/ManagedArtifactStore.js';
import { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore.js';
import { findP4bCapturePolicy } from './CapturePolicy.js';

export class CaptureReadService {
  public constructor(
    private readonly provider: DataProvider,
    private readonly captures: CaptureLedgerService,
    private readonly artifacts: ManagedArtifactStore,
    private readonly revisions: CanonicalOutputRegistryStore,
  ) {}

  public async list(projectId: string, query: CaptureListQuery): Promise<CaptureListResponse> {
    const entries = this.captures
      .list(projectId)
      .filter((entry) => !query.toolContextId || entry.toolContextId === query.toolContextId)
      .filter((entry) => !query.state || entry.state === query.state)
      .filter((entry) =>
        query.view === 'attention'
          ? entry.state === 'UNRESOLVED' || entry.state === 'FAILED_RECOVERABLE'
          : entry.state === 'COMPLETED' || entry.state === 'DISCARDED',
      )
      .sort(
        (left, right) =>
          right.detectedAt.localeCompare(left.detectedAt) ||
          right.captureId.localeCompare(left.captureId),
      );
    let views = await Promise.all(entries.map((entry) => this.view(entry)));
    if (query.application) views = views.filter((entry) => entry.application === query.application);
    const totalCount = views.length;
    if (query.cursor) {
      const index = views.findIndex((entry) => entry.captureId === query.cursor);
      views = index >= 0 ? views.slice(index + 1) : [];
    }
    const pageStart = query.cursor ? 0 : query.page * query.limit;
    const page = views.slice(pageStart, pageStart + query.limit);
    return {
      items: page,
      nextCursor: pageStart + query.limit < views.length ? (page.at(-1)?.captureId ?? null) : null,
      totalCount,
      pageSize: query.limit,
      page: query.page,
    };
  }

  public async get(captureId: string): Promise<CaptureReadModel> {
    return this.view(this.captures.get(captureId));
  }

  public getOwningProjectId(captureId: string): string {
    return this.captures.get(captureId).projectId;
  }

  private async view(entry: CaptureLedgerEntry): Promise<CaptureReadModel> {
    const project = await this.provider.getProject(entry.projectId);
    if (!project) throw new Error('Capture owning Project is unavailable.');
    const context = entry.toolContextId ? this.artifacts.getToolContext(entry.toolContextId) : null;
    const policy = context ? findP4bCapturePolicy(context.tool, entry.expectedArtifactType) : null;
    if (!context || !policy) throw new Error('Capture policy is unavailable.');
    let targetRevision: CaptureReadModel['targetRevision'] = null;
    if (entry.targetRevisionId) {
      try {
        const revision = this.revisions.getRevision(entry.targetRevisionId);
        targetRevision = {
          id: entry.targetRevisionId,
          label: revision.revisionLabel,
          state: revision.lifecycleState,
        };
      } catch {
        targetRevision = { id: entry.targetRevisionId, label: null, state: null };
      }
    }
    let locator: string | null = null;
    let artifactVersion: number | null = null;
    let reusedExisting = false;
    if (entry.finalVersionId) {
      const version = this.artifacts.getArtifactVersion(entry.finalVersionId);
      locator = version.locatorValue;
      artifactVersion = version.version;
      reusedExisting = version.captureId !== null && version.captureId !== entry.captureId;
    } else if (entry.finalArtifactId)
      locator = this.artifacts.getManagedArtifact(entry.finalArtifactId).canonicalPath;
    // A filing failure is the current actionable explanation. The immutable
    // routing reason remains visible separately, but must not mask recovery.
    const structuredReason = reasonDetails(entry.error ?? entry.routingReason);
    return {
      captureId: entry.captureId,
      sourceFileName: path.basename(entry.sourcePath),
      project: { id: project.id, code: project.projectCode, name: project.projectName },
      targetRevision,
      application: policy.application,
      artifactType: policy.artifactType,
      outputMappingId: policy.outputTypeId,
      state: entry.state,
      routingDecision: entry.routingDecision,
      routingReason: safeReason(entry.routingReason ?? entry.error),
      structuredReason,
      sizeBytes: entry.sizeBytes,
      contentHash: entry.contentHash,
      milestones: {
        detectedAt: entry.detectedAt,
        stagedAt: entry.stagedAt,
        admittedAt: entry.admittedAt,
        completedAt: entry.completedAt,
        decidedAt: entry.decidedAt,
      },
      finalProjectRelativeLocator: locator,
      artifactId: entry.finalArtifactId,
      versionId: entry.finalVersionId,
      artifactVersion,
      reusedExisting,
      allowedRecoveryActions: allowedActions(entry.state, structuredReason?.code ?? null),
    };
  }
}

const REASON_SUMMARIES: Readonly<Record<string, string>> = {
  STORAGE_UNAVAILABLE: 'Project storage is disconnected or unavailable.',
  DESTINATION_MAPPING_REQUIRED: 'Output filing needs a valid Project folder mapping.',
  TARGET_REVISION_FINALIZED: 'The Revision this output targeted is already finalized.',
  TARGET_REVISION_NOT_PREPARING: 'The target Revision is not currently preparing.',
  TARGET_REVISION_STALE_OR_DELETED: 'The Revision this Tool Session targeted no longer exists.',
  DESTINATION_PATH_TOO_LONG: 'The configured output destination is too long.',
  SOURCE_NOT_STABLE: 'The exported file was not stable enough to capture yet.',
};

function reasonDetails(value: string | null): { code: string; summary: string } | null {
  if (!value) return null;
  const code = Object.keys(REASON_SUMMARIES).find((candidate) => value.includes(candidate));
  return code
    ? { code, summary: REASON_SUMMARIES[code]! }
    : {
        code: 'CAPTURE_ROUTING_FAILED',
        summary: 'The output needs attention before filing can continue.',
      };
}

function allowedActions(
  state: string,
  reason: string | null,
): CaptureReadModel['allowedRecoveryActions'] {
  if (state === 'COMPLETED') return ['OPEN', 'REVEAL'];
  if (state === 'DISCARDED' && reason === 'TARGET_REVISION_STALE_OR_DELETED') {
    return ['START_NEW_TOOL_SESSION'];
  }
  if (state !== 'UNRESOLVED' && state !== 'FAILED_RECOVERABLE') return [];
  if (reason === 'TARGET_REVISION_FINALIZED') return ['START_NEW_TOOL_SESSION', 'DISCARD'];
  if (reason === 'DESTINATION_MAPPING_REQUIRED') {
    return ['CONFIGURE_OUTPUT_FILING', 'RETRY', 'DISCARD'];
  }
  if (reason === 'STORAGE_UNAVAILABLE') return ['RECONNECT_STORAGE', 'RETRY', 'DISCARD'];
  return ['RETRY', 'DISCARD'];
}

function safeReason(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[A-Za-z]:[\\/][^\s,;]+/g, '[redacted-path]')
    .replace(/\\\\[^\s]+/g, '[redacted-path]')
    .slice(0, 500);
}
