import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  applyV12IssueAuditColumns,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
  applyV18RevisionReuseColumns,
  applyV19RevisionMetadataColumns,
  applyV20AutomationRevisionBindingAudit,
  applyV21OutputPresentationFamily,
} from '../migration/registry/production-migration-registry.js';
import {
  CanonicalOutputRegistryStore,
  type OutputRegistryClock,
} from './CanonicalOutputRegistryStore.js';

/**
 * Wires the existing canonical v4 authority into an isolated non-production Personal store.
 * This reuses the registered production DDL verbatim; it does not define or migrate new schema.
 * V4-ISSUE-A0: the additive v12 Issue-audit columns are applied alongside the v4 registry DDL
 * so non-production harnesses match the production schema target.
 */
export function createNonProductionPersonalCanonicalRegistry(
  personalStore: PersonalWorkspaceStore,
  clock: OutputRegistryClock,
): CanonicalOutputRegistryStore {
  const database = personalStore.getSharedDatabase();
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
    for (const statement of PRODUCTION_V13_DDL) database.exec(statement);
    for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
    for (const statement of PRODUCTION_V15_DDL) database.exec(statement);
    applyV12IssueAuditColumns(database);
    applyV15SnapshotProvenanceColumn(database);
    applyV16SnapshotRebuild(database);
    applyV17RevisionDeleteTable(database);
    applyV18RevisionReuseColumns(database);
    applyV19RevisionMetadataColumns(database);
    applyV20AutomationRevisionBindingAudit(database);
    applyV21OutputPresentationFamily(database, clock.now().toISOString());
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the schema-readiness error.
    }
    throw error;
  }
  const registry = new CanonicalOutputRegistryStore(database, clock, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  return registry;
}
