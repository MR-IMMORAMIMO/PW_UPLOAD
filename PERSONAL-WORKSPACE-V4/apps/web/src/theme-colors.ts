export type AccentTheme = 'light' | 'dark';

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface AccessibleAccentPalette {
  base: string;
  foreground: string;
  strong: string;
  soft: string;
}

function hexToRgb(value: string): RgbColor {
  const normalized = value.trim().replace(/^#/, '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return { red: 0, green: 140, blue: 149 };
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgbToHex(color: RgbColor): string {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function mix(source: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    red: source.red + (target.red - source.red) * amount,
    green: source.green + (target.green - source.green) * amount,
    blue: source.blue + (target.blue - source.blue) * amount,
  };
}

function luminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(hexToRgb(foreground));
  const second = luminance(hexToRgb(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function ensureContrast(
  source: RgbColor,
  background: string,
  target: RgbColor,
  minimumRatio: number,
): string {
  for (let step = 0; step <= 100; step += 1) {
    const candidate = rgbToHex(mix(source, target, step / 100));
    if (contrastRatio(candidate, background) >= minimumRatio) return candidate;
  }
  return rgbToHex(target);
}

export function createAccessibleAccentPalette(
  accent: string,
  theme: AccentTheme,
): AccessibleAccentPalette {
  const baseRgb = hexToRgb(accent);
  const base = rgbToHex(baseRgb);
  // The accent appears on every surface tier, so calibrate it against the least
  // contrasting surface rather than only the page background.
  const foregroundSurface = theme === 'dark' ? '#1c373d' : '#e3eeee';
  const foregroundTarget = theme === 'dark' ? '#ffffff' : '#000000';
  return {
    base,
    foreground: ensureContrast(baseRgb, foregroundSurface, hexToRgb(foregroundTarget), 4.75),
    strong: ensureContrast(baseRgb, '#ffffff', hexToRgb('#000000'), 4.75),
    soft: `rgba(${baseRgb.red}, ${baseRgb.green}, ${baseRgb.blue}, ${theme === 'dark' ? 0.16 : 0.1})`,
  };
}
