import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV27LuminaireDatasheetVerification,
  rollbackV27LuminaireDatasheetVerification,
  validateV27LuminaireDatasheetVerification,
} from './production-v27-luminaire-datasheet-verification';

const NOW = '2026-08-28T00:00:00.000Z';
const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const LUMINAIRE_ID = '20000000-0000-4000-8000-000000000001';
const ASSET_VERSION_ID = '30000000-0000-4000-8000-000000000001';
const DATASHEET_SHA = 'd'.repeat(64);

function migrateThrough(target: 26 | 27): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= target)) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION') {
      database.exec('PRAGMA foreign_keys=OFF');
    }
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date(NOW) },
    });
    database.exec('COMMIT');
    database.exec('PRAGMA foreign_keys=ON');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  }
  return database;
}

function seedProjectLuminaire(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO project_luminaires
       (id,project_id,tag,category,image_path,description,manufacturer,model,wattage,lumens,
        light_color,cri,beam_angle,ip_rating,mounting,cutout,driver,control,emergency,
        datasheet_path,location,unit,quantity,notes,source_name,dimensions,body_color_finish,
        created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      LUMINAIRE_ID,
      PROJECT_ID,
      'L01',
      'Downlight',
      '',
      'Fixture',
      'Acme',
      'A100',
      '15 W',
      '1200 lm',
      '3000 K',
      '>90',
      '36 deg',
      'IP65',
      'Recessed',
      '',
      '',
      '',
      '',
      'managed.pdf',
      '',
      'No.',
      1,
      '',
      '',
      '',
      '',
      NOW,
      NOW,
    );
  database
    .prepare(
      `INSERT INTO luminaire_asset_versions
       (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,mime_type,
        size_bytes,file_hash,backfilled,attached_at,locator_kind,locator_value)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      ASSET_VERSION_ID,
      PROJECT_ID,
      LUMINAIRE_ID,
      'Datasheet',
      1,
      'objects/dd/datasheet.pdf',
      'datasheet.pdf',
      'application/pdf',
      42,
      DATASHEET_SHA,
      0,
      NOW,
      'DATA_ROOT_RELATIVE',
      'objects/dd/datasheet.pdf',
    );
}

function seedV26SourcesWithChildren(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO project_workspaces
       (project_id,folder_path,folder_profile,services_json,input_mode,created_at,updated_at)
       VALUES (?,NULL,'DEFAULT','[]','MANUAL',?,?)`,
    )
    .run(PROJECT_ID, NOW, NOW);
  database
    .prepare(
      `INSERT INTO managed_artifacts
       (artifact_id,project_id,artifact_type,source_tool,canonical_path,status,
        current_working_version,created_at,updated_at)
       VALUES (?,?,?,?,?,'ACTIVE',1,?,?)`,
    )
    .run('40000000-0000-4000-8000-000000000001', PROJECT_ID, 'PDF', 'TEST', 'a.pdf', NOW, NOW);
  database
    .prepare(
      `INSERT INTO artifact_versions
       (version_id,artifact_id,version,content_hash,size_bytes,locator_kind,locator_value,created_at)
       VALUES (?,?,1,?,42,'PROJECT_RELATIVE','a.pdf',?)`,
    )
    .run(
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'a'.repeat(64),
      NOW,
    );
  const insertSource = database.prepare(
    `INSERT INTO document_sources
     (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,
      size_bytes,media_type,original_file_name,admission_mechanism,admitted_at,finalized_at)
     VALUES (?,?,?,?,?,?,42,'application/pdf',?,?,?,?)`,
  );
  insertSource.run(
    '60000000-0000-4000-8000-000000000001',
    'DOCUMENT_STORE',
    'AVAILABLE',
    'objects/bb/b.pdf',
    null,
    'b'.repeat(64),
    'b.pdf',
    'GLOBAL_SELECT',
    NOW,
    NOW,
  );
  insertSource.run(
    '60000000-0000-4000-8000-000000000002',
    'MANAGED_ARTIFACT_VERSION',
    'AVAILABLE',
    null,
    '50000000-0000-4000-8000-000000000001',
    'a'.repeat(64),
    'a.pdf',
    'PHASE4_ARTIFACT',
    NOW,
    NOW,
  );
  for (const [suffix, sourceId] of [
    ['1', '60000000-0000-4000-8000-000000000001'],
    ['2', '60000000-0000-4000-8000-000000000002'],
  ] as const) {
    const documentId = `70000000-0000-4000-8000-00000000000${suffix}`;
    const versionId = `80000000-0000-4000-8000-00000000000${suffix}`;
    database
      .prepare(
        `INSERT INTO intelligence_documents
         (document_id,lifecycle,confirmed_project_id,association_state,classification,
          classification_confidence,active_version_id,comparison_enabled,row_version,created_at,updated_at)
         VALUES (?,'ADMITTED',?,'CONFIRMED','PRODUCT_DATASHEET',100,NULL,1,1,?,?)`,
      )
      .run(documentId, PROJECT_ID, NOW, NOW);
    database
      .prepare(
        `INSERT INTO document_versions
         (version_id,document_id,version_sequence,source_id,admission_provenance_json,
          initial_project_context_id,processing_state,admitted_at)
         VALUES (?,?,1,?,'{}',?,'QUEUED',?)`,
      )
      .run(versionId, documentId, sourceId, PROJECT_ID, NOW);
    database
      .prepare('UPDATE intelligence_documents SET active_version_id=? WHERE document_id=?')
      .run(versionId, documentId);
  }
}

function seedLuminaireDocumentVersion(database: DatabaseSync): string {
  const sourceId = '90000000-0000-4000-8000-000000000001';
  const documentId = '90000000-0000-4000-8000-000000000002';
  const versionId = '90000000-0000-4000-8000-000000000003';
  database
    .prepare(
      `INSERT INTO document_sources
       (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,
        luminaire_asset_version_id,sha256,size_bytes,media_type,original_file_name,
        admission_mechanism,admitted_at,finalized_at)
       VALUES (?,'LUMINAIRE_ASSET_VERSION','AVAILABLE',NULL,NULL,?,?,42,
               'application/pdf','datasheet.pdf','LUMINAIRE_ATTACHMENT',?,?)`,
    )
    .run(sourceId, ASSET_VERSION_ID, DATASHEET_SHA, NOW, NOW);
  database
    .prepare(
      `INSERT INTO intelligence_documents
       (document_id,lifecycle,confirmed_project_id,association_state,classification,
        classification_confidence,active_version_id,comparison_enabled,row_version,created_at,updated_at)
       VALUES (?,'ADMITTED',?,'CONFIRMED','PRODUCT_DATASHEET',100,NULL,1,1,?,?)`,
    )
    .run(documentId, PROJECT_ID, NOW, NOW);
  database
    .prepare(
      `INSERT INTO document_versions
       (version_id,document_id,version_sequence,source_id,admission_provenance_json,
        initial_project_context_id,processing_state,admitted_at)
       VALUES (?,?,1,?,'{}',?,'QUEUED',?)`,
    )
    .run(versionId, documentId, sourceId, PROJECT_ID, NOW);
  database
    .prepare('UPDATE intelligence_documents SET active_version_id=? WHERE document_id=?')
    .run(versionId, documentId);
  return versionId;
}

describe('production v27 Luminaire Datasheet verification migration', () => {
  it('preserves both v26 source authorities and their Document Version children', () => {
    const database = migrateThrough(26);
    seedV26SourcesWithChildren(database);
    database.exec('PRAGMA foreign_keys=OFF');
    applyV27LuminaireDatasheetVerification(database);
    database.exec('PRAGMA foreign_keys=ON');
    validateV27LuminaireDatasheetVerification(database);
    expect(
      database
        .prepare(
          `SELECT source_id,storage_mode,managed_locator,artifact_version_id,
                  luminaire_asset_version_id,sha256
           FROM document_sources ORDER BY source_id`,
        )
        .all(),
    ).toEqual([
      {
        source_id: '60000000-0000-4000-8000-000000000001',
        storage_mode: 'DOCUMENT_STORE',
        managed_locator: 'objects/bb/b.pdf',
        artifact_version_id: null,
        luminaire_asset_version_id: null,
        sha256: 'b'.repeat(64),
      },
      {
        source_id: '60000000-0000-4000-8000-000000000002',
        storage_mode: 'MANAGED_ARTIFACT_VERSION',
        managed_locator: null,
        artifact_version_id: '50000000-0000-4000-8000-000000000001',
        luminaire_asset_version_id: null,
        sha256: 'a'.repeat(64),
      },
    ]);
    expect(database.prepare('SELECT COUNT(*) count FROM document_versions').get()).toEqual({
      count: 2,
    });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('enforces the third source FK, Datasheet type, XOR, and verification authority', () => {
    const database = migrateThrough(27);
    seedV26SourcesWithChildren(database);
    seedProjectLuminaire(database);
    const versionId = seedLuminaireDocumentVersion(database);
    expect(() =>
      database
        .prepare(
          `INSERT INTO document_sources
           (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,
            luminaire_asset_version_id,sha256,size_bytes,media_type,original_file_name,
            admission_mechanism,admitted_at)
           VALUES ('bad','LUMINAIRE_ASSET_VERSION','AVAILABLE','not-xor',NULL,?, ?,42,
                   'application/pdf','bad.pdf','LUMINAIRE_ATTACHMENT',?)`,
        )
        .run(ASSET_VERSION_ID, DATASHEET_SHA, NOW),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `INSERT INTO document_sources
           (source_id,storage_mode,storage_state,luminaire_asset_version_id,sha256,size_bytes,
            media_type,original_file_name,admission_mechanism,admitted_at)
           VALUES ('orphan','LUMINAIRE_ASSET_VERSION','AVAILABLE',?, ?,42,
                   'application/pdf','bad.pdf','LUMINAIRE_ATTACHMENT',?)`,
        )
        .run('ffffffff-ffff-4fff-8fff-ffffffffffff', DATASHEET_SHA, NOW),
    ).toThrow();
    database
      .prepare(
        `INSERT INTO luminaire_datasheet_verifications
         (verification_id,project_luminaire_id,luminaire_asset_version_id,document_version_id,
          luminaire_authority_kind,luminaire_authority_version,datasheet_sha256,
          extractor_fingerprint,semantic_mapping_version,comparison_fingerprint,state,
          row_version,created_at,updated_at)
         VALUES (?,?,?,?,?,'7',?,?,'luminaire-datasheet-v1',?,'CURRENT',1,?,?)`,
      )
      .run(
        'a0000000-0000-4000-8000-000000000001',
        LUMINAIRE_ID,
        ASSET_VERSION_ID,
        versionId,
        'PROJECT_ROW',
        DATASHEET_SHA,
        'e'.repeat(64),
        'f'.repeat(64),
        NOW,
        NOW,
      );
    expect(() =>
      database.prepare('DELETE FROM luminaire_asset_versions WHERE id=?').run(ASSET_VERSION_ID),
    ).toThrow();
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('is idempotent, structurally deterministic, and rolls back only when v27 authority is empty', () => {
    const upgraded = migrateThrough(26);
    upgraded.exec('PRAGMA foreign_keys=OFF');
    applyV27LuminaireDatasheetVerification(upgraded);
    upgraded.exec('PRAGMA foreign_keys=ON');
    const fresh = migrateThrough(27);
    const fingerprint = computeProductionSchemaFingerprint(fresh);
    expect(computeProductionSchemaFingerprint(upgraded)).toBe(fingerprint);
    applyV27LuminaireDatasheetVerification(fresh);
    expect(computeProductionSchemaFingerprint(fresh)).toBe(fingerprint);
    fresh.exec('PRAGMA foreign_keys=OFF');
    rollbackV27LuminaireDatasheetVerification(fresh);
    fresh.exec('PRAGMA foreign_keys=ON');
    validateProductionSchemaVersion(fresh, 26);

    const populated = migrateThrough(27);
    seedProjectLuminaire(populated);
    populated
      .prepare(
        `INSERT INTO document_sources
         (source_id,storage_mode,storage_state,luminaire_asset_version_id,sha256,size_bytes,
          media_type,original_file_name,admission_mechanism,admitted_at)
         VALUES ('source','LUMINAIRE_ASSET_VERSION','AVAILABLE',?,?,42,
                 'application/pdf','datasheet.pdf','LUMINAIRE_ATTACHMENT',?)`,
      )
      .run(ASSET_VERSION_ID, DATASHEET_SHA, NOW);
    expect(() => rollbackV27LuminaireDatasheetVerification(populated)).toThrow(
      /blocked while Luminaire Datasheet authority exists/,
    );
  });
});
