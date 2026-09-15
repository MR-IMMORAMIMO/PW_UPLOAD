import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { createDocumentIntelligenceFixture } from './testing/DocumentIntelligenceFixture';
import { DocumentIntelligenceStore } from './DocumentIntelligenceStore';
import { DocumentProcessingWorker } from './DocumentProcessingWorker';
import { DocumentSourceAdmission } from './DocumentSourceAdmission';
import type { PdfExtractionAdapter } from './PdfExtractionAdapter';
import type { LocalOcrAdapter, OcrRegion } from './LocalOcrAdapter';

const roots: string[] = [];
function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p5c-worker-'));
  roots.push(root);
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
      clock: { now: () => new Date() },
    });
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
  }
  const store = new DocumentIntelligenceStore(db);
  const admission = new DocumentSourceAdmission(root);
  const worker = new DocumentProcessingWorker(store, admission);
  return { root, db, store, admission, worker };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('durable DocumentProcessingWorker', () => {
  it('runs native extraction before OCR and persists deterministic classification, fields, quality, and terminal state', async () => {
    const h = harness();
    const source = createDocumentIntelligenceFixture().find((item) => item.key === 'A')!
      .documents[0]!;
    const admitted = h.store.createAdmission({
      bytes: h.admission.admitBuffer(source.bytes, source.fileName),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'worker-native',
    });
    await h.worker.process(admitted.processingAttemptId);
    expect(h.store.activeAttempt(admitted.documentId).state).toBe('COMPLETE');
    expect(h.store.getDocument(admitted.documentId).classification).toBe(
      'DIALUX_CALCULATION_REPORT',
    );
    expect(
      h.store.evidence(admitted.documentVersionId, 0, 100).items.map((item) => item.canonicalField),
    ).toEqual(expect.arrayContaining(['ILLUMINANCE_AVERAGE', 'MAINTENANCE_FACTOR', 'QUANTITY']));
    expect(h.store.findings(admitted.documentId).some((item) => item.code === 'OCR_REQUIRED')).toBe(
      false,
    );
    await h.worker.close();
    h.db.close();
  });
  it('preserves malformed source bytes and produces a durable retryable attempt without canonical mutation', async () => {
    const h = harness();
    const source = createDocumentIntelligenceFixture().find((item) => item.key === 'K')!
      .documents[0]!;
    const managed = h.admission.admitBuffer(source.bytes, source.fileName);
    const admitted = h.store.createAdmission({
      bytes: managed,
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'worker-malformed',
    });
    await h.worker.process(admitted.processingAttemptId);
    expect(h.store.activeAttempt(admitted.documentId).state).toBe('FAILED_RETRYABLE');
    expect(h.store.findings(admitted.documentId).map((item) => item.code)).toContain(
      'PARSER_FAILED',
    );
    expect(h.admission.resolveManagedLocator(managed.managedLocator)).toMatch(/\.pdf$/);
    expect(h.store.getDocument(admitted.documentId).lifecycle).toBe('ADMITTED');
    await h.worker.close();
    h.db.close();
  });
  it('reconciles interrupted processing and queues idempotent manual targeted OCR with lifetime bounds', () => {
    const h = harness();
    const source = createDocumentIntelligenceFixture().find((item) => item.key === 'B')!
      .documents[0]!;
    const admitted = h.store.createAdmission({
      bytes: h.admission.admitBuffer(source.bytes, source.fileName),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'worker-restart',
    });
    h.store.setAttemptState(admitted.processingAttemptId, 'OCR', 'OCR_PAGE_1', { ocrPages: 1 });
    expect(h.store.interruptStaleAttempts()).toBe(1);
    const manual = h.store.requestManualOcr(admitted.documentId, 1, [1]);
    expect(manual.stageCheckpoint).toBe('MANUAL_OCR:1');
    expect(h.store.requestManualOcr(admitted.documentId, 1, [1]).id).toBe(manual.id);
    h.db.close();
  });
  it('performs at most one bounded targeted OCR second pass for a poor technical region', async () => {
    const h = harness();
    const bytes = createDocumentIntelligenceFixture().find((item) => item.key === 'A')!
      .documents[0]!;
    const admitted = h.store.createAdmission({
      bytes: h.admission.admitBuffer(bytes.bytes, bytes.fileName),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'worker-targeted-second-pass',
    });
    const pdf = {
      async images() {
        return [];
      },
      async extract() {
        return {
          pageCount: 1,
          capped: false,
          pages: [{ pageNumber: 1, text: '', usableTextCharacters: 0, needsOcr: true }],
        };
      },
      async renderPage() {
        return { png: Buffer.from('png'), width: 800, height: 1200, pageNumber: 1 };
      },
    } as PdfExtractionAdapter;
    const regions: Array<OcrRegion | undefined> = [];
    const ocr = {
      async recognize(_png: Buffer, region?: OcrRegion) {
        regions.push(region);
        return region
          ? {
              text: 'Product Datasheet\nOrdering Code: A100\nSystem Power: 15 W',
              confidence: 91,
              regions: [
                {
                  text: 'System Power: 15 W',
                  confidence: 91,
                  region: { x: 100, y: 220, width: 250, height: 30 },
                },
              ],
            }
          : {
              text: 'Product Datasheet\nOrdering C0de A100\nSystem P0wer 15 W',
              confidence: 54,
              regions: [
                {
                  text: 'Ordering Code A100',
                  confidence: 55,
                  region: { x: 90, y: 180, width: 260, height: 30 },
                },
                {
                  text: 'System Power 15 W',
                  confidence: 52,
                  region: { x: 100, y: 220, width: 250, height: 30 },
                },
              ],
            };
      },
      async terminate() {},
      async smoke() {},
    } as LocalOcrAdapter;
    const worker = new DocumentProcessingWorker(h.store, h.admission, pdf, ocr);
    await worker.process(admitted.processingAttemptId);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toBeUndefined();
    expect(regions[1]).toMatchObject({ x: 66, y: 156, width: 308, height: 118 });
    expect(h.store.activeAttempt(admitted.documentId).state).toBe('COMPLETE');
    h.db.close();
  });
  it('keeps corrupted native text when OCR output is still unreadable (poor OCR never becomes hard truth)', async () => {
    const h = harness();
    const bytes = createDocumentIntelligenceFixture().find((item) => item.key === 'A')!
      .documents[0]!;
    const admitted = h.store.createAdmission({
      bytes: h.admission.admitBuffer(bytes.bytes, bytes.fileName),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'worker-poor-ocr',
    });
    const corruptedNative =
      '\u000e\u0013\u0000\u0002\u0013$\u0002\u0017\u0003 \u0004\u0017\u0018\u0019';
    const pdf = {
      async extract() {
        return {
          pageCount: 1,
          capped: false,
          pages: [
            {
              pageNumber: 1,
              text: corruptedNative,
              usableTextCharacters: 28,
              needsOcr: true,
              nativeQuality: {
                nativeTextCharacterCount: 28,
                printableRatio: 0.3,
                controlRatio: 0.5,
                wordLikeTokenRatio: 0,
                longLetterTokenRatio: 0,
                suspiciousGlyphRatio: 0,
                readableLineRatio: 0,
                readabilityScore: 10,
                readingMode: 'NATIVE_CORRUPTED',
                decision: 'OCR_REQUIRED',
              },
            },
          ],
        };
      },
      async renderPage() {
        return { png: Buffer.from('png'), width: 800, height: 1200, pageNumber: 1 };
      },
    } as unknown as PdfExtractionAdapter;
    const ocr = {
      async recognize() {
        return {
          text: '\u000e\u0002\u0013\u0002\u0013\u0013\u0002\u0017\u0003\u0004\u0017\u0018\u0019\u001a\u001b\u0018',
          confidence: 22,
          regions: [],
        };
      },
      async terminate() {},
      async smoke() {},
    } as unknown as LocalOcrAdapter;
    const worker = new DocumentProcessingWorker(h.store, h.admission, pdf, ocr);
    await worker.process(admitted.processingAttemptId);
    expect(h.store.activeAttempt(admitted.documentId).state).toBe('COMPLETE');
    // Poor OCR must not replace native evidence with garbage and must not be
    // recorded as an OCR-sourced page (method stays NATIVE_TEXT).
    expect(h.store.findings(admitted.documentId).some((item) => item.code === 'OCR_REQUIRED')).toBe(
      true,
    );
    expect(
      h.store.findings(admitted.documentId).some((item) => item.code === 'OCR_LOW_CONFIDENCE'),
    ).toBe(true);
    const evidence = h.store.evidence(admitted.documentVersionId, 0, 100).items;
    expect(evidence.every((item) => item.method !== 'OCR')).toBe(true);
    h.db.close();
  });
  it('reconstructs OCR word geometry into canonical table rows before semantic extraction', async () => {
    const h = harness();
    const bytes = createDocumentIntelligenceFixture().find((item) => item.key === 'A')!
      .documents[0]!;
    // Luminaire-asset admission routes through the datasheet semantic engine.
    const assetPath = path.join(h.root, 'datasheet.pdf');
    writeFileSync(assetPath, bytes.bytes);
    const sha256 = createHash('sha256').update(bytes.bytes).digest('hex');
    const now = new Date().toISOString();
    // The v27 trigger requires real project + asset authority rows.
    h.db
      .prepare(
        `INSERT INTO project_workspaces
         (project_id,folder_path,folder_profile,services_json,input_mode,created_at,updated_at)
         VALUES (?,'','Classic SCLI','[]','DialuxCsv',?,?)`,
      )
      .run('project-1', now, now);
    h.db
      .prepare(
        `INSERT INTO project_luminaires
         (id,project_id,tag,category,image_path,description,manufacturer,model,wattage,
          lumens,light_color,cri,beam_angle,ip_rating,mounting,cutout,driver,control,
          emergency,datasheet_path,location,unit,quantity,notes,source_name,dimensions,
          body_color_finish,created_at,updated_at)
         VALUES (?,?,?,'Downlight','','','','','','','','','','','','','','','',
                 ?,'','',1,'','','','',?,?)`,
      )
      .run('lum-1', 'project-1', 'DL01', assetPath, now, now);
    h.db
      .prepare(
        `INSERT INTO luminaire_asset_versions
         (id,project_id,luminaire_id,asset_type,version_sequence,file_path,file_name,
          mime_type,size_bytes,file_hash,attached_at)
         VALUES (?,?,?,'Datasheet',1,?,?,'application/pdf',?,?,?)`,
      )
      .run(
        'asset-1',
        'project-1',
        'lum-1',
        assetPath,
        bytes.fileName,
        bytes.bytes.length,
        sha256,
        now,
      );
    const admitted = h.store.createLuminaireAssetAdmission({
      luminaireAssetVersionId: 'asset-1',
      projectId: 'project-1',
      luminaireId: 'lum-1',
      sha256,
      sizeBytes: bytes.bytes.length,
      originalFileName: bytes.fileName,
      idempotencyKey: 'worker-layout-reconstruction',
    });
    const pdf = {
      async extract() {
        return {
          pageCount: 1,
          capped: false,
          pages: [
            {
              pageNumber: 1,
              text: '',
              usableTextCharacters: 0,
              needsOcr: true,
              nativeQuality: { readingMode: 'IMAGE_ONLY', decision: 'OCR_REQUIRED' },
            },
          ],
        };
      },
      async renderPage() {
        return { png: Buffer.from('png'), width: 1800, height: 2330, pageNumber: 1 };
      },
    } as unknown as PdfExtractionAdapter;
    const ocr = {
      async recognize() {
        return {
          text: 'CCT (K) 3000 Forward voltage (V) 17.8',
          confidence: 85,
          regions: [],
          // Word geometry with a real two-column gutter (x 99..450 vs 648..930).
          words: [
            { text: 'CCT', confidence: 92, bbox: { x: 99, y: 748, width: 31, height: 18 } },
            { text: '(K)', confidence: 92, bbox: { x: 150, y: 748, width: 16, height: 18 } },
            { text: '3000', confidence: 96, bbox: { x: 355, y: 747, width: 50, height: 18 } },
            {
              text: 'Forward',
              confidence: 92,
              bbox: { x: 648, y: 752, width: 54, height: 18 },
            },
            { text: 'voltage', confidence: 92, bbox: { x: 721, y: 751, width: 58, height: 18 } },
            { text: '(V)', confidence: 92, bbox: { x: 804, y: 754, width: 13, height: 18 } },
            { text: '17.8', confidence: 93, bbox: { x: 888, y: 747, width: 40, height: 18 } },
          ],
        };
      },
      async terminate() {},
      async smoke() {},
    } as unknown as LocalOcrAdapter;
    const worker = new DocumentProcessingWorker(
      h.store,
      h.admission,
      pdf,
      ocr,
      undefined, // classification
      undefined, // association
      undefined, // lighting
      undefined, // quality
      undefined, // artifactSourceResolver
      undefined, // projectCandidates
      async () => assetPath, // luminaireAssetSourceResolver
    );
    await worker.process(admitted.processingAttemptId);
    expect(h.store.activeAttempt(admitted.documentId).state).toBe('COMPLETE');
    const evidence = h.store.evidence(admitted.documentVersionId, 0, 100).items;
    // The structured row "CCT (K) | 3000" must be extracted via OCR with
    // cell provenance; the Electrical column must not contaminate it.
    const cct = evidence.find((item) => item.canonicalField === 'CCT');
    expect(cct).toBeDefined();
    expect(cct?.method).toBe('OCR');
    expect(cct?.normalizedValue).toBe(3000);
    expect(cct?.warnings).toContain('UNIT_IN_LABEL');
    // No duplicate CCT from the flat text fallback.
    expect(evidence.filter((item) => item.canonicalField === 'CCT')).toHaveLength(1);
    // The region points at the structured cell (value cell bbox), not a line.
    expect(cct?.region).toMatchObject({ x: 355, y: 747 });
    h.db.close();
  });
});
