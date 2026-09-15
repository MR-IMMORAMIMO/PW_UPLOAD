import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects } from '@scli/test-data';
import { LuminaireExportService } from './luminaire-export-service';
import { worksheetOrderingIsValid } from './ooxml-normalizer';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { revisionRenderTemporaryPath } from './infrastructure/output-registry/canonical-artifact-files';

const stores: PersonalWorkspaceStore[] = [];
const temporaryFolders: string[] = [];

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryFolders.length) {
    const folder = temporaryFolders.pop();
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
});

function createWorkspace() {
  const config = loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LUMINAIRE_EXPORTER_PATH: path.resolve(
      process.cwd(),
      'tools/luminaire-exporter/SCLI Luminaire Studio.exe',
    ),
  });
  const store = new PersonalWorkspaceStore(config);
  stores.push(store);
  const project = seedProjects[0]!;
  store.initializeProject(
    project.id,
    ['LightingLayout'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  return { config, project, store };
}

describe('luminaire export service', () => {
  it('requires both a luminaire and a connected project folder', async () => {
    const { config, project, store } = createWorkspace();
    const service = new LuminaireExportService(config);

    await expect(
      service.export(project, store.getWorkspace(project.id), {
        revision: '00',
        issueStatus: 'Preliminary',
        issueDate: '2026-08-02',
      }),
    ).rejects.toThrow('Add or import at least one luminaire');

    store.addLuminaire(project.id, {
      tag: 'DL01',
      category: 'Downlight',
      imagePath: '',
      description: 'Trimless recessed LED downlight',
      manufacturer: 'ERCO',
      model: 'QA-100',
      wattage: '8W',
      lumens: '720 lm',
      lightColor: '3000K',
      cri: '90',
      beamAngle: '24°',
      ipRating: 'IP44',
      mounting: 'Recessed',
      cutout: 'Ø 85 mm',
      driver: 'Remote',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: '',
      location: 'Ground Floor',
      unit: 'No.',
      quantity: 12,
      notes: '',
      sourceName: 'Manual QA',
      dimensions: 'Ø 95 × 110 mm',
      bodyColorFinish: 'Black',
    });

    await expect(
      service.export(project, store.getWorkspace(project.id), {
        revision: '00',
        issueStatus: 'Preliminary',
        issueDate: '2026-08-02',
      }),
    ).rejects.toThrow('Create or connect the project folder');
  });

  it('runs the real local exporter and produces readable Schedule and BOQ files without prices', async () => {
    const { config, project, store } = createWorkspace();
    const projectFolder = mkdtempSync(path.join(tmpdir(), 'scli-luminaire-export-'));
    temporaryFolders.push(projectFolder);
    store.setFolderPath(project.id, projectFolder);
    store.addLuminaire(project.id, {
      tag: 'LL01',
      category: 'Linear Light',
      imagePath: '',
      description: 'Suspended linear profile',
      manufacturer: 'QA Manufacturer',
      model: 'LINE-1200',
      wattage: '24W',
      lumens: '2400 lm',
      lightColor: '3000K',
      cri: '>90',
      beamAngle: 'Diffuse',
      ipRating: 'IP20',
      mounting: 'Suspended',
      cutout: '',
      driver: 'Integral',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: '',
      location: 'Majlis',
      unit: 'm',
      quantity: 18.5,
      notes: 'Final length subject to shop drawing',
      sourceName: 'Manual QA',
      dimensions: '1200 × 35 × 70 mm',
      bodyColorFinish: 'Black',
    });

    const service = new LuminaireExportService(config);
    const result = await service.export(project, store.getWorkspace(project.id), {
      revision: '01',
      issueStatus: 'For Review',
      issueDate: '2026-08-02',
    });

    for (const output of [
      result.scheduleExcelPath,
      result.schedulePdfPath,
      result.boqExcelPath,
      result.boqPdfPath,
    ]) {
      expect(statSync(output).size).toBeGreaterThan(500);
    }
    expect(readFileSync(result.schedulePdfPath).subarray(0, 4).toString()).toBe('%PDF');
    expect(readFileSync(result.boqPdfPath).subarray(0, 4).toString()).toBe('%PDF');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.boqExcelPath);
    const sheet = workbook.worksheets[0]!;
    const text = sheet
      .getRows(1, Math.max(1, sheet.rowCount))!
      .flatMap((row) => (Array.isArray(row.values) ? row.values : Object.values(row.values)))
      .join(' ')
      .toLowerCase();
    expect(text).toContain('technical boq');
    expect(text).toContain('ll01');
    expect(text).not.toMatch(/unit price|total price|cost|rate|amount/);
    expect(result.datasheetCount).toBe(0);

    // Both generated workbooks must have Excel-compatible worksheet ordering
    // (autoFilter before mergeCells). This is the UAT-ISSUE-06-03 regression.
    await expect(worksheetOrderingIsValid(result.scheduleExcelPath)).resolves.toBe(true);
    await expect(worksheetOrderingIsValid(result.boqExcelPath)).resolves.toBe(true);

    const operationId = randomUUID();
    const ownedTemporaryRoot = revisionRenderTemporaryPath(projectFolder, operationId);
    mkdirSync(ownedTemporaryRoot);
    writeFileSync(path.join(ownedTemporaryRoot, 'unknown.txt'), 'must-not-delete');
    await expect(
      service.render(
        project,
        store.getWorkspace(project.id),
        { revision: '02', issueStatus: 'For Review', issueDate: '2026-08-02' },
        { operationId, recovery: false },
      ),
    ).rejects.toThrow('requires recovery attention');
    expect(readFileSync(path.join(ownedTemporaryRoot, 'unknown.txt'), 'utf8')).toBe(
      'must-not-delete',
    );
    const temporary = await service.render(
      project,
      store.getWorkspace(project.id),
      { revision: '02', issueStatus: 'For Review', issueDate: '2026-08-02' },
      { operationId, recovery: true },
    );
    const temporarySchedule = temporary.scheduleExcelPath;
    expect(path.relative(ownedTemporaryRoot, temporarySchedule).startsWith('..')).toBe(false);
    expect(existsSync(path.join(ownedTemporaryRoot, 'unknown.txt'))).toBe(false);
    expect(statSync(temporarySchedule).size).toBeGreaterThan(500);
    await expect(worksheetOrderingIsValid(temporary.scheduleExcelPath)).resolves.toBe(true);
    await expect(worksheetOrderingIsValid(temporary.boqExcelPath)).resolves.toBe(true);
    await temporary.cleanup();
    await temporary.cleanup();
    expect(existsSync(temporarySchedule)).toBe(false);
    expect(existsSync(ownedTemporaryRoot)).toBe(false);
  }, 120_000);
});
