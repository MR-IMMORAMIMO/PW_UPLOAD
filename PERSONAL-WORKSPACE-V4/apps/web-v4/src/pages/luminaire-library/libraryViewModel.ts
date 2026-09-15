import type { LuminaireLibraryProductProjection } from '@scli/api-client';
import { deriveLuminaireEfficacy } from '@scli/domain';
import type { LibraryStaticProduct } from './luminaireLibraryStaticFixtures';
import { formatBusinessDate } from '../../date-time/businessDateTime';

export interface LibraryProductView extends LibraryStaticProduct {
  productId: string;
  variantId: string | null;
  imageUrl: string | null;
}

export function libraryProductViews(
  items: LuminaireLibraryProductProjection[],
): LibraryProductView[] {
  return items.flatMap(({ product, manufacturer, variants }) =>
    (variants.length ? variants : [null]).map((entry) => {
      // Published technical truth comes from the immutable Version snapshot.
      const values = entry?.latestVersion?.snapshot ?? entry?.variant;
      const efficacy = values ? deriveLuminaireEfficacy(values.wattage, values.lumens) : null;
      const version = entry?.latestVersion;
      const imageId = entry?.assetAvailability.productImageAssetVersionId;
      return {
        id: entry?.variant.variantId ?? product.productId,
        productId: product.productId,
        variantId: entry?.variant.variantId ?? null,
        name: version?.snapshot.productName ?? product.name,
        category: version?.snapshot.productType ?? product.productType,
        manufacturer: version?.snapshot.manufacturerName ?? manufacturer.name,
        productFamily: version?.snapshot.productName ?? product.name,
        orderingCode: values?.orderingCode || '—',
        version: version ? `V${version.versionSequence}` : '—',
        cct: values?.lightColor || '—',
        power: values?.wattage || '—',
        ipRating: values?.ipRating || '—',
        control: values?.control || '—',
        lifecycle:
          product.status === 'ARCHIVED' || entry?.variant.status === 'ARCHIVED'
            ? 'Archived'
            : version
              ? 'Published'
              : 'Draft',
        updatedDate: formatBusinessDate(entry?.variant.updatedAt ?? product.updatedAt),
        updatedBy: entry?.variant.updatedByName ?? product.updatedByName,
        description: version?.snapshot.technicalDescription ?? product.description,
        efficacy: efficacy === null ? '—' : `${efficacy.toFixed(1)} lm/W`,
        cri: values?.cri || '—',
        beamAngle: values?.beamAngle || '—',
        cutout: values?.cutout || '—',
        lifetime: '—',
        thumbnail: 'downlight',
        imageUrl: imageId
          ? `/api/luminaire-library/assets/versions/${encodeURIComponent(imageId)}/content`
          : null,
        assets: [],
        versions: [],
      };
    }),
  );
}
