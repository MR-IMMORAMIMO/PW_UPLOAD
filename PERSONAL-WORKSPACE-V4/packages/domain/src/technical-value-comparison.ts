export type TechnicalComparison = 'Same' | 'Formatting only' | 'Different' | 'Not supplied';

/** Only explicit, field-specific unit spellings are interchangeable. Qualifiers and bases remain significant. */
export function compareTechnicalValue(
  field: string,
  current: string,
  imported: string,
): TechnicalComparison {
  if (!imported.trim()) return 'Not supplied';
  if (current === imported) return 'Same';
  const clean = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
  if (clean(current) === clean(imported)) return 'Formatting only';
  const units: Record<string, string> = {
    wattage: 'W',
    lumens: 'LM',
    lightColor: 'K',
    cri: '',
    beamAngle: '(?:°|DEG)',
  };
  const unit = units[field];
  if (unit !== undefined) {
    const pattern = new RegExp(`^([0-9]+(?:\\.[0-9]+)?)\\s*(?:${unit})?$`, 'i');
    const left = current.trim().match(pattern);
    const right = imported.trim().match(pattern);
    if (left && right && Number(left[1]) === Number(right[1])) return 'Formatting only';
  }
  return 'Different';
}
