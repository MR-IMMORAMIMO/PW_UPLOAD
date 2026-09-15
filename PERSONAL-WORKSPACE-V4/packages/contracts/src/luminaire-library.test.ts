import { describe, expect, it } from 'vitest';
import {
  createProjectLuminaireLibraryDraftSchema,
  luminaireLibraryListQuerySchema,
} from './luminaire-library';

const variant = {
  variantLabel: '12W / 1050lm / 3000K / CRI90 / 24° / White / DALI',
  orderingCode: 'BP-12-930-DALI',
  wattage: '12W',
  lumens: '1050 lm',
  lightColor: '3000K',
  cri: 'CRI90',
  beamAngle: '24°',
  ipRating: 'IP20',
  mounting: 'Suspended',
  cutout: '',
  driver: 'Integral',
  control: 'DALI',
  emergency: 'No',
  dimensions: 'Ø240 x 420 mm',
  bodyColorFinish: 'White',
};

describe('Project Luminaire to Library Draft contract', () => {
  it('accepts intent and explicit identity choices only', () => {
    expect(
      createProjectLuminaireLibraryDraftSchema.parse({
        manufacturer: { mode: 'CREATE_NEW', name: 'Project-only Maker' },
        product: {
          mode: 'CREATE_NEW',
          name: 'Bespoke Pendant',
          productType: 'Pendant',
          description: 'Reusable technical baseline',
          duplicateDecision: 'KEEP_SEPARATE',
        },
        variant,
        idempotencyKey: 'promotion-contract-1',
      }),
    ).toMatchObject({ product: { duplicateDecision: 'KEEP_SEPARATE' } });
  });

  it.each(['sourceFilePath', 'assetDestinationPath', 'contentHash', 'tag', 'quantity'])(
    'rejects renderer-supplied %s authority',
    (field) => {
      expect(() =>
        createProjectLuminaireLibraryDraftSchema.parse({
          manufacturer: { mode: 'CREATE_NEW', name: 'Project-only Maker' },
          product: {
            mode: 'CREATE_NEW',
            name: 'Bespoke Pendant',
            productType: 'Pendant',
            description: '',
            duplicateDecision: 'NO_MATCHES',
          },
          variant,
          idempotencyKey: 'promotion-contract-2',
          [field]: field === 'quantity' ? 3 : 'forbidden',
        }),
      ).toThrow();
    },
  );
});

describe('Master Library filter contract', () => {
  it('parses bounded multi-value facets and unit-safe ranges', () => {
    expect(
      luminaireLibraryListQuerySchema.parse({
        manufacturerIds:
          '10000000-0000-4000-8000-000000000001,20000000-0000-4000-8000-000000000001',
        productTypes: 'Downlight,Spotlight',
        cctKelvin: '3000,4000,3000',
        beam: '24°,36°',
        wattageMin: '8',
        wattageMax: '15',
        wattageBasis: 'W',
        criMin: '90',
        mounting: 'Recessed,Track',
        hasIes: 'true',
        sort: 'HIGHEST_EFFICACY',
      }),
    ).toMatchObject({
      manufacturerIds: [
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
      ],
      productTypes: ['Downlight', 'Spotlight'],
      cctKelvin: [3000, 4000],
      beam: ['24°', '36°'],
      wattageMin: 8,
      wattageMax: 15,
      wattageBasis: 'W',
      criMin: 90,
      mounting: ['Recessed', 'Track'],
      hasIes: true,
      sort: 'HIGHEST_EFFICACY',
    });
  });

  it('rejects reversed or basis-free numeric ranges', () => {
    expect(() =>
      luminaireLibraryListQuerySchema.parse({
        wattageMin: '15',
        wattageMax: '8',
        wattageBasis: 'W',
      }),
    ).toThrow();
    expect(() => luminaireLibraryListQuerySchema.parse({ lumensMin: '800' })).toThrow();
  });
});
