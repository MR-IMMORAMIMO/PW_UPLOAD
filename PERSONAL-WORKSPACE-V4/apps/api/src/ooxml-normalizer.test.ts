import { describe, expect, it } from 'vitest';
import { normalizeWorksheetOrdering } from './ooxml-normalizer';

describe('ooxml-normalizer', () => {
  it('reorders mergeCells after autoFilter when mergeCells appears first', () => {
    const xml =
      '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1" /></mergeCells>' +
      '<autoFilter ref="A4:B6" /><pageMargins />';
    const out = normalizeWorksheetOrdering(xml);
    const af = out.indexOf('<autoFilter');
    const mc = out.indexOf('<mergeCells');
    expect(af).toBeGreaterThan(-1);
    expect(mc).toBeGreaterThan(-1);
    expect(af).toBeLessThan(mc);
    expect(out).toContain('<mergeCell ref="A1:B1" />');
  });

  it('leaves already-correct order unchanged', () => {
    const xml =
      '</sheetData><autoFilter ref="A4:B6" /><mergeCells count="1">' +
      '<mergeCell ref="A1:B1" /></mergeCells><pageMargins />';
    expect(normalizeWorksheetOrdering(xml)).toBe(xml);
  });

  it('handles multiple mergeCells and preserves their content', () => {
    const xml =
      '<worksheet><mergeCells count="2"><mergeCell ref="A1:B1" /><mergeCell ref="C1:D1" /></mergeCells>' +
      '<autoFilter ref="A4:D6" /></worksheet>';
    const out = normalizeWorksheetOrdering(xml);
    const af = out.indexOf('<autoFilter');
    const mc = out.indexOf('<mergeCells');
    expect(af).toBeLessThan(mc);
    expect(out).toContain('<mergeCell ref="A1:B1" />');
    expect(out).toContain('<mergeCell ref="C1:D1" />');
  });

  it('returns input unchanged when either element is absent', () => {
    const onlyMerge = '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1" /></mergeCells>';
    expect(normalizeWorksheetOrdering(onlyMerge)).toBe(onlyMerge);
    const onlyFilter = '</sheetData><autoFilter ref="A4:B6" />';
    expect(normalizeWorksheetOrdering(onlyFilter)).toBe(onlyFilter);
    const neither = '</sheetData><pageMargins />';
    expect(normalizeWorksheetOrdering(neither)).toBe(neither);
  });
});
