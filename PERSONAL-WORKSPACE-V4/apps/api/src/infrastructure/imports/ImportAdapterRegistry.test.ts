import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  ImportAdapterRegistry,
  nativeMappingSafetyIssues,
  suggestColumnMapping,
} from './ImportAdapterRegistry';

describe('Smart Import adapter registry', () => {
  it('uses conservative aliases and never treats Model as Ordering Code', () => {
    expect(suggestColumnMapping('A', 'Connected Load [W]')).toMatchObject({
      canonicalField: 'WATTAGE',
      confidence: 'HIGH',
      unitHint: 'W',
    });
    expect(suggestColumnMapping('B', 'Model')).toMatchObject({
      canonicalField: 'PRODUCT_FAMILY',
      confidence: 'MEDIUM',
    });
    expect(suggestColumnMapping('C', 'Article Number')).toMatchObject({
      canonicalField: 'ORDERING_CODE',
    });
  });

  it('detects native DIALux structure, keeps both headers/raw cells, and preserves unmapped columns', async () => {
    const csv = [
      'TAGText;NumberText;ManufNameText;ArticleNumberText;ArticleNameText;LuminaireLuminousFluxText;ConnectedLoadText;CCTText;CRIText;UnusedText',
      'Type / Tag;Quantity;Manufacturer;Article Number;Article Name;Luminaire Luminous Flux [lm];Connected Load [W];CCT [K];CRI;Unused',
      'DL01;2;ERCO;ABC-01;Iku;242;4,4;3000;90;keep me',
    ].join('\r\n');
    const result = await new ImportAdapterRegistry().inspect('dialux.csv', Buffer.from(csv));
    expect(result.adapterId).toBe('DIALUX_NATIVE_CSV');
    expect(result.detection).toMatchObject({ delimiter: ';', decimalConvention: 'COMMA' });
    expect(
      result.tables[0]!.mapping.find((item) => item.sourceColumnKey === 'ArticleNumberText'),
    ).toMatchObject({ canonicalField: 'ORDERING_CODE' });
    expect(
      result.tables[0]!.mapping.find((item) => item.sourceColumnKey === 'ArticleNameText'),
    ).toMatchObject({ canonicalField: 'PRODUCT_FAMILY', confidence: 'MEDIUM' });
    expect(result.tables[0]!.rows[0]!.rawCells.at(-1)).toMatchObject({
      internalHeader: 'UnusedText',
      rawValue: 'keep me',
    });

    const reversed = result.tables[0]!.mapping.map((mapping) =>
      mapping.sourceColumnKey === 'ArticleNumberText'
        ? { ...mapping, canonicalField: 'PRODUCT_FAMILY' as const }
        : mapping.sourceColumnKey === 'ArticleNameText'
          ? { ...mapping, canonicalField: 'ORDERING_CODE' as const }
          : mapping,
    );
    expect(nativeMappingSafetyIssues(result.adapterId, reversed)).toEqual([
      expect.objectContaining({
        reasonCode: 'DIALUX_ARTICLE_NUMBER_IDENTITY_CONFLICT',
        sourceColumnKey: 'ArticleNumberText',
        recommendedField: 'ORDERING_CODE',
      }),
      expect.objectContaining({
        reasonCode: 'DIALUX_ARTICLE_NAME_IDENTITY_CONFLICT',
        sourceColumnKey: 'ArticleNameText',
        recommendedField: 'PRODUCT_FAMILY',
      }),
    ]);
    expect(nativeMappingSafetyIssues('GENERIC_CSV', reversed)).toEqual([]);
  });

  it.each([
    ['comma', ',', 'Manufacturer,Description\nERCO,"Line, suspended"'],
    ['semicolon', ';', 'Manufacturer;Wattage [W]\nERCO;10,6'],
    ['tab', '\t', 'Manufacturer\tLumens [lm]\nERCO\t1000'],
  ])(
    'detects %s over multiple logical records with quoted fields and BOM safety',
    async (_label, _delimiter, source) => {
      const result = await new ImportAdapterRegistry().inspect(
        'generic.csv',
        Buffer.from(`\uFEFF${source}`),
      );
      expect(result.adapterId).toBe('GENERIC_CSV');
      expect(result.tables[0]!.rows).toHaveLength(1);
      expect(result.tables[0]!.rows[0]!.rawCells[1]!.rawValue).not.toBe('');
    },
  );

  it('enumerates visible and hidden XLSX sheets, detects a later header, and retains formula evidence without calculating', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Luminaires');
    sheet.addRow(['Manufacturer luminaires']);
    sheet.addRow([]);
    sheet.addRow(['Manufacturer', 'Ordering Code', 'Connected Load [W]', 'CCT']);
    sheet.addRow(['ERCO', 'ABC', 10.6, { formula: '1+2', result: 3000 }]);
    sheet.addRow(['FLOS', 'XYZ', 12, { formula: 'A1+A2' }]);
    const hidden = workbook.addWorksheet('Notes');
    hidden.state = 'hidden';
    hidden.addRow(['Manufacturer', 'Notes']);
    hidden.addRow(['Ignore', 'hidden evidence']);
    const bytes = await workbook.xlsx.writeBuffer();
    const result = await new ImportAdapterRegistry().inspect(
      'manufacturer.xlsx',
      Buffer.from(bytes),
    );
    expect(result.adapterId).toBe('GENERIC_XLSX');
    expect(result.tables.map((table) => [table.tableName, table.visibilityState])).toEqual([
      ['Luminaires', 'VISIBLE'],
      ['Notes', 'HIDDEN'],
    ]);
    expect(result.tables[0]!.headerRow).toBe(3);
    expect(result.tables[1]!.selected).toBe(false);
    expect(result.tables[0]!.rows[0]!.rawCells[3]).toMatchObject({
      formula: '1+2',
      cachedValue: 3000,
    });
    expect(result.tables[0]!.rows[1]!.rawCells[3]).toMatchObject({
      formula: 'A1+A2',
      cachedValue: null,
    });
  });

  it('recognizes Workspace output metadata but does not import it as luminaire rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const schedule = workbook.addWorksheet('Schedule');
    schedule.addRow(['Schedule title']);
    schedule.addRow(['Type / Tag', 'Manufacturer', 'Model']);
    schedule.addRow(['DL01', 'ERCO', 'Iku']);
    schedule.addRow(['Subtotal', '', '']);
    const metadata = workbook.addWorksheet('Output Metadata');
    metadata.state = 'hidden';
    metadata.addRow(['schema', 'P4D']);
    const bytes = await workbook.xlsx.writeBuffer();
    const result = await new ImportAdapterRegistry().inspect('schedule.xlsx', Buffer.from(bytes));
    expect(result.adapterId).toBe('WORKSPACE_OUTPUT_XLSX');
    expect(result.tables.find((table) => table.tableName === 'Output Metadata')?.rows).toEqual([]);
    expect(result.tables.find((table) => table.tableName === 'Schedule')?.rows).toHaveLength(1);
  });
});
