export type LibraryStaticLifecycle = 'Published' | 'Draft' | 'Needs Review' | 'Archived';

export type LibraryStaticAssetKind = 'Datasheet' | 'Product Image' | 'IES / LDT' | 'CAD / BIM';

export interface LibraryStaticVersion {
  version: string;
  state: 'Current' | 'Published' | 'Draft';
  date: string;
  actor: string;
  note: string;
}

export interface LibraryStaticProduct {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  productFamily: string;
  orderingCode: string;
  version: string;
  cct: string;
  power: string;
  ipRating: string;
  control: string;
  lifecycle: LibraryStaticLifecycle;
  updatedDate: string;
  updatedBy: string;
  description: string;
  efficacy: string;
  cri: string;
  beamAngle: string;
  cutout: string;
  lifetime: string;
  thumbnail: 'downlight' | 'linear' | 'wall' | 'square' | 'bollard';
  assets: ReadonlyArray<{ kind: LibraryStaticAssetKind; format: string }>;
  versions: ReadonlyArray<LibraryStaticVersion>;
  favorite?: boolean;
  recentlyViewed?: boolean;
}

const standardAssets: LibraryStaticProduct['assets'] = [
  { kind: 'Datasheet', format: 'PDF' },
  { kind: 'Product Image', format: 'PNG' },
  { kind: 'IES / LDT', format: 'IES' },
  { kind: 'CAD / BIM', format: 'RFA' },
];

const standardVersions: LibraryStaticProduct['versions'] = [
  {
    version: 'V1.2',
    state: 'Current',
    date: 'May 10, 2025',
    actor: 'J. Doe',
    note: 'Updated efficacy and photometric data.',
  },
  {
    version: 'V1.1',
    state: 'Draft',
    date: 'May 11, 2025',
    actor: 'M. Smith',
    note: 'Increased optical suite and fixes.',
  },
  {
    version: 'V1.0',
    state: 'Published',
    date: 'May 2, 2025',
    actor: 'M. Smith',
    note: 'Initial release.',
  },
];

export const libraryStaticSummary = {
  totalLuminaires: 126,
  publishedVariants: 128,
  drafts: 32,
  manufacturers: 24,
  needsReview: 7,
  archived: 16,
} as const;

export const libraryStaticProducts: ReadonlyArray<LibraryStaticProduct> = [
  {
    id: 'fixture-lw-dlx100',
    name: 'LumiWorks DLX100',
    category: 'Downlight',
    manufacturer: 'LumiWorks',
    productFamily: 'DLX Downlight',
    orderingCode: 'LW-DLX100-30-927',
    version: '1.2',
    cct: '2700 K',
    power: '10.5 W',
    ipRating: 'IP44',
    control: 'DALI 2',
    lifecycle: 'Published',
    updatedDate: 'May 10, 2025',
    updatedBy: 'J. Doe',
    description:
      'Compact downlight with superior visual comfort and high efficacy. Ideal for offices, retail and hospitality applications.',
    efficacy: '120 lm/W',
    cri: '90',
    beamAngle: '60°',
    cutout: 'Ø 95 mm',
    lifetime: '50,000 h',
    thumbnail: 'downlight',
    assets: standardAssets,
    versions: standardVersions,
    favorite: true,
    recentlyViewed: true,
  },
  {
    id: 'fixture-al-a-line-1200',
    name: 'Aurel A-Line 1200',
    category: 'Linear',
    manufacturer: 'Aureli Lighting',
    productFamily: 'A-Line',
    orderingCode: 'AL-1200-28-840',
    version: '1.1',
    cct: '4000 K',
    power: '28 W',
    ipRating: 'IP20',
    control: 'DALI',
    lifecycle: 'Draft',
    updatedDate: 'May 11, 2025',
    updatedBy: 'M. Smith',
    description: 'Low-glare suspended linear system with continuous optics for workplace lighting.',
    efficacy: '114 lm/W',
    cri: '80',
    beamAngle: '90°',
    cutout: 'Surface',
    lifetime: '60,000 h',
    thumbnail: 'linear',
    assets: standardAssets,
    versions: standardVersions,
    recentlyViewed: true,
  },
  {
    id: 'fixture-bl-hb2c48',
    name: 'Brightline HB2C48',
    category: 'High Bay',
    manufacturer: 'Brightline',
    productFamily: 'HBX',
    orderingCode: 'BL-HBC2-48-150-930',
    version: '2.0',
    cct: '5000 K',
    power: '150 W',
    ipRating: 'IP65',
    control: '1–10 V',
    lifecycle: 'Published',
    updatedDate: 'May 8, 2025',
    updatedBy: 'J. Doe',
    description: 'Robust high-bay optic for industrial interiors and tall-volume applications.',
    efficacy: '155 lm/W',
    cri: '80',
    beamAngle: '90°',
    cutout: 'Suspended',
    lifetime: '80,000 h',
    thumbnail: 'downlight',
    assets: standardAssets,
    versions: standardVersions,
  },
  {
    id: 'fixture-lw-wlx200',
    name: 'LumiWorks WLX200',
    category: 'Wall Light',
    manufacturer: 'LumiWorks',
    productFamily: 'WLX',
    orderingCode: 'LW-WLX200-15-830',
    version: '1.0',
    cct: '3000 K',
    power: '15 W',
    ipRating: 'IP65',
    control: 'On / Off',
    lifecycle: 'Needs Review',
    updatedDate: 'May 9, 2025',
    updatedBy: 'J. Doe',
    description: 'Architectural wall luminaire with a shielded bidirectional distribution.',
    efficacy: '93 lm/W',
    cri: '80',
    beamAngle: '2 × 45°',
    cutout: 'Surface',
    lifetime: '50,000 h',
    thumbnail: 'wall',
    assets: standardAssets,
    versions: standardVersions,
  },
  {
    id: 'fixture-nd-flo300',
    name: 'Nordlux FLO300',
    category: 'Floodlight',
    manufacturer: 'Nordlux',
    productFamily: 'FLO',
    orderingCode: 'ND-FLO300-50-840',
    version: '1.3',
    cct: '4000 K',
    power: '50 W',
    ipRating: 'IP66',
    control: 'DALI',
    lifecycle: 'Published',
    updatedDate: 'May 6, 2025',
    updatedBy: 'P. Taylor',
    description: 'Precision exterior floodlight with interchangeable distributions and tilt lock.',
    efficacy: '132 lm/W',
    cri: '80',
    beamAngle: '40°',
    cutout: 'Bracket',
    lifetime: '70,000 h',
    thumbnail: 'square',
    assets: standardAssets,
    versions: standardVersions,
    favorite: true,
  },
  {
    id: 'fixture-al-spot-85',
    name: 'Aurel Spot 85',
    category: 'Spotlight',
    manufacturer: 'Aureli Lighting',
    productFamily: 'Spot',
    orderingCode: 'AL-SP85-12-927',
    version: '0.9',
    cct: '2700 K',
    power: '12 W',
    ipRating: 'IP20',
    control: 'Phase Dim',
    lifecycle: 'Draft',
    updatedDate: 'May 7, 2025',
    updatedBy: 'M. Smith',
    description: 'Compact track spotlight for hospitality accents and high-contrast displays.',
    efficacy: '88 lm/W',
    cri: '90',
    beamAngle: '24°',
    cutout: 'Track',
    lifetime: '50,000 h',
    thumbnail: 'downlight',
    assets: standardAssets,
    versions: standardVersions,
  },
  {
    id: 'fixture-bl-blr100',
    name: 'Brightline BLR100',
    category: 'Bollard',
    manufacturer: 'Brightline',
    productFamily: 'BLR',
    orderingCode: 'BL-BLR100-9-930',
    version: '1.0',
    cct: '3000 K',
    power: '9 W',
    ipRating: 'IP65',
    control: 'On / Off',
    lifecycle: 'Published',
    updatedDate: 'May 6, 2025',
    updatedBy: 'J. Doe',
    description: 'Shielded bollard for paths, landscape edges and low-level exterior lighting.',
    efficacy: '80 lm/W',
    cri: '80',
    beamAngle: '180°',
    cutout: 'Base plate',
    lifetime: '60,000 h',
    thumbnail: 'bollard',
    assets: standardAssets,
    versions: standardVersions,
  },
  {
    id: 'fixture-lw-emr2',
    name: 'LumiWorks EMR2',
    category: 'Emergency',
    manufacturer: 'LumiWorks',
    productFamily: 'EMR',
    orderingCode: 'LW-EMR2-3W',
    version: '1.0',
    cct: '6500 K',
    power: '3 W',
    ipRating: 'IP20',
    control: 'Maintained',
    lifecycle: 'Archived',
    updatedDate: 'Apr 10, 2025',
    updatedBy: 'J. Doe',
    description:
      'Archived emergency luminaire lineage retained for historical project traceability.',
    efficacy: '70 lm/W',
    cri: '70',
    beamAngle: '120°',
    cutout: 'Recessed',
    lifetime: '30,000 h',
    thumbnail: 'linear',
    assets: standardAssets,
    versions: standardVersions,
  },
  {
    id: 'fixture-nd-linex60',
    name: 'Nordlux LINEX60',
    category: 'Linear',
    manufacturer: 'Nordlux',
    productFamily: 'LINEC',
    orderingCode: 'ND-LX60-28-940',
    version: '1.2',
    cct: '4000 K',
    power: '20 W',
    ipRating: 'IP20',
    control: 'DALI 2',
    lifecycle: 'Needs Review',
    updatedDate: 'Apr 28, 2025',
    updatedBy: 'P. Taylor',
    description: 'Continuous linear profile with microprismatic diffuser and modular gear tray.',
    efficacy: '125 lm/W',
    cri: '90',
    beamAngle: '95°',
    cutout: '60 mm',
    lifetime: '60,000 h',
    thumbnail: 'linear',
    assets: standardAssets,
    versions: standardVersions,
  },
  {
    id: 'fixture-al-wall-graze',
    name: 'Aureli Wall Graze',
    category: 'Wall Light',
    manufacturer: 'Aureli Lighting',
    productFamily: 'Graze',
    orderingCode: 'AL-GRZ-6-830',
    version: '0.8',
    cct: '3000 K',
    power: '6 W',
    ipRating: 'IP65',
    control: 'DMX',
    lifecycle: 'Draft',
    updatedDate: 'Apr 25, 2025',
    updatedBy: 'M. Smith',
    description:
      'Miniature grazing optic for textured façades and close-offset architectural details.',
    efficacy: '75 lm/W',
    cri: '90',
    beamAngle: '10° × 60°',
    cutout: 'Surface',
    lifetime: '50,000 h',
    thumbnail: 'square',
    assets: standardAssets,
    versions: standardVersions,
  },
];

export const libraryStaticCategories = [
  ['Downlight', 42],
  ['Wall Light', 18],
  ['Linear', 16],
  ['High Bay', 12],
  ['Spotlight', 11],
  ['Floodlight', 9],
  ['Bollard', 6],
  ['Emergency', 4],
  ['Other', 10],
] as const;

export const libraryStaticManufacturers = [
  ['LumiWorks', 26],
  ['Aureli Lighting', 22],
  ['Brightline', 20],
  ['Nordlux', 18],
  ['Other', 40],
] as const;
