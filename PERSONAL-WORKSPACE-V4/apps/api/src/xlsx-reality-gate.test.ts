import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects } from '@scli/test-data';
import { LuminaireExportService } from './luminaire-export-service';
import { worksheetOrderingIsValid } from './ooxml-normalizer';
import { PersonalWorkspaceStore } from './personal-workspace-store';

/**
 * Focused reality gate for UAT-ISSUE-06-03.
 *
 * Runs the real production XLSX generation pipeline (LuminaireExportService ->
 * the local luminaire exporter) against a disposable temp project root, then
 * validates that REV_01 and REV_02 Schedule/BOQ workbooks all open in Excel
 * (structurally: autoFilter precedes mergeCells) and that REV_01 bytes are not
 * overwritten by REV_02 while REV_02 reflects the changed quantity.
 */

const stores: PersonalWorkspaceStore[] = [];
const temporaryFolders: string[] = [];

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryFolders.length) {
    const folder = temporaryFolders.pop();
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
});

function createConfig() {
  return loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LUMINAIRE_EXPORTER_PATH: path.resolve(
      process.cwd(),
      'tools/luminaire-exporter/SCLI Luminaire Studio.exe',
    ),
  });
}

function addLuminaire(
  store: PersonalWorkspaceStore,
  projectId: string,
  tag: string,
  quantity: number,
) {
  store.addLuminaire(projectId, {
    tag,
    category: 'Downlight',
    imagePath: '',
    description: `Fixture ${tag}`,
    manufacturer: 'QA MFG',
    model: `MOD-${tag}`,
    wattage: '8W',
    lumens: '720 lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '24',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '',
    location: 'Ground',
    unit: 'No.',
    quantity,
    notes: `note ${tag}`,
    sourceName: 'Manual',
    dimensions: 'x',
    bodyColorFinish: 'Black',
  });
}

describe('UAT-ISSUE-06-03 XLSX reality gate', () => {
  it('produces two independent, Excel-openable revisions and preserves REV_01', async () => {
    const config = createConfig();
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
    const projectFolder = mkdtempSync(path.join(tmpdir(), 'scli-xlsx-reality-'));
    temporaryFolders.push(projectFolder);
    store.setFolderPath(project.id, projectFolder);

    addLuminaire(store, project.id, 'DL01', 12);
    addLuminaire(store, project.id, 'LL01', 18.5);

    const service = new LuminaireExportService(config);
    const runExport = async () => {
      const res = await service.export(project, store.getWorkspace(project.id), {
        revision: '01',
        issueStatus: 'For Review',
        issueDate: '2026-08-09',
      });
      store.recordExport(
        project.id,
        res.scheduleExcelPath,
        res.schedulePdfPath,
        res.boqExcelPath,
        res.boqPdfPath,
        res.datasheetFolder,
        'For Review',
        '2026-08-09',
      );
      return res;
    };

    const rev1 = await runExport();
    const rev1ScheduleBytes = readFileSync(rev1.scheduleExcelPath);
    const rev1BoqBytes = readFileSync(rev1.boqExcelPath);

    // Change a quantity and generate REV_02.
    store.upsertLuminaire(project.id, {
      tag: 'DL01',
      category: 'Downlight',
      imagePath: '',
      description: 'Fixture DL01',
      manufacturer: 'QA MFG',
      model: 'MOD-DL01',
      wattage: '8W',
      lumens: '720 lm',
      lightColor: '3000K',
      cri: '90',
      beamAngle: '24',
      ipRating: 'IP44',
      mounting: 'Recessed',
      cutout: '',
      driver: 'Remote',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: '',
      location: 'Ground',
      unit: 'No.',
      quantity: 25,
      notes: 'note DL01',
      sourceName: 'Manual',
      dimensions: 'x',
      bodyColorFinish: 'Black',
    });
    const rev2 = await runExport();

    const outputs = [
      rev1.scheduleExcelPath,
      rev1.boqExcelPath,
      rev2.scheduleExcelPath,
      rev2.boqExcelPath,
    ];

    // 1-4. All four workbooks are non-empty, valid ZIP packages with
    // Excel-compatible worksheet ordering.
    for (const out of outputs) {
      expect(statSync(out).size).toBeGreaterThan(500);
      await expect(worksheetOrderingIsValid(out)).resolves.toBe(true);
    }

    // REV_02 must live in a different revision folder than REV_01.
    expect(path.basename(path.dirname(rev1.scheduleExcelPath))).toBe('REV_01');
    expect(path.basename(path.dirname(rev2.scheduleExcelPath))).toBe('REV_02');

    // 12. Previous revision bytes are preserved (not overwritten).
    expect(readFileSync(rev1.scheduleExcelPath)).toEqual(rev1ScheduleBytes);
    expect(readFileSync(rev1.boqExcelPath)).toEqual(rev1BoqBytes);

    // 14. Schedule quantity changed in REV_02.
    const readSheetData = async (xlsxPath: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(xlsxPath);
      return wb.worksheets[0]!;
    };
    const rev1Schedule = await readSheetData(rev1.scheduleExcelPath);
    const rev2Schedule = await readSheetData(rev2.scheduleExcelPath);
    const cellText = (sheet: ExcelJS.Worksheet) =>
      sheet
        .getRows(1, Math.max(1, sheet.rowCount))!
        .flatMap((row) => (Array.isArray(row.values) ? row.values : Object.values(row.values)))
        .join(' ');
    expect(cellText(rev2Schedule)).toContain('25');

    // 15. BOQ remains non-priced.
    const rev1BoqText = cellText(await readSheetData(rev1.boqExcelPath));
    const rev2BoqText = cellText(await readSheetData(rev2.boqExcelPath));
    expect(rev1BoqText).not.toMatch(/unit price|total price|cost|rate|amount/);
    expect(rev2BoqText).not.toMatch(/unit price|total price|cost|rate|amount/);

    // 13. Schedule data remains present across both revisions.
    expect(cellText(rev1Schedule)).toContain('DL01');
    expect(cellText(rev2Schedule)).toContain('DL01');
  }, 180_000);
});
