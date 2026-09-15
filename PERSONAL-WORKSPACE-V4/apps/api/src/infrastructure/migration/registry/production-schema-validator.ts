import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type ValidatedProductionSchemaVersion =
  15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

const EXPECTED_SCHEMA_FINGERPRINTS: Readonly<Record<ValidatedProductionSchemaVersion, string>> =
  Object.freeze({
    15: '866ea9c0c221260fd6033f7d3b6cf5cc5e560074dfd78c3b7a89af58b2878524',
    16: '02c71640163ee6c5c05661d06670b0ee928f2585268c62f242960f5e3e465f33',
    17: 'b1cffdfaff69758e912207d1cdee306c4c7ac1b39b4cddf3c6a837af603ba1f7',
    18: 'f3d2690e85c476e14b684771988c70d53b1925154693840f8bacc22f415ff835',
    19: '67e905e188b5481a0b963dbdd2fed8cdcdae345ca4893ec69e2625c7b698915c',
    20: 'a2d9b1e599c10c328680bc81fcbfcdcfc4d00ff44637ff9875ac0c73bab7152e',
    21: 'be0e8c832d7975cec6ecd968f9b15afad994f7589aa53d211abced4f7e31bc5d',
    22: 'c06aaa8657af538b74a8bd3f5eebbdd14754c4ace310580aa3cd3c4f18be61ce',
    23: '3961a181f44278582eb86d12eda88629713994024b5efb2d43855d89ce30d3a2',
    24: 'c8c02721543096eed9287954f8c2cb13e99184277a4a92f11c3d696ab3f248fc',
    25: '2e9c3b3b712b60cb5613df9fb5ea0ca3ab54a2ac7564b7044afebbabe7ec3905',
    26: '385be58520c1a7a73f055fee3e5272347ad2ee0856196cfec00763d865004203',
    27: '4499a37f11fc217a8f3928a47f5a1c0185578dfbbbc2c856cd4cc676fa291910',
    // P5D: 27 + action CAS/issue-blocking columns + project_source_files +
    // revision_source_file_baselines + their indexes.
    28: '0b2d6ca7014fcd26e66584ce3264bf63976c179774dca40f1f820c48e4bc641f',
    29: '0942931aefca057659759d091658ccd0998f581c0068712e594a166756a08b10',
    30: '46a365eb30b3990ac7c73e9a9b53540ccbda85a95e03e54edc1b13c9a18c1d7f',
  });

const EXPECTED_V22_UPGRADE_AUTHORITY_FINGERPRINT =
  '3c1b835808a6392c034de06d2e1c5a5100d95ee71233fee3cc4fa21b277aa18a';

type SqliteSchemaObject = {
  readonly type: 'table' | 'index' | 'trigger';
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
};

type SqliteRecord = Readonly<Record<string, unknown>>;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n\r]*/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeOwnedObjectSql(objectName: string, sql: string): string {
  const normalized = normalizeSql(sql);
  return objectName === 'document_sources' || objectName === 'project_contacts'
    ? normalized.replace(`create table "${objectName}"`, `create table ${objectName}`)
    : normalized;
}

function normalizeV22UpgradeSql(objectName: string, sql: string): string {
  let normalized = normalizeSql(sql)
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/\s+/g, ' ');
  if (objectName === 'luminaire_asset_versions') {
    normalized = normalized.replace(" default 'legacy_path'", '').replace(" default ''", '');
  }
  return normalized;
}

function readSchemaObjects(database: DatabaseSync): readonly SqliteSchemaObject[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE type IN ('table', 'index', 'trigger')
         AND name NOT LIKE 'sqlite_%'
         AND name <> 'schema_migrations'
       ORDER BY type, name`,
    )
    .all() as SqliteSchemaObject[];
}

/**
 * Stable semantic fingerprint for every production-owned table, explicit index, trigger,
 * declared column, foreign key, and indexed expression. The runner-owned migration-history
 * table is deliberately excluded because MigrationStateInspector validates it independently.
 */
export function computeProductionSchemaFingerprint(database: DatabaseSync): string {
  const parts: string[] = [];
  for (const object of readSchemaObjects(database)) {
    parts.push(
      [
        object.type,
        object.name,
        object.tbl_name,
        normalizeOwnedObjectSql(object.name, object.sql ?? ''),
      ].join('|'),
    );
    const quotedName = quoteIdentifier(object.name);
    if (object.type === 'table') {
      const columns = database.prepare(`PRAGMA table_info(${quotedName})`).all() as SqliteRecord[];
      for (const column of columns) {
        parts.push(
          `col|${object.name}|${[
            column.cid,
            column.name,
            column.type,
            column.notnull,
            column.dflt_value ?? '<null>',
            column.pk,
          ].join('|')}`,
        );
      }
      const foreignKeys = database
        .prepare(`PRAGMA foreign_key_list(${quotedName})`)
        .all() as SqliteRecord[];
      for (const foreignKey of foreignKeys) {
        parts.push(
          `fk|${object.name}|${[
            foreignKey.id,
            foreignKey.seq,
            foreignKey.table,
            foreignKey.from,
            foreignKey.to,
            foreignKey.on_update,
            foreignKey.on_delete,
            foreignKey.match,
          ].join('|')}`,
        );
      }
    }
    if (object.type === 'index') {
      const indexedColumns = database
        .prepare(`PRAGMA index_xinfo(${quotedName})`)
        .all() as SqliteRecord[];
      for (const indexedColumn of indexedColumns) {
        parts.push(
          `idx|${object.name}|${[
            indexedColumn.seqno,
            indexedColumn.cid,
            indexedColumn.name ?? '<null>',
            indexedColumn.desc,
            indexedColumn.coll,
            indexedColumn.key,
          ].join('|')}`,
        );
      }
    }
  }
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

/**
 * Bounded semantic authority used only while upgrading an immutable historical v22 database.
 * It ignores SQL layout whitespace and canonicalizes the two locator defaults that v23 owns.
 * Object identity, columns, constraints, foreign keys, index expressions, and triggers remain
 * covered; no other v22 structural difference is admitted.
 */
export function computeV22UpgradeAuthorityFingerprint(database: DatabaseSync): string {
  const parts: string[] = [];
  for (const object of readSchemaObjects(database)) {
    parts.push(
      [
        object.type,
        object.name,
        object.tbl_name,
        normalizeV22UpgradeSql(object.name, object.sql ?? ''),
      ].join('|'),
    );
    const quotedName = quoteIdentifier(object.name);
    if (object.type === 'table') {
      const columns = database.prepare(`PRAGMA table_info(${quotedName})`).all() as SqliteRecord[];
      for (const column of columns) {
        const defaultValue =
          object.name === 'luminaire_asset_versions' &&
          (column.name === 'locator_kind' || column.name === 'locator_value')
            ? '<v23-normalized>'
            : (column.dflt_value ?? '<null>');
        parts.push(
          `col|${object.name}|${[
            column.cid,
            column.name,
            column.type,
            column.notnull,
            defaultValue,
            column.pk,
          ].join('|')}`,
        );
      }
      const foreignKeys = database
        .prepare(`PRAGMA foreign_key_list(${quotedName})`)
        .all() as SqliteRecord[];
      for (const foreignKey of foreignKeys) {
        parts.push(
          `fk|${object.name}|${[
            foreignKey.id,
            foreignKey.seq,
            foreignKey.table,
            foreignKey.from,
            foreignKey.to,
            foreignKey.on_update,
            foreignKey.on_delete,
            foreignKey.match,
          ].join('|')}`,
        );
      }
    }
    if (object.type === 'index') {
      const indexedColumns = database
        .prepare(`PRAGMA index_xinfo(${quotedName})`)
        .all() as SqliteRecord[];
      for (const indexedColumn of indexedColumns) {
        parts.push(
          `idx|${object.name}|${[
            indexedColumn.seqno,
            indexedColumn.cid,
            indexedColumn.name ?? '<null>',
            indexedColumn.desc,
            indexedColumn.coll,
            indexedColumn.key,
          ].join('|')}`,
        );
      }
    }
  }
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

function validateIntegrity(database: DatabaseSync): void {
  const integrity = database.prepare('PRAGMA integrity_check').all() as Array<{
    integrity_check?: string;
  }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('Production schema validation failed: integrity_check did not return ok.');
  }

  const foreignKeysEnabled = database.prepare('PRAGMA foreign_keys').get() as
    { foreign_keys?: number } | undefined;
  if (foreignKeysEnabled?.foreign_keys !== 1) {
    throw new Error('Production schema validation failed: foreign keys are not enabled.');
  }

  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length !== 0) {
    throw new Error('Production schema validation failed: foreign_key_check found violations.');
  }
}

function validateRevisionReuseSemantics(database: DatabaseSync): void {
  const invalid = database
    .prepare(
      `SELECT operation_id
       FROM revision_delete_operations
       WHERE
         ((reused_by_revision_id IS NOT NULL) +
          (reused_at IS NOT NULL) +
          (reused_by_actor_id IS NOT NULL) +
          (reused_by_actor_name IS NOT NULL) +
          (reuse_reason IS NOT NULL)) NOT IN (0, 5)
         OR (
           reused_by_revision_id IS NOT NULL
           AND reused_at IS NOT NULL
           AND reused_by_actor_id IS NOT NULL
           AND reused_by_actor_name IS NOT NULL
           AND reuse_reason IS NOT NULL
           AND state <> 'COMPLETED'
         )
       LIMIT 1`,
    )
    .get() as { operation_id?: string } | undefined;
  if (invalid) {
    throw new Error(
      'Production schema validation failed: revision reuse provenance must be wholly absent or wholly populated on a COMPLETED tombstone.',
    );
  }
}

function validateAutomationRevisionBindingSemantics(database: DatabaseSync): void {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const bindings = database
    .prepare(
      `SELECT target_revision_id AS value FROM tool_contexts WHERE target_revision_id IS NOT NULL
       UNION ALL
       SELECT source_document_id AS value FROM tool_contexts WHERE source_document_id IS NOT NULL
       UNION ALL
       SELECT target_revision_id AS value FROM capture_ledger WHERE target_revision_id IS NOT NULL`,
    )
    .all() as Array<{ value?: unknown }>;
  if (
    bindings.some(
      (binding) => typeof binding.value !== 'string' || !uuidPattern.test(binding.value),
    )
  ) {
    throw new Error(
      'Production schema validation failed: automation identity snapshots must be UUIDs.',
    );
  }
  const invalidDecision = database
    .prepare(
      `SELECT capture_id
       FROM capture_ledger
       WHERE
         (routing_decision = 'USER_CONFIRMED'
          AND (decided_at IS NULL OR decided_by_id IS NULL OR decided_by_name IS NULL
               OR trim(decided_at) = '' OR trim(decided_by_id) = '' OR trim(decided_by_name) = ''))
         OR ((decided_by_id IS NULL) <> (decided_by_name IS NULL))
       LIMIT 1`,
    )
    .get() as { capture_id?: string } | undefined;
  if (invalidDecision) {
    throw new Error(
      'Production schema validation failed: routing decision provenance is incomplete.',
    );
  }
}

/** Fail-closed v22 admission for the single additive v23 convergence migration. */
export function validateV22UpgradeAuthority(database: DatabaseSync): void {
  validateIntegrity(database);
  if (
    computeV22UpgradeAuthorityFingerprint(database) !== EXPECTED_V22_UPGRADE_AUTHORITY_FINGERPRINT
  ) {
    throw new Error(
      'Production schema validation failed: version 22 upgrade-authority fingerprint mismatch.',
    );
  }
  validateRevisionReuseSemantics(database);
  validateAutomationRevisionBindingSemantics(database);
}

/** Fail-closed cumulative validation for an exact late production schema and its persisted data. */
export function validateProductionSchemaVersion(
  database: DatabaseSync,
  version: ValidatedProductionSchemaVersion,
): void {
  validateIntegrity(database);
  const actualFingerprint = computeProductionSchemaFingerprint(database);
  if (actualFingerprint !== EXPECTED_SCHEMA_FINGERPRINTS[version]) {
    throw new Error(
      `Production schema validation failed: version ${version} structural fingerprint mismatch.`,
    );
  }
  if (version >= 18) validateRevisionReuseSemantics(database);
  if (version >= 20) validateAutomationRevisionBindingSemantics(database);
}

/**
 * Structural authority gate used only while the migration runner has explicitly disabled FK
 * enforcement for a referenced-table rebuild. It still proves database integrity, the complete
 * foreign-key graph, the locked schema fingerprint, and the cumulative semantic invariants.
 */
export function validateProductionSchemaVersionDuringForeignKeyRebuild(
  database: DatabaseSync,
  version: ValidatedProductionSchemaVersion,
): void {
  const foreignKeysEnabled = database.prepare('PRAGMA foreign_keys').get() as
    { foreign_keys?: number } | undefined;
  if (foreignKeysEnabled?.foreign_keys !== 0) {
    throw new Error(
      'Production schema rebuild validation requires foreign keys to be temporarily disabled.',
    );
  }
  const integrity = database.prepare('PRAGMA integrity_check').all() as Array<{
    integrity_check?: string;
  }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('Production schema validation failed: integrity_check did not return ok.');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('Production schema validation failed: foreign_key_check found violations.');
  }
  if (computeProductionSchemaFingerprint(database) !== EXPECTED_SCHEMA_FINGERPRINTS[version]) {
    throw new Error(
      `Production schema validation failed: version ${version} structural fingerprint mismatch.`,
    );
  }
  if (version >= 18) validateRevisionReuseSemantics(database);
  if (version >= 20) validateAutomationRevisionBindingSemantics(database);
}
