import { describe, expect, it } from 'vitest';
import { exactTechnicalNumber } from './ExactTechnicalValue';
describe('Exact technical numbers', () => {
  it.each(['12-20 W', '12/24 W', '12 W ±10%', 'up to 12 W', '12 W/m', '12 W or 18 W', '12 lm', ''])(
    'does not treat %s as exact system power',
    (value) => {
      expect(exactTechnicalNumber('wattage', value)).toBeNull();
    },
  );
  it.each(['>80', '≥90', '80–90'])('does not erase the CRI qualifier in %s', (value) => {
    expect(exactTechnicalNumber('cri', value)).toBeNull();
  });
  it('converts explicit compatible units and decimal separators', () => {
    expect(exactTechnicalNumber('wattage', '0.012 kW')).toBe(12);
    expect(exactTechnicalNumber('wattage', '12,5 W')).toBe(12.5);
    expect(exactTechnicalNumber('lumens', '1,200 lm')).toBe(1200);
    expect(exactTechnicalNumber('lumens', '1.2 klm')).toBe(1200);
    expect(exactTechnicalNumber('beamAngle', '24°')).toBe(24);
  });
});
