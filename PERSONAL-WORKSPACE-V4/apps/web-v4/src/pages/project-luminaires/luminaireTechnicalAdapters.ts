export type TechnicalAdapterState<Unit extends string = string> =
  { mode: 'standard'; value: string; unit: Unit } | { mode: 'custom'; value: string };

const numericValue = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseUnitValue<Unit extends string>(
  raw: string,
  units: readonly Unit[],
  defaultUnit: Unit,
): TechnicalAdapterState<Unit> {
  const source = raw.trim();
  if (!source) return { mode: 'standard', value: '', unit: defaultUnit };
  const unitPattern = [...units]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');
  const match = source.match(new RegExp(`^(${numericValue})\\s*(${unitPattern})$`, 'i'));
  if (!match) {
    const numberOnly = source.match(new RegExp(`^(${numericValue})$`));
    return numberOnly
      ? { mode: 'standard', value: numberOnly[1] ?? '', unit: defaultUnit }
      : { mode: 'custom', value: raw };
  }
  const matchedUnit = match[2] ?? '';
  const unit = units.find((candidate) => candidate.toLowerCase() === matchedUnit.toLowerCase());
  return unit ? { mode: 'standard', value: match[1] ?? '', unit } : { mode: 'custom', value: raw };
}

export function formatUnitValue<Unit extends string>(state: TechnicalAdapterState<Unit>): string {
  if (state.mode === 'custom') return state.value;
  const value = state.value.trim();
  return value ? `${value} ${state.unit}` : '';
}

export function parseCct(raw: string): TechnicalAdapterState<'K'> {
  const source = raw.trim();
  if (!source) return { mode: 'standard', value: '', unit: 'K' };
  const match = source.match(new RegExp(`^(${numericValue})\\s*K$`, 'i'));
  const numberOnly = source.match(new RegExp(`^(${numericValue})$`));
  return match || numberOnly
    ? { mode: 'standard', value: (match ?? numberOnly)?.[1] ?? '', unit: 'K' }
    : { mode: 'custom', value: raw };
}

export function formatCct(state: TechnicalAdapterState<'K'>): string {
  return formatUnitValue(state);
}

export function parseBeam(raw: string): TechnicalAdapterState<'°'> {
  const source = raw.trim();
  if (!source) return { mode: 'standard', value: '', unit: '°' };
  const match = source.match(new RegExp(`^(${numericValue})\\s*°?$`));
  return match
    ? { mode: 'standard', value: match[1] ?? '', unit: '°' }
    : { mode: 'custom', value: raw };
}

export function formatBeam(state: TechnicalAdapterState<'°'>): string {
  if (state.mode === 'custom') return state.value;
  const value = state.value.trim();
  return value ? `${value}°` : '';
}

export function parseIpRating(raw: string): TechnicalAdapterState<'IP'> {
  const source = raw.trim();
  if (!source) return { mode: 'standard', value: '', unit: 'IP' };
  const match = source.match(/^(?:IP\s*)?(\d{1,3})$/i);
  return match
    ? { mode: 'standard', value: match[1] ?? '', unit: 'IP' }
    : { mode: 'custom', value: raw };
}

export function formatIpRating(state: TechnicalAdapterState<'IP'>): string {
  if (state.mode === 'custom') return state.value;
  const value = state.value.trim().replace(/^IP\s*/i, '');
  return value ? `IP${value}` : '';
}

export function parseCri(raw: string): string {
  return raw.trim().replace(/^CRI\s*/i, '');
}

export function formatCri(value: string): string {
  const next = value.trim().replace(/^CRI\s*/i, '');
  return next ? `CRI ${next}` : '';
}
