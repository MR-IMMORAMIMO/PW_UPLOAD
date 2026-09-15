import { describe, expect, it } from 'vitest';
import {
  formatBeam,
  formatCct,
  formatIpRating,
  formatUnitValue,
  parseBeam,
  parseCct,
  parseIpRating,
  parseUnitValue,
} from './luminaireTechnicalAdapters';

describe('luminaire technical entry adapters', () => {
  it('parses and formats power and luminous-flux units', () => {
    expect(parseUnitValue('20 W', ['W', 'W/m'], 'W')).toEqual({
      mode: 'standard',
      value: '20',
      unit: 'W',
    });
    expect(parseUnitValue('12 W/m', ['W', 'W/m'], 'W')).toEqual({
      mode: 'standard',
      value: '12',
      unit: 'W/m',
    });
    expect(formatUnitValue(parseUnitValue('900 lm/m', ['lm', 'lm/m'], 'lm'))).toBe('900 lm/m');
  });

  it('round-trips unrecognized power and CCT authority without loss', () => {
    expect(formatUnitValue(parseUnitValue('Driver dependent', ['W', 'W/m'], 'W'))).toBe(
      'Driver dependent',
    );
    expect(formatCct(parseCct('Tunable White 2700–6500 K'))).toBe('Tunable White 2700–6500 K');
    expect(parseCct('4000 K')).toEqual({ mode: 'standard', value: '4000', unit: 'K' });
  });

  it('formats numeric beam and IP values without damaging custom optics or duplicating prefixes', () => {
    expect(formatBeam(parseBeam('40'))).toBe('40°');
    expect(formatBeam(parseBeam('Asymmetric'))).toBe('Asymmetric');
    expect(formatIpRating(parseIpRating('IP20'))).toBe('IP20');
    expect(formatIpRating(parseIpRating('Marine rated'))).toBe('Marine rated');
  });
});
