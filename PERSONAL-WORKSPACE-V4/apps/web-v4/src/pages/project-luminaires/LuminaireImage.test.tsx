/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { clearLocalImageCacheForTests } from '../../desktop/localImage';
import { LuminaireImage } from './LuminaireImage';

const pngSource = 'data:image/png;base64,iVBORw0KGgo=';
const firstPath = 'C:\\fixtures\\DL01.png';
const secondPath = 'C:\\fixtures\\DL02.png';

describe('LuminaireImage', () => {
  afterEach(() => {
    cleanup();
    clearLocalImageCacheForTests();
    delete window.scliDesktop;
  });

  it('renders a valid local image through the narrow desktop authority', async () => {
    const readLocalImage = vi.fn().mockResolvedValue({ ok: true, src: pngSource });
    window.scliDesktop = { readLocalImage };

    render(<LuminaireImage path={firstPath} alt="DL01 product" />);

    expect(await screen.findByRole('img', { name: 'DL01 product' })).toHaveAttribute(
      'src',
      pngSource,
    );
    expect(readLocalImage).toHaveBeenCalledWith(firstPath);
  });

  it('renders truthful missing and unavailable treatments', async () => {
    const readLocalImage = vi.fn().mockResolvedValue({ ok: false, reason: 'missing' });
    window.scliDesktop = { readLocalImage };
    const view = render(<LuminaireImage path="" alt="Missing product" />);

    expect(screen.getByLabelText('Missing image')).toBeInTheDocument();
    view.rerender(<LuminaireImage path={'C:\\fixtures\\missing.jpg'} alt="Missing product" />);
    expect(await screen.findByLabelText('Image preview unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Missing product' })).not.toBeInTheDocument();
  });

  it('shares one cached read between thumbnail and Inspector and ignores stale results', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const first = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const readLocalImage = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true, src: pngSource });
    window.scliDesktop = { readLocalImage };
    const view = render(
      <>
        <LuminaireImage path={firstPath} alt="DL01 thumbnail" />
        <LuminaireImage path={firstPath} alt="DL01 product" />
      </>,
    );

    expect(readLocalImage).toHaveBeenCalledTimes(1);
    view.rerender(<LuminaireImage path={secondPath} alt="DL02 product" />);
    expect(await screen.findByRole('img', { name: 'DL02 product' })).toHaveAttribute(
      'src',
      pngSource,
    );
    resolveFirst({ ok: true, src: 'data:image/png;base64,AAAA' });
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'DL02 product' })).toHaveAttribute('src', pngSource),
    );
  });
});
