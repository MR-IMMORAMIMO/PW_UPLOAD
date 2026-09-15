import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  deriveLuminaireEfficacy,
  type LuminaireLibraryAssetType,
  type LuminaireLibraryVariantDraft,
} from '@scli/domain';
import type { LuminaireLibraryProductProjection } from '@scli/api-client';
import {
  SctLibrary as BookOpen,
  SctQueue as List,
  SctRemove as Minus,
  SctIes as Waves,
} from '../../components/common/SctIcons';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Boxes,
  FileText,
  Image,
  Pencil,
  Plus,
  Search,
  Upload,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4Button } from '../../components/common/V4Button';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4Field } from '../../components/common/V4Field';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import {
  V4InspectorFrame,
  V4InspectorMetadata,
  V4InspectorSection,
} from '../../components/common/V4Inspector';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4SplitPane } from '../../components/common/V4SplitPane';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import {
  displayLuminaireTechnicalValue,
  formatLuminaireVariantSummary,
} from '../../components/common/luminaireTechnicalDisplay';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { pickWorkingFile } from '../../desktop/files';
import { LibraryFacetMenu } from './LibraryFacetMenu';
import { LibraryAddToProjectDialog } from './LibraryAddToProjectDialog';
import { LibraryMoreFilters, type MoreFilterValues } from './LibraryMoreFilters';
import './luminaireLibrary.css';
import './libraryEditors.css';

const emptyVariant: LuminaireLibraryVariantDraft = {
  variantLabel: '',
  orderingCode: '',
  wattage: '',
  lumens: '',
  lightColor: '',
  cri: '',
  beamAngle: '',
  ipRating: '',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: '',
  dimensions: '',
  bodyColorFinish: '',
};
type Editor =
  | { kind: 'manufacturer'; name: string }
  | {
      kind: 'product';
      productId: string | null;
      expectedRowVersion: number | null;
      manufacturerId: string;
      name: string;
      productType: string;
      description: string;
    }
  | {
      kind: 'variant';
      productId: string;
      variantId: string | null;
      expectedRowVersion: number | null;
      values: LuminaireLibraryVariantDraft;
    };
type AssetEditor = {
  assetId: string | null;
  assetType: LuminaireLibraryAssetType;
  variantId: string | null;
  label: string;
  expectedLatestSequence: number;
  sourceFilePath: string;
};
type LifecycleConfirmation = 'publish' | 'archive-variant' | 'archive-product';

const assetFilters: Record<
  LuminaireLibraryAssetType,
  Array<{ name: string; extensions: string[] }>
> = {
  ProductImage: [{ name: 'Product image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  Datasheet: [{ name: 'PDF datasheet', extensions: ['pdf'] }],
  IES: [{ name: 'IES photometry', extensions: ['ies'] }],
  LDT: [{ name: 'LDT photometry', extensions: ['ldt'] }],
};

const technicalFields: Array<[keyof LuminaireLibraryVariantDraft, string]> = [
  ['variantLabel', 'Variant / Configuration'],
  ['orderingCode', 'Ordering Code'],
  ['wattage', 'Wattage'],
  ['lumens', 'Lumens'],
  ['lightColor', 'CCT / Light Color'],
  ['cri', 'CRI'],
  ['beamAngle', 'Beam / Optic'],
  ['ipRating', 'IP Rating'],
  ['mounting', 'Mounting'],
  ['cutout', 'Cut-out'],
  ['driver', 'Driver'],
  ['control', 'Control'],
  ['emergency', 'Emergency'],
  ['bodyColorFinish', 'Finish'],
  ['dimensions', 'Dimensions'],
];

function variantSummary(variant: LuminaireLibraryVariantDraft): string {
  return formatLuminaireVariantSummary(variant);
}

function editableVariantDraft(variant: LuminaireLibraryVariantDraft): LuminaireLibraryVariantDraft {
  return Object.fromEntries(
    technicalFields.map(([field]) => [field, variant[field]]),
  ) as unknown as LuminaireLibraryVariantDraft;
}

function hasUnpublishedChanges(
  projection: LuminaireLibraryProductProjection,
  entry: LuminaireLibraryProductProjection['variants'][number],
): boolean {
  const snapshot = entry.latestVersion?.snapshot;
  if (!snapshot) return true;
  if (
    snapshot.manufacturerId !== projection.manufacturer.manufacturerId ||
    snapshot.productName !== projection.product.name ||
    snapshot.productType !== projection.product.productType ||
    snapshot.technicalDescription !== projection.product.description
  )
    return true;
  return technicalFields.some(([field]) => entry.variant[field] !== snapshot[field]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

function duplicateConflictDetails(error: unknown): {
  productId: string;
  variantId: string;
  manufacturerName: string;
  productName: string;
  orderingCode: string;
} | null {
  if (!error || typeof error !== 'object' || !('details' in error)) return null;
  const details = (error as { details?: Record<string, unknown> }).details;
  if (details?.conflictKind !== 'DUPLICATE_ORDERING_CODE') return null;
  const required = [
    'productId',
    'variantId',
    'manufacturerName',
    'productName',
    'orderingCode',
  ] as const;
  if (required.some((key) => typeof details[key] !== 'string')) return null;
  return Object.fromEntries(required.map((key) => [key, details[key]])) as {
    productId: string;
    variantId: string;
    manufacturerName: string;
    productName: string;
    orderingCode: string;
  };
}

export interface LibraryWorkspaceBinding {
  focusToken?: number;
  selectedProductId: string | null;
  selectedVariantId: string | null;
  items: LuminaireLibraryProductProjection[];
  manufacturerNames?: string[];
  loading: boolean;
  error: string | null;
  feedback: string | null;
  select: (productId: string, variantId: string | null) => void;
  newDraft: () => void;
  newManufacturer: () => void;
  newVariant: () => void;
  openDraft: () => void;
  archive: () => void;
  publish: () => void;
  retry: () => void;
  setArchived: (archived: boolean) => void;
}

export function LibraryWorkspaceController({
  renderFinal,
}: {
  renderFinal?: (binding: LibraryWorkspaceBinding) => ReactNode;
}) {
  const client = useQueryClient();
  const [routeSearchParams] = useSearchParams();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [manufacturerIds, setManufacturerIds] = useState<string[]>([]);
  const [productTypes, setProductTypes] = useState<string[]>([]);
  const [cctKelvin, setCctKelvin] = useState<string[]>([]);
  const [beam, setBeam] = useState<string[]>([]);
  const [wattageMin, setWattageMin] = useState('');
  const [wattageMax, setWattageMax] = useState('');
  const [wattageBasis, setWattageBasis] = useState<'W' | 'W_PER_M'>('W');
  const [lumensMin, setLumensMin] = useState('');
  const [lumensMax, setLumensMax] = useState('');
  const [lumensBasis, setLumensBasis] = useState<'LM' | 'LM_PER_M'>('LM');
  const [criMin, setCriMin] = useState('');
  const [ip, setIp] = useState<string[]>([]);
  const [control, setControl] = useState<string[]>([]);
  const [mounting, setMounting] = useState<string[]>([]);
  const [hasProductImage, setHasProductImage] = useState(false);
  const [hasDatasheet, setHasDatasheet] = useState(false);
  const [hasIes, setHasIes] = useState(false);
  const [hasLdt, setHasLdt] = useState(false);
  const [missingPhotometry, setMissingPhotometry] = useState(false);
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [sort, setSort] = useState<
    | 'RELEVANCE'
    | 'MANUFACTURER_ASC'
    | 'PRODUCT_ASC'
    | 'RECENTLY_UPDATED'
    | 'HIGHEST_LUMENS'
    | 'LOWEST_WATTAGE'
    | 'HIGHEST_EFFICACY'
  >('RELEVANCE');
  const [viewMode, setViewMode] = useState<'DETAILED' | 'COMPACT'>('DETAILED');
  const [libraryFacets, setLibraryFacets] = useState({
    manufacturers: [] as Array<{ value: string; label: string; count: number }>,
    productTypes: [] as Array<{ value: string; label: string; count: number }>,
    cctKelvin: [] as Array<{ value: string; label: string; count: number }>,
    beams: [] as Array<{ value: string; label: string; count: number }>,
    ipRatings: [] as Array<{ value: string; label: string; count: number }>,
    controls: [] as Array<{ value: string; label: string; count: number }>,
    mountings: [] as Array<{ value: string; label: string; count: number }>,
  });
  const [selectedProductId, setSelectedProductId] = useState<string | null>(() =>
    routeSearchParams.get('productId'),
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() =>
    routeSearchParams.get('variantId'),
  );
  const routeIdentity = routeSearchParams.toString();
  useEffect(() => {
    if (routeSearchParams.has('productId') || routeSearchParams.has('variantId')) {
      setSelectedProductId(routeSearchParams.get('productId'));
      setSelectedVariantId(routeSearchParams.get('variantId'));
    }
  }, [routeIdentity]);
  const [variantManufacturerId, setVariantManufacturerId] = useState('');
  const [focusToken, setFocusToken] = useState(0);
  const [preferredManufacturerId, setPreferredManufacturerId] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [assetEditor, setAssetEditor] = useState<AssetEditor | null>(null);
  const [addToProjectOpen, setAddToProjectOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lifecycleConfirmation, setLifecycleConfirmation] = useState<LifecycleConfirmation | null>(
    null,
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [closeAfterDiscard, setCloseAfterDiscard] = useState(false);
  const externalProceedRef = useRef<(() => void) | null>(null);
  const externalCancelRef = useRef<(() => void) | null>(null);
  const lifecycleReturnFocusRef = useRef<HTMLButtonElement>(null);
  const publishActivationRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useV4DirtySurface(Boolean((editor && editorDirty) || assetEditor), (_reason, proceed, cancel) => {
    externalProceedRef.current = proceed;
    externalCancelRef.current = cancel;
    setConfirmDiscard(true);
  });

  const manufacturers = useQuery({
    queryKey: ['v4', 'library', 'manufacturers', status],
    queryFn: async () => {
      const first = await api.luminaireLibraryManufacturers({ status, limit: '100' });
      const items = [...first.items];
      let cursor = first.nextCursor;
      const seen = new Set<string>();
      while (cursor) {
        if (seen.has(cursor)) throw new Error('Manufacturer pagination did not advance.');
        seen.add(cursor);
        const next = await api.luminaireLibraryManufacturers({ status, limit: '100', cursor });
        items.push(...next.items);
        cursor = next.nextCursor;
      }
      return { ...first, items, nextCursor: null };
    },
  });
  const filters = useMemo(
    () => ({
      includeEmptyProducts: 'true',
      search,
      manufacturerIds: manufacturerIds.length ? manufacturerIds.join(',') : undefined,
      productTypes: productTypes.length ? productTypes.join(',') : undefined,
      cctKelvin: cctKelvin.length ? cctKelvin.join(',') : undefined,
      beam: beam.length ? beam.join(',') : undefined,
      wattageMin: wattageMin || undefined,
      wattageMax: wattageMax || undefined,
      wattageBasis: wattageMin || wattageMax ? wattageBasis : undefined,
      lumensMin: lumensMin || undefined,
      lumensMax: lumensMax || undefined,
      lumensBasis: lumensMin || lumensMax ? lumensBasis : undefined,
      criMin: criMin || undefined,
      ip: ip.length ? ip.join(',') : undefined,
      control: control.length ? control.join(',') : undefined,
      mounting: mounting.length ? mounting.join(',') : undefined,
      hasProductImage: hasProductImage ? 'true' : undefined,
      hasDatasheet: hasDatasheet ? 'true' : undefined,
      hasIes: hasIes ? 'true' : undefined,
      hasLdt: hasLdt ? 'true' : undefined,
      missingPhotometry: missingPhotometry ? 'true' : undefined,
      status,
      sort,
      limit: '60',
    }),
    [
      beam,
      cctKelvin,
      control,
      criMin,
      hasDatasheet,
      hasIes,
      hasLdt,
      hasProductImage,
      ip,
      lumensBasis,
      lumensMax,
      lumensMin,
      manufacturerIds,
      missingPhotometry,
      mounting,
      productTypes,
      search,
      sort,
      status,
      wattageBasis,
      wattageMax,
      wattageMin,
    ],
  );
  const products = useQuery({
    queryKey: ['v4', 'library', 'products', filters],
    queryFn: async () => {
      const first = await api.luminaireLibraryProducts(filters);
      const items = [...first.items];
      const seen = new Set<string>();
      let cursor = first.nextCursor;
      while (cursor) {
        if (seen.has(cursor)) throw new Error('Library pagination did not advance.');
        seen.add(cursor);
        const next = await api.luminaireLibraryProducts({ ...filters, cursor });
        items.push(...next.items);
        cursor = next.nextCursor;
      }
      return { ...first, items, nextCursor: null };
    },
  });
  useEffect(() => {
    if (products.data?.facets) setLibraryFacets(products.data.facets);
  }, [products.data?.facets]);
  const selected =
    products.data?.items.find((item) => item.product.productId === selectedProductId) ??
    (selectedProductId ? null : products.data?.items[0]) ??
    null;
  const selectedVariant =
    selected?.variants.find((item) => item.variant.variantId === selectedVariantId) ??
    (selectedVariantId ? null : selected?.variants[0]) ??
    null;
  const selectedEfficacy = selectedVariant
    ? deriveLuminaireEfficacy(selectedVariant.variant.wattage, selectedVariant.variant.lumens)
    : null;
  const productDetail = useQuery({
    queryKey: ['v4', 'library', 'product', selected?.product.productId],
    queryFn: () => api.luminaireLibraryProduct(selected!.product.productId),
    enabled: Boolean(selected),
  });
  const detail = productDetail.data ?? selected;
  const versions = useQuery({
    queryKey: ['v4', 'library', 'variant', selectedVariant?.variant.variantId, 'versions'],
    queryFn: () => api.luminaireLibraryVariantVersions(selectedVariant!.variant.variantId),
    enabled: Boolean(selectedVariant),
  });
  const duplicateManufacturerId =
    editor?.kind === 'product'
      ? editor.manufacturerId
      : editor?.kind === 'variant'
        ? (products.data?.items.find((item) => item.product.productId === editor.productId)
            ?.manufacturer.manufacturerId ?? '')
        : '';
  const duplicateProductName =
    editor?.kind === 'product'
      ? editor.name
      : editor?.kind === 'variant'
        ? (products.data?.items.find((item) => item.product.productId === editor.productId)?.product
            .name ?? '')
        : '';
  const duplicateOrderingCode = editor?.kind === 'variant' ? editor.values.orderingCode.trim() : '';
  const duplicateSuggestions = useQuery({
    queryKey: [
      'v4',
      'library',
      'duplicates',
      duplicateManufacturerId,
      duplicateProductName,
      duplicateOrderingCode,
      editor?.kind === 'variant' ? editor.variantId : null,
    ],
    queryFn: () =>
      api.luminaireLibraryDuplicateSuggestions({
        manufacturerId: duplicateManufacturerId,
        productName: duplicateProductName,
        orderingCode: duplicateOrderingCode || undefined,
        excludeVariantId: editor?.kind === 'variant' ? (editor.variantId ?? undefined) : undefined,
      }),
    enabled:
      Boolean(duplicateManufacturerId) &&
      duplicateProductName.trim().length >= 2 &&
      (editor?.kind === 'product' || Boolean(duplicateOrderingCode)),
  });
  useEffect(() => {
    if (!selectedProductId && products.data?.items[0])
      setSelectedProductId(products.data.items[0].product.productId);
  }, [products.data, selectedProductId]);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['v4', 'library'] });
  };
  const save = useMutation({
    mutationFn: async (value: Editor) => {
      if (value.kind === 'manufacturer')
        return api.createLuminaireLibraryManufacturer({
          name: value.name,
          idempotencyKey: crypto.randomUUID(),
        });
      if (value.kind === 'product') {
        const fields = {
          manufacturerId: value.manufacturerId,
          name: value.name,
          productType: value.productType,
          description: value.description,
        };
        return value.productId
          ? api.updateLuminaireLibraryProduct(value.productId, {
              ...fields,
              expectedRowVersion: value.expectedRowVersion!,
            })
          : api.createLuminaireLibraryProduct({ ...fields, idempotencyKey: crypto.randomUUID() });
      }
      return value.variantId
        ? api.updateLuminaireLibraryVariant(value.variantId, {
            ...value.values,
            expectedRowVersion: value.expectedRowVersion!,
          })
        : api.createLuminaireLibraryVariant(value.productId, {
            ...value.values,
            idempotencyKey: crypto.randomUUID(),
          });
    },
    onSuccess: async (result, submitted) => {
      clearFilters();
      if (submitted.kind === 'manufacturer' && 'manufacturerId' in result)
        setPreferredManufacturerId(result.manufacturerId);
      setFocusToken((value) => value + 1);
      setSelectedVariantId(null);
      setEditorDirty(false);
      setEditor(null);
      setFeedback(
        submitted.kind === 'manufacturer'
          ? `Manufacturer ${submitted.name} saved and available in product forms.`
          : 'Library draft saved. Publish remains explicit.',
      );
      await refresh();
      if ('productId' in result) setSelectedProductId(result.productId);
      if ('variantId' in result) setSelectedVariantId(result.variantId);
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!selected || !selectedVariant) throw new Error('Select a Variant first.');
      return api.publishLuminaireLibraryVariant(selectedVariant.variant.variantId, {
        expectedProductRowVersion: selected.product.rowVersion,
        expectedVariantRowVersion: selectedVariant.variant.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async (result) => {
      setLifecycleConfirmation(null);
      setFeedback(
        result.status === 'NO_CHANGE'
          ? `No change — v${result.version.versionSequence} remains current.`
          : `Published immutable v${result.version.versionSequence}. Existing Projects were not changed.`,
      );
      await refresh();
    },
    onSettled: () => {
      publishActivationRef.current = false;
    },
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!selectedVariant) throw new Error('Select a Variant first.');
      return api.archiveLuminaireLibraryVariant(selectedVariant.variant.variantId, {
        expectedRowVersion: selectedVariant.variant.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async () => {
      setLifecycleConfirmation(null);
      setFeedback(
        'Removed from the active local Library. Existing Project schedules and published history are unchanged.',
      );
      await refresh();
    },
  });
  const archiveProduct = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Select a Product first.');
      return api.archiveLuminaireLibraryProduct(selected.product.productId, {
        expectedRowVersion: selected.product.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async () => {
      setLifecycleConfirmation(null);
      setFeedback('Product archived. Published history and linked Projects remain readable.');
      await refresh();
    },
  });
  const admitAsset = useMutation({
    mutationFn: async (value: AssetEditor) => {
      if (!selected) throw new Error('Select a Product first.');
      let assetId = value.assetId;
      if (!assetId) {
        const logical = await api.createLuminaireLibraryAsset({
          productId: selected.product.productId,
          variantId: value.variantId,
          assetType: value.assetType,
          label: value.label,
          idempotencyKey: crypto.randomUUID(),
        });
        assetId = logical.assetId;
      }
      return api.createLuminaireLibraryAssetVersion(assetId, {
        sourceFilePath: value.sourceFilePath,
        expectedLatestSequence: value.expectedLatestSequence,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async (result) => {
      setAssetEditor(null);
      setFeedback(
        `${result.fileName} admitted as immutable Asset Version v${result.versionSequence}. Publish remains explicit.`,
      );
      await refresh();
    },
  });

  const hardDuplicate = duplicateSuggestions.data?.find((item) => item.hardConflict) ?? null;
  const saveDuplicateConflict = duplicateConflictDetails(save.error);
  const resultProductCount = products.data?.totalProducts ?? products.data?.items.length ?? 0;
  const resultVariantCount =
    products.data?.totalVariants ??
    products.data?.items.reduce((count, item) => count + item.variants.length, 0) ??
    0;
  const clearFilters = () => {
    setManufacturerIds([]);
    setProductTypes([]);
    setCctKelvin([]);
    setBeam([]);
    setWattageMin('');
    setWattageMax('');
    setLumensMin('');
    setLumensMax('');
    setCriMin('');
    setIp([]);
    setControl([]);
    setMounting([]);
    setHasProductImage(false);
    setHasDatasheet(false);
    setHasIes(false);
    setHasLdt(false);
    setMissingPhotometry(false);
    setStatus('ACTIVE');
  };
  const activeFilterChips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (search)
    activeFilterChips.push({
      key: 'search',
      label: `Search: ${search}`,
      remove: () => setSearchInput(''),
    });
  for (const value of manufacturerIds) {
    const label = libraryFacets.manufacturers.find((item) => item.value === value)?.label;
    activeFilterChips.push({
      key: `manufacturer-${value}`,
      label: label ?? 'Manufacturer',
      remove: () => setManufacturerIds((current) => current.filter((item) => item !== value)),
    });
  }
  for (const value of productTypes)
    activeFilterChips.push({
      key: `type-${value}`,
      label: value,
      remove: () => setProductTypes((current) => current.filter((item) => item !== value)),
    });
  for (const value of cctKelvin)
    activeFilterChips.push({
      key: `cct-${value}`,
      label: `${value}K`,
      remove: () => setCctKelvin((current) => current.filter((item) => item !== value)),
    });
  for (const value of beam)
    activeFilterChips.push({
      key: `beam-${value}`,
      label: value,
      remove: () => setBeam((current) => current.filter((item) => item !== value)),
    });
  if (wattageMin || wattageMax)
    activeFilterChips.push({
      key: 'wattage',
      label: `${wattageMin || '0'}–${wattageMax || '∞'}${wattageBasis === 'W' ? 'W' : 'W/m'}`,
      remove: () => {
        setWattageMin('');
        setWattageMax('');
      },
    });
  if (lumensMin || lumensMax)
    activeFilterChips.push({
      key: 'lumens',
      label: `${lumensMin || '0'}–${lumensMax || '∞'}${lumensBasis === 'LM' ? 'lm' : 'lm/m'}`,
      remove: () => {
        setLumensMin('');
        setLumensMax('');
      },
    });
  if (criMin)
    activeFilterChips.push({ key: 'cri', label: `CRI ≥${criMin}`, remove: () => setCriMin('') });
  for (const value of ip)
    activeFilterChips.push({
      key: `ip-${value}`,
      label: libraryFacets.ipRatings.find((item) => item.value === value)?.label ?? value,
      remove: () => setIp((current) => current.filter((item) => item !== value)),
    });
  for (const value of control)
    activeFilterChips.push({
      key: `control-${value}`,
      label: libraryFacets.controls.find((item) => item.value === value)?.label ?? value,
      remove: () => setControl((current) => current.filter((item) => item !== value)),
    });
  for (const value of mounting)
    activeFilterChips.push({
      key: `mounting-${value}`,
      label: libraryFacets.mountings.find((item) => item.value === value)?.label ?? value,
      remove: () => setMounting((current) => current.filter((item) => item !== value)),
    });
  for (const [key, label, enabled, disable] of [
    ['image', 'Has Product Image', hasProductImage, () => setHasProductImage(false)],
    ['datasheet', 'Has Datasheet', hasDatasheet, () => setHasDatasheet(false)],
    ['ies', 'Has IES', hasIes, () => setHasIes(false)],
    ['ldt', 'Has LDT', hasLdt, () => setHasLdt(false)],
    [
      'missing-photometry',
      'Missing Photometry',
      missingPhotometry,
      () => setMissingPhotometry(false),
    ],
  ] as const) {
    if (enabled) activeFilterChips.push({ key, label, remove: disable });
  }
  if (status === 'ARCHIVED')
    activeFilterChips.push({ key: 'status', label: 'Archived', remove: () => setStatus('ACTIVE') });

  const moreFilterValues = useMemo<MoreFilterValues>(
    () => ({
      wattageMin,
      wattageMax,
      wattageBasis,
      lumensMin,
      lumensMax,
      lumensBasis,
      criMin,
      ip,
      control,
      mounting,
      hasProductImage,
      hasDatasheet,
      hasIes,
      hasLdt,
      missingPhotometry,
      status,
    }),
    [
      control,
      criMin,
      hasDatasheet,
      hasIes,
      hasLdt,
      hasProductImage,
      ip,
      lumensBasis,
      lumensMax,
      lumensMin,
      missingPhotometry,
      mounting,
      status,
      wattageBasis,
      wattageMax,
      wattageMin,
    ],
  );
  const applyMoreFilters = (values: MoreFilterValues) => {
    setWattageMin(values.wattageMin);
    setWattageMax(values.wattageMax);
    setWattageBasis(values.wattageBasis);
    setLumensMin(values.lumensMin);
    setLumensMax(values.lumensMax);
    setLumensBasis(values.lumensBasis);
    setCriMin(values.criMin);
    setIp(values.ip);
    setControl(values.control);
    setMounting(values.mounting);
    setHasProductImage(values.hasProductImage);
    setHasDatasheet(values.hasDatasheet);
    setHasIes(values.hasIes);
    setHasLdt(values.hasLdt);
    setMissingPhotometry(values.missingPhotometry);
    setStatus(values.status);
  };

  const closeEditor = () => {
    externalProceedRef.current = null;
    externalCancelRef.current = null;
    if (!editorDirty) {
      setEditorDirty(false);
      setEditor(null);
    } else {
      setConfirmDiscard(true);
    }
  };
  const editorTitle =
    editor?.kind === 'manufacturer'
      ? 'Add Manufacturer'
      : editor?.kind === 'product'
        ? editor.productId
          ? 'Edit Product Draft'
          : 'Add Library Product'
        : editor?.variantId
          ? 'Edit Variant Draft'
          : 'Add Variant Draft';

  const startAsset = (assetType: LuminaireLibraryAssetType) => {
    const variantScoped = assetType === 'IES' || assetType === 'LDT';
    if (variantScoped && !selectedVariant) {
      setFeedback('Select a Variant before adding photometry.');
      return;
    }
    setAssetEditor({
      assetId: null,
      assetType,
      variantId: variantScoped ? selectedVariant!.variant.variantId : null,
      label: `${assetType} current`,
      expectedLatestSequence: 0,
      sourceFilePath: '',
    });
  };

  return (
    <V4AppShell
      context="global"
      sidebarMode={sidebarMode}
      activeSectionId="luminaire-library"
      boundedPage
      onToggleSidebarMode={() =>
        setSidebarMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      pageHeader={
        renderFinal ? undefined : (
          <V4PageHeader
            title="Master Luminaire Library"
            description="Published technical authority for reusable lighting Products and Variants."
            icon={Boxes}
            actions={
              <div className="v4-library__header-actions">
                <V4Button
                  leadingIcon={<Plus />}
                  onClick={() => {
                    setEditor({ kind: 'manufacturer', name: '' });
                    setEditorDirty(false);
                  }}
                >
                  Manufacturer
                </V4Button>
                <V4Button
                  variant="primary"
                  leadingIcon={<Plus />}
                  onClick={() => {
                    setEditor({
                      kind: 'product',
                      productId: null,
                      expectedRowVersion: null,
                      manufacturerId:
                        preferredManufacturerId ||
                        manufacturers.data?.items[0]?.manufacturerId ||
                        '',
                      name: '',
                      productType: '',
                      description: '',
                    });
                    setEditorDirty(false);
                  }}
                >
                  Add Product
                </V4Button>
              </div>
            }
          />
        )
      }
    >
      {renderFinal ? (
        renderFinal({
          focusToken,
          selectedProductId: selected?.product.productId ?? null,
          selectedVariantId: selectedVariant?.variant.variantId ?? null,
          items: products.data?.items ?? [],
          manufacturerNames: manufacturers.data?.items.map((item) => item.name) ?? [],
          loading: products.isLoading,
          error: products.isError ? errorMessage(products.error) : null,
          feedback,
          select: (productId, variantId) => {
            setSelectedProductId(productId);
            setSelectedVariantId(variantId);
          },
          retry: () => {
            void products.refetch();
          },
          setArchived: (archived) => setStatus(archived ? 'ARCHIVED' : 'ACTIVE'),
          newManufacturer: () => {
            setEditorDirty(false);
            setEditor({ kind: 'manufacturer', name: '' });
          },
          newVariant: () => {
            if (!selected) return;
            setVariantManufacturerId(selected.manufacturer.manufacturerId);
            setEditorDirty(false);
            setEditor({
              kind: 'variant',
              productId: selected.product.productId,
              variantId: null,
              expectedRowVersion: null,
              values: { ...emptyVariant },
            });
          },
          newDraft: () => {
            setEditorDirty(false);
            setEditor({
              kind: 'product',
              productId: null,
              expectedRowVersion: null,
              manufacturerId:
                preferredManufacturerId || manufacturers.data?.items[0]?.manufacturerId || '',
              name: '',
              productType: '',
              description: '',
            });
          },
          openDraft: () => {
            if (!selected) return;
            setVariantManufacturerId(selected.manufacturer.manufacturerId);
            const values = { ...emptyVariant };
            if (selectedVariant)
              for (const [key] of technicalFields) values[key] = selectedVariant.variant[key];
            setEditorDirty(false);
            setEditor({
              kind: 'variant',
              productId: selected.product.productId,
              variantId: selectedVariant?.variant.variantId ?? null,
              expectedRowVersion: selectedVariant?.variant.rowVersion ?? null,
              values,
            });
          },
          archive: () => {
            if (selectedVariant) setLifecycleConfirmation('archive-variant');
            else if (selected) setLifecycleConfirmation('archive-product');
          },
          publish: () => {
            if (selectedVariant) setLifecycleConfirmation('publish');
          },
        })
      ) : (
        <main className="v4-library">
          <section className="v4-library__toolbar" aria-label="Luminaire Library filters">
            <label className="v4-library__search">
              <Search aria-hidden="true" />
              <input
                aria-label="Search Library"
                type="search"
                value={searchInput}
                placeholder="Search manufacturer, product, variant or ordering code…"
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <LibraryFacetMenu
              label="Manufacturer"
              values={manufacturerIds}
              options={libraryFacets.manufacturers}
              searchable
              onApply={setManufacturerIds}
            />
            <LibraryFacetMenu
              label="Product Type"
              values={productTypes}
              options={libraryFacets.productTypes}
              searchable
              onApply={setProductTypes}
            />
            <LibraryFacetMenu
              label="CCT"
              values={cctKelvin}
              options={libraryFacets.cctKelvin}
              searchable
              onApply={setCctKelvin}
            />
            <LibraryFacetMenu
              label="Beam / Optic"
              values={beam}
              options={libraryFacets.beams}
              searchable
              onApply={setBeam}
            />
            <LibraryMoreFilters
              values={moreFilterValues}
              ipOptions={libraryFacets.ipRatings}
              controlOptions={libraryFacets.controls}
              mountingOptions={libraryFacets.mountings}
              onApply={applyMoreFilters}
            />
            <div className="v4-library__result-summary" aria-live="polite">
              <p>
                <strong>{resultProductCount}</strong>{' '}
                {resultProductCount === 1 ? 'Product' : 'Products'}
                <span aria-hidden="true">·</span>
                <strong>{resultVariantCount}</strong> matching{' '}
                {resultVariantCount === 1 ? 'Variant' : 'Variants'}
              </p>
              <div className="v4-library__result-controls">
                <label>
                  <span>Sort</span>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as typeof sort)}
                  >
                    <option value="RELEVANCE">Relevance</option>
                    <option value="MANUFACTURER_ASC">Manufacturer A–Z</option>
                    <option value="PRODUCT_ASC">Product Family A–Z</option>
                    <option value="RECENTLY_UPDATED">Recently Updated</option>
                    <option value="HIGHEST_LUMENS">Highest Lumens</option>
                    <option value="LOWEST_WATTAGE">Lowest Wattage</option>
                    <option value="HIGHEST_EFFICACY">Highest Efficacy</option>
                  </select>
                </label>
                <div className="v4-library__view-modes" aria-label="Result view mode">
                  <button
                    type="button"
                    className={viewMode === 'DETAILED' ? 'is-selected' : ''}
                    aria-pressed={viewMode === 'DETAILED'}
                    onClick={() => setViewMode('DETAILED')}
                  >
                    <List aria-hidden="true" /> Detailed
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'COMPACT' ? 'is-selected' : ''}
                    aria-pressed={viewMode === 'COMPACT'}
                    onClick={() => setViewMode('COMPACT')}
                  >
                    <Minus aria-hidden="true" /> Compact
                  </button>
                </div>
              </div>
            </div>
          </section>
          {activeFilterChips.length ? (
            <section className="v4-library__active-filters" aria-label="Active Library filters">
              {activeFilterChips.map((chip) => (
                <button type="button" key={chip.key} onClick={chip.remove}>
                  {chip.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
              <button type="button" className="v4-library__clear-filters" onClick={clearFilters}>
                Clear all
              </button>
            </section>
          ) : null}
          {feedback ? (
            <div className="v4-library__feedback" role="status">
              {feedback}
              <button type="button" aria-label="Dismiss message" onClick={() => setFeedback(null)}>
                ×
              </button>
            </div>
          ) : null}
          {save.error ||
          publish.error ||
          archive.error ||
          archiveProduct.error ||
          admitAsset.error ? (
            <div className="v4-library__error" role="alert">
              <span>
                {errorMessage(
                  save.error ??
                    publish.error ??
                    archive.error ??
                    archiveProduct.error ??
                    admitAsset.error,
                )}
              </span>
              {saveDuplicateConflict ? (
                <V4Button
                  onClick={() => {
                    setSelectedProductId(saveDuplicateConflict.productId);
                    setSelectedVariantId(saveDuplicateConflict.variantId);
                    setEditorDirty(false);
                    setEditor(null);
                  }}
                >
                  Open Existing
                </V4Button>
              ) : null}
            </div>
          ) : null}
          <section
            className="v4-library__workspace"
            aria-label="Master Luminaire Library workspace"
          >
            <V4SplitPane
              collapsed={!selected}
              timeline={
                <LibraryList
                  products={products.data?.items ?? []}
                  loading={products.isLoading}
                  error={products.error}
                  selectedProductId={selected?.product.productId ?? null}
                  selectedVariantId={selectedVariant?.variant.variantId ?? null}
                  viewMode={viewMode}
                  onSelect={(productId, variantId) => {
                    setSelectedProductId(productId);
                    setSelectedVariantId(variantId);
                  }}
                  onRetry={() => void products.refetch()}
                />
              }
              inspector={
                selected ? (
                  <V4InspectorFrame
                    title={selected.product.name}
                    description={selected.manufacturer.name}
                    actions={
                      <V4StatusPill
                        variant={selected.product.status === 'ACTIVE' ? 'success' : 'inactive'}
                      >
                        {selected.product.status}
                      </V4StatusPill>
                    }
                    footer={
                      selectedVariant ? (
                        <div className="v4-library__inspector-actions">
                          <V4Button
                            leadingIcon={<BookOpen />}
                            disabled={!selectedVariant.latestVersion}
                            onClick={() => setAddToProjectOpen(true)}
                          >
                            Add to Project
                          </V4Button>
                          <V4Button
                            leadingIcon={<Pencil />}
                            onClick={() =>
                              setEditor({
                                kind: 'variant',
                                productId: selected.product.productId,
                                variantId: selectedVariant.variant.variantId,
                                expectedRowVersion: selectedVariant.variant.rowVersion,
                                values: editableVariantDraft(selectedVariant.variant),
                              })
                            }
                          >
                            Edit Draft
                          </V4Button>
                          <V4Button
                            variant="primary"
                            leadingIcon={<Upload />}
                            disabled={publish.isPending}
                            onClick={(event) => {
                              lifecycleReturnFocusRef.current = event.currentTarget;
                              setLifecycleConfirmation('publish');
                            }}
                          >
                            Publish Version
                          </V4Button>
                        </div>
                      ) : null
                    }
                  >
                    <V4InspectorSection className="v4-library__product-section">
                      <div className="v4-library__section-heading">
                        <h3>Product</h3>
                        <V4Button
                          variant="tertiary"
                          size="compact"
                          leadingIcon={<Pencil />}
                          onClick={() =>
                            setEditor({
                              kind: 'product',
                              productId: selected.product.productId,
                              expectedRowVersion: selected.product.rowVersion,
                              manufacturerId: selected.product.manufacturerId,
                              name: selected.product.name,
                              productType: selected.product.productType,
                              description: selected.product.description,
                            })
                          }
                        >
                          Edit Product
                        </V4Button>
                      </div>
                      <div className="v4-library__product-hero">
                        <LibraryImage
                          assetVersionId={
                            selectedVariant?.assetAvailability?.productImageAssetVersionId ?? null
                          }
                          label={`${selected.manufacturer.name} ${selected.product.name}`}
                          size="inspector"
                        />
                        <div className="v4-library__product-identity">
                          <small>{selected.manufacturer.name}</small>
                          <h3>{selected.product.name}</h3>
                          <p className="v4-library__product-type">
                            {selected.product.productType || 'Product type not set'}
                          </p>
                          <div className="v4-library__product-description">
                            <span>Description</span>
                            <p>{selected.product.description || '—'}</p>
                          </div>
                          <div className="v4-library__ordering-code">
                            <span>Ordering Code</span>
                            <strong>{selectedVariant?.variant.orderingCode || '—'}</strong>
                          </div>
                        </div>
                      </div>
                    </V4InspectorSection>
                    <V4InspectorSection className="v4-library__variant-selector-section">
                      <div className="v4-library__section-heading">
                        <h3>Variants</h3>
                        <V4Button
                          variant="tertiary"
                          size="compact"
                          leadingIcon={<Plus />}
                          onClick={() =>
                            setEditor({
                              kind: 'variant',
                              productId: selected.product.productId,
                              variantId: null,
                              expectedRowVersion: null,
                              values: { ...emptyVariant },
                            })
                          }
                        >
                          Add Variant
                        </V4Button>
                      </div>
                      <div className="v4-library__variant-selector">
                        {selected.variants.map((entry) => (
                          <button
                            type="button"
                            key={entry.variant.variantId}
                            className={
                              selectedVariant?.variant.variantId === entry.variant.variantId
                                ? 'is-selected'
                                : ''
                            }
                            onClick={() => setSelectedVariantId(entry.variant.variantId)}
                          >
                            <span>
                              <strong>{entry.variant.variantLabel || 'Unnamed Variant'}</strong>
                              <small>
                                {variantSummary(entry.variant) || 'Technical data pending'}
                              </small>
                            </span>
                            <V4StatusPill
                              variant={
                                entry.latestVersion && !hasUnpublishedChanges(selected, entry)
                                  ? 'info'
                                  : 'warning'
                              }
                            >
                              {entry.latestVersion
                                ? hasUnpublishedChanges(selected, entry)
                                  ? 'DRAFT CHANGES'
                                  : `v${entry.latestVersion.versionSequence}`
                                : 'DRAFT'}
                            </V4StatusPill>
                          </button>
                        ))}
                      </div>
                    </V4InspectorSection>
                    {selectedVariant ? (
                      <>
                        <V4InspectorSection title="Technical specification">
                          <V4InspectorMetadata>
                            {technicalFields
                              .filter(([key]) => key !== 'variantLabel')
                              .map(([key, label]) => (
                                <div key={key}>
                                  <dt>{label}</dt>
                                  <dd>
                                    {displayLuminaireTechnicalValue(
                                      key,
                                      selectedVariant.variant[key],
                                    )}
                                  </dd>
                                </div>
                              ))}
                            <div>
                              <dt>Efficacy</dt>
                              <dd>
                                {selectedEfficacy === null
                                  ? '—'
                                  : `${selectedEfficacy.toFixed(1)} lm/W`}
                              </dd>
                            </div>
                          </V4InspectorMetadata>
                        </V4InspectorSection>
                        <V4InspectorSection title="Assets">
                          <div className="v4-library__asset-badges v4-library__asset-badges--inspector">
                            {(
                              [
                                ['IMG', selectedVariant.assetAvailability.hasProductImage],
                                ['PDF', selectedVariant.assetAvailability.hasDatasheet],
                                ['IES', selectedVariant.assetAvailability.hasIes],
                                ['LDT', selectedVariant.assetAvailability.hasLdt],
                              ] as const
                            ).map(([label, available]) => (
                              <span
                                key={label}
                                className={available ? 'is-available' : 'is-missing'}
                              >
                                {label}{' '}
                                {available ? (
                                  <Check aria-hidden="true" />
                                ) : (
                                  <Minus aria-hidden="true" />
                                )}
                              </span>
                            ))}
                          </div>
                          <div className="v4-library__asset-actions">
                            {(['ProductImage', 'Datasheet', 'IES', 'LDT'] as const).map((type) => (
                              <V4Button key={type} onClick={() => startAsset(type)}>
                                {type === 'ProductImage' ? (
                                  <Image />
                                ) : type === 'Datasheet' ? (
                                  <FileText />
                                ) : (
                                  <Waves />
                                )}{' '}
                                Add {type}
                              </V4Button>
                            ))}
                          </div>
                          <div className="v4-library__asset-history">
                            {(detail?.assets ?? []).length ? (
                              detail!.assets!.map(({ asset: logical, versions: history }) => (
                                <article key={logical.assetId}>
                                  <header>
                                    <strong>{logical.assetType}</strong>
                                    <span>
                                      {logical.variantId ? 'Variant' : 'Product'} · {logical.label}
                                    </span>
                                  </header>
                                  {history.map((item) => (
                                    <div key={item.assetVersionId}>
                                      <span>
                                        v{item.versionSequence} · {item.fileName}
                                      </span>
                                      <code title={item.contentHash}>
                                        {item.contentHash.slice(0, 12)}…
                                      </code>
                                    </div>
                                  ))}
                                  <V4Button
                                    onClick={() =>
                                      setAssetEditor({
                                        assetId: logical.assetId,
                                        assetType: logical.assetType,
                                        variantId: logical.variantId,
                                        label: logical.label,
                                        expectedLatestSequence: history[0]?.versionSequence ?? 0,
                                        sourceFilePath: '',
                                      })
                                    }
                                  >
                                    Replace with New Version
                                  </V4Button>
                                </article>
                              ))
                            ) : (
                              <p>No managed assets admitted yet.</p>
                            )}
                          </div>
                        </V4InspectorSection>
                        <V4InspectorSection title="Version History">
                          <V4InspectorMetadata>
                            <div>
                              <dt>Current state</dt>
                              <dd>
                                {selectedVariant.latestVersion
                                  ? hasUnpublishedChanges(selected, selectedVariant)
                                    ? 'Draft changes over published version'
                                    : 'Published'
                                  : 'Draft only'}
                              </dd>
                            </div>
                            <div>
                              <dt>Selected version</dt>
                              <dd>
                                {selectedVariant.latestVersion
                                  ? `v${selectedVariant.latestVersion.versionSequence}`
                                  : '—'}
                              </dd>
                            </div>
                            <div>
                              <dt>Published by</dt>
                              <dd>{selectedVariant.latestVersion?.publishedByName ?? '—'}</dd>
                            </div>
                          </V4InspectorMetadata>
                          {versions.data?.length ? (
                            <ol className="v4-library__versions">
                              {versions.data.map((item) => (
                                <li key={item.versionId}>
                                  <strong>v{item.versionSequence}</strong>
                                  <span>
                                    {formatBusinessDateTime(item.publishedAt)} ·{' '}
                                    {item.publishedByName}
                                  </span>
                                  <code>{item.contentHash.slice(0, 12)}…</code>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p>Draft only — not selectable into Projects.</p>
                          )}
                        </V4InspectorSection>
                        <V4InspectorSection title="Lifecycle">
                          <p className="v4-library__lifecycle-note">
                            Archiving removes the item from active selection while preserving
                            published history and existing Project bindings.
                          </p>
                          <div className="v4-library__danger-actions">
                            <V4Button
                              variant="danger"
                              leadingIcon={<Archive />}
                              disabled={archive.isPending}
                              onClick={(event) => {
                                lifecycleReturnFocusRef.current = event.currentTarget;
                                setLifecycleConfirmation('archive-variant');
                              }}
                            >
                              Archive Variant
                            </V4Button>
                            <V4Button
                              variant="danger"
                              leadingIcon={<Archive />}
                              disabled={archiveProduct.isPending}
                              onClick={(event) => {
                                lifecycleReturnFocusRef.current = event.currentTarget;
                                setLifecycleConfirmation('archive-product');
                              }}
                            >
                              Archive Product
                            </V4Button>
                          </div>
                        </V4InspectorSection>
                      </>
                    ) : (
                      <V4InspectorSection>
                        <p>Add a Variant draft, then publish an immutable version.</p>
                      </V4InspectorSection>
                    )}
                  </V4InspectorFrame>
                ) : (
                  <span />
                )
              }
            />
          </section>
        </main>
      )}
      {addToProjectOpen && selectedVariant?.latestVersion && selected ? (
        <LibraryAddToProjectDialog
          versionId={selectedVariant.latestVersion.versionId}
          productLabel={`${selected.manufacturer.name} · ${selected.product.name}`}
          variantLabel={
            selectedVariant.variant.variantLabel || selectedVariant.variant.orderingCode
          }
          description={selected.product.description}
          onClose={() => setAddToProjectOpen(false)}
          onAdded={(message) => {
            setAddToProjectOpen(false);
            setFeedback(message);
          }}
        />
      ) : null}
      <V4FloatingWorkspace
        open={editor !== null}
        title={editorTitle}
        panelClassName={
          editor?.kind === 'manufacturer'
            ? 'v4-compact-dialog'
            : editor?.kind === 'product'
              ? 'v4-library-family-float'
              : 'v4-library-variant-float'
        }
        description={
          editor?.kind === 'manufacturer'
            ? 'Add a manufacturer to use across the Luminaire Library.'
            : 'Save updates the mutable draft only. Publishing is always a separate action.'
        }
        dismissible={!save.isPending}
        onRequestClose={closeEditor}
        bodyClassName="v4-library-workspace-body"
        footer={
          <div className="v4-library-workspace-footer">
            <p>
              {editor?.kind === 'manufacturer'
                ? 'The saved manufacturer becomes available in Library forms and filters.'
                : 'Draft changes remain private until Publish Version is confirmed.'}
            </p>
            <div>
              <V4Button variant="tertiary" onClick={closeEditor} disabled={save.isPending}>
                Cancel
              </V4Button>
              <V4Button
                variant="primary"
                disabled={
                  !editor ||
                  save.isPending ||
                  (editor.kind === 'variant' && (!editor.productId || Boolean(hardDuplicate)))
                }
                onClick={() => editor && save.mutate(editor)}
              >
                {editor?.kind === 'manufacturer' ? 'Save Manufacturer' : 'Save Draft'}
              </V4Button>
            </div>
          </div>
        }
      >
        {save.error ? (
          <div className="v4-library__error" role="alert">
            <span>{errorMessage(save.error)}</span>
            {saveDuplicateConflict ? (
              <V4Button
                onClick={() => {
                  setSelectedProductId(saveDuplicateConflict.productId);
                  setSelectedVariantId(saveDuplicateConflict.variantId);
                  setEditorDirty(false);
                  setEditor(null);
                }}
              >
                Open Existing
              </V4Button>
            ) : null}
          </div>
        ) : null}
        {editor?.kind === 'manufacturer' ? (
          <V4Field label="Manufacturer Name" controlId="library-manufacturer-name" required>
            <input
              id="library-manufacturer-name"
              value={editor.name}
              onChange={(event) => {
                setEditor({ ...editor, name: event.target.value });
                setEditorDirty(true);
              }}
            />
          </V4Field>
        ) : null}
        {editor?.kind === 'product' ? (
          <div className="v4-library-editor v4-library-editor--product">
            <V4Field label="Manufacturer" controlId="library-product-manufacturer" required>
              <select
                id="library-product-manufacturer"
                value={editor.manufacturerId}
                onChange={(event) => {
                  setEditor({ ...editor, manufacturerId: event.target.value });
                  setEditorDirty(true);
                }}
              >
                {(manufacturers.data?.items ?? []).map((item) => (
                  <option key={item.manufacturerId} value={item.manufacturerId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </V4Field>
            <V4Field label="Product / Family Name" controlId="library-product-name" required>
              <input
                id="library-product-name"
                value={editor.name}
                onChange={(event) => {
                  setEditor({ ...editor, name: event.target.value });
                  setEditorDirty(true);
                }}
              />
            </V4Field>
            <V4Field label="Product Type" controlId="library-product-type">
              <input
                id="library-product-type"
                value={editor.productType}
                onChange={(event) => {
                  setEditor({ ...editor, productType: event.target.value });
                  setEditorDirty(true);
                }}
              />
            </V4Field>
            <V4Field label="Common Technical Description" controlId="library-product-description">
              <textarea
                className="v4-library-editor__common-description"
                id="library-product-description"
                rows={4}
                value={editor.description}
                onChange={(event) => {
                  setEditor({ ...editor, description: event.target.value });
                  setEditorDirty(true);
                }}
              />
            </V4Field>
            {(duplicateSuggestions.data ?? []).filter((item) => item.productId !== editor.productId)
              .length ? (
              <section
                className="v4-library-editor__duplicates"
                aria-label="Possible duplicate Library Products"
              >
                <h3>Review possible duplicates</h3>
                <p>
                  Suggestions never merge records automatically. You may review an existing Product,
                  keep this draft separate, or cancel.
                </p>
                {duplicateSuggestions
                  .data!.filter((item) => item.productId !== editor.productId)
                  .map((item) => (
                    <div key={`${item.productId}:${item.variantId ?? ''}`}>
                      <V4StatusPill variant={item.strength === 'Strong' ? 'warning' : 'info'}>
                        {item.strength}
                      </V4StatusPill>
                      <span>{item.reason}</span>
                      <V4Button
                        onClick={() => {
                          clearFilters();
                          setSelectedVariantId(item.variantId ?? null);
                          setFocusToken((value) => value + 1);
                          setSelectedProductId(item.productId);
                          setEditorDirty(false);
                          setEditor(null);
                        }}
                      >
                        Review Existing
                      </V4Button>
                    </div>
                  ))}
              </section>
            ) : null}
          </div>
        ) : null}
        {editor?.kind === 'variant' ? (
          <div className="v4-library-editor v4-library-editor--technical">
            <V4Field label="Manufacturer" controlId="library-variant-manufacturer" required>
              <select
                id="library-variant-manufacturer"
                disabled={Boolean(editor.variantId)}
                value={variantManufacturerId}
                onChange={(event) => {
                  setEditorDirty(true);
                  setVariantManufacturerId(event.target.value);
                  setEditor({
                    ...editor,
                    productId:
                      products.data?.items.find(
                        (item) => item.manufacturer.manufacturerId === event.target.value,
                      )?.product.productId ?? '',
                  });
                }}
              >
                <option value="">Select manufacturer</option>
                {(manufacturers.data?.items ?? []).map((item) => (
                  <option key={item.manufacturerId} value={item.manufacturerId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </V4Field>
            <V4Field label="Parent product" controlId="library-variant-parent" required>
              <select
                id="library-variant-parent"
                value={editor.productId}
                disabled={Boolean(editor.variantId)}
                onChange={(event) => {
                  setEditorDirty(true);
                  setEditor({ ...editor, productId: event.target.value });
                }}
              >
                {(products.data?.items ?? [])
                  .filter(
                    (item) =>
                      !variantManufacturerId ||
                      item.manufacturer.manufacturerId === variantManufacturerId,
                  )
                  .map((item) => (
                    <option key={item.product.productId} value={item.product.productId}>
                      {item.manufacturer.name} · {item.product.name}
                    </option>
                  ))}
              </select>
            </V4Field>
            {technicalFields.map(([key, label]) => {
              const controlId = `library-variant-${key}`;
              return (
                <V4Field
                  key={key}
                  label={label}
                  controlId={controlId}
                  required={key === 'variantLabel'}
                  helpText={
                    key === 'orderingCode' ? 'Manufacturer product / ordering number' : undefined
                  }
                >
                  <input
                    id={controlId}
                    list={
                      key === 'lightColor'
                        ? 'library-cct-options'
                        : key === 'beamAngle'
                          ? 'library-beam-options'
                          : key === 'mounting'
                            ? 'library-mounting-options'
                            : key === 'control'
                              ? 'library-control-options'
                              : undefined
                    }
                    value={editor.values[key]}
                    onChange={(event) => {
                      setEditor({
                        ...editor,
                        values: { ...editor.values, [key]: event.target.value },
                      });
                      setEditorDirty(true);
                    }}
                  />
                </V4Field>
              );
            })}
            <datalist id="library-cct-options">
              {libraryFacets.cctKelvin.map((item) => (
                <option key={item.value} value={item.label} />
              ))}
            </datalist>
            <datalist id="library-beam-options">
              {libraryFacets.beams.map((item) => (
                <option key={item.value} value={item.label} />
              ))}
            </datalist>
            <datalist id="library-mounting-options">
              {libraryFacets.mountings.map((item) => (
                <option key={item.value} value={item.label} />
              ))}
            </datalist>
            <datalist id="library-control-options">
              {libraryFacets.controls.map((item) => (
                <option key={item.value} value={item.label} />
              ))}
            </datalist>
            {hardDuplicate ? (
              <section
                className="v4-library-editor__duplicates"
                aria-label="Ordering code conflict"
              >
                <h3>
                  This {hardDuplicate.manufacturerName} ordering code already exists in the Master
                  Library.
                </h3>
                <p>
                  <strong>
                    {hardDuplicate.manufacturerName} · {hardDuplicate.productName}
                  </strong>
                  <br />
                  {hardDuplicate.orderingCode}
                </p>
                <V4Button
                  onClick={() => {
                    setSelectedProductId(hardDuplicate.productId);
                    setSelectedVariantId(hardDuplicate.variantId);
                    setEditorDirty(false);
                    setEditor(null);
                  }}
                >
                  Open Existing
                </V4Button>
              </section>
            ) : null}
            <div className="v4-library-editor__asset-note">
              <Upload aria-hidden="true" />
              <p>
                Product Image, Datasheet, IES and LDT admission is server-managed. Files become
                immutable Asset Versions and are selected into the next Publish.
              </p>
            </div>
          </div>
        ) : null}
      </V4FloatingWorkspace>
      <V4FloatingWorkspace
        open={assetEditor !== null}
        title={
          assetEditor?.assetId
            ? `Replace ${assetEditor.assetType}`
            : `Add ${assetEditor?.assetType ?? 'Asset'}`
        }
        description="The selected bytes are copied into managed Library storage. Each admission creates a new immutable Asset Version; publishing is separate."
        dismissible={!admitAsset.isPending}
        onRequestClose={() => setAssetEditor(null)}
        bodyClassName="v4-library-workspace-body"
        footer={
          <div className="v4-library-workspace-footer">
            <p>Admission creates an immutable Asset Version. Publishing remains separate.</p>
            <div>
              <V4Button
                variant="tertiary"
                onClick={() => setAssetEditor(null)}
                disabled={admitAsset.isPending}
              >
                Cancel
              </V4Button>
              <V4Button
                variant="primary"
                disabled={!assetEditor?.sourceFilePath || admitAsset.isPending}
                onClick={() => assetEditor && admitAsset.mutate(assetEditor)}
              >
                Admit Asset Version
              </V4Button>
            </div>
          </div>
        }
      >
        {assetEditor ? (
          <div className="v4-library-editor">
            <V4Field label="Asset Type">
              <input readOnly value={assetEditor.assetType} />
            </V4Field>
            <V4Field label="Attached To">
              {!assetEditor.assetId &&
              selectedVariant &&
              assetEditor.assetType !== 'IES' &&
              assetEditor.assetType !== 'LDT' ? (
                <select
                  value={assetEditor.variantId ? 'VARIANT' : 'PRODUCT'}
                  onChange={(event) =>
                    setAssetEditor({
                      ...assetEditor,
                      variantId:
                        event.target.value === 'VARIANT' ? selectedVariant.variant.variantId : null,
                    })
                  }
                >
                  <option value="PRODUCT">Product</option>
                  <option value="VARIANT">Selected Variant</option>
                </select>
              ) : (
                <input readOnly value={assetEditor.variantId ? 'Selected Variant' : 'Product'} />
              )}
            </V4Field>
            <V4Field label="Label">
              <input
                value={assetEditor.label}
                disabled={Boolean(assetEditor.assetId)}
                onChange={(event) => setAssetEditor({ ...assetEditor, label: event.target.value })}
              />
            </V4Field>
            <V4Field label="Selected File" required>
              <div className="v4-library__file-picker">
                <input readOnly value={assetEditor.sourceFilePath} placeholder="No file selected" />
                <V4Button
                  onClick={async () => {
                    const selectedPath = await pickWorkingFile(assetFilters[assetEditor.assetType]);
                    if (selectedPath)
                      setAssetEditor({ ...assetEditor, sourceFilePath: selectedPath });
                  }}
                >
                  Browse
                </V4Button>
              </div>
            </V4Field>
          </div>
        ) : null}
      </V4FloatingWorkspace>
      <V4ConfirmDialog
        open={lifecycleConfirmation !== null}
        title={
          lifecycleConfirmation === 'publish'
            ? 'Publish Variant Version?'
            : lifecycleConfirmation === 'archive-variant'
              ? 'Delete from Library?'
              : 'Archive this Product?'
        }
        description={
          lifecycleConfirmation === 'publish'
            ? `${selected?.product.name ?? 'Product'} · ${selectedVariant?.variant.variantLabel ?? 'Variant'}. ${
                selectedVariant?.latestVersion
                  ? technicalFields
                      .filter(
                        ([field]) =>
                          selectedVariant.variant[field] !==
                          selectedVariant.latestVersion!.snapshot[field],
                      )
                      .map(([, label]) => label)
                      .join(', ') || 'No technical field changes'
                  : 'First published version'
              }. This creates a new immutable Library version. Projects already using older versions will not change automatically.`
            : lifecycleConfirmation === 'archive-variant'
              ? 'This removes the item from the active local Library and keeps it under Archived. Copies already saved in Project schedules, their assets, and published history remain unchanged.'
              : 'The Product leaves active selection. Existing Project bindings and published history remain readable.'
        }
        cancelLabel="Cancel"
        confirmLabel={
          lifecycleConfirmation === 'publish'
            ? 'Publish Version'
            : lifecycleConfirmation === 'archive-variant'
              ? 'Delete from Library'
              : 'Archive Product'
        }
        destructive={lifecycleConfirmation !== 'publish'}
        pending={
          lifecycleConfirmation === 'publish'
            ? publish.isPending
            : lifecycleConfirmation === 'archive-variant'
              ? archive.isPending
              : archiveProduct.isPending
        }
        returnFocusRef={lifecycleReturnFocusRef}
        onCancel={() => setLifecycleConfirmation(null)}
        onConfirm={() => {
          if (lifecycleConfirmation === 'publish') {
            if (publishActivationRef.current) return;
            publishActivationRef.current = true;
            publish.mutate();
          } else if (lifecycleConfirmation === 'archive-variant') archive.mutate();
          else if (lifecycleConfirmation === 'archive-product') archiveProduct.mutate();
        }}
      />
      <V4ConfirmDialog
        open={confirmDiscard}
        title="Discard Library draft changes?"
        description="Unsaved Product, Variant, or asset draft changes will be lost. Published Library history is unchanged."
        cancelLabel="Keep Editing"
        confirmLabel="Discard Changes"
        destructive
        onCancel={() => {
          externalCancelRef.current?.();
          externalProceedRef.current = null;
          externalCancelRef.current = null;
          setConfirmDiscard(false);
        }}
        onConfirm={() => {
          setCloseAfterDiscard(true);
          setConfirmDiscard(false);
        }}
        restoreFocus={!closeAfterDiscard}
        onAfterExit={() => {
          if (!closeAfterDiscard) return;
          const proceed = externalProceedRef.current;
          externalProceedRef.current = null;
          externalCancelRef.current = null;
          setCloseAfterDiscard(false);
          setEditorDirty(false);
          setEditor(null);
          setAssetEditor(null);
          proceed?.();
        }}
      />
    </V4AppShell>
  );
}

function LibraryImage({
  assetVersionId,
  label,
  size,
}: {
  assetVersionId: string | null;
  label: string;
  size: 'thumbnail' | 'inspector';
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [assetVersionId]);
  const className = `v4-library-image v4-library-image--${size}`;
  if (!assetVersionId || failed) {
    return (
      <span className={`${className} is-placeholder`} aria-label="No product image">
        <Image aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={className}>
      <img
        src={`/api/luminaire-library/assets/versions/${encodeURIComponent(assetVersionId)}/content`}
        alt={label}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function LibraryList({
  products,
  loading,
  error,
  selectedProductId,
  selectedVariantId,
  viewMode,
  onSelect,
  onRetry,
}: {
  products: LuminaireLibraryProductProjection[];
  loading: boolean;
  error: unknown;
  selectedProductId: string | null;
  selectedVariantId: string | null;
  viewMode: 'DETAILED' | 'COMPACT';
  onSelect: (productId: string, variantId: string | null) => void;
  onRetry: () => void;
}) {
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedProductId) return;
    setExpandedProductIds((current) => {
      if (current.has(selectedProductId)) return current;
      return new Set([...current, selectedProductId]);
    });
  }, [selectedProductId]);
  if (loading)
    return (
      <div className="v4-library__state" role="status">
        Loading Master Library…
      </div>
    );
  if (error)
    return (
      <div className="v4-library__state" role="alert">
        <p>{errorMessage(error)}</p>
        <V4Button onClick={onRetry}>Retry</V4Button>
      </div>
    );
  if (!products.length)
    return (
      <div className="v4-library__state">
        <Boxes aria-hidden="true" />
        <h2>No published Library Products match</h2>
        <p>Change the filters or add the first Product draft.</p>
      </div>
    );
  return (
    <div className={`v4-library__list is-${viewMode.toLocaleLowerCase('en')}`}>
      {products.map((item) => {
        const expanded = expandedProductIds.has(item.product.productId);
        const preferredVariant =
          item.variants.find((entry) => entry.variant.variantId === selectedVariantId) ??
          item.variants[0] ??
          null;
        const availability = {
          hasProductImage: item.variants.some((entry) => entry.assetAvailability.hasProductImage),
          hasDatasheet: item.variants.some((entry) => entry.assetAvailability.hasDatasheet),
          hasIes: item.variants.some((entry) => entry.assetAvailability.hasIes),
          hasLdt: item.variants.some((entry) => entry.assetAvailability.hasLdt),
        };
        return (
          <section key={item.product.productId} className="v4-library-product">
            <div
              className={`v4-library-product__header ${selectedProductId === item.product.productId ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                className="v4-library-product__expand"
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.manufacturer.name} ${item.product.name}`}
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedProductIds((current) => {
                    const next = new Set(current);
                    if (next.has(item.product.productId)) next.delete(item.product.productId);
                    else next.add(item.product.productId);
                    return next;
                  })
                }
              >
                {expanded ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="v4-library-product__select"
                onClick={() =>
                  onSelect(item.product.productId, item.variants[0]?.variant.variantId ?? null)
                }
              >
                <span className="v4-library-product__identity">
                  <LibraryImage
                    assetVersionId={
                      preferredVariant?.assetAvailability.productImageAssetVersionId ?? null
                    }
                    label={`${item.manufacturer.name} ${item.product.name}`}
                    size="thumbnail"
                  />
                  <span>
                    <small>{item.manufacturer.name}</small>
                    <strong>{item.product.name}</strong>
                    <em>{item.product.productType || 'Product type not set'}</em>
                    <span className="v4-library-product__technical-summary">
                      {preferredVariant
                        ? variantSummary(preferredVariant.variant) || 'Technical data pending'
                        : 'Technical data pending'}
                    </span>
                  </span>
                </span>
                <span className="v4-library-product__summary">
                  <span className="v4-library-product__count">
                    <strong>{item.variants.length}</strong>
                    <small>matching {item.variants.length === 1 ? 'Variant' : 'Variants'}</small>
                  </span>
                  <span className="v4-library__asset-badges" aria-label="Asset availability">
                    {(
                      [
                        ['IMG', availability.hasProductImage],
                        ['PDF', availability.hasDatasheet],
                        ['IES', availability.hasIes],
                        ['LDT', availability.hasLdt],
                      ] as const
                    ).map(([label, available]) => (
                      <span key={label} className={available ? 'is-available' : 'is-missing'}>
                        {label}{' '}
                        {available ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </div>
            {expanded ? (
              <div className="v4-library-variants">
                <div className="v4-library-variants__scroller">
                  <table aria-label={`${item.manufacturer.name} ${item.product.name} Variants`}>
                    <thead>
                      <tr>
                        <th>Ordering Code</th>
                        <th>Wattage</th>
                        <th>Lumens</th>
                        <th>CCT</th>
                        <th>CRI</th>
                        <th>Beam / Optic</th>
                        <th>IP</th>
                        <th>Control</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.variants.map((entry) => {
                        const selected = selectedVariantId === entry.variant.variantId;
                        const status = entry.latestVersion
                          ? hasUnpublishedChanges(item, entry)
                            ? 'DRAFT CHANGES'
                            : `v${entry.latestVersion.versionSequence}`
                          : 'DRAFT';
                        const selectVariant = () =>
                          onSelect(item.product.productId, entry.variant.variantId);
                        return (
                          <tr
                            key={entry.variant.variantId}
                            className={selected ? 'is-selected' : ''}
                            aria-selected={selected}
                            tabIndex={0}
                            onClick={selectVariant}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              selectVariant();
                            }}
                          >
                            <td>
                              <strong>
                                {entry.variant.orderingCode || entry.variant.variantLabel || '—'}
                              </strong>
                              <V4StatusPill
                                variant={
                                  entry.latestVersion && !hasUnpublishedChanges(item, entry)
                                    ? 'info'
                                    : 'warning'
                                }
                              >
                                {status}
                              </V4StatusPill>
                            </td>
                            <td>
                              {displayLuminaireTechnicalValue('wattage', entry.variant.wattage)}
                            </td>
                            <td>
                              {displayLuminaireTechnicalValue('lumens', entry.variant.lumens)}
                            </td>
                            <td>
                              {displayLuminaireTechnicalValue(
                                'lightColor',
                                entry.variant.lightColor,
                              )}
                            </td>
                            <td>{displayLuminaireTechnicalValue('cri', entry.variant.cri)}</td>
                            <td>
                              {displayLuminaireTechnicalValue('beamAngle', entry.variant.beamAngle)}
                            </td>
                            <td>
                              {displayLuminaireTechnicalValue('ipRating', entry.variant.ipRating)}
                            </td>
                            <td>{entry.variant.control || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
