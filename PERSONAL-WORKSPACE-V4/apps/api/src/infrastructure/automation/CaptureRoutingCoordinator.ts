import path from 'node:path';
import { access, lstat, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { DomainError, type CaptureLedgerEntry, type ToolContext } from '@scli/domain';
import { CaptureLedgerService } from '../managed-artifact/CaptureLedgerService.js';
import {
  CaptureStagingError,
  CaptureStagingService,
  sha256FileStreaming,
} from '../managed-artifact/CaptureStagingService.js';
import { ToolContextService } from '../managed-artifact/ToolContextService.js';
import { ManagedArtifactStore } from '../managed-artifact/ManagedArtifactStore.js';
import {
  CaptureDestinationResolver,
  type CaptureDestinationPlan,
} from './CaptureDestinationResolver.js';
import { CaptureFilingService } from './CaptureFilingService.js';
import { CapturePersistenceService } from './CapturePersistenceService.js';
import {
  createP4bCapabilityRegistry,
  findP4bCapturePolicy,
  policyAcceptsFile,
  type P4bCapturePolicy,
} from './CapturePolicy.js';
import { validateContextInboxCandidate } from './CaptureInboxBoundary.js';
import { manualAdmissionAuditPath, type ManualAdmissionAudit } from './ManualCaptureService.js';

const NONTERMINAL = new Set([
  'DETECTED',
  'STABILIZING',
  'STAGED',
  'VERIFYING',
  'ADMITTED',
  'MATERIALIZING',
]);

export class CaptureRoutingCoordinator {
  private readonly capabilities = createP4bCapabilityRegistry();

  public constructor(
    private readonly dataRoot: string,
    private readonly contexts: ToolContextService,
    private readonly captures: CaptureLedgerService,
    private readonly staging: CaptureStagingService,
    private readonly artifacts: ManagedArtifactStore,
    private readonly destinations: CaptureDestinationResolver,
    private readonly filing: CaptureFilingService,
    private readonly persistence: CapturePersistenceService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async admitInboxCandidate(
    context: ToolContext,
    sourcePath: string,
  ): Promise<CaptureLedgerEntry | null> {
    const proof = await this.proveOrRecordFailure(context, sourcePath);
    if (!proof) return null;
    const found = this.captures.findOrCreateProvenDetectedCapture({
      projectId: context.projectId,
      targetRevisionId: context.targetRevisionId,
      toolContextId: context.toolContextId,
      sourcePath,
      sourceChannel: context.channel,
      expectedArtifactType: context.expectedArtifactType,
      detectedAt: this.now().toISOString(),
      contentHash: proof.contentHash,
      sizeBytes: proof.sizeBytes,
    });
    if (!found.created) return found.entry;

    const policy = findP4bCapturePolicy(context.tool, context.expectedArtifactType);
    if (context.mode === 'MANUAL_EXPLICIT' && context.channel === 'MANUAL_PICKER_INBOX') {
      if (!policy || !policyAcceptsFile(policy, sourcePath)) {
        return this.reject(found.entry, 'UNSUPPORTED_MANUAL_CAPTURE_EXTENSION');
      }
      const audit = await this.readManualAdmissionAudit(context.toolContextId);
      this.captures.recordRoutingDecision(found.entry.captureId, {
        decision: 'USER_CONFIRMED',
        reason: 'MANUAL_EXPLICIT_FILE_ADMISSION',
        decidedAt: audit.authorizedAt,
        decidedById: audit.actorId,
        decidedByName: audit.actorName,
      });
      const routed = await this.route(found.entry.captureId);
      const latestContext = this.contexts.get(context.toolContextId);
      if (latestContext.state === 'LIVE' || latestContext.state === 'REBOUND') {
        this.contexts.close(context.toolContextId, this.now().toISOString());
      }
      return routed;
    }
    const capability = this.capabilities.findExact(
      context.tool,
      context.expectedArtifactType,
      context.mode,
      context.channel,
    );
    const authorization = this.contexts.authorizeNewCapture(
      context.projectId,
      context.toolContextId,
      context.tool,
      context.expectedArtifactType,
      context.mode,
      context.channel,
      'AUTOMATIC_CAPTURE',
      capability,
    );
    if (authorization.outcome === 'DENIED' || !policy || !policyAcceptsFile(policy, sourcePath)) {
      return this.reject(
        found.entry,
        !policy || authorization.outcome === 'DENIED'
          ? 'UNSUPPORTED_CAPTURE_CAPABILITY'
          : 'UNSUPPORTED_CAPTURE_EXTENSION',
      );
    }
    return this.route(found.entry.captureId);
  }

  public async route(captureId: string): Promise<CaptureLedgerEntry> {
    let capture = this.captures.get(captureId);
    const context = capture.toolContextId ? this.contexts.get(capture.toolContextId) : null;
    const policy = context
      ? findP4bCapturePolicy(context.tool, capture.expectedArtifactType)
      : null;
    if (!context || !policy || !policyAcceptsFile(policy, capture.sourcePath)) {
      return this.reject(capture, 'UNSUPPORTED_CAPTURE_CAPABILITY_OR_EXTENSION');
    }

    try {
      if (capture.state === 'DETECTED' || capture.state === 'STABILIZING') {
        const contained = await validateContextInboxCandidate(
          this.dataRoot,
          context.toolContextId,
          capture.sourcePath,
        );
        if (!contained) return this.reject(capture, 'SOURCE_BOUNDARY_ESCAPE');
        capture = await this.staging.stageCapture(capture.captureId, this.now().toISOString());
      } else if (capture.state === 'STAGED') {
        await this.staging.verifyStagedCapture(capture.captureId);
        capture = this.captures.advance(capture.captureId, this.now().toISOString()).entry;
      } else if (capture.state === 'VERIFYING') {
        await this.staging.verifyStagedCapture(capture.captureId);
      }

      if (capture.state === 'VERIFYING') {
        return await this.routeVerified(capture, policy);
      }
      if (capture.state === 'ADMITTED' || capture.state === 'MATERIALIZING') {
        return await this.continuePersistence(capture, policy);
      }
      return capture;
    } catch (error) {
      return this.handleRecoverable(capture.captureId, error);
    }
  }

  public async retry(captureId: string): Promise<CaptureLedgerEntry> {
    const current = this.captures.get(captureId);
    if (current.state === 'UNRESOLVED') this.captures.resolve(captureId, this.now().toISOString());
    else if (current.state === 'FAILED_RECOVERABLE') {
      this.captures.resume(captureId, this.now().toISOString());
    } else {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Retry is allowed only for UNRESOLVED or FAILED_RECOVERABLE captures.',
        409,
      );
    }
    return this.route(captureId);
  }

  public async recoverNonterminal(): Promise<void> {
    for (const capture of this.captures.list().filter((entry) => NONTERMINAL.has(entry.state))) {
      await this.route(capture.captureId).catch(() => undefined);
    }
  }

  private async routeVerified(
    capture: CaptureLedgerEntry,
    policy: P4bCapturePolicy,
  ): Promise<CaptureLedgerEntry> {
    const initial = await this.destinations.resolve(capture, policy);
    if (initial.kind !== 'READY') return this.applyDestinationFailure(capture, initial);
    const extension = path.extname(capture.sourcePath).toLowerCase();
    const filing = await this.filing.file({
      captureId: capture.captureId,
      stagedPath: this.staging.finalStagedPathFor(capture.captureId),
      contentHash: capture.contentHash!,
      sizeBytes: capture.sizeBytes!,
      matchedExtension: extension,
      policy,
      initialPlan: initial.plan,
      revalidate: () => this.requireReadyPlan(capture, policy),
      beforeFinalMutation: async () => {
        const finalGate = await this.requireReadyPlan(capture, policy);
        if (
          finalGate.verifiedRoot.toLowerCase() !== initial.plan.verifiedRoot.toLowerCase() ||
          finalGate.destinationFolderId !== initial.plan.destinationFolderId
        ) {
          throw new DomainError('CONFLICT', 'PROJECT_ROOT_OR_MAPPING_CHANGED', 409);
        }
        const latest = this.captures.get(capture.captureId);
        if (latest.routingDecision === null) {
          this.captures.recordRoutingDecision(capture.captureId, {
            decision: 'AUTO_APPROVED',
            reason: 'ALL_OBJECTIVE_ROUTING_GATES_PASSED',
            decidedAt: this.now().toISOString(),
          });
        } else if (
          latest.routingDecision !== 'AUTO_APPROVED' &&
          !(
            latest.routingDecision === 'USER_CONFIRMED' &&
            this.contexts.get(capture.toolContextId!).mode === 'MANUAL_EXPLICIT'
          )
        ) {
          throw new DomainError('CONFLICT', 'Capture has a non-routable immutable decision.', 409);
        }
      },
    });
    const admitted = this.persistence.admit({
      capture: this.captures.get(capture.captureId),
      policy,
      relativeLocator: filing.relativeLocator,
      revisionLabel: initial.plan.revision?.revisionLabel ?? null,
      now: this.now().toISOString(),
    });
    return this.continuePersistence(admitted, policy);
  }

  private async continuePersistence(
    capture: CaptureLedgerEntry,
    policy: P4bCapturePolicy,
  ): Promise<CaptureLedgerEntry> {
    let current = this.captures.get(capture.captureId);
    if (!current.finalArtifactId)
      throw new DomainError('CONFLICT', 'Capture artifact milestone is missing.', 409);
    const finalArtifactId = current.finalArtifactId;
    const artifact = this.artifacts.getManagedArtifact(finalArtifactId);
    const ready = await this.requireReadyPlan(current, policy);
    const absoluteFinal = path.resolve(ready.verifiedRoot, artifact.canonicalPath);
    const relative = path.relative(ready.verifiedRoot, absoluteFinal);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new DomainError('CONFLICT', 'FINAL_LOCATOR_OUTSIDE_VERIFIED_ROOT', 409);
    }
    const metadata = await lstat(absoluteFinal);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new DomainError('CONFLICT', 'FINAL_FILE_NOT_REGULAR', 409);
    }
    await access(absoluteFinal, constants.R_OK);
    if (current.contentHash && (await sha256FileStreaming(absoluteFinal)) !== current.contentHash) {
      throw new DomainError('CONFLICT', 'FINAL_FILE_HASH_MISMATCH', 409);
    }
    if (current.state === 'ADMITTED') {
      current = this.captures.advance(current.captureId, this.now().toISOString()).entry;
    }
    const persistenceInput = {
      capture: current,
      policy,
      relativeLocator: artifact.canonicalPath,
      revisionLabel: ready.revision?.revisionLabel ?? null,
      now: this.now().toISOString(),
    };
    const version = this.persistence.admitVersion(persistenceInput);
    if (policy.createRevisionSnapshot) {
      const finalRevisionGate = await this.destinations.resolve(current, policy);
      if (finalRevisionGate.kind !== 'READY') {
        throw new DomainError('CONFLICT', `POST_FILE_${finalRevisionGate.reason}`, 409);
      }
      this.persistence.admitRevisionSnapshot(persistenceInput, version);
    }
    return this.captures.complete(
      current.captureId,
      finalArtifactId,
      version.versionId,
      this.now().toISOString(),
    );
  }

  private async requireReadyPlan(
    capture: CaptureLedgerEntry,
    policy: P4bCapturePolicy,
  ): Promise<CaptureDestinationPlan> {
    const resolution = await this.destinations.resolve(
      this.captures.get(capture.captureId),
      policy,
    );
    if (resolution.kind !== 'READY') throw new DomainError('CONFLICT', resolution.reason, 409);
    return resolution.plan;
  }

  private applyDestinationFailure(
    capture: CaptureLedgerEntry,
    resolution: Exclude<
      Awaited<ReturnType<CaptureDestinationResolver['resolve']>>,
      { kind: 'READY' }
    >,
  ): CaptureLedgerEntry {
    if (resolution.kind === 'REJECTED') return this.reject(capture, resolution.reason);
    if (resolution.kind === 'UNRESOLVED') {
      return this.captures.markUnresolved(
        capture.captureId,
        resolution.reason,
        this.now().toISOString(),
      );
    }
    return this.captures.markFailedRecoverable(
      capture.captureId,
      resolution.reason,
      this.now().toISOString(),
    );
  }

  private reject(capture: CaptureLedgerEntry, reason: string): CaptureLedgerEntry {
    let current = this.captures.get(capture.captureId);
    if (current.routingDecision === null) {
      current = this.captures.recordRoutingDecision(current.captureId, {
        decision: 'REJECTED',
        reason,
        decidedAt: this.now().toISOString(),
      });
    }
    if (current.state === 'DISCARDED') return current;
    return this.captures.discard(current.captureId, this.now().toISOString(), reason);
  }

  private async proveOrRecordFailure(
    context: ToolContext,
    sourcePath: string,
  ): Promise<{ contentHash: string; sizeBytes: number } | null> {
    try {
      return await this.staging.proveStableCandidate(sourcePath);
    } catch (error) {
      const existing = this.captures
        .list(context.projectId)
        .find(
          (entry) =>
            entry.toolContextId === context.toolContextId &&
            entry.sourcePath.toLowerCase() === sourcePath.toLowerCase() &&
            entry.contentHash === null &&
            entry.state === 'FAILED_RECOVERABLE',
        );
      if (existing) return null;
      const detected = this.captures.createDetectedCapture({
        projectId: context.projectId,
        targetRevisionId: context.targetRevisionId,
        toolContextId: context.toolContextId,
        sourcePath,
        sourceChannel: context.channel,
        expectedArtifactType: context.expectedArtifactType,
        detectedAt: this.now().toISOString(),
      });
      this.captures.markFailedRecoverable(
        detected.captureId,
        error instanceof CaptureStagingError ? error.code : 'SOURCE_NOT_STABLE',
        this.now().toISOString(),
      );
      return null;
    }
  }

  private handleRecoverable(captureId: string, error: unknown): CaptureLedgerEntry {
    const current = this.captures.get(captureId);
    if (current.state === 'FAILED_RECOVERABLE' || current.state === 'UNRESOLVED') return current;
    const reason = error instanceof Error ? error.message : 'CAPTURE_ROUTING_FAILED';
    if (reason.includes('DESTINATION_PATH_TOO_LONG')) {
      return this.captures.markUnresolved(
        captureId,
        'DESTINATION_PATH_TOO_LONG',
        this.now().toISOString(),
      );
    }
    if (
      current.state === 'VERIFYING' &&
      (reason.includes('DESTINATION_MAPPING_REQUIRED') ||
        reason.includes('TARGET_REVISION_FINALIZED'))
    ) {
      return this.captures.markUnresolved(
        captureId,
        reason.includes('TARGET_REVISION_FINALIZED')
          ? 'TARGET_REVISION_FINALIZED'
          : 'DESTINATION_MAPPING_REQUIRED',
        this.now().toISOString(),
      );
    }
    if (current.state === 'VERIFYING' && reason.includes('TARGET_REVISION_STALE_OR_DELETED')) {
      return this.reject(current, 'TARGET_REVISION_STALE_OR_DELETED');
    }
    if (current.state === 'COMPLETED' || current.state === 'DISCARDED') return current;
    return this.captures.markFailedRecoverable(captureId, reason, this.now().toISOString());
  }

  private async readManualAdmissionAudit(toolContextId: string): Promise<ManualAdmissionAudit> {
    try {
      const value = JSON.parse(
        await readFile(manualAdmissionAuditPath(this.dataRoot, toolContextId), 'utf8'),
      ) as Partial<ManualAdmissionAudit>;
      if (
        typeof value.actorId !== 'string' ||
        typeof value.actorName !== 'string' ||
        typeof value.authorizedAt !== 'string'
      ) {
        throw new Error('invalid');
      }
      return {
        actorId: value.actorId,
        actorName: value.actorName,
        authorizedAt: value.authorizedAt,
      };
    } catch {
      throw new DomainError('CONFLICT', 'Manual capture audit authority is unavailable.', 409);
    }
  }
}
