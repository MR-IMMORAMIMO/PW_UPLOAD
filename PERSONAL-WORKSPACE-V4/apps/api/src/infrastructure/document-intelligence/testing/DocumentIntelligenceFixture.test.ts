import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DocumentClassificationService } from '../DocumentClassificationService';
import { LightingDocumentExtractionService } from '../LightingDocumentExtractionService';
import { LocalOcrAdapter } from '../LocalOcrAdapter';
import { PdfExtractionAdapter } from '../PdfExtractionAdapter';
import { ProjectAssociationService } from '../ProjectAssociationService';
import {
  createCorruptedEncodingDocumentPdf,
  createDocumentIntelligenceFixture,
  SYNTHETIC_PROJECTS,
} from './DocumentIntelligenceFixture';

const root = mkdtempSync(path.join(os.tmpdir(), 'p5c-al-'));
const fixtures = createDocumentIntelligenceFixture();
afterAll(() => rmSync(root, { recursive: true, force: true }));
function file(key: string, index = 0) {
  const fixture = fixtures.find((item) => item.key === key)!;
  const document = fixture.documents[index]!;
  const target = path.join(root, `${key}-${index}.pdf`);
  writeFileSync(target, document.bytes);
  return { fixture, document, target };
}

describe('deterministic disposable A-L Document Intelligence fixture', () => {
  it('contains every synthetic case and preserves exact versus different byte identity', () => {
    expect(fixtures.map((item) => item.key)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
    ]);
    const a = file('A').document.bytes,
      c = file('C').document.bytes,
      d = file('D').document.bytes;
    const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
    expect(hash(c)).toBe(hash(a));
    expect(hash(d)).not.toBe(hash(a));
  });
  it('extracts searchable DIALux evidence natively and signature-gates lighting fields', async () => {
    const parsed = await new PdfExtractionAdapter().extract(file('A').target);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]?.needsOcr).toBe(false);
    const classified = new DocumentClassificationService().classify(parsed.pages[0]!.text);
    expect(classified.classification).toBe('DIALUX_CALCULATION_REPORT');
    const values = new LightingDocumentExtractionService().extract(
      classified.classification,
      parsed.pages,
      new Map([[1, 'NATIVE_TEXT']]),
    );
    expect(values.map((value) => value.canonicalField)).toEqual(
      expect.arrayContaining(['MAINTENANCE_FACTOR', 'ILLUMINANCE_AVERAGE', 'QUANTITY']),
    );
  });
  it('detects image-only pages, renders within bounds, and obtains local OCR confidence evidence', async () => {
    const pdf = new PdfExtractionAdapter();
    const source = file('B').target;
    const parsed = await pdf.extract(source);
    expect(parsed.pages[0]?.needsOcr).toBe(true);
    const rendered = await pdf.renderPage(source, 1);
    expect(rendered.width * rendered.height).toBeLessThanOrEqual(5_000_000);
    const ocr = new LocalOcrAdapter();
    try {
      const result = await ocr.recognize(rendered.png);
      expect(result.text.trim().length).toBeGreaterThan(5);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.regions.length).toBeGreaterThan(0);
    } finally {
      await ocr.terminate();
    }
  }, 60_000);
  it('classifies high-character-count corrupted native text as OCR-required, not native-readable', async () => {
    const pdf = new PdfExtractionAdapter();
    const target = path.join(root, 'corrupted-encoding.pdf');
    writeFileSync(target, createCorruptedEncodingDocumentPdf());
    const parsed = await pdf.extract(target);
    expect(parsed.pages).toHaveLength(1);
    const page = parsed.pages[0]!;
    // Quantity alone is high - the old quantity-only threshold would accept it.
    expect(page.usableTextCharacters).toBeGreaterThan(80);
    // Quality decides: the gate must classify it as corrupted and OCR-required.
    expect(page.needsOcr).toBe(true);
    expect(page.nativeQuality?.readingMode).toBe('NATIVE_CORRUPTED');
    expect(page.nativeQuality?.decision).toBe('OCR_REQUIRED');
  });
  it('surfaces conflicting strong context, ambiguous exact names, weak code, and reference classification without promotion', async () => {
    const pdf = new PdfExtractionAdapter();
    const association = new ProjectAssociationService();
    const eText = (await pdf.extract(file('E').target)).pages[0]!.text;
    expect(
      association.evaluate(eText, file('E').document.projectContextId!, SYNTHETIC_PROJECTS).state,
    ).toBe('CONFLICTING');
    const fText = (await pdf.extract(file('F').target)).pages[0]!.text;
    expect(association.evaluate(fText, null, SYNTHETIC_PROJECTS).state).toBe('AMBIGUOUS');
    expect(association.evaluate('SYN-A', null, SYNTHETIC_PROJECTS).state).toBe('UNRESOLVED');
    const gText = (await pdf.extract(file('G').target)).pages[0]!.text;
    expect(new DocumentClassificationService().classify(gText).classification).toBe(
      'REFERENCE_DOCUMENT',
    );
  });
});
