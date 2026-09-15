import type { LuminaireRecord } from '@scli/domain';

export type LuminaireCompleteness = 'Complete' | 'Missing DS' | 'Review';
export type LuminaireFilter =
  'all' | 'category' | 'missing-datasheet' | 'missing-image' | 'complete-assets';

const technicalFields: Array<keyof LuminaireRecord> = [
  'manufacturer',
  'model',
  'wattage',
  'lightColor',
  'beamAngle',
  'ipRating',
  'mounting',
];

export function luminaireCompleteness(item: LuminaireRecord): LuminaireCompleteness {
  if (!item.datasheetPath.trim()) return 'Missing DS';
  if (!item.imagePath.trim() || technicalFields.some((field) => !String(item[field]).trim())) {
    return 'Review';
  }
  return 'Complete';
}

export function luminaireIdentity(item: LuminaireRecord): string {
  return [item.manufacturer.trim(), item.model.trim()].filter(Boolean).join(' - ') || 'Luminaire';
}

export function luminaireFileName(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).at(-1) ?? value;
}

export function luminaireImageSource(value: string): string {
  const path = value.trim();
  if (!path || /^(https?:|data:|blob:|\/)/i.test(path)) return path;
  if (/^[a-z]:[\\/]/i.test(path)) return encodeURI(`file:///${path.replaceAll('\\', '/')}`);
  return encodeURI(path.replaceAll('\\', '/'));
}

export function filterLuminaires(
  items: readonly LuminaireRecord[],
  query: string,
  filter: LuminaireFilter,
  category: string,
): LuminaireRecord[] {
  const needle = query.trim().toLocaleLowerCase('en');
  return items.filter((item) => {
    const matchesQuery =
      !needle ||
      [item.tag, item.category, item.description, item.manufacturer, item.model, item.location]
        .join(' ')
        .toLocaleLowerCase('en')
        .includes(needle);
    if (!matchesQuery) return false;
    if (filter === 'category') return item.category === category;
    if (filter === 'missing-datasheet') return !item.datasheetPath.trim();
    if (filter === 'missing-image') return !item.imagePath.trim();
    if (filter === 'complete-assets')
      return Boolean(item.datasheetPath.trim() && item.imagePath.trim());
    return true;
  });
}

export function nextSelectionAfterDelete(
  before: readonly LuminaireRecord[],
  deletedId: string,
): string | null {
  const index = before.findIndex((item) => item.id === deletedId);
  if (index < 0) return before[0]?.id ?? null;
  return before[index + 1]?.id ?? before[index - 1]?.id ?? null;
}
