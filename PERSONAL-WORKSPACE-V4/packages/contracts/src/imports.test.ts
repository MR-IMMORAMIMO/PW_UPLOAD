import { describe, expect, it } from 'vitest';
import {
  importLibraryResultIdentitySchema,
  importLibraryRowActionSchema,
  updateImportRowActionSchema,
} from './imports';

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const fingerprint = 'a'.repeat(64);

function createDraftAction() {
  return {
    type: 'LIBRARY_CREATE_DRAFT' as const,
    manufacturer: {
      manufacturerGroupId: id('1'),
      mode: 'CREATE' as const,
      manufacturerId: id('2'),
      name: 'Acme',
      normalizedName: 'acme',
      expected: null,
    },
    product: {
      productGroupId: id('3'),
      mode: 'CREATE' as const,
      productId: id('4'),
      family: 'Arc',
      normalizedFamily: 'arc',
      productType: 'Downlight',
      description: '',
      expected: null,
    },
    variant: {
      plannedVariantId: id('5'),
      variantLabel: '12 W · 900 lm · 3000 K',
      orderingCode: 'ARC-12',
      normalizedOrderingCode: 'ARC-12',
      wattage: '12 W',
      wattageBasis: 'W' as const,
      lumens: '900 lm',
      lumensBasis: 'LM' as const,
      lightColor: '3000 K',
      cri: '',
      beamAngle: '',
      ipRating: '',
      mounting: '',
      cutout: '',
      driver: '',
      control: '',
      emergency: '',
      dimensions: '',
      bodyColorFinish: '',
      assetVersionIds: [] as [],
    },
    basis: {
      sourceRowFingerprint: fingerprint,
      mappingFingerprint: fingerprint,
      reconciliationFingerprint: fingerprint,
      destinationFingerprint: fingerprint,
      importRowVersion: 2,
    },
    publish: false as const,
  };
}

describe('P5B-C Library Import contracts', () => {
  it('accepts only the fully materialized non-publishing Draft plan', () => {
    expect(importLibraryRowActionSchema.parse(createDraftAction())).toEqual(createDraftAction());
    expect(
      importLibraryRowActionSchema.safeParse({ ...createDraftAction(), publish: true }).success,
    ).toBe(false);
    expect(
      importLibraryRowActionSchema.safeParse({ ...createDraftAction(), projectId: id('9') })
        .success,
    ).toBe(false);
    expect(
      importLibraryRowActionSchema.safeParse({
        ...createDraftAction(),
        variant: { ...createDraftAction().variant, assetVersionIds: [id('8')] },
      }).success,
    ).toBe(false);
  });

  it('keeps owner row decisions payload-free and rejects an update action', () => {
    expect(
      updateImportRowActionSchema.safeParse({
        expectedSessionRevision: 1,
        expectedRowVersion: 1,
        action: { type: 'LIBRARY_CREATE_DRAFT' },
      }).success,
    ).toBe(true);
    expect(
      updateImportRowActionSchema.safeParse({
        expectedSessionRevision: 1,
        expectedRowVersion: 1,
        action: { type: 'LIBRARY_UPDATE_DRAFT' },
      }).success,
    ).toBe(false);
  });

  it('has no Published outcome in the strict Library result vocabulary', () => {
    const base = {
      schemaVersion: 2,
      mutationOccurred: true,
      manufacturerId: id('2'),
      productId: id('4'),
      variantId: id('5'),
      latestPublishedVersionId: null,
      manufacturerCreated: true,
      productCreated: true,
      applyAttemptId: id('6'),
      appliedAt: '2026-08-27T08:00:00.000Z',
      failureCode: null,
      retryEligible: false,
    };
    expect(
      importLibraryResultIdentitySchema.safeParse({ ...base, outcome: 'DRAFT_CREATED' }).success,
    ).toBe(true);
    expect(
      importLibraryResultIdentitySchema.safeParse({ ...base, outcome: 'PUBLISHED' }).success,
    ).toBe(false);
  });
});
