import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { CrossDocumentConsistencyService } from './CrossDocumentConsistencyService';
import { DocumentIntelligenceStore } from './DocumentIntelligenceStore';
import { DocumentSourceAdmission } from './DocumentSourceAdmission';

const projectId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

function harness(documentTotal = 2) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p5c-consistency-'));
  roots.push(root);
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS) {
    database.exec(
      migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
        ? 'PRAGMA foreign_keys = OFF'
        : 'PRAGMA foreign_keys = ON',
    );
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
    });
    database.exec('COMMIT');
    database.exec('PRAGMA foreign_keys = ON');
  }
  database
    .prepare(
      `INSERT INTO project_workspaces(project_id,folder_path,folder_profile,services_json,input_mode,created_at,updated_at) VALUES (?,?,'Standard','[]','Manual',?,?)`,
    )
    .run(
      projectId,
      path.join(root, 'project'),
      '2026-08-27T00:00:00.000Z',
      '2026-08-27T00:00:00.000Z',
    );
  const store = new DocumentIntelligenceStore(database);
  const admission = new DocumentSourceAdmission(root);
  const admitted = Array.from({ length: documentTotal }, (_, index) => index + 1).map((sequence) =>
    store.createAdmission({
      bytes: admission.admitBuffer(
        Buffer.from(`%PDF-1.4\nconsistency ${sequence}\n%%EOF`),
        `Schedule ${sequence}.pdf`,
      ),
      admissionMechanism: 'PROJECT_SELECT',
      projectContextId: projectId,
      idempotencyKey: `consistency-${sequence}`,
    }),
  );
  for (const item of admitted) {
    store.applyDecision(
      item.documentId,
      {
        action: 'CONFIRM_PROJECT_ASSOCIATION',
        expectedRowVersion: 1,
        reason: 'Synthetic exact Project context.',
        projectId,
      },
      { id: 'owner', name: 'Owner' },
    );
    store.applyDecision(
      item.documentId,
      { action: 'ACCEPT_DOCUMENT', expectedRowVersion: 2, reason: 'Synthetic evidence accepted.' },
      { id: 'owner', name: 'Owner' },
    );
    store.applyDecision(
      item.documentId,
      {
        action: 'INCLUDE_COMPARISON',
        expectedRowVersion: 3,
        reason: 'Synthetic consistency scope.',
      },
      { id: 'owner', name: 'Owner' },
    );
  }
  const values = (index: number, wattage: number) => [
    {
      id: `${index}1111111-1111-4111-8111-111111111111`,
      versionId: admitted[index - 1]!.documentVersionId,
      pageNumber: 1,
      region: null,
      rawValue: 'Tag DL01',
      normalizedValue: 'DL01',
      canonicalField: 'TAG',
      unit: null,
      basis: null,
      method: 'NATIVE_TEXT' as const,
      confidence: 100,
      adapterId: 'TEST',
      extractorVersion: '1',
      warnings: [],
    },
    {
      id: `${index}2222222-2222-4222-8222-222222222222`,
      versionId: admitted[index - 1]!.documentVersionId,
      pageNumber: 1,
      region: null,
      rawValue: `${wattage} W`,
      normalizedValue: wattage,
      canonicalField: 'WATTAGE',
      unit: 'W',
      basis: 'per luminaire',
      method: 'NATIVE_TEXT' as const,
      confidence: 100,
      adapterId: 'TEST',
      extractorVersion: '1',
      warnings: [],
    },
    {
      id: `${index}3333333-3333-4333-8333-333333333333`,
      versionId: admitted[index - 1]!.documentVersionId,
      pageNumber: 1,
      region: null,
      rawValue: '10',
      normalizedValue: 10,
      canonicalField: 'QUANTITY',
      unit: index === 1 ? 'ea' : 'm',
      basis: index === 1 ? 'count' : 'length',
      method: 'NATIVE_TEXT' as const,
      confidence: 100,
      adapterId: 'TEST',
      extractorVersion: '1',
      warnings: [],
    },
  ];
  if (admitted[0])
    store.replaceAttemptValues(
      admitted[0].processingAttemptId,
      admitted[0].documentVersionId,
      values(1, 10),
    );
  if (admitted[1])
    store.replaceAttemptValues(
      admitted[1].processingAttemptId,
      admitted[1].documentVersionId,
      values(2, 12),
    );
  return {
    database,
    store,
    admitted,
    values,
    service: new CrossDocumentConsistencyService(database, store),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CrossDocumentConsistencyService', () => {
  it('returns authoritative reason codes when the Project source set is ineligible', () => {
    const empty = harness(0);
    expect(() => empty.service.recompute(projectId)).toThrowError(
      'No eligible accepted documents are enabled for comparison.',
    );
    try {
      empty.service.recompute(projectId);
    } catch (error) {
      expect(error).toMatchObject({
        details: { reasonCode: 'DOCUMENT_CONSISTENCY_NO_ELIGIBLE_DOCUMENTS' },
      });
    }
    empty.database.close();

    const one = harness(1);
    expect(() => one.service.recompute(projectId)).toThrowError(
      'At least two compatible documents are required for this comparison.',
    );
    try {
      one.service.recompute(projectId);
    } catch (error) {
      expect(error).toMatchObject({
        details: { reasonCode: 'DOCUMENT_CONSISTENCY_INSUFFICIENT_DOCUMENTS' },
      });
    }
    one.database.close();
  });

  it('shows every accepted source value, refuses incompatible bases, and supersedes stale generated conflicts', () => {
    const h = harness();
    const canonicalBefore = {
      revisions: h.database.prepare('SELECT COUNT(*) count FROM project_revisions').get(),
      luminaires: h.database.prepare('SELECT COUNT(*) count FROM project_luminaires').get(),
      libraryVersions: h.database
        .prepare('SELECT COUNT(*) count FROM luminaire_library_versions')
        .get(),
    };
    const first = h.service.recompute(projectId);
    expect(first.findings).toBe(2);
    expect(first.eligibleDocuments).toBe(2);
    expect(first.affectedDocumentIds).toHaveLength(1);
    const generated = h.database
      .prepare(
        `SELECT finding_code,state,evidence_json FROM document_quality_findings WHERE generation_fingerprint=? ORDER BY finding_code`,
      )
      .all(first.fingerprint) as Array<{
      finding_code: string;
      state: string;
      evidence_json: string;
    }>;
    expect(generated.map((row) => row.finding_code)).toEqual([
      'VALUE_BASIS_CONFLICT',
      'WATTAGE_CONFLICT',
    ]);
    const wattageEvidence = JSON.parse(
      generated.find((row) => row.finding_code === 'WATTAGE_CONFLICT')!.evidence_json,
    ) as unknown[];
    expect(wattageEvidence).toHaveLength(2);
    const exposed = h.store
      .findings(first.affectedDocumentIds[0]!)
      .find((finding) => finding.code === 'WATTAGE_CONFLICT');
    expect(
      exposed?.competingValues
        ?.map((source) => Number(source.value))
        .sort((left, right) => left - right),
    ).toEqual([10, 12]);
    h.store.replaceAttemptValues(
      h.admitted[1]!.processingAttemptId,
      h.admitted[1]!.documentVersionId,
      h.values(2, 10),
    );
    const second = h.service.recompute(projectId);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(
      h.database
        .prepare(
          `SELECT state FROM document_quality_findings WHERE generation_fingerprint=? AND finding_code='WATTAGE_CONFLICT'`,
        )
        .get(first.fingerprint),
    ).toEqual({ state: 'SUPERSEDED' });
    expect(
      h.database
        .prepare(
          `SELECT COUNT(*) count FROM document_extraction_values WHERE canonical_field='WATTAGE'`,
        )
        .get(),
    ).toEqual({ count: 2 });
    expect({
      revisions: h.database.prepare('SELECT COUNT(*) count FROM project_revisions').get(),
      luminaires: h.database.prepare('SELECT COUNT(*) count FROM project_luminaires').get(),
      libraryVersions: h.database
        .prepare('SELECT COUNT(*) count FROM luminaire_library_versions')
        .get(),
    }).toEqual(canonicalBefore);
    h.database.close();
  });
});
