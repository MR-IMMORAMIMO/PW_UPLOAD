import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { createSmartImportUatFixtures } from './create-smart-import-uat-fixtures';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('Smart Import Owner UAT fixture factory', () => {
  it('creates only disposable DIALux, generic TSV, and multi-sheet XLSX sources', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'p5b-owner-uat-'));
    roots.push(root);
    const paths = await createSmartImportUatFixtures(root);
    expect(paths).toHaveLength(3);
    expect(readFileSync(paths[0]!, 'utf8')).toContain('TAGText;ManufNameText');
    expect(readFileSync(paths[1]!, 'utf8').split('\n').length).toBeGreaterThan(100);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(paths[2]!);
    expect(workbook.worksheets).toHaveLength(3);
    expect(workbook.getWorksheet('Hidden options')?.state).toBe('hidden');
    expect(paths.every((fixture) => statSync(fixture).isFile())).toBe(true);
  });
});
