import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildMinimalPdf } from './golden-uat-assets.js';

export const GOLDEN_V19_PROJECT_ID = '440bef8e-5799-4e96-87e9-5d617320b6a4' as const;
export const GOLDEN_V19_PROJECT_CODE =
  '004_SCT260812_SCT_UAT_BOUTIQUE_HOTEL_LIGHTING_PACKAGE' as const;

export const GOLDEN_V19_IDS = Object.freeze({
  deletedRevision: 'c1100000-0000-4000-8000-000000000001',
  lastingRevision: 'c1100000-0000-4000-8000-000000000002',
  deleteOperation: 'c1100000-0000-4000-8000-000000000003',
  deletedSnapshot: 'c1100000-0000-4000-8000-000000000004',
  drawingSnapshot: 'c1100000-0000-4000-8000-000000000005',
  dialuxSnapshot: 'c1100000-0000-4000-8000-000000000006',
  datasheetSnapshot: 'c1100000-0000-4000-8000-000000000007',
  scheduleXlsx: 'c1100000-0000-4000-8000-000000000008',
  schedulePdf: 'c1100000-0000-4000-8000-000000000009',
  boqXlsx: 'c1100000-0000-4000-8000-000000000010',
  boqPdf: 'c1100000-0000-4000-8000-000000000011',
  initialPackage: 'c1200000-0000-4000-8000-000000000001',
  reissuePackage: 'c1200000-0000-4000-8000-000000000002',
});

export const GOLDEN_V19_PURPOSE = 'Client issue — coordinated lighting package' as const;
export const GOLDEN_V19_INTERNAL_NOTE =
  'GOLDEN PRIVATE NOTE — must remain Revision-workspace only.' as const;
export const GOLDEN_V19_REUSE_REASON =
  'Golden v19 fixture: deliberately reuse the safely deleted sequence 3.' as const;

export type GoldenV19OwnershipClass =
  | 'SOURCE_PROJECT_DOCUMENT'
  | 'SOURCE_LUMINAIRE_ASSET_VERSION'
  | 'GENERATED_OUTPUT_ARTIFACT'
  | 'REVISION_SNAPSHOT_COPY'
  | 'PACKAGE_MEMBER_MATERIALIZATION'
  | 'INTERNAL_PACKAGE_MANIFEST'
  | 'REVISION_DELETE_ARCHIVED_MEMBER';

export interface GoldenV19FixtureFile {
  logicalId: string;
  relativePath: string;
  role: string;
  sizeBytes: number;
  sha256: string;
  ownershipClass: GoldenV19OwnershipClass;
  bytes: Buffer;
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixtureFile(
  logicalId: string,
  relativePath: string,
  role: string,
  ownershipClass: GoldenV19OwnershipClass,
  bytes: Buffer,
): GoldenV19FixtureFile {
  return {
    logicalId,
    relativePath: relativePath.replaceAll('\\', '/'),
    role,
    sizeBytes: bytes.length,
    sha256: hash(bytes),
    ownershipClass,
    bytes,
  };
}

export function goldenV19SourceFiles(): GoldenV19FixtureFile[] {
  return [
    fixtureFile(
      'source-delete-evidence',
      'SOURCE_DOCUMENTS/REV_03_DELETE_EVIDENCE.txt',
      'Temporary Safe Delete evidence ProjectDocument source',
      'SOURCE_PROJECT_DOCUMENT',
      Buffer.from('Golden v19 temporary Revision delete evidence.\n', 'utf8'),
    ),
    fixtureFile(
      'source-drawing',
      'SOURCE_DOCUMENTS/L-301_Golden_Lighting_Layout.dwg',
      'Drawing ProjectDocument source',
      'SOURCE_PROJECT_DOCUMENT',
      Buffer.from('SCLI Golden v19 synthetic DWG source placeholder.\n', 'utf8'),
    ),
    fixtureFile(
      'source-dialux-report',
      'SOURCE_DOCUMENTS/DIALUX_Golden_Calculation_Report.pdf',
      'DIALux Report ProjectDocument source',
      'SOURCE_PROJECT_DOCUMENT',
      buildMinimalPdf(
        'Golden v19 DIALux Report',
        'Synthetic fixture-owned calculation report for canonical snapshot testing.',
      ),
    ),
    fixtureFile(
      'source-datasheet',
      'SOURCE_DATASHEETS/DL01_Golden_Current_Datasheet.pdf',
      'Hash-backed LuminaireAssetVersion Datasheet source',
      'SOURCE_LUMINAIRE_ASSET_VERSION',
      buildMinimalPdf(
        'DL01 Golden Current Datasheet',
        'Synthetic verified v19 Datasheet source with immutable AssetVersion provenance.',
      ),
    ),
  ];
}

async function workbookBytes(title: string, columns: readonly string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const fixed = new Date('2026-08-12T08:00:00.000Z');
  workbook.creator = 'SCLI Golden v19 Fixture';
  workbook.created = fixed;
  workbook.modified = fixed;
  workbook.lastPrinted = fixed;
  const sheet = workbook.addWorksheet(title);
  sheet.addRow([...columns]);
  sheet.addRow(columns.map((column, index) => `${column} fixture ${index + 1}`));
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

export async function goldenV19GeneratedOutputFiles(): Promise<GoldenV19FixtureFile[]> {
  const scheduleXlsx = await workbookBytes('Luminaire Schedule', [
    'Tag',
    'Description',
    'Manufacturer',
    'Model',
  ]);
  const boqXlsx = await workbookBytes('Technical BOQ', ['Tag', 'Description', 'Unit', 'Quantity']);
  return [
    fixtureFile(
      'output-schedule-xlsx',
      'OUTPUTS/REV_03/Golden_Luminaire_Schedule.xlsx',
      'Luminaire Schedule XLSX canonical Output',
      'GENERATED_OUTPUT_ARTIFACT',
      scheduleXlsx,
    ),
    fixtureFile(
      'output-schedule-pdf',
      'OUTPUTS/REV_03/Golden_Luminaire_Schedule.pdf',
      'Luminaire Schedule PDF canonical Output',
      'GENERATED_OUTPUT_ARTIFACT',
      buildMinimalPdf('Golden Luminaire Schedule', 'DL01 — representative fixture row.'),
    ),
    fixtureFile(
      'output-boq-xlsx',
      'OUTPUTS/REV_03/Golden_Technical_BOQ.xlsx',
      'Technical BOQ XLSX canonical Output',
      'GENERATED_OUTPUT_ARTIFACT',
      boqXlsx,
    ),
    fixtureFile(
      'output-boq-pdf',
      'OUTPUTS/REV_03/Golden_Technical_BOQ.pdf',
      'Technical BOQ PDF canonical Output',
      'GENERATED_OUTPUT_ARTIFACT',
      buildMinimalPdf('Golden Technical BOQ', 'DL01 — 1 fixture unit.'),
    ),
  ];
}

export function defaultGoldenV19SourceRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd, 'data', 'golden-uat-fixture', 'v19-sources');
}
