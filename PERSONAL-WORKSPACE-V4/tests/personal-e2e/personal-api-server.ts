import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../apps/api/src/app';
import { LuminaireLibraryAssetStorage } from '../../apps/api/src/infrastructure/luminaire-library/LuminaireLibraryAssetStorage';
import { LuminaireLibraryService } from '../../apps/api/src/infrastructure/luminaire-library/LuminaireLibraryService';
import { LuminaireLibraryStore } from '../../apps/api/src/infrastructure/luminaire-library/LuminaireLibraryStore';
import { ProjectLuminaireWriteStore } from '../../apps/api/src/infrastructure/project-luminaires/ProjectLuminaireWriteStore';
import {
  createImageOnlyDocumentPdf,
  createSearchableDocumentPdf,
} from '../../apps/api/src/infrastructure/document-intelligence/testing/DocumentIntelligenceFixture';
import {
  createDisposablePersonalRuntime,
  type DisposablePersonalRuntime,
} from '../../apps/api/src/infrastructure/startup/createDisposablePersonalRuntime';
import { createNonProductionPersonalCanonicalRegistry } from '../../apps/api/src/infrastructure/output-registry/createNonProductionPersonalCanonicalRegistry';
import { ProjectIntelligenceStore } from '../../apps/api/src/infrastructure/project-intelligence/ProjectIntelligenceStore';
import { loadConfig } from '../../packages/config/src/index';

const ROOT_PREFIX = 'scli-personal-playwright-api-';
const MARKER_PREFIX = 'scli-personal-playwright-api-run-';
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tempAuthority = realpathSync(tmpdir());

interface RuntimeEvidence {
  readonly runtimeRoot: string;
  readonly databasePath: string;
  readonly databaseExists: boolean;
  readonly backupRoot: string;
  readonly backups: string[];
}

interface RuntimeMarker {
  readonly runId: string;
  readonly state: 'starting' | 'running' | 'closed' | 'cleaned' | 'preserved' | 'failed';
  readonly runtimeRoot: string;
  readonly evidence?: RuntimeEvidence;
  readonly error?: string;
}

interface P5bOwnerUatFixtureState {
  readonly projectId: string;
  readonly existingProjectLuminaireId: string;
  readonly staleProjectLuminaireId: string;
  readonly linkedProjectLuminaireId: string;
  readonly latestVersionId: string;
  readonly olderVersionId: string;
  readonly failureVersionId: string;
  readonly failureAssetPath: string;
  readonly revisionCountBefore: number;
  readonly libraryCountsBefore: Record<string, number>;
}

interface P5cDatasheetFixtureState {
  readonly projectId: string;
  readonly luminaireId: string;
  readonly assetVersionId: string;
}

interface P5cLegacyAdoptionFixtureItem {
  readonly luminaireId: string;
  readonly assetVersionId: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
}

interface P5cLegacyAdoptionFixtureState {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly items: P5cLegacyAdoptionFixtureItem[];
}

interface P5dIntelligenceFixtureState {
  readonly projectId: string;
  readonly revisionId: string;
  readonly sourceId: string;
  readonly sourceRelativePath: string;
}

function seedP5cDatasheetFixture(
  runtime: DisposablePersonalRuntime,
  runtimeRoot: string,
  projectId: string,
  corruptStoredHash = false,
): P5cDatasheetFixtureState {
  const database = runtime.store.getSharedDatabase();
  const at = new Date('2026-08-28T10:00:00.000Z');
  const writes = new ProjectLuminaireWriteStore(database, () => at);
  const assetVersionId = randomUUID();
  const relativePath = `p5c-datasheets/${assetVersionId}/A100.pdf`;
  const absolutePath = path.join(runtimeRoot, ...relativePath.split('/'));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const bytes = createSearchableDocumentPdf([
    'Product Datasheet',
    'Manufacturer: Acme Lighting',
    'Ordering Code: A100',
    'System Power: 15 W',
    'Luminaire Flux: 1200 lm',
    'CCT: 3000 K',
    'Beam Angle: 36 deg',
    'CRI: >90',
    'IP Rating: IP65',
  ]);
  writeFileSync(absolutePath, bytes);
  const luminaire = writes.create(projectId, {
    tag: 'A100-UAT',
    category: 'Downlight',
    imagePath: '',
    description: 'Disposable P5C Datasheet verification fixture',
    manufacturer: 'Acme Lighting',
    model: 'A100',
    productType: 'Downlight',
    variantLabel: '',
    orderingCode: 'A100',
    wattage: '12 W',
    lumens: '1200 lm',
    lightColor: '3000 K',
    cri: '',
    beamAngle: '24°',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: absolutePath,
    location: 'Disposable UAT',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: 'P5C Owner UAT',
    dimensions: '',
    bodyColorFinish: 'White',
  });
  database
    .prepare(
      `INSERT INTO luminaire_asset_versions
       (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
        size_bytes,file_hash,backfilled,attached_at,attached_by_id,attached_by_name_snapshot,
        locator_kind,locator_value,source_library_asset_version_id)
       VALUES (?,?,?,'Datasheet',1,?,'A100.pdf','application/pdf',?,?,0,?,NULL,NULL,
               'DATA_ROOT_RELATIVE',?,NULL)`,
    )
    .run(
      assetVersionId,
      projectId,
      luminaire.id,
      absolutePath,
      bytes.length,
      corruptStoredHash ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'),
      at.toISOString(),
      relativePath,
    );
  return { projectId, luminaireId: luminaire.id, assetVersionId };
}

async function seedP5cLegacyAdoptionFixture(
  runtime: DisposablePersonalRuntime,
  runtimeRoot: string,
  projectId: string,
): Promise<P5cLegacyAdoptionFixtureState> {
  let project = await runtime.provider.getProject(projectId);
  if (!project) throw new Error('Disposable legacy-adoption Project was not found.');
  let projectRoot = project.projectFolderPath;
  if (!projectRoot) {
    projectRoot = path.join(runtimeRoot, 'project-roots', project.projectCode);
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      path.join(projectRoot, 'PROJECT_INFO.txt'),
      `Project Code: ${project.projectCode}\nProject ID: ${project.id}\n`,
      'utf8',
    );
    project = await runtime.provider.updateProject(projectId, { projectFolderPath: projectRoot });
    runtime.store.setFolderPath(projectId, projectRoot);
  }

  const database = runtime.store.getSharedDatabase();
  const at = new Date('2026-08-28T11:00:00.000Z');
  const writes = new ProjectLuminaireWriteStore(database, () => at);
  const legacyRoot = path.join(runtimeRoot, 'legacy-datasheets', projectId);
  mkdirSync(legacyRoot, { recursive: true });
  const items: P5cLegacyAdoptionFixtureItem[] = [];

  for (let index = 0; index < 10; index += 1) {
    const number = String(index + 1).padStart(2, '0');
    const tag = `LEG-${number}`;
    const sourcePath = path.join(legacyRoot, `${tag}.pdf`);
    const bytes =
      index === 7
        ? createImageOnlyDocumentPdf(
            'PRODUCT DATASHEET MANUFACTURER LEGACY FIXTURE 08 ORDERING CODE LEGACY 08 SYSTEM POWER 19 W LUMINAIRE FLUX 1700 LM CCT 3000 K BEAM ANGLE 24 DEG CRI 90 IP RATING IP44',
          )
        : createSearchableDocumentPdf([
            'Product Datasheet',
            `Manufacturer: Legacy Fixture ${number}`,
            `Ordering Code: LEGACY-${number}`,
            `System Power: ${12 + index} W`,
            `Luminaire Flux: ${1000 + index * 100} lm`,
            'CCT: 3000 K',
            'Beam Angle: 24 deg',
            'CRI: >90',
            'IP Rating: IP44',
          ]);
    writeFileSync(sourcePath, bytes);
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const luminaire = writes.create(projectId, {
      tag,
      category: 'Downlight',
      imagePath: '',
      description: 'Disposable legacy Datasheet adoption fixture',
      manufacturer: `Legacy Fixture ${number}`,
      model: `LEGACY-${number}`,
      productType: 'Downlight',
      variantLabel: '',
      orderingCode: `LEGACY-${number}`,
      wattage: `${12 + index} W`,
      lumens: `${1000 + index * 100} lm`,
      lightColor: '3000 K',
      cri: 'CRI90',
      beamAngle: '24°',
      ipRating: 'IP44',
      mounting: 'Recessed',
      cutout: '',
      driver: 'Remote',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: sourcePath,
      location: 'Disposable UAT',
      unit: 'No.',
      quantity: 1,
      notes: '',
      sourceName: 'P5C Legacy Adoption UAT',
      dimensions: '',
      bodyColorFinish: 'White',
    });
    const assetVersionId = randomUUID();
    if (index === 0) {
      const historicalAssetVersionId = randomUUID();
      const historicalPath = path.join(legacyRoot, `${tag}-previous.pdf`);
      const historicalBytes = createSearchableDocumentPdf([
        'Historical Product Datasheet',
        'Ordering Code: LEGACY-01-PREVIOUS',
        'System Power: 10 W',
      ]);
      writeFileSync(historicalPath, historicalBytes);
      database
        .prepare(
          `INSERT INTO luminaire_asset_versions
           (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
            size_bytes,file_hash,backfilled,attached_at,attached_by_id,attached_by_name_snapshot,
            locator_kind,locator_value,source_library_asset_version_id)
           VALUES (?,?,?,'Datasheet',1,?,?,'application/pdf',?,?,1,?,NULL,NULL,
                   'LEGACY_PATH',?,NULL)`,
        )
        .run(
          historicalAssetVersionId,
          projectId,
          luminaire.id,
          historicalPath,
          `${tag}-previous.pdf`,
          historicalBytes.length,
          null,
          '2026-08-27T11:00:00.000Z',
          historicalPath,
        );
    }
    const storedHash = index < 4 ? null : sourceHash;
    database
      .prepare(
        `INSERT INTO luminaire_asset_versions
         (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
          size_bytes,file_hash,backfilled,attached_at,attached_by_id,attached_by_name_snapshot,
          locator_kind,locator_value,source_library_asset_version_id)
         VALUES (?,?,?,'Datasheet',?, ?,?,'application/pdf',?,?,1,?,NULL,NULL,
                 'LEGACY_PATH',?,NULL)`,
      )
      .run(
        assetVersionId,
        projectId,
        luminaire.id,
        index === 0 ? 2 : 1,
        sourcePath,
        `${tag}.pdf`,
        bytes.length,
        storedHash,
        at.toISOString(),
        sourcePath,
      );
    items.push({ luminaireId: luminaire.id, assetVersionId, sourcePath, sourceHash });
  }

  return { projectId, projectRoot, items };
}

async function seedP5dIntelligenceFixture(
  runtime: DisposablePersonalRuntime,
  runtimeRoot: string,
  projectId: string,
): Promise<P5dIntelligenceFixtureState> {
  const database = runtime.store.getSharedDatabase();
  const actor = (await runtime.provider.listUsers()).find((user) => user.role === 'Admin');
  if (!actor) throw new Error('Disposable P5D fixture is missing an Admin actor.');
  const at = new Date('2026-08-29T10:00:00.000Z');
  const clock = () => at;

  // Ensure the project workspace is initialized so the intelligence routes can
  // read the workspace projection.
  const project = await runtime.provider.getProject(projectId);
  if (!project) throw new Error('Disposable P5D Project was not found.');
  runtime.store.initializeProject(
    projectId,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );

  // Create a canonical Revision on the shared connection (the app auto-wires a
  // non-production registry on the same DB, so the revision is visible).
  const registry = createNonProductionPersonalCanonicalRegistry(runtime.store, { now: clock });
  const revision = registry.createRevision({
    projectId,
    projectSnapshot: {
      id: projectId,
      projectCode: project.projectCode,
      projectName: project.projectName,
      clientName: project.clientName,
      projectType: project.projectType,
      status: project.status,
      updatedAt: project.updatedAt,
    },
    luminaires: [],
    createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
  });

  // Register a controlled source file under the project root.
  const projectRoot = path.join(runtimeRoot, 'project-roots', project.projectCode);
  mkdirSync(projectRoot, { recursive: true });
  const sourceRelativePath = 'plan.dwg';
  const sourceAbsolutePath = path.join(projectRoot, sourceRelativePath);
  const sourceBytes = Buffer.from('P5D controlled source fixture');
  writeFileSync(sourceAbsolutePath, sourceBytes);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const sourceStore = new ProjectIntelligenceStore(database, 'LEGACY_SELF_MANAGED');
  const source = sourceStore.registerSourceFile({
    projectId,
    sourceType: 'AUTOCAD',
    displayName: sourceRelativePath,
    originalRelativeLocator: sourceRelativePath,
    sha256: sourceHash,
    sizeBytes: sourceBytes.length,
    modifiedAt: at.toISOString(),
    now: at.toISOString(),
  });

  return {
    projectId,
    revisionId: revision.revisionId,
    sourceId: source.id,
    sourceRelativePath,
  };
}

async function seedP5bOwnerUatFixture(
  runtime: DisposablePersonalRuntime,
  runtimeRoot: string,
  projectId: string,
): Promise<P5bOwnerUatFixtureState> {
  const database = runtime.store.getSharedDatabase();
  const actor = (await runtime.provider.listUsers()).find((user) => user.role === 'Admin');
  if (!actor) throw new Error('Disposable Owner fixture is missing an Admin actor.');
  const clock = () => new Date('2026-08-27T09:00:00.000Z');
  const writes = new ProjectLuminaireWriteStore(database, clock);
  const baseProjectLuminaire = {
    category: 'Downlight',
    imagePath: '',
    description: 'Disposable Owner UAT fixture',
    manufacturer: 'ERCO',
    model: 'UAT',
    productType: 'Downlight',
    variantLabel: '12W 3000K',
    orderingCode: 'UAT-PROJECT',
    wattage: '12W',
    lumens: '1000 lm',
    lightColor: '3000K',
    cri: 'CRI90',
    beamAngle: '24 degrees',
    ipRating: 'IP20',
    mounting: 'Recessed',
    cutout: '90 mm',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '',
    location: 'Original location',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: 'P5B Owner UAT',
    dimensions: '100 x 120 mm',
    bodyColorFinish: 'White',
  };
  const existing = writes.create(projectId, { ...baseProjectLuminaire, tag: 'EXIST-001' });
  const stale = writes.create(projectId, { ...baseProjectLuminaire, tag: 'STALE-001' });
  writes.create(projectId, { ...baseProjectLuminaire, tag: 'DUP-001' });
  const duplicate = writes.create(projectId, {
    ...baseProjectLuminaire,
    tag: 'DUP-SEED-SECOND',
  });
  database
    .prepare('UPDATE project_luminaires SET tag = ? WHERE id = ? AND project_id = ?')
    .run(' dup-001 ', duplicate.id, projectId);

  const libraryStore = new LuminaireLibraryStore(database, clock);
  const library = new LuminaireLibraryService(
    libraryStore,
    new LuminaireLibraryAssetStorage(runtimeRoot),
    clock,
  );
  const manufacturer =
    libraryStore
      .listManufacturers({ search: 'ERCO', status: 'ACTIVE', limit: 25 })
      .items.find((candidate) => candidate.normalizedName === 'erco') ??
    libraryStore.createManufacturer({ name: 'ERCO', idempotencyKey: 'p5b-owner-uat-maker' }, actor);
  const product = libraryStore.createProduct(
    {
      manufacturerId: manufacturer.manufacturerId,
      name: 'Owner UAT Exact Family',
      productType: 'Spotlight',
      description: 'Disposable Published Library fixture',
      idempotencyKey: 'p5b-owner-uat-product',
    },
    actor,
  );
  const variantInput = {
    variantLabel: '12W 3000K',
    orderingCode: 'UAT-EXACT',
    wattage: '12W',
    lumens: '1000 lm',
    lightColor: '3000K',
    cri: 'CRI90',
    beamAngle: '24 degrees',
    ipRating: 'IP20',
    mounting: 'Track',
    cutout: '',
    driver: 'Integral',
    control: 'DALI',
    emergency: 'No',
    dimensions: '',
    bodyColorFinish: 'White',
  };
  const variant = libraryStore.createVariant(
    product.productId,
    { ...variantInput, idempotencyKey: 'p5b-owner-uat-variant' },
    actor,
  );
  const incomingRoot = path.join(runtimeRoot, 'p5b-owner-uat-incoming');
  mkdirSync(incomingRoot, { recursive: true });
  const exactAssetPath = path.join(incomingRoot, 'exact.ies');
  writeFileSync(exactAssetPath, 'IESNA:LM-63 P5B Owner UAT exact asset');
  const exactAsset = libraryStore.createAsset(
    {
      productId: product.productId,
      variantId: variant.variantId,
      assetType: 'IES',
      label: 'Owner UAT photometry',
      idempotencyKey: 'p5b-owner-uat-exact-asset',
    },
    actor,
  );
  await library.admitAssetVersion(
    exactAsset.assetId,
    {
      sourceFilePath: exactAssetPath,
      expectedLatestSequence: 0,
      idempotencyKey: 'p5b-owner-uat-exact-asset-version',
    },
    actor,
  );
  const olderVersion = libraryStore.publishVariant(
    variant.variantId,
    {
      expectedProductRowVersion: product.rowVersion,
      expectedVariantRowVersion: variant.rowVersion,
      idempotencyKey: 'p5b-owner-uat-publish-v1',
    },
    actor,
  ).version;
  const edited = libraryStore.updateVariant(
    variant.variantId,
    { ...variantInput, wattage: '14W', expectedRowVersion: variant.rowVersion },
    actor,
  );
  const latestVersion = libraryStore.publishVariant(
    variant.variantId,
    {
      expectedProductRowVersion: product.rowVersion,
      expectedVariantRowVersion: edited.rowVersion,
      idempotencyKey: 'p5b-owner-uat-publish-v2',
    },
    actor,
  ).version;
  const linked = await library.addProjectLuminaire(
    projectId,
    {
      versionId: latestVersion.versionId,
      tag: 'LINK-001',
      category: 'Spotlight',
      location: 'Linked original',
      unit: 'No.',
      quantity: 1,
      notes: '',
      descriptionOverride: null,
      idempotencyKey: 'p5b-owner-uat-linked-row',
    },
    actor,
  );

  const failureProduct = libraryStore.createProduct(
    {
      manufacturerId: manufacturer.manufacturerId,
      name: 'Owner UAT Failure Family',
      productType: 'Spotlight',
      description: 'Disposable row-level failure fixture',
      idempotencyKey: 'p5b-owner-uat-failure-product',
    },
    actor,
  );
  const failureVariant = libraryStore.createVariant(
    failureProduct.productId,
    {
      ...variantInput,
      orderingCode: 'UAT-FAIL',
      idempotencyKey: 'p5b-owner-uat-failure-variant',
    },
    actor,
  );
  const failureIncomingPath = path.join(incomingRoot, 'failure.ies');
  writeFileSync(failureIncomingPath, 'IESNA:LM-63 P5B Owner UAT failure asset');
  const failureAsset = libraryStore.createAsset(
    {
      productId: failureProduct.productId,
      variantId: failureVariant.variantId,
      assetType: 'IES',
      label: 'Failure photometry',
      idempotencyKey: 'p5b-owner-uat-failure-asset',
    },
    actor,
  );
  const admittedFailureAsset = await library.admitAssetVersion(
    failureAsset.assetId,
    {
      sourceFilePath: failureIncomingPath,
      expectedLatestSequence: 0,
      idempotencyKey: 'p5b-owner-uat-failure-asset-version',
    },
    actor,
  );
  const failureVersion = libraryStore.publishVariant(
    failureVariant.variantId,
    {
      expectedProductRowVersion: failureProduct.rowVersion,
      expectedVariantRowVersion: failureVariant.rowVersion,
      idempotencyKey: 'p5b-owner-uat-failure-publish',
    },
    actor,
  ).version;
  const count = (table: string) =>
    Number(
      (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    );
  return {
    projectId,
    existingProjectLuminaireId: existing.id,
    staleProjectLuminaireId: stale.id,
    linkedProjectLuminaireId: linked.luminaireId,
    latestVersionId: latestVersion.versionId,
    olderVersionId: olderVersion.versionId,
    failureVersionId: failureVersion.versionId,
    failureAssetPath: path.resolve(runtimeRoot, ...admittedFailureAsset.locatorValue.split('/')),
    revisionCountBefore: count('canonical_revisions'),
    libraryCountsBefore: {
      manufacturers: count('luminaire_manufacturers'),
      products: count('luminaire_library_products'),
      variants: count('luminaire_library_variants'),
      versions: count('luminaire_library_versions'),
      assets: count('luminaire_library_assets'),
      assetVersions: count('luminaire_library_asset_versions'),
    },
  };
}

function requiredRunId(): string {
  const runId = process.env.PERSONAL_E2E_RUN_ID;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('PERSONAL_E2E_RUN_ID must be a Playwright-owned UUID.');
  }
  return runId;
}

function markerPath(runId: string): string {
  return path.join(tempAuthority, `${MARKER_PREFIX}${runId}.json`);
}

function assertOwnedRuntimeRoot(candidate: string): string {
  const resolvedRoot = realpathSync(candidate);
  if (
    path.dirname(resolvedRoot) !== tempAuthority ||
    !path.basename(resolvedRoot).startsWith(ROOT_PREFIX)
  ) {
    throw new Error(`Refusing to clean unowned Personal Playwright root: ${resolvedRoot}`);
  }
  return resolvedRoot;
}

function writeMarker(marker: RuntimeMarker): void {
  writeFileSync(markerPath(marker.runId), JSON.stringify(marker), { encoding: 'utf8', flag: 'w' });
}

function readMarker(runId: string): RuntimeMarker {
  return JSON.parse(readFileSync(markerPath(runId), 'utf8')) as RuntimeMarker;
}

function collectEvidence(runtimeRoot: string): RuntimeEvidence {
  const resolvedRoot = assertOwnedRuntimeRoot(runtimeRoot);
  const databasePath = path.join(resolvedRoot, 'workspace.sqlite');
  const backupRoot = path.join(resolvedRoot, 'backups');
  return {
    runtimeRoot: resolvedRoot,
    databasePath,
    databaseExists: existsSync(databasePath),
    backupRoot,
    backups: existsSync(backupRoot)
      ? readdirSync(backupRoot, { withFileTypes: true })
          .filter((entry) =>
            entry.isFile()
              ? entry.name.toLowerCase().endsWith('.sqlite')
              : entry.isDirectory() &&
                existsSync(path.join(backupRoot, entry.name, 'database.sqlite')),
          )
          .map((entry) => entry.name)
          .sort()
      : [],
  };
}

function assertExpectedBackupSemantics(evidence: RuntimeEvidence): void {
  if (process.env.PERSONAL_E2E_REQUIRE_FULL_BACKUPS === 'false') return;
  if (!evidence.databaseExists) throw new Error('Disposable Personal database was not created.');
  for (const reason of ['PRE_LEGACY_IMPORT', 'PRE_REMOVE_PROJECT', 'PRE_REVISION']) {
    if (!evidence.backups.some((name) => name.startsWith(`SCLI_${reason}_`))) {
      throw new Error(`Disposable Personal backup evidence is missing ${reason}.`);
    }
  }
}

async function startServer(): Promise<void> {
  const runId = requiredRunId();
  const runtimeRoot = process.env.PERSONAL_E2E_REUSE_RUNTIME_ROOT
    ? assertOwnedRuntimeRoot(process.env.PERSONAL_E2E_REUSE_RUNTIME_ROOT)
    : mkdtempSync(path.join(tempAuthority, ROOT_PREFIX));
  const databasePath = path.join(runtimeRoot, 'workspace.sqlite');
  writeMarker({ runId, state: 'starting', runtimeRoot });

  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let runtime: DisposablePersonalRuntime | undefined;
  let p5bOwnerUatFixture: P5bOwnerUatFixtureState | undefined;
  const p5cDatasheetFixtures = new Map<string, P5cDatasheetFixtureState>();
  const p5cLegacyAdoptionFixtures = new Map<string, P5cLegacyAdoptionFixtureState>();
  const p5dIntelligenceFixtures = new Map<string, P5dIntelligenceFixtureState>();
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = async (reason: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const errors: unknown[] = [];
      if (app) {
        try {
          await app.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (runtime) {
        try {
          await runtime.close();
        } catch (error) {
          errors.push(error);
        }
      }

      let evidence: RuntimeEvidence | undefined;
      try {
        evidence = collectEvidence(runtimeRoot);
        writeMarker({ runId, state: 'closed', runtimeRoot, evidence });
        console.log(`PERSONAL_E2E_DISPOSABLE_EVIDENCE ${JSON.stringify({ reason, ...evidence })}`);
        if (process.env.PERSONAL_E2E_PRESERVE_RUNTIME === 'true') {
          writeMarker({ runId, state: 'preserved', runtimeRoot, evidence });
        } else {
          rmSync(assertOwnedRuntimeRoot(runtimeRoot), { recursive: true, force: true });
          writeMarker({ runId, state: 'cleaned', runtimeRoot, evidence });
        }
      } catch (error) {
        errors.push(error);
      }

      if (errors.length > 0) {
        const failure = new AggregateError(
          errors,
          'Personal Playwright API launcher shutdown failed.',
        );
        writeMarker({ runId, state: 'failed', runtimeRoot, evidence, error: String(failure) });
        throw failure;
      }
    })();
    return shutdownPromise;
  };

  const reportShutdownFailure = (error: unknown): void => {
    console.error('PERSONAL_E2E_DISPOSABLE_SHUTDOWN_FAILED', error);
    process.exitCode = 1;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch(reportShutdownFailure);
    });
  }
  process.once('beforeExit', () => {
    void shutdown('beforeExit').catch(reportShutdownFailure);
  });

  try {
    const mockConfig = loadConfig({
      ...process.env,
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      PORT: process.env.PORT ?? '4102',
      WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4174',
      STANDALONE_DB_PATH: databasePath,
    });
    const storageConfig = loadConfig({
      ...process.env,
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      STANDALONE_DB_PATH: databasePath,
    });
    runtime = await createDisposablePersonalRuntime(storageConfig);
    app = await createApp({
      config: mockConfig,
      provider: runtime.provider,
      personalStore: runtime.store,
      workspaceBackupService: runtime.workspaceBackupService,
    });
    app.post('/api/test/p5b-owner-uat/seed', async (request, reply) => {
      if (process.env.P5B_OWNER_UAT_FIXTURE !== 'true') return reply.code(404).send();
      const body = request.body as { projectId?: unknown };
      if (typeof body.projectId !== 'string') return reply.code(400).send();
      p5bOwnerUatFixture ??= await seedP5bOwnerUatFixture(runtime!, runtimeRoot, body.projectId);
      const publicFixture = {
        projectId: p5bOwnerUatFixture.projectId,
        existingProjectLuminaireId: p5bOwnerUatFixture.existingProjectLuminaireId,
        staleProjectLuminaireId: p5bOwnerUatFixture.staleProjectLuminaireId,
        linkedProjectLuminaireId: p5bOwnerUatFixture.linkedProjectLuminaireId,
        latestVersionId: p5bOwnerUatFixture.latestVersionId,
        olderVersionId: p5bOwnerUatFixture.olderVersionId,
        failureVersionId: p5bOwnerUatFixture.failureVersionId,
        revisionCountBefore: p5bOwnerUatFixture.revisionCountBefore,
        libraryCountsBefore: p5bOwnerUatFixture.libraryCountsBefore,
      };
      return { data: publicFixture };
    });
    app.post('/api/test/p5c-datasheet-verification/seed', async (request, reply) => {
      if (process.env.P5C_DATASHEET_UAT_FIXTURE !== 'true') return reply.code(404).send();
      const body = request.body as { projectId?: unknown; corruptStoredHash?: unknown };
      if (typeof body.projectId !== 'string') return reply.code(400).send();
      let fixture = p5cDatasheetFixtures.get(body.projectId);
      if (!fixture) {
        fixture = seedP5cDatasheetFixture(
          runtime!,
          runtimeRoot,
          body.projectId,
          body.corruptStoredHash === true,
        );
        p5cDatasheetFixtures.set(body.projectId, fixture);
      }
      return { data: fixture };
    });
    app.post('/api/test/p5c-legacy-adoption/seed', async (request, reply) => {
      if (process.env.P5C_DATASHEET_UAT_FIXTURE !== 'true') return reply.code(404).send();
      const body = request.body as { projectId?: unknown };
      if (typeof body.projectId !== 'string') return reply.code(400).send();
      let fixture = p5cLegacyAdoptionFixtures.get(body.projectId);
      if (!fixture) {
        fixture = await seedP5cLegacyAdoptionFixture(runtime!, runtimeRoot, body.projectId);
        p5cLegacyAdoptionFixtures.set(body.projectId, fixture);
      }
      return {
        data: {
          projectId: fixture.projectId,
          projectRoot: fixture.projectRoot,
          items: fixture.items.map(({ luminaireId, assetVersionId }) => ({
            luminaireId,
            assetVersionId,
          })),
        },
      };
    });
    app.get('/api/test/p5c-legacy-adoption/evidence/:projectId', async (request, reply) => {
      if (process.env.P5C_DATASHEET_UAT_FIXTURE !== 'true') return reply.code(404).send();
      const { projectId } = request.params as { projectId: string };
      const fixture = p5cLegacyAdoptionFixtures.get(projectId);
      if (!fixture) return reply.code(404).send();
      const database = runtime!.store.getSharedDatabase();
      const rows = fixture.items.map((item) => {
        const current = database
          .prepare(
            `SELECT id, locator_kind, file_hash
             FROM luminaire_asset_versions
             WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'
             ORDER BY version_sequence DESC LIMIT 1`,
          )
          .get(projectId, item.luminaireId) as
          { id: string; locator_kind: string; file_hash: string | null } | undefined;
        const versionCount = Number(
          (
            database
              .prepare(
                `SELECT COUNT(*) AS count FROM luminaire_asset_versions
                 WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'`,
              )
              .get(projectId, item.luminaireId) as { count: number }
          ).count,
        );
        const sourceExists = existsSync(item.sourcePath);
        const sourceHash = sourceExists
          ? createHash('sha256').update(readFileSync(item.sourcePath)).digest('hex')
          : null;
        return {
          luminaireId: item.luminaireId,
          originalAssetVersionId: item.assetVersionId,
          currentAssetVersionId: current?.id ?? null,
          currentLocatorKind: current?.locator_kind ?? null,
          currentHash: current?.file_hash ?? null,
          versionCount,
          sourceExists,
          sourceUnchanged: sourceHash === item.sourceHash,
        };
      });
      const adoptionActivityCount = Number(
        (
          database
            .prepare(
              `SELECT COUNT(*) AS count FROM workspace_activity
               WHERE project_id=? AND action='LEGACY_DATASHEET_ADOPTED'`,
            )
            .get(projectId) as { count: number }
        ).count,
      );
      const historicalNullHashCount = Number(
        (
          database
            .prepare(
              `SELECT COUNT(*) AS count FROM luminaire_asset_versions
               WHERE project_id=? AND locator_kind='LEGACY_PATH' AND file_hash IS NULL`,
            )
            .get(projectId) as { count: number }
        ).count,
      );
      const scannedLuminaireId = fixture.items[7]!.luminaireId;
      const ocrPageCount = Number(
        (
          database
            .prepare(
              `SELECT COALESCE(SUM(a.ocr_pages),0) AS count
               FROM document_processing_attempts a
               JOIN document_versions v ON v.version_id=a.version_id
               JOIN document_sources s ON s.source_id=v.source_id
               WHERE s.luminaire_asset_version_id=(
                 SELECT id FROM luminaire_asset_versions
                 WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'
                 ORDER BY version_sequence DESC LIMIT 1
               )`,
            )
            .get(projectId, scannedLuminaireId) as { count: number }
        ).count,
      );
      return {
        data: { projectId, adoptionActivityCount, historicalNullHashCount, ocrPageCount, rows },
      };
    });
    app.post('/api/test/p5c-legacy-adoption/prepare-mixed-batch/:projectId', (request, reply) => {
      if (process.env.P5C_DATASHEET_UAT_FIXTURE !== 'true') return reply.code(404).send();
      const { projectId } = request.params as { projectId: string };
      const fixture = p5cLegacyAdoptionFixtures.get(projectId);
      if (!fixture) return reply.code(404).send();
      const hashFailureTarget = fixture.items[0]!;
      const legacyTarget = fixture.items[1]!;
      const database = runtime!.store.getSharedDatabase();
      const result = database
        .prepare(
          `UPDATE luminaire_asset_versions SET file_hash=?
           WHERE id=(SELECT id FROM luminaire_asset_versions
                     WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'
                     ORDER BY version_sequence DESC LIMIT 1)
             AND locator_kind='DATA_ROOT_RELATIVE'`,
        )
        .run('f'.repeat(64), projectId, hashFailureTarget.luminaireId);
      if (Number(result.changes) !== 1) return reply.code(409).send();
      const current = database
        .prepare(
          `SELECT MAX(version_sequence) AS sequence FROM luminaire_asset_versions
           WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'`,
        )
        .get(projectId, legacyTarget.luminaireId) as { sequence: number };
      const bytes = readFileSync(legacyTarget.sourcePath);
      const assetVersionId = randomUUID();
      database
        .prepare(
          `INSERT INTO luminaire_asset_versions
           (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
            size_bytes,file_hash,backfilled,attached_at,attached_by_id,attached_by_name_snapshot,
            locator_kind,locator_value,source_library_asset_version_id)
           VALUES (?,?,?,'Datasheet',?,?,?,'application/pdf',?,?,1,?,NULL,NULL,
                   'LEGACY_PATH',?,NULL)`,
        )
        .run(
          assetVersionId,
          projectId,
          legacyTarget.luminaireId,
          Number(current.sequence) + 1,
          legacyTarget.sourcePath,
          path.basename(legacyTarget.sourcePath),
          bytes.length,
          legacyTarget.sourceHash,
          '2026-08-28T12:00:00.000Z',
          legacyTarget.sourcePath,
        );
      database
        .prepare(
          `UPDATE project_luminaires
           SET datasheet_path=?,row_version=row_version+1,updated_at=?
           WHERE project_id=? AND id=?`,
        )
        .run(
          legacyTarget.sourcePath,
          '2026-08-28T12:00:00.000Z',
          projectId,
          legacyTarget.luminaireId,
        );
      return {
        data: {
          hashFailureLuminaireId: hashFailureTarget.luminaireId,
          legacyLuminaireId: legacyTarget.luminaireId,
        },
      };
    });
    app.post('/api/test/p5d-intelligence/seed', async (request, reply) => {
      if (process.env.P5D_INTELLIGENCE_UAT_FIXTURE !== 'true') return reply.code(404).send();
      const body = request.body as { projectId?: unknown };
      if (typeof body.projectId !== 'string') return reply.code(400).send();
      let fixture = p5dIntelligenceFixtures.get(body.projectId);
      if (!fixture) {
        fixture = await seedP5dIntelligenceFixture(runtime!, runtimeRoot, body.projectId);
        p5dIntelligenceFixtures.set(body.projectId, fixture);
      }
      return { data: fixture };
    });
    app.post('/api/test/p5b-owner-uat/mutate-stale-target', async (_request, reply) => {
      if (process.env.P5B_OWNER_UAT_FIXTURE !== 'true' || !p5bOwnerUatFixture)
        return reply.code(404).send();
      const writes = new ProjectLuminaireWriteStore(
        runtime!.store.getSharedDatabase(),
        () => new Date('2026-08-27T09:30:00.000Z'),
      );
      const target = writes.get(
        p5bOwnerUatFixture.projectId,
        p5bOwnerUatFixture.staleProjectLuminaireId,
      );
      writes.patch(
        p5bOwnerUatFixture.projectId,
        target.id,
        target.rowVersion,
        target.tag,
        [{ field: 'notes', before: target.notes, after: 'Concurrent Owner UAT edit' }],
        false,
      );
      return { data: { mutated: true } };
    });
    app.post('/api/test/p5b-owner-uat/mutate-binding-version', async (_request, reply) => {
      if (process.env.P5B_OWNER_UAT_FIXTURE !== 'true' || !p5bOwnerUatFixture)
        return reply.code(404).send();
      runtime!.store
        .getSharedDatabase()
        .prepare(
          `UPDATE project_luminaire_library_bindings
           SET row_version = row_version + 1
           WHERE project_id = ? AND luminaire_id = ?`,
        )
        .run(p5bOwnerUatFixture.projectId, p5bOwnerUatFixture.linkedProjectLuminaireId);
      return { data: { mutated: true } };
    });
    app.post('/api/test/p5b-owner-uat/remove-failure-asset', async (_request, reply) => {
      if (process.env.P5B_OWNER_UAT_FIXTURE !== 'true' || !p5bOwnerUatFixture)
        return reply.code(404).send();
      unlinkSync(p5bOwnerUatFixture.failureAssetPath);
      return { data: { removed: true } };
    });
    app.get('/api/test/p5b-owner-uat/evidence', async (_request, reply) => {
      if (process.env.P5B_OWNER_UAT_FIXTURE !== 'true' || !p5bOwnerUatFixture)
        return reply.code(404).send();
      const database = runtime!.store.getSharedDatabase();
      const count = (table: string) =>
        Number(
          (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
            .count,
        );
      return {
        data: {
          revisionCount: count('canonical_revisions'),
          libraryCounts: {
            manufacturers: count('luminaire_manufacturers'),
            products: count('luminaire_library_products'),
            variants: count('luminaire_library_variants'),
            versions: count('luminaire_library_versions'),
            assets: count('luminaire_library_assets'),
            assetVersions: count('luminaire_library_asset_versions'),
          },
          projectLuminaireCount: Number(
            (
              database
                .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
                .get(p5bOwnerUatFixture.projectId) as { count: number }
            ).count,
          ),
        },
      };
    });
    app.post('/api/test/runtime-shutdown', async (request, reply) => {
      if (request.headers['x-personal-e2e-run-id'] !== runId) return reply.code(404).send();
      setTimeout(() => void shutdown('global-teardown').catch(reportShutdownFailure), 0).unref();
      return { shutdown: true };
    });
    await app.listen({ port: mockConfig.PORT, host: '0.0.0.0' });
    writeMarker({ runId, state: 'running', runtimeRoot });
    console.log(`PERSONAL_E2E_DISPOSABLE_ROOT ${runtimeRoot}`);
  } catch (error) {
    try {
      await shutdown('startup-error');
    } catch (shutdownError) {
      throw new AggregateError(
        [error, shutdownError],
        'Personal Playwright API launcher startup and cleanup failed.',
      );
    }
    throw error;
  }
}

async function requestGracefulShutdown(runId: string): Promise<void> {
  try {
    const response = await fetch('http://127.0.0.1:4102/api/test/runtime-shutdown', {
      method: 'POST',
      headers: { 'x-personal-e2e-run-id': runId },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`Disposable API shutdown returned ${response.status}.`);
  } catch {
    // Playwright may already have stopped the server process. The guarded fallback below only
    // removes the exact marker-owned temp root after the API is confirmed unreachable.
  }
}

async function waitForCleanedMarker(runId: string): Promise<RuntimeMarker> {
  const deadline = Date.now() + 10_000;
  let marker = readMarker(runId);
  while (
    marker.state !== 'cleaned' &&
    marker.state !== 'preserved' &&
    marker.state !== 'failed' &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    marker = readMarker(runId);
  }
  return marker;
}

async function serverIsReachable(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:4102/api/health', {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function globalTeardown(): Promise<void> {
  const runId = requiredRunId();
  const ownedMarkerPath = markerPath(runId);
  if (!existsSync(ownedMarkerPath)) {
    throw new Error('Personal Playwright launcher did not publish its runtime marker.');
  }

  await requestGracefulShutdown(runId);
  let marker = await waitForCleanedMarker(runId);
  if (marker.state === 'preserved' && process.env.PERSONAL_E2E_PRESERVE_RUNTIME === 'true') {
    if (!marker.evidence) throw new Error('Preserved Owner UAT evidence was not captured.');
    assertExpectedBackupSemantics(marker.evidence);
    console.log(`PERSONAL_E2E_DISPOSABLE_PRESERVED ${JSON.stringify(marker.evidence)}`);
    rmSync(ownedMarkerPath, { force: true });
    return;
  }
  if (marker.state !== 'cleaned') {
    if (await serverIsReachable()) {
      throw new Error('Refusing fallback cleanup while the Personal API remains reachable.');
    }
    const evidence = collectEvidence(marker.runtimeRoot);
    assertExpectedBackupSemantics(evidence);
    rmSync(assertOwnedRuntimeRoot(marker.runtimeRoot), { recursive: true, force: true });
    marker = { runId, state: 'cleaned', runtimeRoot: marker.runtimeRoot, evidence };
    writeMarker(marker);
  }

  if (!marker.evidence) throw new Error('Disposable Personal runtime evidence was not captured.');
  assertExpectedBackupSemantics(marker.evidence);
  console.log(`PERSONAL_E2E_DISPOSABLE_VERIFIED ${JSON.stringify(marker.evidence)}`);
  rmSync(ownedMarkerPath, { force: true });
}

const entryPath = process.argv[1];
if (entryPath && path.resolve(entryPath) === path.resolve(fileURLToPath(import.meta.url))) {
  await startServer();
}
