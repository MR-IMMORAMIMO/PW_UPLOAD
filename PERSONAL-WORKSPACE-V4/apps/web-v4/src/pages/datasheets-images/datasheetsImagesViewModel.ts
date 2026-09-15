import type { LuminaireAssetSummary, LuminaireRecord } from '@scli/domain';

export type AssetFilter = 'all' | 'missing' | 'missing-datasheet' | 'missing-image' | 'complete';

export interface LuminaireAssetRow {
  luminaire: LuminaireRecord;
  assets: LuminaireAssetSummary;
}

export function assetRows(
  luminaires: readonly LuminaireRecord[],
  summaries: readonly LuminaireAssetSummary[],
): LuminaireAssetRow[] {
  const byLuminaire = new Map(summaries.map((summary) => [summary.luminaireId, summary]));
  return luminaires.map((luminaire) => ({
    luminaire,
    assets: byLuminaire.get(luminaire.id) ?? {
      luminaireId: luminaire.id,
      datasheet: null,
      productImage: null,
    },
  }));
}

export function assetCounts(rows: readonly LuminaireAssetRow[]) {
  return {
    missingDatasheets: rows.filter((row) => !row.assets.datasheet).length,
    missingImages: rows.filter((row) => !row.assets.productImage).length,
    complete: rows.filter((row) => row.assets.datasheet && row.assets.productImage).length,
  };
}

export function filterAssetRows(
  rows: readonly LuminaireAssetRow[],
  query: string,
  filter: AssetFilter,
): LuminaireAssetRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const matchesQuery =
      !needle ||
      [
        row.luminaire.tag,
        row.luminaire.category,
        row.luminaire.manufacturer,
        row.luminaire.model,
        row.luminaire.description,
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    if (!matchesQuery) return false;
    if (filter === 'missing') return !row.assets.datasheet || !row.assets.productImage;
    if (filter === 'missing-datasheet') return !row.assets.datasheet;
    if (filter === 'missing-image') return !row.assets.productImage;
    if (filter === 'complete') return Boolean(row.assets.datasheet && row.assets.productImage);
    return true;
  });
}
