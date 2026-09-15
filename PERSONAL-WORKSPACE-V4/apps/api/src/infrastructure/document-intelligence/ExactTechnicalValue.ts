/** A range, tolerance, list, or capability is not an exact supplied specification. */
export function exactTechnicalNumber(field: string, value: unknown): number | null {
  let text = String(value ?? '')
    .normalize('NFKC')
    .trim();
  if (/^\d{1,3}(,\d{3})+(\s|$)/.test(text)) text = text.replaceAll(',', '');
  else text = text.replace(/^(\d+),(\d{1,2})(?=\s|$)/, '$1.$2');
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([a-z°]*)$/i);
  if (!match) return null;
  const unit = match[2]!.toLowerCase();
  const units: Record<string, Record<string, number>> = {
    wattage: { '': 1, w: 1, kw: 1000, mw: 0.001 },
    lumens: { '': 1, lm: 1, klm: 1000 },
    lightColor: { '': 1, k: 1 },
    beamAngle: { '': 1, '°': 1, deg: 1 },
    cri: { '': 1, ra: 1 },
  };
  const multiplier = units[field]?.[unit];
  return multiplier === undefined ? null : Number(match[1]) * multiplier;
}
