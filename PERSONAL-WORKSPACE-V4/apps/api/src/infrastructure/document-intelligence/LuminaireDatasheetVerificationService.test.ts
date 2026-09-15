import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { DocumentExtractionValue } from '@scli/domain';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { DocumentIntelligenceStore } from './DocumentIntelligenceStore';
import type { DocumentProcessingWorker } from './DocumentProcessingWorker';
import { LuminaireDatasheetVerificationService } from './LuminaireDatasheetVerificationService';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const LUMINAIRE_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-28T08:00:00.000Z');
const HASH = 'a'.repeat(64);

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  value.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION')
      value.exec('PRAGMA foreign_keys=OFF');
    value.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database: value,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => NOW },
    });
    value.exec('COMMIT; PRAGMA foreign_keys=ON');
  }
  value
    .prepare(
      `INSERT INTO project_workspaces
       (project_id,folder_path,folder_profile,services_json,input_mode,created_at,updated_at)
       VALUES (?,NULL,'DEFAULT','[]','MANUAL',?,?)`,
    )
    .run(PROJECT_ID, NOW.toISOString(), NOW.toISOString());
  const writeStore = new ProjectLuminaireWriteStore(
    value,
    () => NOW,
    () => LUMINAIRE_ID,
  );
  writeStore.create(PROJECT_ID, {
    tag: 'L01',
    category: 'Downlight',
    imagePath: '',
    description: 'Fixture',
    manufacturer: 'Acme Lighting',
    model: 'A100',
    productType: '',
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
    driver: '',
    control: '',
    emergency: '',
    datasheetPath: 'managed-datasheet.pdf',
    location: '',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: '',
    dimensions: '',
    bodyColorFinish: '',
  });
  value
    .prepare(
      `INSERT INTO luminaire_asset_versions
       (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
        size_bytes,file_hash,backfilled,attached_at,locator_kind,locator_value)
       VALUES (?,?,?,'Datasheet',1,'managed-datasheet.pdf','managed-datasheet.pdf',
               'application/pdf',42,?,0,?,'DATA_ROOT_RELATIVE','asset.pdf')`,
    )
    .run(ASSET_ID, PROJECT_ID, LUMINAIRE_ID, HASH, NOW.toISOString());
  return value;
}

function extracted(
  field: string,
  normalizedValue: string | number,
  rawValue: string,
  confidence = 96,
): DocumentExtractionValue {
  const units: Record<string, [string | null, string | null]> = {
    SYSTEM_POWER: ['W', 'LUMINAIRE_SYSTEM'],
    LUMINAIRE_FLUX: ['lm', 'LUMINAIRE_DELIVERED'],
    CCT: ['K', 'LIGHT_SOURCE'],
    BEAM_ANGLE: ['deg', 'BEAM'],
    IP_RATING: [null, 'ENCLOSURE'],
    CRI: [null, 'LIGHT_SOURCE'],
  };
  return {
    id: crypto.randomUUID(),
    versionId: '',
    pageNumber: 1,
    region: { x: 10, y: 20, width: 100, height: 20 },
    rawValue,
    normalizedValue,
    canonicalField: field,
    unit: units[field]?.[0] ?? null,
    basis: units[field]?.[1] ?? 'PRODUCT_IDENTITY',
    method: 'NATIVE_TABLE',
    confidence,
    adapterId: 'LUMINAIRE_DATASHEET_SEMANTIC',
    extractorVersion: 'luminaire-datasheet-semantic-v8',
    warnings: [`LABEL:${field}`, `CONTEXT:${rawValue}`, 'PRODUCT_ROW:A100'],
  };
}

function harness(values: readonly DocumentExtractionValue[]) {
  const db = database();
  const store = new DocumentIntelligenceStore(db, () => NOW);
  let processCount = 0;
  const worker = {
    async process(attemptId: string) {
      processCount += 1;
      const source = store.sourceForAttempt(attemptId);
      store.setAttemptState(attemptId, 'STRUCTURED_EXTRACTION', 'TEST_FIELDS');
      store.replaceAttemptValues(
        attemptId,
        source.versionId,
        values.map((item) => ({ ...item, id: crypto.randomUUID(), versionId: source.versionId })),
      );
      store.setAttemptState(attemptId, 'COMPLETE', 'COMPLETE', { completedPages: 1 });
    },
  } as DocumentProcessingWorker;
  return {
    db,
    store,
    service: new LuminaireDatasheetVerificationService(db, store, worker, () => NOW),
    processCount: () => processCount,
  };
}

function bindLibrarySnapshot(db: DatabaseSync): string {
  const versionId = '44444444-4444-4444-8444-444444444444';
  const audit = ['owner', 'Owner', NOW.toISOString(), 'owner', 'Owner', NOW.toISOString()] as const;
  db.prepare(
    `INSERT INTO luminaire_manufacturers
     (manufacturer_id,name,normalized_name,status,created_by_id,created_by_name,created_at,
      updated_by_id,updated_by_name,updated_at)
     VALUES ('manufacturer-1','Acme Lighting','acme lighting','ACTIVE',?,?,?,?,?,?)`,
  ).run(...audit);
  db.prepare(
    `INSERT INTO luminaire_library_products
     (product_id,manufacturer_id,name,normalized_name,product_type,description,status,
      created_by_id,created_by_name,created_at,updated_by_id,updated_by_name,updated_at)
     VALUES ('product-1','manufacturer-1','A100','a100','Downlight','','ACTIVE',?,?,?,?,?,?)`,
  ).run(...audit);
  db.prepare(
    `INSERT INTO luminaire_library_variants
     (variant_id,product_id,manufacturer_id,variant_label,normalized_label,ordering_code,
      normalized_ordering_code,wattage,wattage_value,wattage_basis,lumens,lumens_value,
      lumens_basis,light_color,cct_kelvin,cri,cri_value,beam_angle,beam_degrees,beam_facet,
      ip_rating,ip_facet,mounting,cutout,driver,control,control_facet,emergency,dimensions,
      body_color_finish,status,created_by_id,created_by_name,created_at,updated_by_id,
      updated_by_name,updated_at)
     VALUES ('variant-1','product-1','manufacturer-1','A100','a100','A100','A100',
      '12 W',12,'W','1200 lm',1200,'LM','3000 K',3000,'>90',90,'24°',24,'24',
      'IP44','ip44','Recessed','','','DALI','dali','No','','White','ACTIVE',?,?,?,?,?,?)`,
  ).run(...audit);
  db.prepare(
    `INSERT INTO luminaire_library_versions
     (version_id,manufacturer_id,product_id,variant_id,version_sequence,snapshot_json,
      content_hash,search_text,product_type,light_color,beam_angle,published_by_id,
      published_by_name,published_at)
     VALUES (?,'manufacturer-1','product-1','variant-1',1,'{}',?,'A100','Downlight',
      '3000 K','24°','owner','Owner',?)`,
  ).run(versionId, 'c'.repeat(64), NOW.toISOString());
  db.prepare(
    `UPDATE luminaire_library_variants SET latest_published_version_id=? WHERE variant_id='variant-1'`,
  ).run(versionId);
  db.prepare(
    `INSERT INTO project_luminaire_library_bindings
     (project_id,luminaire_id,manufacturer_id,product_id,variant_id,selected_version_id,
      selected_by_id,selected_by_name,selected_at,updated_by_id,updated_by_name,updated_at)
     VALUES (?,?,'manufacturer-1','product-1','variant-1',?,'owner','Owner',?,
      'owner','Owner',?)`,
  ).run(PROJECT_ID, LUMINAIRE_ID, versionId, NOW.toISOString(), NOW.toISOString());
  return versionId;
}

const cleanValues = [
  extracted('MANUFACTURER', 'ACME LIGHTING', 'Manufacturer: Acme Lighting'),
  extracted('ORDERING_CODE', 'A100', 'Ordering Code: A100'),
  extracted('SYSTEM_POWER', 15, 'System Power: 15 W'),
  extracted('LUMINAIRE_FLUX', 1200, 'Luminaire Flux: 1200 lm'),
  extracted('CCT', 3000, 'CCT: 3000 K'),
  extracted('BEAM_ANGLE', 36, 'Beam Angle: 36°'),
  extracted('CRI', '>90', 'CRI: >90'),
  extracted('IP_RATING', 'IP65', 'IP Rating: IP65'),
] as const;

describe('Luminaire Datasheet verification service', () => {
  it('does not certify technical fields through a low-confidence OCR identity', async () => {
    const value = harness(
      cleanValues.map((item) =>
        item.canonicalField === 'ORDERING_CODE' ? { ...item, method: 'OCR', confidence: 75 } : item,
      ),
    );
    try {
      const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
      expect(result.identityResult).toBe('UNVERIFIED');
      expect(result.comparisons.find((item) => item.fieldKey === 'wattage')).toMatchObject({
        verificationResult: 'UNVERIFIED',
        canUseDatasheetValue: false,
      });
    } finally {
      value.db.close();
    }
  });
  it('does not silently truncate identity and technical evidence after the first 100 values', async () => {
    const value = harness([
      ...Array.from({ length: 120 }, (_, index) => extracted('AUXILIARY', index, String(index))),
      ...cleanValues,
    ]);
    try {
      const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
      expect(
        result.comparisons.find((item) => item.fieldKey === 'wattage')?.verificationResult,
      ).toBe('CONFLICT');
    } finally {
      value.db.close();
    }
  });
  it('keeps a ranged project power unverified and cannot adopt against that comparison', async () => {
    const value = harness(cleanValues);
    try {
      value.db
        .prepare('UPDATE project_luminaires SET wattage=? WHERE id=?')
        .run('15-20 W', LUMINAIRE_ID);
      const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
      expect(result.comparisons.find((item) => item.fieldKey === 'wattage')).toMatchObject({
        verificationResult: 'UNVERIFIED',
        canUseDatasheetValue: false,
      });
    } finally {
      value.db.close();
    }
  });
  it('creates exact normalized authority, compares identity first, and reuses unchanged extraction', async () => {
    const value = harness(cleanValues);
    const first = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(first.identityResult).toBe('MATCH');
    expect(first.comparisons.map((item) => [item.fieldKey, item.verificationResult])).toEqual([
      ['manufacturer', 'MATCH'],
      ['orderingCode', 'MATCH'],
      ['model', 'MISSING_IN_DATASHEET'],
      ['wattage', 'CONFLICT'],
      ['lumens', 'MATCH'],
      ['lightColor', 'MATCH'],
      ['cri', 'MISSING_IN_TABLE'],
      ['beamAngle', 'CONFLICT'],
      ['ipRating', 'CONFLICT'],
    ]);
    expect(value.processCount()).toBe(1);
    const second = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(second.reusedExtraction).toBe(true);
    expect(second.verificationId).toBe(first.verificationId);
    expect(value.processCount()).toBe(1);
    expect(
      value.db
        .prepare(
          `SELECT storage_mode,luminaire_asset_version_id,managed_locator,artifact_version_id
           FROM document_sources`,
        )
        .get(),
    ).toEqual({
      storage_mode: 'LUMINAIRE_ASSET_VERSION',
      luminaire_asset_version_id: ASSET_ID,
      managed_locator: null,
      artifact_version_id: null,
    });
    expect(value.db.prepare('SELECT COUNT(*) count FROM document_sources').get()).toEqual({
      count: 1,
    });
  });

  it('applies only one verified Project field with CAS, audits it, and stales the old fingerprint', async () => {
    const value = harness(cleanValues);
    const before = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const after = await value.service.resolveProjectField({
      projectId: PROJECT_ID,
      luminaireId: LUMINAIRE_ID,
      fieldKey: 'wattage',
      expectedRowVersion: 1,
      verificationFingerprint: before.verificationFingerprint!,
      actor: { id: 'owner', name: 'Owner' },
    });
    const luminaire = new ProjectLuminaireWriteStore(value.db).get(PROJECT_ID, LUMINAIRE_ID);
    expect(luminaire).toMatchObject({
      wattage: '15 W',
      beamAngle: '24°',
      ipRating: 'IP44',
      rowVersion: 2,
    });
    expect(after.comparisons.find((item) => item.fieldKey === 'wattage')?.verificationResult).toBe(
      'MATCH',
    );
    expect(
      value.db
        .prepare(
          `SELECT state,COUNT(*) count FROM luminaire_datasheet_verifications
           GROUP BY state ORDER BY state`,
        )
        .all(),
    ).toEqual([
      { state: 'CURRENT', count: 1 },
      { state: 'STALE', count: 1 },
    ]);
    expect(
      value.db
        .prepare("SELECT action FROM workspace_activity WHERE action='DATASHEET_VALUE_ADOPTED'")
        .get(),
    ).toEqual({ action: 'DATASHEET_VALUE_ADOPTED' });
    await expect(
      value.service.resolveProjectField({
        projectId: PROJECT_ID,
        luminaireId: LUMINAIRE_ID,
        fieldKey: 'beamAngle',
        expectedRowVersion: 1,
        verificationFingerprint: before.verificationFingerprint!,
        actor: { id: 'owner', name: 'Owner' },
      }),
    ).rejects.toThrow(/changed|Refresh/i);
  });

  it('returns POSSIBLE_WRONG_DATASHEET and suppresses hard technical conflicts', async () => {
    const wrong = cleanValues.map((item) =>
      item.canonicalField === 'ORDERING_CODE'
        ? {
            ...item,
            normalizedValue: 'B200',
            rawValue: 'Ordering Code: B200',
            warnings: ['LABEL:Ordering Code', 'PRODUCT_ROW:B200'],
          }
        : { ...item, warnings: item.warnings.map((warning) => warning.replace('A100', 'B200')) },
    );
    const value = harness(wrong);
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(result.identityResult).toBe('POSSIBLE_WRONG_DATASHEET');
    expect(result.comparisons.every((item) => item.status === 'NeedsReview')).toBe(true);
    expect(result.comparisons.every((item) => !item.canUseDatasheetValue)).toBe(true);
  });

  it('uses the exact legacy model as supporting identity but never as canonical Ordering Code', async () => {
    const value = harness(cleanValues);
    // Project-only Luminaire: canonical ordering_code blank, legacy model A2000427.
    new ProjectLuminaireWriteStore(value.db).patch(
      PROJECT_ID,
      LUMINAIRE_ID,
      1,
      'L01',
      [{ field: 'orderingCode', before: 'A100', after: '' }],
      false,
    );
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(result.identityResult).toBe('MATCH');
    const ordering = result.comparisons.find((item) => item.fieldKey === 'orderingCode');
    expect(ordering).toMatchObject({
      verificationResult: 'MISSING_IN_TABLE',
      status: 'MissingSchedule',
      scheduleValue: '',
      value: 'A100',
    });
    // The canonical field was never silently filled from the legacy model.
    const luminaire = new ProjectLuminaireWriteStore(value.db).get(PROJECT_ID, LUMINAIRE_ID);
    expect(luminaire.orderingCode).toBe('');
    expect(luminaire.model).toBe('A100');
  });

  it('rejects identity verification when the legacy model does not match the Datasheet article', async () => {
    const wrong = cleanValues.map((item) =>
      item.canonicalField === 'ORDERING_CODE'
        ? {
            ...item,
            normalizedValue: 'B200',
            rawValue: 'Ordering Code: B200',
            warnings: ['LABEL:Ordering Code', 'PRODUCT_ROW:B200'],
          }
        : { ...item, warnings: item.warnings.map((warning) => warning.replace('A100', 'B200')) },
    );
    const value = harness(wrong);
    // Project-only Luminaire: canonical ordering_code blank, legacy model A100 (mismatch).
    new ProjectLuminaireWriteStore(value.db).patch(
      PROJECT_ID,
      LUMINAIRE_ID,
      1,
      'L01',
      [{ field: 'orderingCode', before: 'A100', after: '' }],
      false,
    );
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(result.identityResult).toBe('POSSIBLE_WRONG_DATASHEET');
    expect(result.comparisons.every((item) => !item.canUseDatasheetValue)).toBe(true);
  });

  it('keeps low-confidence OCR evidence UNVERIFIED instead of hard conflict', async () => {
    const low = cleanValues.map((item) =>
      item.canonicalField === 'SYSTEM_POWER'
        ? { ...item, confidence: 62, method: 'OCR' as const }
        : item,
    );
    const value = harness(low);
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(result.comparisons.find((item) => item.fieldKey === 'wattage')).toMatchObject({
      verificationResult: 'UNVERIFIED',
      status: 'NeedsReview',
      canUseDatasheetValue: false,
    });
  });

  it('compares Model against Datasheet MODEL evidence and never against Ordering Code', async () => {
    const values = [...cleanValues, extracted('MODEL', 'IKU DOWNLIGHT', 'E Iku Downlight', 90)];
    const value = harness(values);
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const model = result.comparisons.find((item) => item.fieldKey === 'model');
    expect(model).toMatchObject({
      verificationResult: 'CONFLICT',
      status: 'Mismatch',
      scheduleValue: 'A100',
      value: 'IKU DOWNLIGHT',
      canUseDatasheetValue: true,
    });
    // The canonical Ordering Code comparison is unaffected by the Model evidence.
    expect(result.comparisons.find((item) => item.fieldKey === 'orderingCode')).toMatchObject({
      verificationResult: 'MATCH',
    });
  });

  it('reports MISSING_IN_TABLE for blank physical fields with exact Datasheet evidence', async () => {
    const values = [
      ...cleanValues,
      extracted('BODY_COLOR', 'WHITE (RAL9002)', 'A2000427 White (RAL9002)', 92),
      extracted('CUTOUT', 'Ø125 MM', 'Cut-out: Ø125 mm', 94),
      extracted('DIMENSIONS', 'Ø160 × 110 MM', 'Dimensions: Ø160 × 110 mm', 94),
    ];
    const value = harness(values);
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(result.comparisons.find((item) => item.fieldKey === 'bodyColorFinish')).toMatchObject({
      verificationResult: 'MISSING_IN_TABLE',
      status: 'MissingSchedule',
      canUseDatasheetValue: true,
    });
    expect(result.comparisons.find((item) => item.fieldKey === 'cutout')).toMatchObject({
      verificationResult: 'MISSING_IN_TABLE',
      status: 'MissingSchedule',
      canUseDatasheetValue: true,
    });
    expect(result.comparisons.find((item) => item.fieldKey === 'dimensions')).toMatchObject({
      verificationResult: 'MISSING_IN_TABLE',
      status: 'MissingSchedule',
      canUseDatasheetValue: true,
    });
  });

  it('never turns optional control capability into a hard Project configuration conflict', async () => {
    const values = [
      ...cleanValues,
      {
        ...extracted('CONTROL', 'DALI', 'Optional DALI control', 94),
        confidence: 60,
        warnings: ['LABEL:Control / Dimming', 'CONTEXT:Optional DALI control', 'CAPABILITY_ONLY'],
      },
    ];
    const value = harness(values);
    // Project control is DALI; the Datasheet only says "Optional DALI control".
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const control = result.comparisons.find((item) => item.fieldKey === 'control');
    expect(control).toMatchObject({
      verificationResult: 'UNVERIFIED',
      status: 'NeedsReview',
      canUseDatasheetValue: false,
    });
  });

  it('compares exact supplied control evidence against the Project configuration', async () => {
    const values = [
      ...cleanValues,
      extracted('CONTROL', 'CASAMBI', 'Includes ERCO Casambi control gear.', 94),
      {
        ...extracted('CONTROL', 'DALI', 'Control via Casambi app (Android/iOS)', 94),
        confidence: 60,
        warnings: ['LABEL:Control / Dimming', 'CONTEXT:Control via Casambi app', 'CAPABILITY_ONLY'],
      },
    ];
    const value = harness(values);
    // Project control is DALI; the Datasheet proves the exact supplied control is Casambi.
    new ProjectLuminaireWriteStore(value.db).patch(
      PROJECT_ID,
      LUMINAIRE_ID,
      1,
      'L01',
      [{ field: 'control', before: '', after: 'DALI' }],
      false,
    );
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const control = result.comparisons.find((item) => item.fieldKey === 'control');
    // Exact-supplied evidence outranks capability-only candidates: the
    // capability item cannot create ambiguity or mask the exact conflict.
    expect(control).toMatchObject({
      verificationResult: 'CONFLICT',
      status: 'Mismatch',
      scheduleValue: 'DALI',
      value: 'CASAMBI',
      canUseDatasheetValue: true,
    });
  });

  it('never turns emergency capability/approval into a hard Project emergency conflict', async () => {
    const values = [
      ...cleanValues,
      {
        ...extracted(
          'EMERGENCY',
          'EMERGENCY LIGHTING',
          'Approved for use as emergency lighting',
          60,
        ),
        confidence: 60,
        warnings: ['LABEL:Emergency', 'CAPABILITY_ONLY'],
      },
    ];
    const value = harness(values);
    // Project emergency is "No"; the Datasheet only proves approval capability.
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const emergency = result.comparisons.find((item) => item.fieldKey === 'emergency');
    expect(emergency).toMatchObject({
      verificationResult: 'UNVERIFIED',
      status: 'NeedsReview',
      canUseDatasheetValue: false,
    });
  });

  it('compares exact emergency article evidence when the Datasheet proves a configuration', async () => {
    const values = [
      ...cleanValues,
      extracted(
        'EMERGENCY',
        'INTEGRATED EMERGENCY 3 H',
        'Emergency: Integrated emergency, 3 h',
        94,
      ),
    ];
    const value = harness(values);
    // Project emergency is "No"; the Datasheet proves an integrated 3h emergency variant.
    new ProjectLuminaireWriteStore(value.db).patch(
      PROJECT_ID,
      LUMINAIRE_ID,
      1,
      'L01',
      [{ field: 'emergency', before: '', after: 'No' }],
      false,
    );
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const emergency = result.comparisons.find((item) => item.fieldKey === 'emergency');
    expect(emergency).toMatchObject({
      verificationResult: 'CONFLICT',
      status: 'Mismatch',
      scheduleValue: 'No',
      canUseDatasheetValue: true,
    });
  });

  it('compares a qualitative Project distribution term against LIGHT_DISTRIBUTION, not numeric beam', async () => {
    const values = cleanValues.map((item) =>
      item.canonicalField === 'BEAM_ANGLE'
        ? {
            ...item,
            canonicalField: 'LIGHT_DISTRIBUTION',
            normalizedValue: 'WIDE FLOOD',
            rawValue: 'Fresnel lens wide flood',
            unit: null,
            basis: 'OPTIC',
            warnings: ['LABEL:Light Distribution', 'CONTEXT:Fresnel lens wide flood'],
          }
        : item,
    );
    const value = harness(values);
    // The Project luminaire holds a qualitative distribution term, not a numeric angle.
    new ProjectLuminaireWriteStore(value.db).patch(
      PROJECT_ID,
      LUMINAIRE_ID,
      1,
      'L01',
      [{ field: 'beamAngle', before: '24°', after: 'wide flood' }],
      false,
    );
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const beam = result.comparisons.find((item) => item.fieldKey === 'beamAngle');
    expect(beam).toMatchObject({
      verificationResult: 'MATCH',
      status: 'Matched',
      value: 'WIDE FLOOD',
    });
  });

  it('keeps a numeric Project beam angle compared against numeric BEAM_ANGLE', async () => {
    const value = harness(cleanValues);
    const result = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const beam = result.comparisons.find((item) => item.fieldKey === 'beamAngle');
    expect(beam).toMatchObject({
      verificationResult: 'CONFLICT',
      status: 'Mismatch',
    });
  });

  it('supersedes the old verification when the exact Datasheet AssetVersion changes', async () => {
    const value = harness(cleanValues);
    const first = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    value.db
      .prepare(
        `INSERT INTO luminaire_asset_versions
         (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
          size_bytes,file_hash,backfilled,attached_at,locator_kind,locator_value)
         VALUES ('asset-version-2',?,?,'Datasheet',2,'managed-datasheet.pdf','v2.pdf',
                 'application/pdf',42,?,0,?,'DATA_ROOT_RELATIVE','asset-v2.pdf')`,
      )
      .run(PROJECT_ID, LUMINAIRE_ID, 'b'.repeat(64), NOW.toISOString());

    const second = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(second.datasheetAssetVersionId).toBe('asset-version-2');
    expect(second.verificationId).not.toBe(first.verificationId);
    expect(
      value.db
        .prepare(
          `SELECT verification_id,state FROM luminaire_datasheet_verifications
           ORDER BY created_at,verification_id`,
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { verification_id: first.verificationId, state: 'SUPERSEDED' },
        { verification_id: second.verificationId, state: 'CURRENT' },
      ]),
    );
    expect(value.processCount()).toBe(2);
  });

  it('server-blocks direct adoption for a Library-linked immutable snapshot', async () => {
    const value = harness(cleanValues);
    const versionId = bindLibrarySnapshot(value.db);
    const beforeSnapshot = value.db
      .prepare(
        'SELECT snapshot_json,content_hash FROM luminaire_library_versions WHERE version_id=?',
      )
      .get(versionId);
    const verification = await value.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(verification).toMatchObject({ libraryLinked: true, authorityKind: 'LIBRARY_VERSION' });
    expect(verification.comparisons.every((item) => !item.canUseDatasheetValue)).toBe(true);

    await expect(
      value.service.resolveProjectField({
        projectId: PROJECT_ID,
        luminaireId: LUMINAIRE_ID,
        fieldKey: 'wattage',
        expectedRowVersion: 1,
        verificationFingerprint: verification.verificationFingerprint!,
        actor: { id: 'owner', name: 'Owner' },
      }),
    ).rejects.toThrow(/Library-linked|correction Draft/i);
    expect(
      value.db
        .prepare(
          'SELECT snapshot_json,content_hash FROM luminaire_library_versions WHERE version_id=?',
        )
        .get(versionId),
    ).toEqual(beforeSnapshot);
    expect(new ProjectLuminaireWriteStore(value.db).get(PROJECT_ID, LUMINAIRE_ID).wattage).toBe(
      '12 W',
    );
  });

  it('returns independent batch outcomes when a managed Datasheet succeeds and a legacy one needs adoption', async () => {
    const value = harness(cleanValues);
    const legacyLuminaireId = '22222222-2222-4222-8222-222222222223';
    const legacyAssetId = '33333333-3333-4333-8333-333333333334';
    const writes = new ProjectLuminaireWriteStore(
      value.db,
      () => NOW,
      () => legacyLuminaireId,
    );
    writes.create(PROJECT_ID, {
      tag: 'L02',
      category: 'Downlight',
      imagePath: '',
      description: 'Legacy fixture',
      manufacturer: 'Acme Lighting',
      model: 'A200',
      productType: '',
      variantLabel: '',
      orderingCode: 'A200',
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
      datasheetPath: 'C:\\legacy\\L02.pdf',
      location: '',
      unit: 'No.',
      quantity: 1,
      notes: '',
      sourceName: '',
      dimensions: '',
      bodyColorFinish: '',
    });
    value.db
      .prepare(
        `INSERT INTO luminaire_asset_versions
         (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
          size_bytes,file_hash,backfilled,attached_at,locator_kind,locator_value)
         VALUES (?,?,?,'Datasheet',1,'C:\\legacy\\L02.pdf','L02.pdf','application/pdf',42,?,0,?,'LEGACY_PATH','C:\\legacy\\L02.pdf')`,
      )
      .run(legacyAssetId, PROJECT_ID, legacyLuminaireId, 'b'.repeat(64), NOW.toISOString());

    const result = await value.service.verifyBatch(PROJECT_ID, [
      writes.get(PROJECT_ID, LUMINAIRE_ID),
      writes.get(PROJECT_ID, legacyLuminaireId),
    ]);

    expect(result.items).toMatchObject([
      { luminaireId: LUMINAIRE_ID, status: 'VERIFIED', reasonCode: 'NONE' },
      {
        luminaireId: legacyLuminaireId,
        status: 'NEEDS_ADOPTION',
        reasonCode: 'LEGACY_DATASHEET_REQUIRES_ADOPTION',
      },
    ]);
    expect(result.summary).toMatchObject({ analyzed: 1, verified: 1, needsAdoption: 1, failed: 0 });
    expect(value.processCount()).toBe(1);
  });
});

describe('Saved technical results', () => {
  it('remembers an explicit batch run even when every Datasheet is missing', async () => {
    const h = harness(cleanValues);
    try {
      h.db.prepare("UPDATE project_luminaires SET datasheet_path='' WHERE id=?").run(LUMINAIRE_ID);
      const luminaire = new ProjectLuminaireWriteStore(h.db, () => NOW).get(
        PROJECT_ID,
        LUMINAIRE_ID,
      );
      expect(await h.service.readBatch(PROJECT_ID, [luminaire])).toBeNull();
      const run = await h.service.verifyBatch(PROJECT_ID, [luminaire]);
      const before = h.db.prepare('SELECT total_changes() AS count').get();
      const restored = await h.service.readBatch(PROJECT_ID, [luminaire]);
      expect(restored?.summary).toEqual(run.summary);
      expect(restored?.items[0]).toMatchObject({
        luminaireId: LUMINAIRE_ID,
        status: 'MISSING_DATASHEET',
        analysis: null,
      });
      expect(h.processCount()).toBe(0);
      expect(h.db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    } finally {
      h.db.close();
    }
  });

  it('rejects foreign project records before reads or processing', async () => {
    const h = harness(cleanValues);
    try {
      const luminaire = new ProjectLuminaireWriteStore(h.db, () => NOW).get(
        PROJECT_ID,
        LUMINAIRE_ID,
      );
      const before = h.db.prepare('SELECT total_changes() AS count').get();
      await expect(h.service.readBatch('foreign', [luminaire])).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      expect(h.processCount()).toBe(0);
      expect(h.db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    } finally {
      h.db.close();
    }
  });

  it('reconstructs the same verification after a service restart without processing or database writes', async () => {
    const h = harness(cleanValues);
    try {
      const luminaire = new ProjectLuminaireWriteStore(h.db, () => NOW).get(
        PROJECT_ID,
        LUMINAIRE_ID,
      );
      expect(await h.service.readBatch(PROJECT_ID, [luminaire])).toBeNull();
      expect(h.processCount()).toBe(0);
      const verified = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
      const before = h.db.prepare('SELECT total_changes() AS count').get();
      const reader = new LuminaireDatasheetVerificationService(
        h.db,
        h.store,
        {
          process: async () => {
            throw new Error('Read must not process files');
          },
        } as unknown as DocumentProcessingWorker,
        () => new Date('2030-01-01T00:00:00Z'),
      );
      const result = await reader.readBatch(PROJECT_ID, [luminaire]);
      expect(result?.items[0]?.analysis).toMatchObject({
        verificationFingerprint: verified.verificationFingerprint,
        analyzedAt: verified.analyzedAt,
        comparisons: verified.comparisons,
      });
      expect(h.db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
      expect(h.processCount()).toBe(1);
    } finally {
      h.db.close();
    }
  });
  it('does not present stale comparisons as current after a project edit', async () => {
    const h = harness(cleanValues);
    try {
      await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
      h.db
        .prepare('UPDATE project_luminaires SET wattage=?,row_version=row_version+1 WHERE id=?')
        .run('900 W', LUMINAIRE_ID);
      const luminaire = new ProjectLuminaireWriteStore(h.db, () => NOW).get(
        PROJECT_ID,
        LUMINAIRE_ID,
      );
      const before = h.db.prepare('SELECT total_changes() AS count').get();
      const result = await h.service.readBatch(PROJECT_ID, [luminaire]);
      expect(result?.items[0]).toMatchObject({ status: 'UNVERIFIED', analysis: null });
      expect(h.db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
      expect(h.processCount()).toBe(1);
    } finally {
      h.db.close();
    }
  });
});

describe('saved Datasheet reading confirmations', () => {
  it('keeps Project value as a persisted review decision while retaining the conflict and evidence', async () => {
    const h = harness(cleanValues);
    h.db.prepare('UPDATE project_luminaires SET wattage=? WHERE id=?').run('19 W', LUMINAIRE_ID);
    const before = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const input = {
      fieldKey: 'wattage' as const,
      verificationFingerprint: before.verificationFingerprint!,
      operationId: crypto.randomUUID(),
    };
    const after = await h.service.keepProjectField(PROJECT_ID, LUMINAIRE_ID, input, {
      id: 'reviewer',
      name: 'Reviewer',
    });
    const oldField = before.comparisons.find((field) => field.fieldKey === 'wattage')!;
    const newField = after.comparisons.find((field) => field.fieldKey === 'wattage')!;
    expect(newField.verificationResult).toBe('CONFLICT');
    expect(newField.value).toBe(oldField.value);
    expect(newField.scheduleValue).toBe('19 W');
    expect(
      newField.reviewNotes?.some((note) => note.startsWith('KEPT_PROJECT_VALUE:Reviewer')),
    ).toBe(true);
    expect(after.verificationFingerprint).toBe(before.verificationFingerprint);
    await h.service.keepProjectField(PROJECT_ID, LUMINAIRE_ID, input, {
      id: 'reviewer',
      name: 'Reviewer',
    });
    expect(
      h.db
        .prepare("SELECT COUNT(*) AS n FROM app_state WHERE state_key LIKE 'project-field-keep:%'")
        .get()?.n,
    ).toBe(1);
    const restarted = new LuminaireDatasheetVerificationService(
      h.db,
      h.store,
      {} as DocumentProcessingWorker,
      () => NOW,
    );
    expect(
      (await restarted.verify(PROJECT_ID, LUMINAIRE_ID)).comparisons.find(
        (field) => field.fieldKey === 'wattage',
      )?.reviewNotes,
    ).toEqual(newField.reviewNotes);
    h.db.prepare('UPDATE project_luminaires SET wattage=? WHERE id=?').run('20 W', LUMINAIRE_ID);
    await expect(
      restarted.keepProjectField(PROJECT_ID, LUMINAIRE_ID, input, {
        id: 'reviewer',
        name: 'Reviewer',
      }),
    ).rejects.toThrow(/changed/);
    expect(
      (await restarted.verify(PROJECT_ID, LUMINAIRE_ID)).comparisons
        .find((field) => field.fieldKey === 'wattage')
        ?.reviewNotes?.some((note) => note.startsWith('KEPT_PROJECT_VALUE:')),
    ).toBe(false);
  });
  it('requires explicit field-scoped identity acceptance before adopting a reviewed value from a mismatched Datasheet', async () => {
    const h = harness(cleanValues);
    h.db
      .prepare('UPDATE project_luminaires SET manufacturer=? WHERE id=?')
      .run('Different Project name', LUMINAIRE_ID);
    let analysis = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const input = {
      fieldKey: 'wattage' as const,
      value: '15 W',
      pageNumber: 1,
      note: 'Checked the exact attached model and printed power',
      verificationFingerprint: analysis.verificationFingerprint!,
      operationId: crypto.randomUUID(),
    };
    analysis = await h.service.confirmField(PROJECT_ID, LUMINAIRE_ID, input, {
      id: 'reviewer',
      name: 'Reviewer',
    });
    expect(
      analysis.comparisons.find((field) => field.fieldKey === 'wattage')?.canUseDatasheetValue,
    ).toBe(false);
    analysis = await h.service.confirmField(
      PROJECT_ID,
      LUMINAIRE_ID,
      {
        ...input,
        verificationFingerprint: analysis.verificationFingerprint!,
        operationId: crypto.randomUUID(),
        acceptIdentityMismatch: true,
      },
      { id: 'reviewer', name: 'Reviewer' },
    );
    expect(analysis.comparisons.find((field) => field.fieldKey === 'wattage')).toMatchObject({
      canUseDatasheetValue: true,
      verificationResult: 'CONFLICT',
    });
    expect(
      analysis.comparisons.find((field) => field.fieldKey === 'manufacturer')?.verificationResult,
    ).toBe('POSSIBLE_WRONG_DATASHEET');
    const writes = new ProjectLuminaireWriteStore(h.db);
    const before = writes.get(PROJECT_ID, LUMINAIRE_ID);
    await h.service.resolveProjectField({
      projectId: PROJECT_ID,
      luminaireId: LUMINAIRE_ID,
      fieldKey: 'wattage',
      expectedRowVersion: before.rowVersion,
      verificationFingerprint: analysis.verificationFingerprint!,
      actor: { id: 'reviewer', name: 'Reviewer' },
    });
    expect(writes.get(PROJECT_ID, LUMINAIRE_ID).wattage).toBe('15 W');
    expect(writes.get(PROJECT_ID, LUMINAIRE_ID).manufacturer).toBe('Different Project name');
  });
  const actor = { id: 'reviewer', name: 'Reviewer' };
  it('persists a reviewed decimal without changing Project truth and survives service restart', async () => {
    const h = harness(cleanValues);
    const before = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const input = {
      fieldKey: 'wattage' as const,
      value: '12 W',
      pageNumber: 1,
      note: 'Read the printed system power cell.',
      verificationFingerprint: before.verificationFingerprint!,
      operationId: crypto.randomUUID(),
    };
    const result = await h.service.confirmField(PROJECT_ID, LUMINAIRE_ID, input, actor);
    expect(result.comparisons.find((c) => c.fieldKey === 'wattage')).toMatchObject({
      verificationResult: 'MATCH',
      reviewNotes: expect.arrayContaining(['OWNER_CONFIRMED:Reviewer']),
    });
    expect(new ProjectLuminaireWriteStore(h.db).get(PROJECT_ID, LUMINAIRE_ID).wattage).toBe('12 W');
    const restarted = new LuminaireDatasheetVerificationService(
      h.db,
      h.store,
      {} as DocumentProcessingWorker,
      () => NOW,
    );
    expect(
      (await restarted.verify(PROJECT_ID, LUMINAIRE_ID)).comparisons.find(
        (c) => c.fieldKey === 'wattage',
      )?.verificationResult,
    ).toBe('MATCH');
    await restarted.confirmField(PROJECT_ID, LUMINAIRE_ID, input, actor);
    expect(
      h.db
        .prepare(
          "SELECT COUNT(*) AS n FROM app_state WHERE state_key LIKE 'datasheet-confirmation:%'",
        )
        .get()?.n,
    ).toBe(1);
    await expect(
      restarted.confirmField(PROJECT_ID, LUMINAIRE_ID, { ...input, value: '13 W' }, actor),
    ).rejects.toThrow('different content');
  });
  it('rejects stale decisions, invalid units, and nonexistent evidence pages', async () => {
    const h = harness(cleanValues);
    const first = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
    const input = {
      fieldKey: 'wattage' as const,
      value: '12 W',
      pageNumber: 1,
      note: 'Printed power',
      verificationFingerprint: first.verificationFingerprint!,
      operationId: crypto.randomUUID(),
    };
    await expect(
      h.service.confirmField(
        PROJECT_ID,
        LUMINAIRE_ID,
        { ...input, verificationFingerprint: '0'.repeat(64) },
        actor,
      ),
    ).rejects.toThrow('changed');
    await expect(
      h.service.confirmField(PROJECT_ID, LUMINAIRE_ID, { ...input, value: '12 lm' }, actor),
    ).rejects.toThrow('correct unit');
    await expect(
      h.service.confirmField(PROJECT_ID, LUMINAIRE_ID, { ...input, pageNumber: 99 }, actor),
    ).rejects.toThrow('supported field');
  });
  it('does not carry a confirmation into a replacement AssetVersion', async () => {
    const h = harness(cleanValues);
    const first = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
    await h.service.confirmField(
      PROJECT_ID,
      LUMINAIRE_ID,
      {
        fieldKey: 'wattage',
        value: '12 W',
        pageNumber: 1,
        note: 'Printed power',
        verificationFingerprint: first.verificationFingerprint!,
        operationId: crypto.randomUUID(),
      },
      actor,
    );
    h.db
      .prepare(
        `INSERT INTO luminaire_asset_versions (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,size_bytes,file_hash,backfilled,attached_at,locator_kind,locator_value) VALUES (?, ?, ?, 'Datasheet',2,'managed-datasheet.pdf','v2.pdf','application/pdf',42,?,0,?,'DATA_ROOT_RELATIVE','asset-v2.pdf')`,
      )
      .run(crypto.randomUUID(), PROJECT_ID, LUMINAIRE_ID, 'b'.repeat(64), NOW.toISOString());
    const next = await h.service.verify(PROJECT_ID, LUMINAIRE_ID);
    expect(next.comparisons.find((c) => c.fieldKey === 'wattage')).toMatchObject({
      verificationResult: 'CONFLICT',
      reviewNotes: [],
    });
    expect(
      h.db
        .prepare(
          "SELECT COUNT(*) AS n FROM app_state WHERE state_key LIKE 'datasheet-confirmation:%'",
        )
        .get()?.n,
    ).toBe(1);
  });
});
