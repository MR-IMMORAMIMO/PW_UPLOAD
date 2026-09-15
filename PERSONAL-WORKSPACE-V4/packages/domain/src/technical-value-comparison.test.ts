import { describe, expect, it } from 'vitest';
import { compareTechnicalValue } from './technical-value-comparison';

describe('technical comparison', () => {
  it.each([
    ['wattage', '10.6', '10.60 W'],
    ['lumens', '1222 lm', '1222'],
    ['lightColor', '3000K', '3000'],
    ['beamAngle', '55°', '55'],
  ])('recognizes formatting for %s', (field, current, imported) => {
    expect(compareTechnicalValue(field, current, imported)).toBe('Formatting only');
  });
  it.each([
    ['wattage', '10 W/m', '10 W'],
    ['cri', '>90', '90'],
    ['cri', '92', '95'],
    ['ipRating', 'IP20/IP54', 'IP54'],
    ['lightColor', '3000/4000K', '3000K'],
  ])('retains meaningful %s differences', (field, current, imported) => {
    expect(compareTechnicalValue(field, current, imported)).toBe('Different');
  });
  it('does not interpret an empty import as deletion', () => {
    expect(compareTechnicalValue('wattage', '10 W', '')).toBe('Not supplied');
  });
});
