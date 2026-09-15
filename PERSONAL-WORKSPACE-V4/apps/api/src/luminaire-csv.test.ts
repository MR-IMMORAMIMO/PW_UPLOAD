import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importLuminaireCsv } from './luminaire-csv';

const nativeDialuxFixture = readFileSync(
  new URL('./test-fixtures/native-dialux.csv', import.meta.url),
  'utf8',
);

describe('luminaire CSV import', () => {
  it('parses quoted commas, escaped quotes, aliases, a BOM and skips blank tags', () => {
    const records = importLuminaireCsv(
      '\uFEFFTag,Description,Manufacturer,Model Number,QTY,CCT,IP,Remarks\r\n' +
        'DL01,"Downlight, trimless",ERCO,"Starpoint ""Mini""",12,3000K,IP44,"Lobby, level 1"\r\n' +
        ',Ignored row,Brand,Model,5,4000K,IP20,Missing tag\r\n',
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      tag: 'DL01',
      description: 'Downlight, trimless',
      manufacturer: 'ERCO',
      model: 'Starpoint "Mini"',
      quantity: 12,
      lightColor: '3000K',
      ipRating: 'IP44',
      notes: 'Lobby, level 1',
    });
    // UNIT column is absent from the source, so it must not be present in the patch.
    expect(records[0]).not.toHaveProperty('unit');
  });

  it('supports tab-delimited DIALux exports and decimal-comma quantities', () => {
    const records = importLuminaireCsv(
      'TAG\tCATEGORY\tQUANTITY\tUNIT OF MEASURE\tBODY COLOR\n' +
        'LL01\tLinear Light\t3,5\tm\tBlack\n',
    );

    expect(records[0]).toMatchObject({
      tag: 'LL01',
      category: 'Linear Light',
      quantity: 3.5,
      unit: 'm',
      bodyColorFinish: 'Black',
    });
  });

  it('omits absent columns from the patch so sparse imports are non-destructive', () => {
    const records = importLuminaireCsv(
      'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED SEVEN,27,No.\n',
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      tag: 'DL07',
      description: 'SPARSE UPDATED SEVEN',
      quantity: 27,
      unit: 'No.',
    });
    // Technical fields whose columns are absent must not be present at all.
    for (const field of [
      'category',
      'manufacturer',
      'model',
      'wattage',
      'lumens',
      'lightColor',
      'cri',
      'beamAngle',
      'ipRating',
      'mounting',
      'control',
      'emergency',
      'location',
      'sourceName',
      'bodyColorFinish',
      'imagePath',
      'datasheetPath',
      'notes',
    ]) {
      expect(records[0]).not.toHaveProperty(field);
    }
  });

  it('distinguishes an explicitly blank present column from an absent column', () => {
    const records = importLuminaireCsv('TAG,MANUFACTURER,DESCRIPTION\nDL08,,Blank manufacturer\n');

    expect(records).toHaveLength(1);
    // MANUFACTURER is present with an explicit blank value -> preserved as ''.
    expect(records[0]).toMatchObject({
      tag: 'DL08',
      manufacturer: '',
      description: 'Blank manufacturer',
    });
    // Absent columns are still omitted.
    expect(records[0]).not.toHaveProperty('model');
  });

  it('parses the native semicolon DIALux dialect, its two headers and spacer rows', () => {
    const records = importLuminaireCsv(nativeDialuxFixture);

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.tag)).toEqual(['WL01', 'DL01', 'UL01']);
    expect(records[0]).toEqual({
      tag: 'WL01',
      description: 'Kubus floor washlight 1xLED 3W warm white',
      manufacturer: 'ERCO',
      model: '33367000',
      wattage: '4.4',
      lumens: '242',
      lightColor: '3000K',
      cri: '92',
      unit: 'No.',
      quantity: 83,
      sourceName: 'Kubus floor washlight 1xLED 3W warm white',
    });
    expect(records[1]).toMatchObject({
      tag: 'DL01',
      manufacturer: 'FLOS',
      model: 'F12345',
      description: 'Coordinates modular downlight',
      lumens: '720',
      wattage: '8.5',
      lightColor: '2700K',
      cri: '90',
      quantity: 12,
      unit: 'No.',
    });
    // The mapped DIALux no-value sentinel is omitted, not converted to a clear.
    expect(records[2]).not.toHaveProperty('wattage');
  });

  it('does not classify an arbitrary semicolon CSV as native DIALux', () => {
    const records = importLuminaireCsv('TAG;DESCRIPTION;MANUFACTURER\nDL09;;ERCO\n');

    expect(records).toEqual([{ tag: 'DL09', description: '', manufacturer: 'ERCO' }]);
  });

  it('omits native DIALux empty and unavailable mapped values from sparse patches', () => {
    const records = importLuminaireCsv(
      'NumberText;ManufNameText;ArticleNumberText;ArticleNameText;' +
        'LuminaireLuminousFluxText;ConnectedLoadText;CCTText;CRIText;TAGText\n' +
        'pcs.;Manufacturer;Article No.;Article name;Lumens;P [W];CCT;CRI;TAG\n' +
        '9;–;-;;—;–;;-;DL01\n',
    );

    expect(records).toEqual([{ tag: 'DL01', unit: 'No.', quantity: 9 }]);
  });

  it('rejects empty files, missing TAG columns and rows without valid tags', () => {
    expect(() => importLuminaireCsv('TAG,MODEL\n')).toThrow('no luminaire rows');
    expect(() => importLuminaireCsv('CODE,MODEL\nDL01,Model A')).toThrow(
      'No supported luminaire Tag column was found',
    );
    expect(() => importLuminaireCsv('TAG,MODEL\n,Model A')).toThrow(
      'No valid TAG values were found',
    );
  });
});
