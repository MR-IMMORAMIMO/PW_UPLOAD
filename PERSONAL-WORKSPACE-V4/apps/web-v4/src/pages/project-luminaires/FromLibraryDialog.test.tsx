/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FromLibraryDialog } from './FromLibraryDialog';
import { stubMatchMedia } from '../../test-utils/renderV4';
const api = vi.hoisted(() => ({
  luminaireLibraryProducts: vi.fn(),
  addProjectLuminaireFromLibrary: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('shows the selected published identity and image, accepts a custom category and loads additional products', async () => {
  stubMatchMedia();
  const product = (id: string) => ({
    product: { name: 'Product ' + id },
    manufacturer: { name: 'Manufacturer' },
    variants: [
      {
        variant: { status: 'ACTIVE', variantLabel: 'Variant ' + id },
        latestVersion: {
          versionId: id,
          versionSequence: 2,
          snapshot: {
            orderingCode: 'ORDER-' + id,
            wattage: '12 W',
            lumens: '1000 lm',
            lightColor: '3000 K',
            cri: '90',
            beamAngle: '36°',
            control: 'DALI',
            technicalDescription: 'Published description',
          },
        },
        assetAvailability: { productImageAssetVersionId: 'asset-' + id },
      },
    ],
  });
  api.luminaireLibraryProducts
    .mockResolvedValueOnce({ items: [product('v1')], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [product('v2')], nextCursor: null });
  api.addProjectLuminaireFromLibrary.mockResolvedValue({ luminaireId: 'created' });
  const added = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FromLibraryDialog projectId="p1" onClose={vi.fn()} onAdded={added} />
    </QueryClientProvider>,
  );
  await screen.findByText('Product v1');
  fireEvent.click(screen.getByRole('button', { name: /Product v1/ }));
  expect(screen.getByText('ORDER-v1')).toBeVisible();
  expect(
    screen
      .getAllByRole('img', { name: 'Product v1' })
      .every(
        (img) =>
          img.getAttribute('src') === '/api/luminaire-library/assets/versions/asset-v1/content',
      ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(/^Tag/), { target: { value: 'NEW01' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Project Category' }), {
    target: { value: 'Bespoke category' },
  });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load more products' }));
  await screen.findByText('Product v2');
  expect(api.luminaireLibraryProducts).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'next' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add to Project' }));
  await waitFor(() => expect(added).toHaveBeenCalledWith('created'));
  expect(api.addProjectLuminaireFromLibrary).toHaveBeenCalledWith(
    'p1',
    expect.objectContaining({
      versionId: 'v1',
      tag: 'NEW01',
      category: 'Bespoke category',
      quantity: 4,
    }),
  );
  const body = api.addProjectLuminaireFromLibrary.mock.calls[0]![1];
  expect(body).not.toHaveProperty('model');
  expect(body).not.toHaveProperty('orderingCode');
});
