import type { LuminaireLibraryVariantDraft } from '@scli/domain';

export type LuminaireTechnicalDisplayOptions = {
  wattageBasis?: 'W' | 'W_PER_M' | null;
  lumensBasis?: 'LM' | 'LM_PER_M' | null;
};

const numericValue = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';

function compactNumber(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : value;
}

function formatMeasuredValue(
  raw: string,
  units: { base: string; perMetre: string },
  defaultPerMetre: boolean,
): string {
  const source = raw.trim();
  if (!source) return '';
  const match = source.match(
    new RegExp(`^(${numericValue})\\s*(${units.base}|${units.base}\\s*\\/\\s*m)?$`, 'i'),
  );
  if (!match) return source;
  const value = compactNumber(match[1] ?? '');
  const explicitUnit = (match[2] ?? '').replace(/\s/g, '').toLocaleLowerCase('en');
  const perMetre = explicitUnit.endsWith('/m') || (!explicitUnit && defaultPerMetre);
  return `${value} ${perMetre ? units.perMetre : units.base}`;
}

export function formatLuminaireWattage(raw: string, basis: 'W' | 'W_PER_M' | null = null): string {
  return formatMeasuredValue(raw, { base: 'W', perMetre: 'W/m' }, basis === 'W_PER_M');
}

export function formatLuminaireLumens(raw: string, basis: 'LM' | 'LM_PER_M' | null = null): string {
  return formatMeasuredValue(raw, { base: 'lm', perMetre: 'lm/m' }, basis === 'LM_PER_M');
}

export function formatLuminaireCct(raw: string): string {
  const source = raw.trim();
  if (!source) return '';
  const match = source.match(new RegExp(`^(${numericValue})\\s*K?$`, 'i'));
  return match ? `${compactNumber(match[1] ?? '')} K` : source;
}

export function formatLuminaireCri(raw: string): string {
  const source = raw.trim();
  if (!source) return '';
  const withoutPrefix = source.replace(/^(?:CRI\s*)+/i, '').trim();
  return new RegExp(`^${numericValue}$`).test(withoutPrefix) ? `CRI ${withoutPrefix}` : source;
}

export function formatLuminaireBeam(raw: string): string {
  const source = raw.trim();
  if (!source) return '';
  const match = source.match(new RegExp(`^(${numericValue})\\s*(?:°|deg(?:ree)?s?)?$`, 'i'));
  return match ? `${compactNumber(match[1] ?? '')}°` : source;
}

export function formatLuminaireIp(raw: string): string {
  const source = raw.trim();
  if (!source) return '';
  const match = source.match(/^(?:IP\s*)?(\d{1,3}[A-Z]?)$/i);
  return match ? `IP${(match[1] ?? '').toLocaleUpperCase('en')}` : source;
}

function normalizedField(field: string): string {
  return field.replace(/[^a-z]/gi, '').toLocaleLowerCase('en');
}

export function formatLuminaireTechnicalValue(
  field: string,
  raw: string,
  options: LuminaireTechnicalDisplayOptions = {},
): string {
  switch (normalizedField(field)) {
    case 'power':
    case 'wattage':
      return formatLuminaireWattage(raw, options.wattageBasis ?? null);
    case 'lumens':
    case 'luminousflux':
      return formatLuminaireLumens(raw, options.lumensBasis ?? null);
    case 'cct':
    case 'cctlightcolor':
    case 'lightcolor':
      return formatLuminaireCct(raw);
    case 'cri':
      return formatLuminaireCri(raw);
    case 'beam':
    case 'beamangle':
    case 'beamoptic':
      return formatLuminaireBeam(raw);
    case 'ip':
    case 'iprating':
      return formatLuminaireIp(raw);
    default:
      return raw.trim();
  }
}

export function displayLuminaireTechnicalValue(
  field: string,
  raw: string,
  options: LuminaireTechnicalDisplayOptions = {},
): string {
  return formatLuminaireTechnicalValue(field, raw, options) || '—';
}

export function formatLuminaireVariantSummary(
  variant: Pick<
    LuminaireLibraryVariantDraft,
    'wattage' | 'lumens' | 'lightColor' | 'cri' | 'beamAngle' | 'control'
  >,
  options: LuminaireTechnicalDisplayOptions = {},
): string {
  return [
    formatLuminaireWattage(variant.wattage, options.wattageBasis ?? null),
    formatLuminaireLumens(variant.lumens, options.lumensBasis ?? null),
    formatLuminaireCct(variant.lightColor),
    formatLuminaireCri(variant.cri),
    formatLuminaireBeam(variant.beamAngle),
    variant.control.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
}
