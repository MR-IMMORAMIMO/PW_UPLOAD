import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../api/environment';
import { renderV4, cleanupV4, stubMatchMedia } from '../../test-utils/renderV4';
import { DatasheetProductImages } from './DatasheetProductImages';
afterEach(() => {
  cleanup();
  cleanupV4();
  vi.restoreAllMocks();
});
const sourceAssetVersionId = '11111111-1111-4111-8111-111111111111';
const image = { pageNumber: 1, width: 200, height: 160, hash: 'a'.repeat(64), pngBase64: 'test' };
it('requires explicit selection and passes exact source and current image identities', async () => {
  stubMatchMedia();
  vi.spyOn(api, 'datasheetImages').mockResolvedValue({
    sourceAssetVersionId,
    currentImageVersionId: null,
    images: [image],
  });
  const apply = vi.spyOn(api, 'useDatasheetImage').mockResolvedValue({});
  const close = vi.fn();
  renderV4(<DatasheetProductImages projectId="p1" luminaireId="l1" onClose={close} />);
  expect(screen.getByRole('button', { name: 'Use selected image' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'Select image 1 from page 1' }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use selected image' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(apply).toHaveBeenCalledWith('p1', 'l1', {
    pageNumber: 1,
    sourceAssetVersionId,
    currentImageVersionId: null,
    imageHash: image.hash,
  });
});
it('shows extraction errors without allowing an unreviewed replacement', async () => {
  stubMatchMedia();
  vi.spyOn(api, 'datasheetImages').mockRejectedValue(new Error('Datasheet hash changed.'));
  renderV4(<DatasheetProductImages projectId="p1" luminaireId="l1" onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Datasheet hash changed.');
  expect(screen.getByRole('button', { name: 'Use selected image' })).toBeDisabled();
});
