export type LocalImageUnavailableReason =
  | 'bridge-unavailable'
  | 'invalid-path'
  | 'unsupported-format'
  | 'missing'
  | 'not-file'
  | 'oversized'
  | 'invalid-image'
  | 'read-failed';

export type LocalImageResult =
  { ok: true; src: string } | { ok: false; reason: LocalImageUnavailableReason };

declare global {
  interface Window {
    scliDesktop?: {
      openContactLink?: (input: { kind: 'email' | 'phone'; value: string }) => Promise<boolean>;
      exportPdf?: (input: {
        html: string;
        suggestedName: string;
        defaultDirectory?: string;
      }) => Promise<string | null>;
      readLocalImage?: (path: string) => Promise<unknown>;
      selectFile?: (
        filters?: Array<{ name: string; extensions: string[] }>,
      ) => Promise<string | null>;
      /** Bounded native picker for the existing Luminaire AssetVersion workflow. */
      selectLuminaireAssetFile?: (assetType: 'Datasheet' | 'ProductImage') => Promise<{
        assetType: 'Datasheet' | 'ProductImage';
        fileName: string;
        filePath: string;
      } | null>;
      /** Narrow desktop folder picker exposed by the existing preload bridge. */
      selectFolder?: () => Promise<string | null>;
      openPath?: (path: string) => Promise<string>;
      /** Narrow reveal-in-folder exposed by the existing preload bridge. */
      revealInFolder?: (path: string) => Promise<string>;
      isDesktop?: boolean;
      onCloseRequested?: (listener: () => void) => () => void;
      respondToClose?: (allow: boolean) => void;
      integrationStatus?: () => Promise<
        Array<{
          application: 'AUTOCAD' | 'DIALUX';
          available: boolean;
          executablePath: string | null;
          selectedPath: string | null;
          source: 'CONFIGURED' | 'DISCOVERED' | 'SELECTED_MISSING' | 'NOT_FOUND';
          health:
            | 'CONFIGURED'
            | 'DISCOVERED_SELECTION_REQUIRED'
            | 'SELECTED_VERSION_MISSING'
            | 'NOT_FOUND';
          discoveries: Array<{ executablePath: string; version: string | null }>;
        }>
      >;
      configureIntegration?: (application: 'AUTOCAD' | 'DIALUX') => Promise<unknown>;
      executeDesktopHandoff?: (handoffId: string, expectedAction: string) => Promise<unknown>;
    };
  }
}

const localImageCache = new Map<string, Promise<LocalImageResult>>();
const MAX_CACHE_ENTRIES = 128;
const safeImageDataUrl = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i;

export function browserReadableImageSource(value: string): string | null {
  const source = value.trim();
  if (/^(?:https?:|blob:|\/)/i.test(source)) return source;
  if (safeImageDataUrl.test(source)) return source;
  return null;
}

function normalizeResult(result: unknown): LocalImageResult {
  if (
    typeof result === 'object' &&
    result !== null &&
    'ok' in result &&
    result.ok === true &&
    'src' in result &&
    typeof result.src === 'string' &&
    safeImageDataUrl.test(result.src)
  ) {
    return { ok: true, src: result.src };
  }
  return { ok: false, reason: 'read-failed' };
}

async function requestLocalImage(path: string): Promise<LocalImageResult> {
  const bridge = window.scliDesktop?.readLocalImage;
  if (!bridge) return { ok: false, reason: 'bridge-unavailable' };
  try {
    return normalizeResult(await bridge(path));
  } catch {
    return { ok: false, reason: 'read-failed' };
  }
}

export function resolveLuminaireImage(value: string): Promise<LocalImageResult> {
  const path = value.trim();
  const browserSource = browserReadableImageSource(path);
  if (browserSource) return Promise.resolve({ ok: true, src: browserSource });
  if (!path) return Promise.resolve({ ok: false, reason: 'invalid-path' });

  const cached = localImageCache.get(path);
  if (cached) return cached;

  if (localImageCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = localImageCache.keys().next().value;
    if (typeof oldest === 'string') localImageCache.delete(oldest);
  }
  const pending = requestLocalImage(path);
  localImageCache.set(path, pending);
  return pending;
}

export function invalidateLocalImage(path?: string): void {
  if (path) localImageCache.delete(path.trim());
  else localImageCache.clear();
}

export function clearLocalImageCacheForTests(): void {
  invalidateLocalImage();
}
