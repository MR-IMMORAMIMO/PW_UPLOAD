import { PNG } from 'pngjs';
import { DOCUMENT_INTELLIGENCE_LIMITS } from '@scli/domain';

/** Darken faint printed labels without moving pixels: evidence coordinates stay on the original. */
export function prepareOcrImage(bytes: Buffer): Buffer {
  const image = PNG.sync.read(bytes);
  if (image.width * image.height > DOCUMENT_INTELLIGENCE_LIMITS.previewPixels) {
    throw new Error('OCR_IMAGE_LIMIT_EXCEEDED');
  }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3]! / 255;
    const gray =
      (0.299 * image.data[offset]! +
        0.587 * image.data[offset + 1]! +
        0.114 * image.data[offset + 2]!) *
        alpha +
      255 * (1 - alpha);
    const contrast = Math.max(0, Math.round(255 - (255 - gray) * 5));
    image.data[offset] = contrast;
    image.data[offset + 1] = contrast;
    image.data[offset + 2] = contrast;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}
