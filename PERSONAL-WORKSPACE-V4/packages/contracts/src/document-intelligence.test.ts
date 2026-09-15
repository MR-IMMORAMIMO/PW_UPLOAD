import { describe, expect, it } from 'vitest';
import {
  approveRoutingProposalSchema,
  createDocumentAdmissionSchema,
  documentListQuerySchema,
  manualOcrSchema,
  ownerDocumentDecisionSchema,
} from './document-intelligence';

const uuid = '11111111-1111-4111-8111-111111111111';
describe('Document Intelligence contracts', () => {
  it('accepts bounded identity-only admission and rejects renderer path authority', () => {
    expect(
      createDocumentAdmissionSchema.parse({
        originalFileName: 'report.pdf',
        projectContextId: uuid,
        idempotencyKey: 'admission-1',
      }),
    ).toBeTruthy();
    expect(() =>
      createDocumentAdmissionSchema.parse({
        originalFileName: 'report.pdf',
        idempotencyKey: 'admission-1',
        sourcePath: 'C:\\private\\report.pdf',
      }),
    ).toThrow();
  });
  it('rejects forged decisions, stale-shape routing, and over-limit OCR requests', () => {
    expect(() =>
      ownerDocumentDecisionSchema.parse({
        action: 'CONFIRM_PROJECT_ASSOCIATION',
        expectedRowVersion: 1,
        reason: 'confirm',
        projectId: uuid,
        absolutePath: 'C:\\x.pdf',
      }),
    ).toThrow();
    expect(() =>
      approveRoutingProposalSchema.parse({
        expectedRowVersion: 1,
        expectedEligibilityFingerprint: 'bad',
        reason: 'approve',
      }),
    ).toThrow();
    expect(() =>
      manualOcrSchema.parse({
        expectedRowVersion: 1,
        pageNumbers: Array.from({ length: 11 }, (_, index) => index + 1),
      }),
    ).toThrow();
  });
  it('enforces server pagination bounds and typed filters', () => {
    expect(documentListQuerySchema.parse({ page: '0', limit: '50' }).limit).toBe(50);
    expect(() => documentListQuerySchema.parse({ limit: '51' })).toThrow();
    expect(() => documentListQuerySchema.parse({ processingState: 'DONE' })).toThrow();
  });
});
