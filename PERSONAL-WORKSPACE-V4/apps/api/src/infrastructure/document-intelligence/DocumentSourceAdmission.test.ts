import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOCUMENT_INTELLIGENCE_LIMITS } from '@scli/domain';
import { DocumentSourceAdmission } from './DocumentSourceAdmission';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p5c-source-'));
  roots.push(root);
  return new DocumentSourceAdmission(root);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('DocumentSourceAdmission', () => {
  it('admits immutable PDF bytes, strips external path authority, and physically deduplicates', () => {
    const admission = fixture();
    const pdf = Buffer.from('%PDF-1.4\nsynthetic\n%%EOF');
    const first = admission.admitBuffer(pdf, 'A.pdf');
    const second = admission.admitBuffer(pdf, 'B.pdf');
    expect(first.sha256).toBe(second.sha256);
    expect(second.reusedExistingBytes).toBe(true);
    expect(first.managedLocator).not.toContain(':');
    expect(readFileSync(admission.resolveManagedLocator(first.managedLocator))).toEqual(pdf);
  });
  it('rejects extension, signature, traversal, and oversized inputs without losing prior sources', () => {
    const admission = fixture();
    expect(() => admission.admitBuffer(Buffer.from('%PDF-1.4'), 'source.docx')).toThrow(
      /PDF files only/i,
    );
    expect(() => admission.admitBuffer(Buffer.from('not pdf'), 'source.pdf')).toThrow(/signature/i);
    expect(() => admission.resolveManagedLocator('../outside.pdf')).toThrow(/invalid|unavailable/i);
    expect(() =>
      admission.admitBuffer(Buffer.alloc(DOCUMENT_INTELLIGENCE_LIMITS.pdfBytes + 1), 'large.pdf'),
    ).toThrow(/50 MiB/i);
  });
  it('reconciles only stale application-owned staging directories', () => {
    const admission = fixture();
    const id = '11111111-1111-4111-8111-111111111111';
    admission.prepareDesktopInbox(id);
    expect(admission.reconcileStaging(new Set(), new Date(Date.now() + 25 * 60 * 60 * 1000))).toBe(
      1,
    );
  });
});
