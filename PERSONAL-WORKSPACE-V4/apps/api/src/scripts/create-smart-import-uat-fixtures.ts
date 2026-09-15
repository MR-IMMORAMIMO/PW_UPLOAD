import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

export async function createSmartImportUatFixtures(outputRoot: string): Promise<string[]> {
  const root = path.resolve(outputRoot);
  mkdirSync(root, { recursive: true });
  const dialuxPath = path.join(root, '01-dialux-native-semicolon.csv');
  writeFileSync(
    dialuxPath,
    [
      'TAGText;ManufNameText;ArticleNumberText;ConnectedLoadText;LuminaireLuminousFluxText;CCTText;UnusedText',
      'Type / Tag;Manufacturer;Article Number;Connected Load [W];Luminaire Luminous Flux [lm];CCT [K];Unused',
      'DL01;ERCO;ABC-01;4,4;242;3000;retained raw',
      'DL02;ERCO;ABC-02;12.5;950;4000;retained raw',
      'DL03;ERCO;ABC-03;unsafe;formula unavailable;warm;review me',
    ].join('\r\n'),
  );

  const genericPath = path.join(root, '02-generic-pagination.tsv');
  writeFileSync(
    genericPath,
    [
      '\uFEFFManufacturer\tProduct Family\tOrdering Code\tWattage [W/m]\tLumens [lm/m]\tNotes',
      ...Array.from(
        { length: 125 },
        (_, index) =>
          `Maker ${index}\tLinear ${index}\tLINE-${index}\t${index === 4 ? 'unsafe' : '9.6'}\t${index === 5 ? 'unknown' : '880'}\t"quoted; note ${index}"`,
      ),
    ].join('\r\n'),
  );

  const xlsxPath = path.join(root, '03-manufacturer-multi-sheet.xlsx');
  const workbook = new ExcelJS.Workbook();
  const products = workbook.addWorksheet('Products');
  products.addRow(['Manufacturer Catalogue — Owner UAT']);
  products.addRow([]);
  products.addRow([
    'Manufacturer',
    'Product Family',
    'Ordering Code',
    'Wattage [W]',
    'Lumens [lm]',
    'CCT [K]',
  ]);
  products.addRow(['Delta Light', 'Spy', 'SPY-01', 12, 900, 3000]);
  products.addRow(['Delta Light', 'Spy', 'SPY-02', { formula: '6+6' }, 900, 4000]);
  products.addRow([]);
  products.addRow(['Delta Light', 'Ambiguous', 'AMB-01', '12 W/m', '900 lm/m', 'warm']);
  const hidden = workbook.addWorksheet('Hidden options');
  hidden.state = 'hidden';
  hidden.addRow(['Manufacturer', 'Product Family', 'Ordering Code']);
  hidden.addRow(['Hidden Brand', 'Hidden Family', 'H-01']);
  const repeated = workbook.addWorksheet('Repeated headers');
  repeated.addRow(['Catalogue']);
  repeated.addRow(['Manufacturer', 'Product Family', 'Ordering Code']);
  repeated.addRow(['Manufacturer', 'Product Family', 'Ordering Code']);
  repeated.addRow(['Maker', 'Family', 'SKU']);
  await workbook.xlsx.writeFile(xlsxPath);
  return [dialuxPath, genericPath, xlsxPath];
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output)
    throw new Error(
      'Usage: pnpm --filter @scli/api exec tsx src/scripts/create-smart-import-uat-fixtures.ts <output-folder>',
    );
  const paths = await createSmartImportUatFixtures(output);
  console.info(
    `Created ${paths.length} disposable Smart Import sources in ${path.resolve(output)}.`,
  );
}
