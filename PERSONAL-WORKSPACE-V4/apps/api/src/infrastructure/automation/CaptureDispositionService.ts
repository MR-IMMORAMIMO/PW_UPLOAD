import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopHandoff, DiscardCaptureInput, FileHandoffInput } from '@scli/contracts';
import { DomainError, type AppUser, type DataProvider } from '@scli/domain';
import { ProjectStorageService } from '../../project-storage-service.js';
import { CaptureLedgerService } from '../managed-artifact/CaptureLedgerService.js';
import { ManagedArtifactStore } from '../managed-artifact/ManagedArtifactStore.js';
import { DesktopHandoffService } from './DesktopHandoffService.js';

export class CaptureDispositionService {
  public constructor(
    private readonly provider: DataProvider,
    private readonly captures: CaptureLedgerService,
    private readonly artifacts: ManagedArtifactStore,
    private readonly storage: ProjectStorageService,
    private readonly handoffs: DesktopHandoffService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public discard(captureId: string, input: DiscardCaptureInput, actor: AppUser) {
    let capture = this.captures.get(captureId);
    if (capture.state !== 'UNRESOLVED' && capture.state !== 'FAILED_RECOVERABLE') {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Only a Needs Attention capture can be discarded.',
        409,
      );
    }
    if (capture.routingDecision === null) {
      capture = this.captures.recordRoutingDecision(captureId, {
        decision: 'USER_CONFIRMED',
        reason: `DISCARD_${input.reason}`,
        decidedAt: this.now().toISOString(),
        decidedById: actor.id,
        decidedByName: actor.displayName,
      });
    }
    // AUTO_APPROVED and prior USER_CONFIRMED decisions are immutable. Discard
    // changes lifecycle only and never deletes source, staged, or final bytes.
    return this.captures.discard(
      capture.captureId,
      this.now().toISOString(),
      `DISCARD_${input.reason}`,
    );
  }

  public async fileHandoff(captureId: string, input: FileHandoffInput): Promise<DesktopHandoff> {
    const capture = this.captures.get(captureId);
    if (capture.state !== 'COMPLETED' || !capture.finalVersionId) {
      throw new DomainError('INVALID_TRANSITION', 'Only a completed capture can be opened.', 409);
    }
    const project = await this.provider.getProject(capture.projectId);
    if (!project) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const root = await this.storage.resolveVerifiedProjectRoot(project);
    const version = this.artifacts.getArtifactVersion(capture.finalVersionId);
    if (version.locatorKind !== 'PROJECT_RELATIVE') {
      throw new DomainError(
        'CONFLICT',
        'Capture file locator is not managed Project storage.',
        409,
      );
    }
    const targetPath = path.resolve(root, version.locatorValue);
    const relative = path.relative(root, targetPath);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new DomainError('CONFLICT', 'Capture file is outside verified Project storage.', 409);
    }
    try {
      const metadata = await lstat(targetPath);
      const canonical = await realpath(targetPath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        canonical.toLowerCase() !== targetPath.toLowerCase()
      ) {
        throw new Error('invalid');
      }
    } catch {
      throw new DomainError('CONFLICT', 'The completed capture file is unavailable.', 409);
    }
    return this.handoffs.create({
      action: input.action === 'OPEN' ? 'OPEN_CAPTURE_FILE' : 'REVEAL_CAPTURE_FILE',
      projectId: capture.projectId,
      captureId,
      authorizedProjectRoot: root,
      targetPath,
    });
  }

  public async projectDocumentFileHandoff(
    projectId: string,
    documentId: string,
    input: FileHandoffInput,
  ): Promise<DesktopHandoff> {
    const artifact = this.artifacts
      .listManagedArtifacts(projectId)
      .find((candidate) => candidate.projectDocumentId === documentId);
    if (!artifact) {
      throw new DomainError('NOT_FOUND', 'Managed Project file capture was not found.', 404);
    }
    const version = this.artifacts
      .listArtifactVersions(artifact.artifactId)
      .toReversed()
      .find((candidate) => candidate.captureId !== null);
    if (!version?.captureId) {
      throw new DomainError('NOT_FOUND', 'Managed Project file version was not found.', 404);
    }
    return this.fileHandoff(version.captureId, input);
  }
}
