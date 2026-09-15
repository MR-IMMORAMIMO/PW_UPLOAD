import { useEffect, useState } from 'react';
import { SctImage as ImageOff } from '../../components/common/SctIcons';
import { browserReadableImageSource, resolveLuminaireImage } from '../../desktop/localImage';

type ImageState =
  | { path: string; status: 'loading' | 'missing' | 'unavailable' }
  | { path: string; status: 'ready'; src: string };

function initialState(path: string): ImageState {
  if (!path) return { path, status: 'missing' };
  const browserSource = browserReadableImageSource(path);
  return browserSource
    ? { path, status: 'ready', src: browserSource }
    : { path, status: 'loading' };
}

export function LuminaireImage({ path, alt }: { path: string; alt: string }) {
  const normalizedPath = path.trim();
  const [state, setState] = useState<ImageState>(() => initialState(normalizedPath));

  useEffect(() => {
    let active = true;
    const next = initialState(normalizedPath);
    setState(next);
    if (next.status !== 'loading') return () => undefined;

    void resolveLuminaireImage(normalizedPath).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { path: normalizedPath, status: 'ready', src: result.src }
          : { path: normalizedPath, status: 'unavailable' },
      );
    });
    return () => {
      active = false;
    };
  }, [normalizedPath]);

  const current = state.path === normalizedPath ? state : initialState(normalizedPath);
  if (current.status !== 'ready') {
    const label =
      current.status === 'missing'
        ? 'Missing image'
        : current.status === 'loading'
          ? 'Loading image preview'
          : 'Image preview unavailable';
    return (
      <span className="v4-luminaires__image-missing" aria-label={label}>
        <ImageOff aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={current.src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setState({ path: normalizedPath, status: 'unavailable' })}
    />
  );
}
