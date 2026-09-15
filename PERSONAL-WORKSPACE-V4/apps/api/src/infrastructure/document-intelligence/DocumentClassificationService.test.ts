import { describe, expect, it } from 'vitest';
import { DocumentClassificationService } from './DocumentClassificationService';

describe('DocumentClassificationService', () => {
  it.each([
    ['DIALUX_CALCULATION_REPORT', 'DIALux evo maintenance factor illuminance'],
    ['LIGHTING_LAYOUT', 'Lighting layout reflected ceiling plan'],
    ['LUMINAIRE_SCHEDULE', 'Luminaire schedule ordering code CCT'],
    ['BOQ_QTO', 'Bill of quantities BOQ quantity take-off'],
    ['PRODUCT_DATASHEET', 'Product datasheet luminous flux beam angle'],
    ['TECHNICAL_SUBMITTAL', 'Technical submittal'],
    ['CLIENT_COMMENT_MARKUP', 'Client comment review markup'],
    ['REFERENCE_DOCUMENT', 'For reference reference document'],
    ['MEETING_DOCUMENT', 'Minutes of meeting'],
    ['COMMERCIAL_RECEIPT', 'Tax invoice payment receipt'],
    ['REVISION_REGISTER', 'Revision register revision history'],
    ['TRANSMITTAL', 'Document transmittal transmittal no'],
    ['COVER_SHEET', 'Cover sheet document cover'],
    ['VISUALIZATION_RENDERING', 'Lighting visualization rendering'],
    ['UNKNOWN', 'Unstructured synthetic content with no controlled signature'],
  ] as const)('classifies %s deterministically', (expected, text) => {
    const result = new DocumentClassificationService().classify(text);
    expect(result.classification).toBe(expected);
    if (expected === 'UNKNOWN') expect(result.confidence).toBe(0);
    else expect(result.confidence).toBeGreaterThan(0);
  });
});
