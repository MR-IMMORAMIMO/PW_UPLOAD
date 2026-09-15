import { describe, expect, it } from 'vitest';
import {
  canonicalLuminaireLibrarySnapshot,
  compareLuminaireLibraryVersions,
  deriveLuminaireEfficacy,
  effectiveProjectLuminaireDescription,
  normalizeLuminaireOrderingCode,
  normalizeLuminaireTechnicalValues,
  normalizeManufacturerName,
  parseLuminaireCctKelvin,
  parseLuminaireCri,
  parseLuminaireBeamDegrees,
  parseLuminaireLumens,
  parseLuminaireWattage,
  type LuminaireLibraryVersion,
} from './luminaire-library';

const snapshot = {
  manufacturerId: '10000000-0000-4000-8000-000000000001',
  manufacturerName: 'ERCO',
  productId: '20000000-0000-4000-8000-000000000001',
  productName: 'Lightscan',
  productType: 'Spotlight',
  technicalDescription: 'Track spotlight',
  variantId: '30000000-0000-4000-8000-000000000001',
  variantLabel: '12W / 3000K / 24 degrees / White / DALI',
  orderingCode: 'LS-12-30-24-W-D',
  wattage: '12W',
  lumens: '1050 lm',
  lightColor: '3000K',
  cri: 'CRI90',
  beamAngle: '24 degrees',
  ipRating: 'IP20',
  mounting: 'Track',
  cutout: '',
  driver: 'Integral',
  control: 'DALI',
  emergency: 'No',
  dimensions: '100 x 200 mm',
  bodyColorFinish: 'White',
  assetVersionIds: ['asset-a'],
};

function version(versionId: string, sequence: number, overrides = {}): LuminaireLibraryVersion {
  return {
    versionId,
    variantId: snapshot.variantId,
    versionSequence: sequence,
    snapshot: { ...snapshot, ...overrides },
    contentHash: String(sequence).repeat(64),
    publishedById: 'user-1',
    publishedByName: 'Library Manager',
    publishedAt: `2026-08-25T00:00:0${sequence}.000Z`,
  };
}

describe('Master Luminaire Library domain', () => {
  it('normalizes Manufacturer names without turning different names into the same identity', () => {
    expect(normalizeManufacturerName('  ERCO   Lighting  ')).toBe('erco lighting');
    expect(normalizeManufacturerName('Erco')).toBe('erco');
    expect(normalizeManufacturerName('ERCO Lighting')).not.toBe(normalizeManufacturerName('ERCO'));
  });

  it('canonicalizes snapshots and returns deterministic field and asset changes', () => {
    const v1 = version('version-1', 1);
    const v2 = version('version-2', 2, {
      wattage: '14W',
      lumens: '1250 lm',
      assetVersionIds: ['asset-b'],
    });
    expect(canonicalLuminaireLibrarySnapshot(v1.snapshot)).toBe(
      canonicalLuminaireLibrarySnapshot({ ...v1.snapshot }),
    );
    const comparison = compareLuminaireLibraryVersions(
      v1,
      v2,
      new Map([
        ['asset-a', 'Datasheet'],
        ['asset-b', 'Datasheet'],
      ]),
    );
    expect(comparison.fieldChanges).toEqual(
      expect.arrayContaining([
        { field: 'wattage', before: '12W', after: '14W' },
        { field: 'lumens', before: '1050 lm', after: '1250 lm' },
      ]),
    );
    expect(comparison.assetChanges).toEqual([
      {
        assetType: 'Datasheet',
        beforeAssetVersionIds: ['asset-a'],
        afterAssetVersionIds: ['asset-b'],
      },
    ]);
  });

  it('uses only the explicit Project Description override over the Library baseline', () => {
    expect(effectiveProjectLuminaireDescription('Library baseline', null)).toBe('Library baseline');
    expect(effectiveProjectLuminaireDescription('Library baseline', 'Project description')).toBe(
      'Project description',
    );
  });

  it('normalizes ordering codes without destructive character rewriting', () => {
    expect(normalizeLuminaireOrderingCode('  a200  0427 / x  ')).toBe('A200 0427 / X');
  });

  it('parses normalized technical values conservatively and keeps unit bases separate', () => {
    expect(parseLuminaireWattage('10.6 W')).toEqual({ value: 10.6, basis: 'W' });
    expect(parseLuminaireWattage('20 W/m')).toEqual({ value: 20, basis: 'W_PER_M' });
    expect(parseLuminaireLumens('1222lm')).toEqual({ value: 1222, basis: 'LM' });
    expect(parseLuminaireLumens('1200 lm/m')).toEqual({ value: 1200, basis: 'LM_PER_M' });
    expect(parseLuminaireCctKelvin('3000K')).toBe(3000);
    expect(parseLuminaireCri('CRI92')).toBe(92);
    expect(parseLuminaireWattage('approximately twelve watts')).toBeNull();
    expect(parseLuminaireLumens('high output')).toBeNull();
    expect(parseLuminaireCri('excellent')).toBeNull();
    expect(parseLuminaireBeamDegrees('24')).toBe(24);
    expect(parseLuminaireBeamDegrees('24°')).toBe(24);
    expect(parseLuminaireBeamDegrees('24 deg')).toBe(24);

    const normalized = normalizeLuminaireTechnicalValues({
      ...snapshot,
      beamAngle: 'Wide Flood',
      wattage: '20 W/m',
      lumens: '1200 lm/m',
    });
    expect(normalized).toMatchObject({
      wattageValue: 20,
      wattageBasis: 'W_PER_M',
      lumensValue: 1200,
      lumensBasis: 'LM_PER_M',
      cctKelvin: 3000,
      criValue: 90,
      beamDegrees: null,
      beamFacet: 'wide flood',
    });
    expect(normalizeLuminaireTechnicalValues({ ...snapshot, beamAngle: '24' }).beamFacet).toBe(
      '24°',
    );
  });

  it('derives efficacy only for compatible absolute or per-metre bases', () => {
    expect(deriveLuminaireEfficacy('10 W', '1000 lm')).toBe(100);
    expect(deriveLuminaireEfficacy('20 W/m', '1800 lm/m')).toBe(90);
    expect(deriveLuminaireEfficacy('10 W', '1000 lm/m')).toBeNull();
    expect(deriveLuminaireEfficacy('0 W', '1000 lm')).toBeNull();
  });
});
