import { describe, expect, it } from 'vitest';
import { contrastRatio, createAccessibleAccentPalette } from './theme-colors';

describe('accessible accent palette', () => {
  it.each(['#008C95', '#f0be21', '#7257d5', '#db4351'])(
    'keeps %s readable in both themes',
    (accent) => {
      const light = createAccessibleAccentPalette(accent, 'light');
      const dark = createAccessibleAccentPalette(accent, 'dark');

      expect(contrastRatio(light.foreground, '#e3eeee')).toBeGreaterThanOrEqual(4.75);
      expect(contrastRatio(dark.foreground, '#1c373d')).toBeGreaterThanOrEqual(4.75);
      expect(contrastRatio('#ffffff', light.strong)).toBeGreaterThanOrEqual(4.75);
      expect(contrastRatio('#ffffff', dark.strong)).toBeGreaterThanOrEqual(4.75);
      expect(light.base).toBe(dark.base);
    },
  );

  it('normalizes short and invalid accent values safely', () => {
    expect(createAccessibleAccentPalette('#abc', 'light').base).toBe('#aabbcc');
    expect(createAccessibleAccentPalette('not-a-color', 'dark').base).toBe('#008c95');
  });
});
