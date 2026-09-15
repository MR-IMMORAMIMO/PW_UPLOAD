import { describe, expect, it } from 'vitest';
import {
  displayLuminaireTechnicalValue,
  formatLuminaireBeam,
  formatLuminaireCct,
  formatLuminaireCri,
  formatLuminaireIp,
  formatLuminaireLumens,
  formatLuminaireVariantSummary,
  formatLuminaireWattage,
} from './luminaireTechnicalDisplay';

describe('luminaire technical display authority', () => {
  it('formats power and luminous flux with the correct basis', () => {
    expect(formatLuminaireWattage('10.6')).toBe('10.6 W');
    expect(formatLuminaireWattage('20', 'W_PER_M')).toBe('20 W/m');
    expect(formatLuminaireWattage('20 W/m')).toBe('20 W/m');
    expect(formatLuminaireLumens('1222')).toBe('1222 lm');
    expect(formatLuminaireLumens('1200', 'LM_PER_M')).toBe('1200 lm/m');
    expect(formatLuminaireLumens('1200 lm/m')).toBe('1200 lm/m');
  });

  it('normalizes CCT, CRI, numeric beams, and IP without duplicating markers', () => {
    expect(formatLuminaireCct('3000K')).toBe('3000 K');
    expect(formatLuminaireCct('Tunable White')).toBe('Tunable White');
    expect(formatLuminaireCri('92')).toBe('CRI 92');
    expect(formatLuminaireCri('CRI CRI90')).toBe('CRI 90');
    expect(formatLuminaireBeam('24 degrees')).toBe('24°');
    expect(formatLuminaireBeam('Wide Flood')).toBe('Wide Flood');
    expect(formatLuminaireIp('20')).toBe('IP20');
    expect(formatLuminaireIp('IP20')).toBe('IP20');
  });

  it('provides one compact, unit-aware Variant summary and truthful empty fallback', () => {
    expect(
      formatLuminaireVariantSummary({
        wattage: '10.6',
        lumens: '1222',
        lightColor: '3000K',
        cri: 'CRI92',
        beamAngle: 'Wide Flood',
        control: 'DALI',
      }),
    ).toBe('10.6 W · 1222 lm · 3000 K · CRI 92 · Wide Flood · DALI');
    expect(displayLuminaireTechnicalValue('wattage', '')).toBe('—');
  });
});
