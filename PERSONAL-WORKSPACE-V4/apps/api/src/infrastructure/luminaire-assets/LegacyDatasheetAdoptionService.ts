import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { LegacyDatasheetAdoptionInput } from '@scli/contracts';
import {
  DomainError,
  type AppUser,
  type LegacyDatasheetAdoptionBatchResult,
  type LegacyDatasheetAdoptionItemResult,
  type Project,
} from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import type { ProjectStorageService } from '../../project-storage-service.js';
import type {
  LegacyProjectDatasheetInspection,
  LuminaireLibraryAssetStorage,
  ManagedAssetWrite,
} from '../luminaire-library/LuminaireLibraryAssetStorage.js';

type Row = Readonly<Record<string, unknown>>;

interface BackupAuthority {
  createVerifiedBackup(reason: string): Promise<{ backupId: string }>;
}

interface PreparedAdoption {
  luminaireId: string;
  tag: string;
  requestedAssetVersionId: string;
  source: Row;
  inspection: LegacyProjectDatasheetInspection;
  resultingAssetVersionId: string;
}

function text(row: Row, key: string): string {
  return String(row[key] ?? '');
}

function deterministicAssetVersionId(sourceAssetVersionId: string): string {
  const value = createHash('sha256')
    .update(`SCLI:LEGACY_DATASHEET_ADOPTION:${sourceAssetVersionId}`)
    .digest('hex')
    .split('');
  value[12] = '5';
  value[16] = ['8', '9', 'a', 'b'][Number.parseInt(value[16]!, 16) % 4]!;
  const hex = value.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function blocked(
  luminaireId: string,
  tag: string,
  requestedAssetVersionId: string,
  status: LegacyDatasheetAdoptionItemResult['status'],
  reasonCode: LegacyDatasheetAdoptionItemResult['reasonCode'],
  message: string,
): LegacyDatasheetAdoptionItemResult {
  return {
    luminaireId,
    tag,
    requestedAssetVersionId,
    resultingAssetVersionId: null,
    status,
    reasonCode,
    message,
  };
}

function mapInspectionFailure(
  luminaireId: string,
  tag: string,
  requestedAssetVersionId: string,
  error: unknown,
): LegacyDatasheetAdoptionItemResult {
  const reason = error instanceof Error ? error.message : 'ADOPTION_FAILED';
  if (reason === 'SOURCE_FILE_MISSING') {
    return blocked(
      luminaireId,
      tag,
      requestedAssetVersionId,
      'BLOCKED_FILE_MISSING',
      'SOURCE_FILE_MISSING',
      'The exact legacy Datasheet file is unavailable.',
    );
  }
  if (reason === 'SOURCE_HASH_MISMATCH') {
    return blocked(
      luminaireId,
      tag,
      requestedAssetVersionId,
      'BLOCKED_HASH_MISMATCH',
      'SOURCE_HASH_MISMATCH',
      'The exact legacy Datasheet bytes do not match the stored hash.',
    );
  }
  if (reason === 'PDF_VALIDATION_FAILED') {
    return blocked(
      luminaireId,
      tag,
      requestedAssetVersionId,
      'BLOCKED_PDF_VALIDATION',
      'PDF_VALIDATION_FAILED',
      'The exact legacy attachment is not an eligible regular PDF.',
    );
  }
  return blocked(
    luminaireId,
    tag,
    requestedAssetVersionId,
    'FAILED',
    'ADOPTION_FAILED',
    'Legacy Datasheet adoption failed without changing the current attachment.',
  );
}

function isPrepared(
  result: PreparedAdoption | LegacyDatasheetAdoptionItemResult,
): result is PreparedAdoption {
  return 'inspection' in result;
}

export class LegacyDatasheetAdoptionService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly workspace: PersonalWorkspaceStore,
    private readonly projectStorage: Pick<ProjectStorageService, 'resolveVerifiedProjectRoot'>,
    private readonly assetStorage: LuminaireLibraryAssetStorage,
    private readonly backups: BackupAuthority,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async inspectProject(project: Project): Promise<LegacyDatasheetAdoptionBatchResult> {
    const items = this.currentDatasheets(project.id).map((row) => ({
      luminaireId: text(row, 'luminaire_id'),
      assetVersionId: text(row, 'id'),
    }));
    return this.inspect(project, { items });
  }

  public async inspect(
    project: Project,
    input: LegacyDatasheetAdoptionInput,
  ): Promise<LegacyDatasheetAdoptionBatchResult> {
    const rootVerified = await this.rootIsVerified(project);
    const items: LegacyDatasheetAdoptionItemResult[] = [];
    for (const request of input.items) {
      const prepared = await this.prepare(project.id, request, rootVerified);
      items.push(isPrepared(prepared) ? this.ready(prepared) : prepared);
    }
    return { projectId: project.id, backupId: null, items };
  }

  public async adopt(
    project: Project,
    input: LegacyDatasheetAdoptionInput,
    actor: AppUser,
  ): Promise<LegacyDatasheetAdoptionBatchResult> {
    const rootVerified = await this.rootIsVerified(project);
    const terminal = new Map<string, LegacyDatasheetAdoptionItemResult>();
    const prepared: PreparedAdoption[] = [];
    for (const request of input.items) {
      const result = await this.prepare(project.id, request, rootVerified);
      if (isPrepared(result)) prepared.push(result);
      else terminal.set(request.luminaireId, result);
    }

    let backupId: string | null = null;
    if (prepared.length > 0) {
      try {
        backupId = (await this.backups.createVerifiedBackup('PRE_LEGACY_DATASHEET_ADOPTION'))
          .backupId;
      } catch {
        for (const item of prepared) {
          terminal.set(
            item.luminaireId,
            blocked(
              item.luminaireId,
              item.tag,
              item.requestedAssetVersionId,
              'FAILED',
              'BACKUP_FAILED',
              'A verified workspace backup could not be created; no Datasheet was adopted.',
            ),
          );
        }
        prepared.length = 0;
      }
    }

    for (const item of prepared) {
      terminal.set(item.luminaireId, await this.adoptOne(project.id, item, actor, backupId!));
    }
    return {
      projectId: project.id,
      backupId,
      items: input.items.map((item) => terminal.get(item.luminaireId)!),
    };
  }

  private async prepare(
    projectId: string,
    request: LegacyDatasheetAdoptionInput['items'][number],
    rootVerified: boolean,
  ): Promise<PreparedAdoption | LegacyDatasheetAdoptionItemResult> {
    const luminaire = this.database
      .prepare('SELECT id,tag,datasheet_path FROM project_luminaires WHERE project_id=? AND id=?')
      .get(projectId, request.luminaireId) as Row | undefined;
    const tag = luminaire ? text(luminaire, 'tag') : 'Unknown';
    if (!luminaire) {
      return blocked(
        request.luminaireId,
        tag,
        request.assetVersionId,
        'FAILED',
        'CURRENT_ATTACHMENT_CHANGED',
        'The Project Luminaire no longer exists.',
      );
    }
    const current = this.currentDatasheet(projectId, request.luminaireId);
    if (!current) {
      return blocked(
        request.luminaireId,
        tag,
        request.assetVersionId,
        'BLOCKED_WRONG_ASSET_TYPE',
        'WRONG_ASSET_TYPE',
        'The Luminaire has no current Datasheet AssetVersion.',
      );
    }
    if (text(current, 'locator_kind') === 'DATA_ROOT_RELATIVE') {
      const replay =
        request.assetVersionId === text(current, 'id') ||
        this.wasAdopted(request.assetVersionId, text(current, 'id'));
      return replay
        ? {
            luminaireId: request.luminaireId,
            tag,
            requestedAssetVersionId: request.assetVersionId,
            resultingAssetVersionId: text(current, 'id'),
            status: 'ALREADY_MANAGED',
            reasonCode: 'ALREADY_MANAGED',
            message: 'The current Datasheet is already managed; no new AssetVersion was created.',
          }
        : blocked(
            request.luminaireId,
            tag,
            request.assetVersionId,
            'FAILED',
            'CURRENT_ATTACHMENT_CHANGED',
            'The current Datasheet attachment changed after this action was prepared.',
          );
    }
    if (request.assetVersionId !== text(current, 'id')) {
      return blocked(
        request.luminaireId,
        tag,
        request.assetVersionId,
        'FAILED',
        'CURRENT_ATTACHMENT_CHANGED',
        'The requested legacy AssetVersion is no longer the current attachment.',
      );
    }
    if (
      text(current, 'asset_type') !== 'Datasheet' ||
      text(luminaire, 'datasheet_path').trim() !== text(current, 'file_path').trim() ||
      text(current, 'locator_kind') !== 'LEGACY_PATH' ||
      text(current, 'locator_value').trim() !== text(current, 'file_path').trim()
    ) {
      return blocked(
        request.luminaireId,
        tag,
        request.assetVersionId,
        'BLOCKED_WRONG_ASSET_TYPE',
        'WRONG_ASSET_TYPE',
        'The requested record is not the exact current legacy Datasheet authority.',
      );
    }
    if (!rootVerified) {
      return blocked(
        request.luminaireId,
        tag,
        request.assetVersionId,
        'BLOCKED_STORAGE_UNVERIFIED',
        'STORAGE_UNVERIFIED',
        'Connect / verify the Project folder before adopting legacy Datasheets.',
      );
    }
    try {
      const inspection = await this.assetStorage.inspectLegacyProjectDatasheet({
        sourcePath: text(current, 'file_path'),
        storedHash: text(current, 'file_hash') || null,
      });
      return {
        luminaireId: request.luminaireId,
        tag,
        requestedAssetVersionId: request.assetVersionId,
        source: current,
        inspection,
        resultingAssetVersionId: deterministicAssetVersionId(request.assetVersionId),
      };
    } catch (error) {
      return mapInspectionFailure(request.luminaireId, tag, request.assetVersionId, error);
    }
  }

  private ready(item: PreparedAdoption): LegacyDatasheetAdoptionItemResult {
    return {
      luminaireId: item.luminaireId,
      tag: item.tag,
      requestedAssetVersionId: item.requestedAssetVersionId,
      resultingAssetVersionId: null,
      status: 'READY_TO_ADOPT',
      reasonCode: 'READY_TO_ADOPT',
      message: 'The exact legacy Datasheet is eligible for managed adoption.',
    };
  }

  private async adoptOne(
    projectId: string,
    item: PreparedAdoption,
    actor: AppUser,
    backupId: string,
  ): Promise<LegacyDatasheetAdoptionItemResult> {
    let write: ManagedAssetWrite | null = null;
    try {
      write = await this.assetStorage.adoptLegacyProjectDatasheet({
        sourcePath: item.inspection.sourcePath,
        storedHash: text(item.source, 'file_hash') || null,
        projectId,
        luminaireId: item.luminaireId,
        projectAssetVersionId: item.resultingAssetVersionId,
      });
      const at = this.now().toISOString();
      this.workspace.runInTransaction(() => {
        const current = this.currentDatasheet(projectId, item.luminaireId);
        if (!current || text(current, 'id') !== item.requestedAssetVersionId) {
          throw new DomainError('CONFLICT', 'CURRENT_ATTACHMENT_CHANGED', 409);
        }
        const sequence = Number(current.version_sequence) + 1;
        this.database
          .prepare(
            `INSERT INTO luminaire_asset_versions
             (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
              size_bytes,file_hash,backfilled,attached_at,attached_by_id,attached_by_name_snapshot,
              locator_kind,locator_value,source_library_asset_version_id)
             VALUES (?,?,?,'Datasheet',?,?,?,?,?,?,0,?,?,?,'DATA_ROOT_RELATIVE',?,NULL)`,
          )
          .run(
            write!.assetVersionId,
            projectId,
            item.luminaireId,
            sequence,
            write!.absolutePath,
            write!.fileName,
            write!.mimeType,
            write!.sizeBytes,
            write!.contentHash,
            at,
            actor.id,
            actor.displayName,
            write!.locatorValue,
          );
        this.database
          .prepare(
            `UPDATE project_luminaires SET datasheet_path=?,row_version=row_version+1,updated_at=? WHERE project_id=? AND id=?`,
          )
          .run(write!.absolutePath, at, projectId, item.luminaireId);
        this.database
          .prepare(
            `INSERT INTO workspace_activity (id,project_id,entity_type,entity_id,action,title,detail,created_at) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            randomUUID(),
            projectId,
            'Luminaire',
            item.luminaireId,
            'LEGACY_DATASHEET_ADOPTED',
            `Legacy Datasheet adopted for ${item.tag}`,
            JSON.stringify({
              sourceLegacyAssetVersionId: item.requestedAssetVersionId,
              resultingAssetVersionId: write!.assetVersionId,
              contentHash: write!.contentHash,
              sizeBytes: write!.sizeBytes,
              backupId,
              actorId: actor.id,
              actorName: actor.displayName,
            }),
            at,
          );
      });
      return {
        luminaireId: item.luminaireId,
        tag: item.tag,
        requestedAssetVersionId: item.requestedAssetVersionId,
        resultingAssetVersionId: write.assetVersionId,
        status: 'ADOPTED',
        reasonCode: 'READY_TO_ADOPT',
        message: 'The exact Datasheet bytes were adopted into managed Project asset storage.',
      };
    } catch (error) {
      if (write) await write.cleanup().catch(() => undefined);
      if (error instanceof Error && error.message === 'CURRENT_ATTACHMENT_CHANGED') {
        return blocked(
          item.luminaireId,
          item.tag,
          item.requestedAssetVersionId,
          'FAILED',
          'CURRENT_ATTACHMENT_CHANGED',
          'The current Datasheet changed before adoption could commit.',
        );
      }
      return mapInspectionFailure(item.luminaireId, item.tag, item.requestedAssetVersionId, error);
    }
  }

  private currentDatasheets(projectId: string): Row[] {
    return this.database
      .prepare(
        `SELECT v.*,l.tag FROM luminaire_asset_versions v
         JOIN project_luminaires l ON l.id=v.luminaire_id AND l.project_id=v.project_id
         WHERE v.project_id=? AND v.asset_type='Datasheet'
           AND v.version_sequence=(SELECT MAX(v2.version_sequence) FROM luminaire_asset_versions v2 WHERE v2.project_id=v.project_id AND v2.luminaire_id=v.luminaire_id AND v2.asset_type='Datasheet')
         ORDER BY l.tag COLLATE NOCASE`,
      )
      .all(projectId) as Row[];
  }

  private currentDatasheet(projectId: string, luminaireId: string): Row | undefined {
    return this.database
      .prepare(
        `SELECT * FROM luminaire_asset_versions WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet' ORDER BY version_sequence DESC LIMIT 1`,
      )
      .get(projectId, luminaireId) as Row | undefined;
  }

  private async rootIsVerified(project: Project): Promise<boolean> {
    try {
      await this.projectStorage.resolveVerifiedProjectRoot(project);
      return true;
    } catch {
      return false;
    }
  }

  private wasAdopted(sourceAssetVersionId: string, resultingAssetVersionId: string): boolean {
    const rows = this.database
      .prepare(
        `SELECT detail FROM workspace_activity WHERE action='LEGACY_DATASHEET_ADOPTED' ORDER BY created_at DESC`,
      )
      .all() as Array<{ detail?: unknown }>;
    return rows.some((row) => {
      try {
        const detail = JSON.parse(String(row.detail)) as Record<string, unknown>;
        return (
          detail.sourceLegacyAssetVersionId === sourceAssetVersionId &&
          detail.resultingAssetVersionId === resultingAssetVersionId
        );
      } catch {
        return false;
      }
    });
  }
}
