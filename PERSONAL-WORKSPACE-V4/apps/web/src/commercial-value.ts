export interface CommercialValueInputPair {
  commercialValueMinor?: number;
  commercialCurrency?: string;
}

export type CommercialValueParseResult =
  { ok: true; value: CommercialValueInputPair } | { ok: false; error: string };

const currencyCodePattern = /^[A-Z]{3}$/;

export function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase();
}

export function currencyFractionDigits(currency: string): number | null {
  const normalized = normalizeCurrencyCode(currency);
  if (!currencyCodePattern.test(normalized)) return null;
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalized,
    }).resolvedOptions().maximumFractionDigits;
    return digits !== undefined && Number.isInteger(digits) && digits >= 0 ? digits : null;
  } catch {
    return null;
  }
}

export function parseCommercialValueInput(
  rawAmount: string,
  rawCurrency: string,
): CommercialValueParseResult {
  const amount = rawAmount.trim();
  const currency = normalizeCurrencyCode(rawCurrency);

  if (!amount && !currency) return { ok: true, value: {} };
  if (!amount) {
    return { ok: false, error: 'Enter an amount or clear the currency.' };
  }
  if (!currency) {
    return { ok: false, error: 'Currency is required when an amount is entered.' };
  }

  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === null) {
    return { ok: false, error: 'Currency must be a valid three-letter code.' };
  }
  if (amount.startsWith('-')) {
    return { ok: false, error: 'Commercial value cannot be negative.' };
  }

  const match = /^(?:\d+(?:\.(\d*))?|\.(\d+))$/.exec(amount);
  if (!match) {
    return {
      ok: false,
      error: 'Enter a plain non-negative amount without commas or scientific notation.',
    };
  }

  const [integerPart = '0'] = amount.startsWith('.') ? ['0'] : amount.split('.', 1);
  const fractionPart = match[1] ?? match[2] ?? '';
  if (fractionPart.length > fractionDigits) {
    return {
      ok: false,
      error: `${currency} supports at most ${fractionDigits} fractional digit${fractionDigits === 1 ? '' : 's'}.`,
    };
  }

  const factor = 10n ** BigInt(fractionDigits);
  const paddedFraction = fractionPart.padEnd(fractionDigits, '0');
  const minor = BigInt(integerPart) * factor + BigInt(paddedFraction || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: 'Commercial value exceeds the safe supported range.' };
  }

  return {
    ok: true,
    value: {
      commercialValueMinor: Number(minor),
      commercialCurrency: currency,
    },
  };
}

export function commercialValueInputFromMinor(
  minor: number | null | undefined,
  currency: string | null | undefined,
): { amount: string; currency: string } {
  const normalized = currency ? normalizeCurrencyCode(currency) : '';
  const fractionDigits = currencyFractionDigits(normalized);
  if (
    minor === null ||
    minor === undefined ||
    !Number.isSafeInteger(minor) ||
    minor < 0 ||
    fractionDigits === null
  ) {
    return { amount: '', currency: '' };
  }

  const factor = 10n ** BigInt(fractionDigits);
  const value = BigInt(minor);
  const integerPart = value / factor;
  if (fractionDigits === 0) return { amount: integerPart.toString(), currency: normalized };
  const fractionPart = (value % factor).toString().padStart(fractionDigits, '0');
  return { amount: `${integerPart}.${fractionPart}`, currency: normalized };
}

export function formatCommercialValue(
  minor: number | null | undefined,
  currency: string | null | undefined,
  locale = 'en-AE',
): string {
  const input = commercialValueInputFromMinor(minor, currency);
  if (!input.amount || !input.currency) return 'Not set';

  const fractionDigits = currencyFractionDigits(input.currency);
  if (fractionDigits === null || minor === null || minor === undefined) return 'Not set';

  const factor = 10n ** BigInt(fractionDigits);
  const value = BigInt(minor);
  const integerPart = value / factor;
  const fractionPart = (value % factor).toString().padStart(fractionDigits, '0');
  const groupedInteger = new Intl.NumberFormat(locale, {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(integerPart);
  let integerWritten = false;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: input.currency,
    currencyDisplay: 'code',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
    .formatToParts(0)
    .map((part) => {
      if (part.type === 'integer') {
        if (integerWritten) return '';
        integerWritten = true;
        return groupedInteger;
      }
      if (part.type === 'group') return '';
      if (part.type === 'decimal') return fractionDigits ? part.value : '';
      if (part.type === 'fraction') return fractionPart;
      return part.value;
    })
    .join('');
}
