import type { DocumentClassification } from '@scli/domain';

export interface ClassificationResult {
  classification: DocumentClassification;
  confidence: number;
  evidence: string[];
  alternatives: Array<{ classification: DocumentClassification; confidence: number }>;
}

const signatures: Array<{
  classification: DocumentClassification;
  confidence: number;
  patterns: RegExp[];
}> = [
  {
    classification: 'DIALUX_CALCULATION_REPORT',
    confidence: 96,
    patterns: [/\bDIALux(?:\s+evo)?\b/i, /maintenance\s+factor/i, /illuminance/i],
  },
  {
    classification: 'LUMINAIRE_SCHEDULE',
    confidence: 92,
    patterns: [/luminaire\s+schedule/i, /ordering\s+code/i, /\bCCT\b/i],
  },
  {
    classification: 'BOQ_QTO',
    confidence: 91,
    patterns: [/bill\s+of\s+quantit/i, /\bBOQ\b/i, /quantity\s+take[- ]?off/i],
  },
  {
    classification: 'PRODUCT_DATASHEET',
    confidence: 90,
    patterns: [/product\s+datasheet/i, /luminous\s+flux/i, /beam\s+angle/i],
  },
  {
    classification: 'LIGHTING_LAYOUT',
    confidence: 88,
    patterns: [/lighting\s+layout/i, /luminaire\s+layout/i],
  },
  {
    classification: 'TECHNICAL_SUBMITTAL',
    confidence: 88,
    patterns: [/technical\s+submittal/i, /material\s+submittal/i],
  },
  {
    classification: 'CLIENT_COMMENT_MARKUP',
    confidence: 86,
    patterns: [/client\s+comment/i, /review\s+markup/i],
  },
  {
    classification: 'MEETING_DOCUMENT',
    confidence: 86,
    patterns: [/minutes\s+of\s+meeting/i, /meeting\s+minutes/i],
  },
  {
    classification: 'COMMERCIAL_RECEIPT',
    confidence: 84,
    patterns: [/tax\s+invoice/i, /payment\s+receipt/i],
  },
  {
    classification: 'REVISION_REGISTER',
    confidence: 90,
    patterns: [/revision\s+register/i, /revision\s+history/i],
  },
  {
    classification: 'TRANSMITTAL',
    confidence: 90,
    patterns: [/document\s+transmittal/i, /transmittal\s+no/i],
  },
  {
    classification: 'COVER_SHEET',
    confidence: 82,
    patterns: [/cover\s+sheet/i, /document\s+cover/i],
  },
  {
    classification: 'VISUALIZATION_RENDERING',
    confidence: 82,
    patterns: [/lighting\s+visuali[sz]ation/i, /rendering/i],
  },
  {
    classification: 'REFERENCE_DOCUMENT',
    confidence: 72,
    patterns: [/for\s+reference/i, /reference\s+document/i],
  },
];

export class DocumentClassificationService {
  public classify(text: string): ClassificationResult {
    const candidates = signatures
      .map((signature) => {
        const matched = signature.patterns.filter((pattern) => pattern.test(text));
        return {
          classification: signature.classification,
          confidence:
            matched.length === 0
              ? 0
              : Math.min(
                  99,
                  signature.confidence - 8 * (signature.patterns.length - matched.length),
                ),
          evidence: matched.map((pattern) => pattern.source),
        };
      })
      .filter((candidate) => candidate.confidence > 0)
      .sort((left, right) => right.confidence - left.confidence);
    const best = candidates[0];
    return best
      ? {
          classification: best.classification,
          confidence: best.confidence,
          evidence: best.evidence,
          alternatives: candidates
            .slice(1, 4)
            .map(({ classification, confidence }) => ({ classification, confidence })),
        }
      : { classification: 'UNKNOWN', confidence: 0, evidence: [], alternatives: [] };
  }
}
