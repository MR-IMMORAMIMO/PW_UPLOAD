import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AppConfig } from '@scli/config';
import { DomainError, type OutputColumn, type Project, type ProjectWorkspace } from '@scli/domain';
import { normalizeWorkbookOrdering } from './ooxml-normalizer';
import { revisionRenderTemporaryPath } from './infrastructure/output-registry/canonical-artifact-files';

const runFile = promisify(execFile);

const fieldNames: Record<string, string> = {
  tag: 'Tag',
  category: 'Category',
  imagePath: 'ImageRef',
  description: 'Description',
  manufacturer: 'Manufacturer',
  model: 'Model',
  wattage: 'Wattage',
  lumens: 'Lumens',
  lightColor: 'LightColor',
  cri: 'Cri',
  beamAngle: 'BeamAngle',
  ipRating: 'IpRating',
  mounting: 'Mounting',
  cutout: 'Cutout',
  driver: 'Driver',
  control: 'Control',
  emergency: 'Emergency',
  datasheetPath: 'DatasheetPath',
  location: 'Location',
  unit: 'Unit',
  quantity: 'Quantity',
  notes: 'Notes',
  sourceName: 'SourceName',
  dimensions: 'Dimensions',
  bodyColorFinish: 'BodyColorFinish',
};

function exportColumns(columns: OutputColumn[]) {
  return [...columns]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((column) => ({
      visible: column.visible && !column.internalOnly,
      fieldKey: fieldNames[column.fieldKey] ?? column.fieldKey,
      header: column.header,
      width: column.width,
    }));
}

export interface LightingExportInput {
  revision: string;
  issueStatus: string;
  issueDate: string;
  recoveryRevisionId?: string | undefined;
}

export interface LightingExportResult {
  excelPath: string;
  pdfPath: string;
  scheduleExcelPath: string;
  schedulePdfPath: string;
  boqExcelPath: string;
  boqPdfPath: string;
  datasheetFolder: string;
  datasheetCount: number;
  outputFolder: string;
}

export interface TemporaryLightingRenderResult {
  scheduleExcelPath: string;
  schedulePdfPath: string;
  boqExcelPath: string;
  boqPdfPath: string;
  datasheetFolder: string;
  datasheetCount: number;
  cleanup(): Promise<void>;
}

export interface LightingPackageRenderer {
  render(
    project: Project,
    workspace: ProjectWorkspace,
    input: LightingExportInput,
    context?: LightingRenderContext,
  ): Promise<TemporaryLightingRenderResult>;
}

export interface LightingRenderContext {
  readonly operationId: string;
  readonly recovery: boolean;
}

const rendererResultSchema = z.object({
  ScheduleExcelPath: z.string().min(1),
  SchedulePdfPath: z.string().min(1),
  BoqExcelPath: z.string().min(1),
  BoqPdfPath: z.string().min(1),
  DatasheetFolder: z.string().min(1),
  DatasheetCount: z.number().int().min(0),
});

function rendererOwnedPath(stagingFolder: string, candidate: string, label: string): string {
  const root = path.resolve(stagingFolder);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DomainError(
      'EXPORT_FAILED',
      `The local exporter returned an unsafe ${label} path.`,
      500,
    );
  }
  return resolved;
}

function resolveProjectOutput(projectRoot: string, relativePath: string): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, ...relativePath.replaceAll('\\', '/').split('/'));
  const safeRoot = `${root}${path.sep}`.toLowerCase();
  if (!`${target}${path.sep}`.toLowerCase().startsWith(safeRoot)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'An output folder resolved outside the project.',
      400,
    );
  }
  return target;
}

export class LuminaireExportService implements LightingPackageRenderer {
  public constructor(private readonly config: AppConfig) {}

  /**
   * Runs the existing renderer into an owned process-temporary folder only. The caller decides
   * how and when those bytes become visible in the project. This is the P2-FND-05 renderer port;
   * cleanup is explicit and idempotent so a canonical coordinator can finish DB state first.
   */
  public async render(
    project: Project,
    workspace: ProjectWorkspace,
    input: LightingExportInput,
    context?: LightingRenderContext,
  ): Promise<TemporaryLightingRenderResult> {
    if (!workspace.luminaires.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Add or import at least one luminaire before exporting.',
        400,
      );
    }
    if (!workspace.folderPath) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Create or connect the project folder before generating Schedule and BOQ files.',
        400,
      );
    }
    const exporterPath =
      [
        path.resolve(process.cwd(), this.config.LUMINAIRE_EXPORTER_PATH),
        path.resolve(process.cwd(), '..', '..', this.config.LUMINAIRE_EXPORTER_PATH),
      ].find((candidate) => existsSync(candidate)) ??
      path.resolve(process.cwd(), this.config.LUMINAIRE_EXPORTER_PATH);
    if (!existsSync(exporterPath)) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'The local luminaire exporter is not installed.',
        503,
      );
    }
    const temporaryRoot = path.resolve(process.cwd(), 'data', 'tmp');
    const temporaryFolder = context
      ? revisionRenderTemporaryPath(workspace.folderPath, context.operationId)
      : await (async () => {
          await mkdir(temporaryRoot, { recursive: true });
          return await mkdtemp(path.join(temporaryRoot, 'scli-export-'));
        })();
    if (context) {
      if (existsSync(temporaryFolder)) {
        if (!context.recovery) {
          throw new DomainError(
            'CONFLICT',
            'The owned canonical renderer staging path already exists and requires recovery attention.',
            409,
          );
        }
        await rm(temporaryFolder, { recursive: true, force: true });
      }
      await mkdir(temporaryFolder);
    }
    const stagingFolder = path.join(temporaryFolder, 'output');
    const requestPath = path.join(temporaryFolder, 'project.json');
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(temporaryFolder, { recursive: true, force: true });
    };
    try {
      await mkdir(stagingFolder);
      const payload = {
        projectName: project.projectName,
        client: project.clientName,
        location: project.siteLocation,
        projectNumber: project.projectCode,
        revision: input.revision,
        issueStatus: input.issueStatus,
        issueDate: input.issueDate,
        pdfPaperSize: workspace.lightingPackage.pdfPaperSize,
        inputMode:
          workspace.lightingPackage.inputMode === 'Later'
            ? 'Manual'
            : workspace.lightingPackage.inputMode,
        luminaires: workspace.luminaires,
        scheduleColumns: exportColumns(workspace.lightingPackage.scheduleColumns),
        boqColumns: exportColumns(workspace.lightingPackage.boqColumns),
      };
      await writeFile(requestPath, JSON.stringify(payload), 'utf8');
      await runFile(exporterPath, ['--export-json', requestPath, stagingFolder], {
        windowsHide: true,
        timeout: 120_000,
      });
      const parsed = rendererResultSchema.parse(
        JSON.parse(await readFile(path.join(stagingFolder, 'export-result.json'), 'utf8')),
      );
      const result = {
        scheduleExcelPath: rendererOwnedPath(
          stagingFolder,
          parsed.ScheduleExcelPath,
          'Schedule Excel',
        ),
        schedulePdfPath: rendererOwnedPath(stagingFolder, parsed.SchedulePdfPath, 'Schedule PDF'),
        boqExcelPath: rendererOwnedPath(stagingFolder, parsed.BoqExcelPath, 'BOQ Excel'),
        boqPdfPath: rendererOwnedPath(stagingFolder, parsed.BoqPdfPath, 'BOQ PDF'),
        datasheetFolder: rendererOwnedPath(
          stagingFolder,
          parsed.DatasheetFolder,
          'Datasheet folder',
        ),
        datasheetCount: parsed.DatasheetCount,
      };
      await normalizeWorkbookOrdering(result.scheduleExcelPath);
      await normalizeWorkbookOrdering(result.boqExcelPath);
      return { ...result, cleanup };
    } catch (error) {
      await cleanup();
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'EXPORT_FAILED',
        error instanceof Error ? error.message : 'The lighting package could not be rendered.',
        500,
      );
    }
  }

  public async export(
    project: Project,
    workspace: ProjectWorkspace,
    input: LightingExportInput,
  ): Promise<LightingExportResult> {
    if (!workspace.luminaires.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Add or import at least one luminaire before exporting.',
        400,
      );
    }
    if (!workspace.folderPath) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Create or connect the project folder before generating Schedule and BOQ files.',
        400,
      );
    }
    const exporterPath =
      [
        path.resolve(process.cwd(), this.config.LUMINAIRE_EXPORTER_PATH),
        path.resolve(process.cwd(), '..', '..', this.config.LUMINAIRE_EXPORTER_PATH),
      ].find((candidate) => existsSync(candidate)) ??
      path.resolve(process.cwd(), this.config.LUMINAIRE_EXPORTER_PATH);
    if (!existsSync(exporterPath)) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'The local luminaire exporter is not installed.',
        503,
      );
    }
    const nextRevision = Math.max(0, ...workspace.exports.map((item) => item.revision)) + 1;
    const projectRoot = workspace.folderPath;
    const mappedOutputs = workspace.outputFolders;
    const revisionFolder = `REV_${String(nextRevision).padStart(2, '0')}`;
    const targetFolders = Object.fromEntries(
      Object.entries(mappedOutputs).map(([key, relativePath]) => [
        key,
        path.join(resolveProjectOutput(projectRoot, relativePath), revisionFolder),
      ]),
    ) as Record<keyof typeof mappedOutputs, string>;
    const occupied = [...new Set(Object.values(targetFolders))].find((folder) =>
      existsSync(folder),
    );
    if (occupied) {
      throw new DomainError(
        'CONFLICT',
        `Revision ${nextRevision} already exists in the configured output folders.`,
        409,
      );
    }
    const temporaryRoot = path.resolve(process.cwd(), 'data', 'tmp');
    await mkdir(temporaryRoot, { recursive: true });
    const temporaryFolder = await mkdtemp(path.join(temporaryRoot, 'scli-export-'));
    const stagingFolder = path.join(temporaryFolder, 'output');
    await mkdir(stagingFolder);
    const requestPath = path.join(temporaryFolder, 'project.json');
    const createdTargetFolders: string[] = [];
    const payload = {
      projectName: project.projectName,
      client: project.clientName,
      location: project.siteLocation,
      projectNumber: project.projectCode,
      revision: input.revision,
      issueStatus: input.issueStatus,
      issueDate: input.issueDate,
      pdfPaperSize: workspace.lightingPackage.pdfPaperSize,
      inputMode:
        workspace.lightingPackage.inputMode === 'Later'
          ? 'Manual'
          : workspace.lightingPackage.inputMode,
      luminaires: workspace.luminaires,
      scheduleColumns: exportColumns(workspace.lightingPackage.scheduleColumns),
      boqColumns: exportColumns(workspace.lightingPackage.boqColumns),
    };
    try {
      await writeFile(requestPath, JSON.stringify(payload), 'utf8');
      await runFile(exporterPath, ['--export-json', requestPath, stagingFolder], {
        windowsHide: true,
        timeout: 120_000,
      });
      const result = JSON.parse(
        await readFile(path.join(stagingFolder, 'export-result.json'), 'utf8'),
      ) as {
        ScheduleExcelPath: string;
        SchedulePdfPath: string;
        BoqExcelPath: string;
        BoqPdfPath: string;
        DatasheetFolder: string;
        DatasheetCount: number;
      };
      // The local exporter emits worksheet parts with mergeCells before
      // autoFilter, which Microsoft Excel treats as corruption and repairs.
      // Normalize the generated workbooks in place so both Schedule and BOQ
      // XLSX open cleanly. This touches only the worksheet ordering.
      await normalizeWorkbookOrdering(result.ScheduleExcelPath);
      await normalizeWorkbookOrdering(result.BoqExcelPath);
      for (const folder of new Set(Object.values(targetFolders))) {
        await mkdir(folder, { recursive: true });
        createdTargetFolders.push(folder);
      }
      const scheduleExcelPath = path.join(
        targetFolders.scheduleExcel,
        path.basename(result.ScheduleExcelPath),
      );
      const schedulePdfPath = path.join(
        targetFolders.schedulePdf,
        path.basename(result.SchedulePdfPath),
      );
      const boqExcelPath = path.join(targetFolders.boqExcel, path.basename(result.BoqExcelPath));
      const boqPdfPath = path.join(targetFolders.boqPdf, path.basename(result.BoqPdfPath));
      await Promise.all([
        copyFile(result.ScheduleExcelPath, scheduleExcelPath, constants.COPYFILE_EXCL),
        copyFile(result.SchedulePdfPath, schedulePdfPath, constants.COPYFILE_EXCL),
        copyFile(result.BoqExcelPath, boqExcelPath, constants.COPYFILE_EXCL),
        copyFile(result.BoqPdfPath, boqPdfPath, constants.COPYFILE_EXCL),
      ]);
      const datasheets = await readdir(result.DatasheetFolder, { withFileTypes: true });
      await Promise.all(
        datasheets
          .filter((item) => item.isFile())
          .map((item) =>
            copyFile(
              path.join(result.DatasheetFolder, item.name),
              path.join(targetFolders.datasheets, item.name),
              constants.COPYFILE_EXCL,
            ),
          ),
      );
      return {
        excelPath: scheduleExcelPath,
        pdfPath: schedulePdfPath,
        scheduleExcelPath,
        schedulePdfPath,
        boqExcelPath,
        boqPdfPath,
        datasheetFolder: targetFolders.datasheets,
        datasheetCount: result.DatasheetCount,
        outputFolder: projectRoot,
      };
    } catch (error) {
      await Promise.all(
        createdTargetFolders.map(async (folder) => {
          const resolved = path.resolve(folder);
          const safeRoot = `${path.resolve(projectRoot)}${path.sep}`.toLowerCase();
          if (
            `${resolved}${path.sep}`.toLowerCase().startsWith(safeRoot) &&
            path.basename(resolved) === revisionFolder
          ) {
            await rm(resolved, { recursive: true, force: true });
          }
        }),
      );
      throw new DomainError(
        'EXPORT_FAILED',
        error instanceof Error ? error.message : 'The lighting package could not be exported.',
        500,
      );
    } finally {
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  }
}
