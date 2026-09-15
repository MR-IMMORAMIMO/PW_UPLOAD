import { describe, expect, it } from 'vitest';
import {
  commercialValueInputFromMinor,
  currencyFractionDigits,
  formatCommercialValue,
  parseCommercialValueInput,
} from './commercial-value';

describe('commercial value UI boundary', () => {
  it('uses platform currency metadata for two, zero, and three fraction digits', () => {
    expect(currencyFractionDigits('AED')).toBe(2);
    expect(currencyFractionDigits('JPY')).toBe(0);
    expect(currencyFractionDigits('BHD')).toBe(3);
  });

  it('converts human decimal strings to integer minor units without floating point parsing', () => {
    expect(parseCommercialValueInput('125000.50', 'aed')).toEqual({
      ok: true,
      value: { commercialValueMinor: 12_500_050, commercialCurrency: 'AED' },
    });
    expect(parseCommercialValueInput('125000', 'JPY')).toEqual({
      ok: true,
      value: { commercialValueMinor: 125_000, commercialCurrency: 'JPY' },
    });
    expect(parseCommercialValueInput('1.234', 'BHD')).toEqual({
      ok: true,
      value: { commercialValueMinor: 1_234, commercialCurrency: 'BHD' },
    });
    expect(parseCommercialValueInput('.5', 'AED')).toEqual({
      ok: true,
      value: { commercialValueMinor: 50, commercialCurrency: 'AED' },
    });
  });

  it('rejects excess precision instead of rounding it', () => {
    expect(parseCommercialValueInput('10.001', 'AED')).toMatchObject({
      ok: false,
      error: 'AED supports at most 2 fractional digits.',
    });
    expect(parseCommercialValueInput('10.0', 'JPY')).toMatchObject({
      ok: false,
      error: 'JPY supports at most 0 fractional digits.',
    });
  });

  it('rejects negative, scientific, malformed, and unsafe amounts', () => {
    expect(parseCommercialValueInput('-1', 'AED')).toMatchObject({
      ok: false,
      error: 'Commercial value cannot be negative.',
    });
    expect(parseCommercialValueInput('1e6', 'AED')).toMatchObject({ ok: false });
    expect(parseCommercialValueInput('NaN', 'AED')).toMatchObject({ ok: false });
    expect(parseCommercialValueInput('Infinity', 'AED')).toMatchObject({ ok: false });
    expect(parseCommercialValueInput('90071992547409.92', 'AED')).toMatchObject({
      ok: false,
      error: 'Commercial value exceeds the safe supported range.',
    });
  });

  it('enforces the optional amount and currency pair', () => {
    expect(parseCommercialValueInput('  ', ' ')).toEqual({ ok: true, value: {} });
    expect(parseCommercialValueInput('125', '')).toMatchObject({ ok: false });
    expect(parseCommercialValueInput('', 'AED')).toMatchObject({ ok: false });
  });

  it('round-trips canonical minor units to exact editable strings', () => {
    expect(commercialValueInputFromMinor(12_500_050, 'AED')).toEqual({
      amount: '125000.50',
      currency: 'AED',
    });
    expect(commercialValueInputFromMinor(125_000, 'JPY')).toEqual({
      amount: '125000',
      currency: 'JPY',
    });
    expect(commercialValueInputFromMinor(1_234, 'BHD')).toEqual({
      amount: '1.234',
      currency: 'BHD',
    });
  });

  it('formats missing and zero values correctly with currency-specific precision', () => {
    expect(formatCommercialValue(undefined, undefined)).toBe('Not set');
    expect(formatCommercialValue(null, null)).toBe('Not set');
    expect(formatCommercialValue(0, 'AED')).toContain('AED');
    expect(formatCommercialValue(0, 'AED')).toContain('0.00');
    expect(formatCommercialValue(125_000, 'JPY')).toContain('125,000');
    expect(formatCommercialValue(125_000, 'JPY')).not.toContain('.00');
    expect(formatCommercialValue(1_234, 'BHD')).toContain('1.234');
  });
});
