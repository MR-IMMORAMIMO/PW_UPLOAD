import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { DocumentIntelligenceStore } from './DocumentIntelligenceStore';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS) {
    db.exec(
      migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
        ? 'PRAGMA foreign_keys = OFF'
        : 'PRAGMA foreign_keys = ON',
    );
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database: db,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
    });
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}
const bytes = (hash = 'a'.repeat(64), name = 'document.pdf') => ({
  sha256: hash,
  sizeBytes: 100,
  originalFileName: name,
  managedLocator: `objects/${hash.slice(0, 2)}/${hash}.pdf`,
  absolutePath: 'never-persisted',
  reusedExistingBytes: false,
});
describe('DocumentIntelligenceStore', () => {
  it('persists immutable source/version identities, idempotency, pagination, and exact-duplicate evidence', () => {
    const db = database();
    const store = new DocumentIntelligenceStore(db, () => new Date('2026-08-27T01:00:00.000Z'));
    const first = store.createAdmission({
      bytes: bytes(),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'admission-one',
    });
    const replay = store.createAdmission({
      bytes: bytes(),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'admission-one',
    });
    expect(replay.documentId).toBe(first.documentId);
    const duplicate = store.createAdmission({
      bytes: bytes(),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'admission-two',
    });
    expect(duplicate.sourceId).toBe(first.sourceId);
    expect(store.relationships(duplicate.documentId)[0]?.type).toBe('EXACT_DUPLICATE');
    expect(store.list({ page: 0, limit: 1 }).totalCount).toBe(2);
    expect(store.versions(first.documentId)[0]?.sequence).toBe(1);
  });
  it('applies audited Owner CAS decisions and explicitly rejects stale writes', () => {
    const db = database();
    const store = new DocumentIntelligenceStore(db);
    const admitted = store.createAdmission({
      bytes: bytes('b'.repeat(64)),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'decision-doc',
    });
    const updated = store.applyDecision(
      admitted.documentId,
      { action: 'ACCEPT_DOCUMENT', expectedRowVersion: 1, reason: 'Reviewed synthetic evidence.' },
      { id: 'owner', name: 'Owner' },
    );
    expect(updated.lifecycle).toBe('ACCEPTED');
    expect(updated.rowVersion).toBe(2);
    expect(store.decisions(admitted.documentId)).toHaveLength(1);
    expect(() =>
      store.applyDecision(
        admitted.documentId,
        { action: 'EXCLUDE_DOCUMENT', expectedRowVersion: 1, reason: 'stale' },
        { id: 'owner', name: 'Owner' },
      ),
    ).toThrow(/Refresh|changed/i);
  });
  it('binds finding decisions to the reviewed document and exact generation fingerprint', () => {
    const db = database();
    const store = new DocumentIntelligenceStore(db);
    const first = store.createAdmission({
      bytes: bytes('d'.repeat(64)),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'finding-one',
    });
    const second = store.createAdmission({
      bytes: bytes('e'.repeat(64)),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'finding-two',
    });
    store.addFinding(
      first.documentId,
      first.documentVersionId,
      'PARSER_FAILED',
      'WARNING',
      'Synthetic finding',
      'Synthetic evidence.',
      'Owner review.',
      { page: 1 },
      { source: 'fixture' },
    );
    const finding = store.findings(first.documentId)[0]!;
    expect(() =>
      store.applyDecision(
        second.documentId,
        {
          action: 'ACKNOWLEDGE_FINDING',
          expectedRowVersion: 1,
          reason: 'Forged cross-document target.',
          findingId: finding.id,
          fingerprint: finding.generationFingerprint,
        },
        { id: 'owner', name: 'Owner' },
      ),
    ).toThrow(/unavailable|superseded/i);
    expect(store.getDocument(second.documentId).rowVersion).toBe(1);
    expect(() =>
      store.applyDecision(
        first.documentId,
        {
          action: 'ACKNOWLEDGE_FINDING',
          expectedRowVersion: 1,
          reason: 'Stale fingerprint.',
          findingId: finding.id,
          fingerprint: 'f'.repeat(64),
        },
        { id: 'owner', name: 'Owner' },
      ),
    ).toThrow(/unavailable|superseded/i);
    const updated = store.applyDecision(
      first.documentId,
      {
        action: 'ACKNOWLEDGE_FINDING',
        expectedRowVersion: 1,
        reason: 'Reviewed exact finding evidence.',
        findingId: finding.id,
        fingerprint: finding.generationFingerprint,
      },
      { id: 'owner', name: 'Owner' },
    );
    expect(updated.rowVersion).toBe(2);
    expect(store.findings(first.documentId)[0]?.state).toBe('ACKNOWLEDGED');
  });
  it('preserves confirmed Project and classification override authority across reprocessing', () => {
    const db = database();
    const projectId = '11111111-1111-4111-8111-111111111111';
    db.prepare(
      `INSERT INTO project_workspaces(project_id,folder_path,folder_profile,services_json,input_mode,created_at,updated_at) VALUES (?,?,'Standard','[]','Manual',?,?)`,
    ).run(projectId, 'C:/synthetic', '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z');
    const store = new DocumentIntelligenceStore(db);
    const admitted = store.createAdmission({
      bytes: bytes('9'.repeat(64)),
      admissionMechanism: 'PROJECT_SELECT',
      projectContextId: projectId,
      idempotencyKey: 'owner-authority',
    });
    store.applyDecision(
      admitted.documentId,
      {
        action: 'CONFIRM_PROJECT_ASSOCIATION',
        expectedRowVersion: 1,
        reason: 'Owner confirmed exact Project.',
        projectId,
      },
      { id: 'owner', name: 'Owner' },
    );
    store.applyDecision(
      admitted.documentId,
      {
        action: 'OVERRIDE_CLASSIFICATION',
        expectedRowVersion: 2,
        reason: 'Owner classified the reviewed source.',
        classification: 'TECHNICAL_SUBMITTAL',
      },
      { id: 'owner', name: 'Owner' },
    );
    store.updateAnalysis(
      admitted.documentId,
      admitted.processingAttemptId,
      'UNKNOWN',
      0,
      'UNRESOLVED',
      [{ strength: 'WEAK' }],
      { evidence: [] },
    );
    expect(store.getDocument(admitted.documentId)).toMatchObject({
      classification: 'TECHNICAL_SUBMITTAL',
      associationState: 'CONFIRMED',
      confirmedProjectId: projectId,
      lifecycle: 'NEEDS_REVIEW',
      rowVersion: 4,
    });
  });
  it('interrupts stale processing, creates one audited idempotent retry, and replaces attempt evidence without duplication', () => {
    const db = database();
    const store = new DocumentIntelligenceStore(db);
    const actor = { id: 'owner', name: 'Owner' };
    const admitted = store.createAdmission({
      bytes: bytes('c'.repeat(64)),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'processing-doc',
    });
    expect(store.interruptStaleAttempts()).toBe(0);
    store.setAttemptState(admitted.processingAttemptId, 'FAILED_RETRYABLE', 'FAILED', {
      errorCode: 'TEST',
    });
    const retry = store.retry(admitted.documentId, 1, 'retry-once', actor);
    expect(store.retry(admitted.documentId, 1, 'retry-once', actor).id).toBe(retry.id);
    expect(
      store.decisions(admitted.documentId).filter((item) => item.action === 'RETRY_PROCESSING'),
    ).toHaveLength(1);
    store.replaceAttemptValues(retry.id, admitted.documentVersionId, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        versionId: admitted.documentVersionId,
        pageNumber: 1,
        region: null,
        rawValue: 'Tag: DL01',
        normalizedValue: 'DL01',
        canonicalField: 'TAG',
        unit: null,
        basis: null,
        method: 'NATIVE_TEXT',
        confidence: 100,
        adapterId: 'TEST',
        extractorVersion: '1',
        warnings: [],
      },
    ]);
    store.replaceAttemptValues(retry.id, admitted.documentVersionId, []);
    expect(store.evidence(admitted.documentVersionId, 0, 100).totalCount).toBe(0);
  });
});
