import { PNG } from 'pngjs';
import type { OcrRegion, OcrWord } from './LocalOcrAdapter.js';
export interface NumericOcrReview {
  primary: string;
  secondary: string;
  region: OcrRegion;
  status: 'AGREE' | 'DISAGREE' | 'UNREADABLE';
}
export function numericReviewTargets(words: readonly OcrWord[]): OcrWord[] {
  return words
    .filter(
      (word) =>
        /^\d+(?:[.,]\d+)?$/.test(word.text) &&
        words.some(
          (label) =>
            label.bbox.x < word.bbox.x &&
            word.bbox.x - label.bbox.x < 500 &&
            Math.abs(label.bbox.y + label.bbox.height / 2 - (word.bbox.y + word.bbox.height / 2)) <=
              Math.max(12, word.bbox.height) &&
            /^(?:power|flux|output|CCT|CRI|beam|current|voltage|depth|length|diameter|width|height)$/i.test(
              label.text,
            ),
        ),
    )
    .slice(0, 16);
}
export function enlargedNumberCrop(png: PNG, region: OcrRegion): Buffer {
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x >= png.width ||
    region.y >= png.height
  )
    throw new Error('OCR_NUMERIC_CROP_LIMIT');
  const x = Math.max(0, Math.floor(region.x) - 8),
    y = Math.max(0, Math.floor(region.y) - 8);
  const width = Math.min(png.width - x, Math.ceil(region.width) + 16),
    height = Math.min(png.height - y, Math.ceil(region.height) + 16);
  if (width <= 0 || height <= 0 || width * height > 100_000)
    throw new Error('OCR_NUMERIC_CROP_LIMIT');
  const scale = 3,
    crop = new PNG({ width: width * scale, height: height * scale });
  for (let row = 0; row < crop.height; row++)
    for (let col = 0; col < crop.width; col++) {
      const source = ((y + Math.floor(row / scale)) * png.width + x + Math.floor(col / scale)) * 4;
      png.data.copy(crop.data, (row * crop.width + col) * 4, source, source + 4);
    }
  return PNG.sync.write(crop);
}
export function compareNumericReadings(
  primary: string,
  secondary: string,
  region: OcrRegion,
): NumericOcrReview {
  const clean = secondary.trim();
  return {
    primary,
    secondary: clean,
    region,
    status: !/^\d+(?:[.,]\d+)?$/.test(clean)
      ? 'UNREADABLE'
      : primary.replace(',', '.') === clean.replace(',', '.')
        ? 'AGREE'
        : 'DISAGREE',
  };
}
