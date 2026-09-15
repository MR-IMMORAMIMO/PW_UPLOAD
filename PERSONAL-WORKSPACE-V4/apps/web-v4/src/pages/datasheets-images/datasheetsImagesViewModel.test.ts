import { describe, expect, it } from 'vitest';
import type { LuminaireAssetSummary, LuminaireAssetVersion, LuminaireRecord } from '@scli/domain';
import { assetCounts, assetRows, filterAssetRows } from './datasheetsImagesViewModel';

const luminaire = (id: string, tag: string, category = 'Downlight'): LuminaireRecord => ({
  id,
  projectId: 'p1',
  tag,
  category,
  imagePath: '',
  description: '',
  manufacturer: 'Scientechnic',
  model: 'DLX',
  wattage: '18W',
  lumens: '',
  lightColor: '3000K',
  cri: '',
  beamAngle: '',
  ipRating: '',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: '',
  datasheetPath: '',
  location: '',
  unit: 'No.',
  quantity: 1,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
  rowVersion: 1,
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
});

const version = (
  luminaireId: string,
  assetType: 'Datasheet' | 'ProductImage',
): LuminaireAssetVersion => ({
  id: `${luminaireId}-${assetType}`,
  projectId: 'p1',
  luminaireId,
  assetType,
  versionSequence: 1,
  filePath: assetType === 'Datasheet' ? 'C:\\asset.pdf' : 'C:\\asset.png',
  fileName: assetType === 'Datasheet' ? 'asset.pdf' : 'asset.png',
  mimeType: assetType === 'Datasheet' ? 'application/pdf' : 'image/png',
  sizeBytes: null,
  fileHash: null,
  backfilled: false,
  attachedAt: '2026-08-16T08:00:00.000Z',
  attachedById: null,
  attachedByNameSnapshot: null,
});

it('calculates the three dynamic reference summary counts', () => {
  const summaries: LuminaireAssetSummary[] = [
    {
      luminaireId: 'l1',
      datasheet: version('l1', 'Datasheet'),
      productImage: version('l1', 'ProductImage'),
    },
    { luminaireId: 'l2', datasheet: null, productImage: version('l2', 'ProductImage') },
    { luminaireId: 'l3', datasheet: version('l3', 'Datasheet'), productImage: null },
  ];
  expect(
    assetCounts(
      assetRows(
        [luminaire('l1', 'DL01'), luminaire('l2', 'DL02'), luminaire('l3', 'WL01', 'Wall Light')],
        summaries,
      ),
    ),
  ).toEqual({ missingDatasheets: 1, missingImages: 1, complete: 1 });
});

describe('asset search and completeness filters', () => {
  const rows = assetRows(
    [luminaire('l1', 'DL01'), luminaire('l2', 'WL01', 'Wall Light')],
    [
      {
        luminaireId: 'l1',
        datasheet: version('l1', 'Datasheet'),
        productImage: version('l1', 'ProductImage'),
      },
      { luminaireId: 'l2', datasheet: null, productImage: version('l2', 'ProductImage') },
    ],
  );

  it('searches canonical tag, type, manufacturer, model, and description fields', () => {
    expect(filterAssetRows(rows, 'wall', 'all').map((row) => row.luminaire.tag)).toEqual(['WL01']);
    expect(filterAssetRows(rows, 'scientechnic', 'all')).toHaveLength(2);
  });

  it('supports missing-only, missing-datasheet, missing-image, and complete modes', () => {
    expect(filterAssetRows(rows, '', 'missing').map((row) => row.luminaire.tag)).toEqual(['WL01']);
    expect(filterAssetRows(rows, '', 'missing-datasheet')).toHaveLength(1);
    expect(filterAssetRows(rows, '', 'missing-image')).toHaveLength(0);
    expect(filterAssetRows(rows, '', 'complete').map((row) => row.luminaire.tag)).toEqual(['DL01']);
  });
});
