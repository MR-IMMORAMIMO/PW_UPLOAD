/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { LuminaireLibraryPage } from './LuminaireLibraryPage';
import type { LuminaireLibraryProductProjection } from '@scli/api-client';

const apiMock = vi.hoisted(() => ({
  me: vi.fn(async () => ({ displayName: 'Owner', email: 'owner@example.test' })),
  finalUiPreferences: vi.fn(),
  updateFinalUiPreference: vi.fn(),
  luminaireLibraryManufacturers: vi.fn(),
  luminaireLibraryProducts: vi.fn(),
  luminaireLibraryProduct: vi.fn(),
  luminaireLibraryVariantVersions: vi.fn(),
  luminaireLibraryDuplicateSuggestions: vi.fn(),
  updateLuminaireLibraryVariant: vi.fn(),
  archiveLuminaireLibraryVariant: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api: apiMock }));
const audit = {
  createdById: '11111111-1111-4111-8111-111111111111',
  createdByName: 'Owner',
  createdAt: '2026-09-09T08:00:00Z',
  updatedById: '11111111-1111-4111-8111-111111111111',
  updatedByName: 'Owner',
  updatedAt: '2026-09-09T08:00:00Z',
  rowVersion: 1,
  status: 'ACTIVE' as const,
};
const technical = {
  variantLabel: 'Spot 3000K',
  orderingCode: 'REAL-30',
  wattage: '10 W',
  lumens: '1000 lm',
  lightColor: '3000 K',
  cri: '90',
  beamAngle: '30',
  ipRating: 'IP20',
  mounting: 'Recessed',
  cutout: '',
  driver: '',
  control: 'DALI',
  emergency: '',
  dimensions: '',
  bodyColorFinish: '',
};
const productId = '22222222-2222-4222-8222-222222222222';
const variantId = '33333333-3333-4333-8333-333333333333';
const manufacturerId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const record: LuminaireLibraryProductProjection = {
  manufacturer: {
    ...audit,
    manufacturerId,
    name: 'Actual Manufacturer',
    normalizedName: 'actual manufacturer',
  },
  product: {
    ...audit,
    productId,
    manufacturerId,
    name: 'Actual Product',
    productType: 'Downlight',
    description: 'Persisted description',
  },
  variants: [
    {
      variant: {
        ...audit,
        ...technical,
        wattage: '99 W',
        productId,
        variantId,
        latestPublishedVersionId: versionId,
      },
      latestVersion: {
        versionId,
        variantId,
        versionSequence: 1,
        contentHash: 'a'.repeat(64),
        publishedAt: audit.createdAt,
        publishedById: audit.createdById,
        publishedByName: 'Owner',
        snapshot: {
          ...technical,
          manufacturerId,
          manufacturerName: 'Actual Manufacturer',
          productId,
          productName: 'Actual Product',
          productType: 'Downlight',
          technicalDescription: 'Published description',
          variantId,
          assetVersionIds: [],
        },
      },
      assetAvailability: {
        hasProductImage: false,
        hasDatasheet: false,
        hasIes: false,
        hasLdt: false,
        missingPhotometry: true,
        productImageAssetVersionId: null,
      },
    },
  ],
  assets: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  stubMatchMedia();
  window.localStorage.clear();
  apiMock.me.mockResolvedValue({ displayName: 'Owner', email: 'owner@example.test' });
  apiMock.finalUiPreferences.mockResolvedValue({ schemaVersion: 1, items: [] });
  apiMock.updateFinalUiPreference.mockResolvedValue({ schemaVersion: 1, items: [] });
  apiMock.luminaireLibraryManufacturers.mockResolvedValue({
    items: [record.manufacturer],
    nextCursor: null,
  });
  apiMock.luminaireLibraryProducts.mockResolvedValue({ items: [record], nextCursor: null });
  apiMock.luminaireLibraryProduct.mockResolvedValue(record);
  apiMock.luminaireLibraryVariantVersions.mockResolvedValue([record.variants[0]!.latestVersion]);
  apiMock.luminaireLibraryDuplicateSuggestions.mockResolvedValue([]);
});
function renderPage() {
  return renderV4(<LuminaireLibraryPage />, ['/luminaire-library']);
}
describe('Library persisted integration', () => {
  it('requires confirmation before removing a global Library item and preserves the Project-copy boundary', async () => {
    apiMock.archiveLuminaireLibraryVariant.mockResolvedValue(record.variants[0]!.variant);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete from Library' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete from Library' });
    expect(within(dialog).getByText(/Copies already saved in Project schedules/)).toBeVisible();
    expect(apiMock.archiveLuminaireLibraryVariant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(apiMock.archiveLuminaireLibraryVariant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete from Library' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'Delete from Library' })).getByRole(
        'button',
        { name: 'Delete from Library' },
      ),
    );
    await waitFor(() =>
      expect(apiMock.archiveLuminaireLibraryVariant).toHaveBeenCalledWith(variantId, {
        expectedRowVersion: 1,
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it('renders server identity and immutable published technical values instead of the mutable draft', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Actual Product' })).toBeVisible();
    const inspector = screen.getByRole('complementary', { name: 'Selected product inspector' });
    expect(within(inspector).getByText('10 W')).toBeVisible();
    expect(within(inspector).queryByText('99 W')).not.toBeInTheDocument();
    expect(screen.queryByText('LumiWorks DLX100')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datasheet' })).toBeDisabled();
  });
  it('opens the existing draft editor with mutable values and rejects identity fields in the outgoing edit', async () => {
    apiMock.updateLuminaireLibraryVariant.mockResolvedValue(record.variants[0]!.variant);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Draft' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('99 W')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(apiMock.updateLuminaireLibraryVariant).toHaveBeenCalled());
    const [id, body] = apiMock.updateLuminaireLibraryVariant.mock.calls[0]!;
    expect(id).toBe(variantId);
    expect(body).toMatchObject({ expectedRowVersion: 1, wattage: '99 W' });
    expect(body).not.toHaveProperty('variantId');
    expect(body).not.toHaveProperty('latestPublishedVersionId');
  });
  it('follows every server cursor rather than treating the first page as the entire catalogue', async () => {
    apiMock.luminaireLibraryProducts
      .mockResolvedValueOnce({ items: [record], nextCursor: 'next-page' })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    renderPage();
    await screen.findByRole('button', { name: 'Open Draft' });
    expect(apiMock.luminaireLibraryProducts).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'next-page' }),
    );
  });
  it('keeps manufacturer creation reachable through the existing split action on an empty catalogue', async () => {
    apiMock.luminaireLibraryProducts.mockResolvedValue({ items: [], nextCursor: null });
    apiMock.luminaireLibraryManufacturers.mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    await screen.findByText('No luminaires match these filters.');
    fireEvent.click(screen.getByRole('button', { name: 'New Library item options' }));
    expect(screen.getByRole('menuitem', { name: 'Add Variant' })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Manufacturer' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Manufacturer Name/ })).toBeVisible();
  });
  it('renders a truthful empty state without fixture data', async () => {
    apiMock.luminaireLibraryProducts.mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('No luminaires match these filters.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open Draft' })).not.toBeInTheDocument();
  });
});
