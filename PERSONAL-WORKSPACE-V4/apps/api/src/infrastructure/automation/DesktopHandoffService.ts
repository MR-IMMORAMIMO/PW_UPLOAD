import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DesktopHandoff, DesktopHandoffAction } from '@scli/contracts';

export type DesktopHandoffPayload =
  | {
      action: 'OPEN_LIBRARY_ASSET';
      assetVersionId: string;
      managed: true;
      authorizedProjectRoot: string;
      targetPath: string;
      fileHash: string;
      fileName: string;
    }
  | {
      action: 'OPEN_PACKAGE_DELIVERABLE';
      projectId: string;
      packageId: string;
      deliverableId: string;
      authorizedProjectRoot: string;
      managed: true;
      targetPath: string;
      fileHash: string;
      fileName: string;
    }
  | {
      action: 'OPEN_REVISION_DELIVERABLE';
      projectId: string;
      revisionId: string;
      deliverableId: string;
      authorizedProjectRoot: string;
      managed: false;
      targetPath: string;
      fileHash: string;
      fileName: string;
    }
  | {
      action: 'OPEN_LUMINAIRE_ASSET' | 'SAVE_LUMINAIRE_ASSET_COPY';
      projectId: string;
      assetVersionId: string;
      authorizedProjectRoot: string;
      managed: boolean;
      targetPath: string;
      fileHash: string;
      fileName: string;
    }
  | {
      action: 'LAUNCH_TOOL';
      projectId: string;
      toolContextId: string;
      application: 'AUTOCAD' | 'DIALUX';
      authorizedProjectRoot: string;
      sourcePath: string | null;
    }
  | {
      action: 'OPEN_EXPORT_FOLDER';
      projectId: string;
      toolContextId: string;
      inboxPath: string;
    }
  | { action: 'TEST_LAUNCH'; application: 'AUTOCAD' | 'DIALUX' }
  | {
      action: 'MANUAL_FILE_PICK';
      projectId: string;
      toolContextId: string;
      inboxPath: string;
      allowedExtensions: string[];
    }
  | {
      action: 'SELECT_IMPORT_SOURCE';
      importSessionId: string;
      inboxPath: string;
      allowedExtensions: string[];
    }
  | {
      action: 'SELECT_DOCUMENT_PDF';
      admissionId: string;
      inboxPath: string;
      allowedExtensions: string[];
    }
  | {
      action: 'SELECT_PROJECT_SOURCE';
      projectId: string;
      admissionId: string;
      inboxPath: string;
      allowedExtensions: string[];
      maximumBytes: number;
      authorizedProjectRoot: string;
    }
  | {
      action: 'OPEN_CAPTURE_FILE' | 'REVEAL_CAPTURE_FILE';
      projectId: string;
      captureId: string;
      authorizedProjectRoot: string;
      targetPath: string;
    };

/**
 * Persists short-lived, one-time Desktop commands outside the renderer. The
 * JSON payload may contain local paths because it is exchanged only between
 * the API and Electron main process; API responses expose the opaque UUID.
 */
export class DesktopHandoffService {
  private readonly root: string;

  public constructor(
    dataRoot: string,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 2 * 60_000,
  ) {
    this.root = path.join(dataRoot, 'desktop-handoffs', 'pending');
  }

  public create(payload: DesktopHandoffPayload): DesktopHandoff {
    const handoffId = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs).toISOString();
    const record = {
      schemaVersion: 1,
      handoffId,
      action: payload.action satisfies DesktopHandoffAction,
      createdAt: createdAt.toISOString(),
      expiresAt,
      payload,
    };
    mkdirSync(this.root, { recursive: true });
    const target = path.join(this.root, `${handoffId}.json`);
    const temporary = path.join(this.root, `.${handoffId}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target);
    return { handoffId, action: payload.action, expiresAt };
  }
}
