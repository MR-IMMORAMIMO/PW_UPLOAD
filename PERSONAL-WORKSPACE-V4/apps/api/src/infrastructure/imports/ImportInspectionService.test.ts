import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { AppUser } from '@scli/domain';
import { applyV24SmartImportInspection } from '../migration/registry/production-v24-smart-import-inspection';
import { ImportInspectionService } from './ImportInspectionService';
import { ImportSessionStore } from './ImportSessionStore';
import { ImportSourceAdmission } from './ImportSourceAdmission';

const actor: AppUser = {
  id: '11111111-1111-4111-8111-111111111111',
  entraObjectId: 'standalone:owner',
  displayName: 'Workspace Owner',
  email: 'owner@example.com',
  jobTitle: 'Owner',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

function harness() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  applyV24SmartImportInspection(database);
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5b-import-'));
  const admission = new ImportSourceAdmission(dataRoot);
  const store = new ImportSessionStore(database, () => new Date('2026-08-27T00:00:00.000Z'));
  return {
    database,
    dataRoot,
    admission,
    store,
    service: new ImportInspectionService(store, admission),
  };
}

describe('persistent Smart Import inspection service', () => {
  it('persists source hash, immutable raw rows, mappings, normalization, validation, and removes source bytes', async () => {
    const h = harness();
    const session = h.service.create(
      { destinationMode: 'PROJECT', projectId: '22222222-2222-4222-8222-222222222222' },
      actor,
    );
    const inspected = await h.service.inspectBuffer(
      session.importSessionId,
      'dialux.csv',
      Buffer.from(
        [
          'TAGText;ManufNameText;ArticleNumberText;ConnectedLoadText;LuminaireLuminousFluxText;CCTText',
          'Type / Tag;Manufacturer;Article Number;Connected Load [W];Luminaire Luminous Flux [lm];CCT [K]',
          'DL01;ERCO;ABC;4,4;242;3000',
        ].join('\n'),
      ),
    );
    expect(inspected.detectedAdapterId).toBe('DIALUX_NATIVE_CSV');
    expect(inspected.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inspected.counts.total).toBe(1);
    expect(existsSync(path.join(h.dataRoot, 'import-stage', session.importSessionId))).toBe(false);
    const rows = h.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' });
    expect(
      rows.items[0]!.rawCells.find((cell) => cell.sourceColumnKey === 'ConnectedLoadText'),
    ).toMatchObject({ rawValue: '4,4' });
    expect(
      rows.items[0]!.normalizationEvidence.find((item) => item.canonicalField === 'WATTAGE'),
    ).toMatchObject({ normalizedValue: 4.4, basis: 'W', unit: 'W', success: true });
    expect(h.store.get(session.importSessionId)).toEqual(inspected);
    expect(
      h.store.rows(session.importSessionId, { page: 0, limit: 1, filter: 'ALL', search: 'erco' })
        .totalCount,
    ).toBe(1);
    expect(
      h.store.rows(session.importSessionId, {
        page: 0,
        limit: 1,
        filter: 'ALL',
        search: "%_' OR 1=1",
      }).totalCount,
    ).toBe(0);
    expect(() => h.store.cancelEmptySelection(session.importSessionId)).toThrow();
    expect(
      h.store.rows(session.importSessionId, {
        page: 0,
        limit: 1,
        filter: 'ALL',
        matchQuality: 'UNRESOLVED',
        search: 'ERCO',
      }).totalCount,
    ).toBe(1);
    expect(
      h.store.rows(session.importSessionId, {
        page: 0,
        limit: 1,
        filter: 'ALL',
        matchQuality: 'EXACT',
      }).totalCount,
    ).toBe(0);
  });

  it('retains a cancelled empty selection without showing a phantom history item', () => {
    const h = harness();
    const session = h.service.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
    h.store.cancelEmptySelection(session.importSessionId);
    expect(h.store.get(session.importSessionId).sessionStatus).toBe('ABANDONED');
    expect(h.store.list(actor.id, { page: 0, limit: 30 }).totalCount).toBe(0);
    expect(h.store.cancelEmptySelection(session.importSessionId).sessionStatus).toBe('ABANDONED');
  });

  it('supports server pagination, filters, history reopen, and optimistic mapping concurrency', async () => {
    const h = harness();
    const session = h.service.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
    const lines = ['Manufacturer,Product Family,Ordering Code,Wattage [W]'];
    for (let index = 0; index < 125; index += 1)
      lines.push(`Brand ${index},Family ${index},SKU-${index},${index + 1}`);
    const inspected = await h.service.inspectBuffer(
      session.importSessionId,
      'many.csv',
      Buffer.from(lines.join('\n')),
    );
    expect(
      h.store.rows(session.importSessionId, { page: 1, limit: 50, filter: 'ALL' }).items,
    ).toHaveLength(50);
    expect(h.store.list(actor.id, { page: 0, limit: 30 }).items[0]!.sourceSha256).toBe(
      inspected.sourceSha256,
    );
    const table = h.store.tables(session.importSessionId)[0]!;
    const updated = h.service.updateTable(session.importSessionId, table.sourceTableId, {
      expectedRowVersion: table.rowVersion,
      expectedSessionRevision: inspected.sessionRevision,
      mapping: table.mapping,
    });
    expect(updated.rowVersion).toBe(table.rowVersion + 1);
    expect(() =>
      h.service.updateTable(session.importSessionId, table.sourceTableId, {
        expectedRowVersion: table.rowVersion,
        expectedSessionRevision: inspected.sessionRevision,
        selected: false,
      }),
    ).toThrow(/changed/i);
    const reopened = h.service.reinspect(session.importSessionId, inspected.sessionRevision + 1);
    expect(reopened.counts.total).toBe(125);
  });

  it('rejects the dangerous native DIALux Article Number and Article Name reversal without mutating the table', async () => {
    const h = harness();
    const session = h.service.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
    const inspected = await h.service.inspectBuffer(
      session.importSessionId,
      'dialux.csv',
      Buffer.from(
        [
          'TAGText;NumberText;ManufNameText;ArticleNumberText;ArticleNameText',
          'Type / Tag;Quantity;Manufacturer;Article Number;Article Name',
          'DL01;2;ERCO;ABC-01;Iku',
        ].join('\n'),
      ),
    );
    expect(inspected.detectedAdapterId).toBe('DIALUX_NATIVE_CSV');
    const before = h.store.tables(session.importSessionId)[0]!;
    const reversed = before.mapping.map((mapping) =>
      mapping.sourceColumnKey === 'ArticleNumberText'
        ? { ...mapping, canonicalField: 'PRODUCT_FAMILY' as const }
        : mapping.sourceColumnKey === 'ArticleNameText'
          ? { ...mapping, canonicalField: 'ORDERING_CODE' as const }
          : mapping,
    );

    expect(() =>
      h.service.updateTable(session.importSessionId, before.sourceTableId, {
        expectedRowVersion: before.rowVersion,
        expectedSessionRevision: inspected.sessionRevision,
        mapping: reversed,
      }),
    ).toThrow(/DIALUX_ARTICLE_NUMBER_IDENTITY_CONFLICT.*Restore Article No/i);
    expect(h.store.tables(session.importSessionId)[0]).toEqual(before);
  });

  it('rebuilds XLSX mappings and rows from persisted raw grid after header correction', async () => {
    const h = harness();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['Manufacturer', 'Product Family', 'Ordering Code']);
    sheet.addRow(['Wrong Brand', 'Wrong Family', 'WRONG-1']);
    sheet.addRow([]);
    sheet.addRow(['Manufacturer', 'Product Name', 'SKU']);
    sheet.addRow(['Delta Light', 'Spy', 'SPY-01']);
    const session = h.service.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
    const inspected = await h.service.inspectBuffer(
      session.importSessionId,
      'alternate-header.xlsx',
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    const table = h.store.tables(session.importSessionId)[0]!;
    const updated = h.service.updateTable(session.importSessionId, table.sourceTableId, {
      expectedRowVersion: table.rowVersion,
      expectedSessionRevision: inspected.sessionRevision,
      headerRow: 4,
      selected: true,
    });
    expect(updated.mapping.map((item) => item.sourceHeader)).toEqual([
      'Manufacturer',
      'Product Name',
      'SKU',
    ]);
    expect(updated.headerSignature).not.toBe(table.headerSignature);
    const reinspected = h.service.reinspect(session.importSessionId, inspected.sessionRevision + 1);
    expect(reinspected.counts.total).toBe(1);
    const row = h.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    expect(row.sourceRowNumber).toBe(5);
    expect(row.rawCells[1]).toMatchObject({ header: 'Product Name', rawValue: 'Spy' });
    expect(row.mappedCandidate.PRODUCT_FAMILY).toMatchObject({ normalizedValue: 'Spy' });
  });

  it('rejects unsupported/oversize sources, sanitizes names, hashes server-side, and rejects symlink staging', () => {
    const h = harness();
    expect(() =>
      h.admission.stageBuffer(
        '33333333-3333-4333-8333-333333333333',
        'source.pdf',
        Buffer.from('pdf'),
      ),
    ).toThrow(/CSV, TSV, or XLSX/);
    expect(() =>
      h.admission.stageBuffer(
        '33333333-3333-4333-8333-333333333333',
        'huge.csv',
        Buffer.alloc(10 * 1024 * 1024 + 1),
      ),
    ).toThrow(/size limit/);
    const admitted = h.admission.stageBuffer(
      '33333333-3333-4333-8333-333333333333',
      '..\\bad:name.csv',
      Buffer.from('A,B\n1,2'),
    );
    expect(admitted.displayFileName).toBe('bad_name.csv');
    expect(admitted.sha256).toMatch(/^[0-9a-f]{64}$/);

    const outside = path.join(h.dataRoot, 'outside.csv');
    writeFileSync(outside, 'A,B\n1,2');
    const inbox = h.admission.prepareDesktopInbox('44444444-4444-4444-8444-444444444444');
    const link = path.join(inbox, 'link.csv');
    try {
      symlinkSync(outside, link, 'file');
      expect(() =>
        h.admission.admitDesktopSelection('44444444-4444-4444-8444-444444444444'),
      ).toThrow(/regular file/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });

  it('rejects canonical staging escapes and sibling-prefix paths', () => {
    const h = harness();
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const inbox = h.admission.prepareDesktopInbox(sessionId);
    const outside = mkdtempSync(path.join(tmpdir(), 'p5b-import-outside-'));
    const outsideFile = path.join(outside, 'outside.csv');
    writeFileSync(outsideFile, 'A,B\n1,2');
    rmSync(inbox, { recursive: true, force: true });
    try {
      symlinkSync(outside, inbox, process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => h.admission.admitDesktopSelection(sessionId)).toThrow(
        /staged source is invalid/i,
      );
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error;
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }

    const sibling = `${h.admission.stageRoot}-sibling`;
    mkdirSync(sibling, { recursive: true });
    const siblingFile = path.join(sibling, 'sibling.csv');
    writeFileSync(siblingFile, 'A,B\n1,2');
    const internals = h.admission as unknown as {
      readAndValidate(candidate: string, displayFileName: string): unknown;
    };
    expect(() => internals.readAndValidate(siblingFile, 'sibling.csv')).toThrow(
      /staged source is invalid/i,
    );
    rmSync(sibling, { recursive: true, force: true });
  });
});
