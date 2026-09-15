import { randomUUID } from 'node:crypto';
import type { DocumentClassification, DocumentExtractionValue } from '@scli/domain';
import type { ExtractedPdfPage } from './PdfExtractionAdapter.js';

interface Rule {
  field: string;
  pattern: RegExp;
  unit?: string;
  basis?: string;
  confidence: number;
}

const dialuxRules: Rule[] = [
  {
    field: 'PROJECT_NAME',
    pattern: /project\s*(?:name)?\s*[:#-]\s*([^\n]{2,120})/i,
    confidence: 92,
  },
  {
    field: 'PROJECT_CODE',
    pattern: /project\s*(?:code|number|no\.?)\s*[:#-]\s*([^\s\n]{2,80})/i,
    confidence: 92,
  },
  {
    field: 'REPORT_DATE',
    pattern: /(?:report|calculation)\s*date\s*[:#-]\s*([^\n]{4,40})/i,
    confidence: 88,
  },
  {
    field: 'CALCULATION_OBJECT',
    pattern: /(?:calculation\s*object|room|area)\s*[:#-]\s*([^\n]{2,120})/i,
    confidence: 88,
  },
  {
    field: 'ILLUMINANCE_AVERAGE',
    pattern:
      /(?:e\s*avg|average|maintained)\s*(?:illuminance)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*lx\b/i,
    unit: 'lx',
    confidence: 95,
  },
  {
    field: 'ILLUMINANCE_MINIMUM',
    pattern: /(?:e\s*min|minimum)\s*(?:illuminance)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*lx\b/i,
    unit: 'lx',
    confidence: 95,
  },
  {
    field: 'ILLUMINANCE_MAXIMUM',
    pattern: /(?:e\s*max|maximum)\s*(?:illuminance)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*lx\b/i,
    unit: 'lx',
    confidence: 95,
  },
  {
    field: 'UNIFORMITY',
    pattern: /(?:uniformity|u0)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i,
    confidence: 92,
  },
  {
    field: 'MAINTENANCE_FACTOR',
    pattern: /maintenance\s*factor\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i,
    confidence: 97,
  },
  {
    field: 'INSTALLED_LOAD',
    pattern: /installed\s*(?:load|power)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(W|kW)\b/i,
    confidence: 94,
  },
  {
    field: 'TAG',
    pattern: /(?:luminaire\s*(?:identifier|id)|tag|type)\s*[:#-]\s*([A-Z]{1,6}[0-9]{1,4}[A-Z]?)/i,
    confidence: 91,
  },
  {
    field: 'QUANTITY',
    pattern: /(?:luminaire\s*)?(?:quantity|qty\.?)\s*[:#-]?\s*([0-9]+(?:\.[0-9]+)?)/i,
    unit: 'No.',
    basis: 'PROJECT_TOTAL',
    confidence: 92,
  },
];

const scheduleRules: Rule[] = [
  { field: 'TAG', pattern: /(?:tag|type)\s*[:#-]\s*([A-Z]{1,6}[0-9]{1,4}[A-Z]?)/i, confidence: 92 },
  {
    field: 'MANUFACTURER',
    pattern: /(?:manufacturer|make|brand)\s*[:#-]\s*([^\n|]{2,80})/i,
    confidence: 93,
  },
  {
    field: 'PRODUCT_FAMILY',
    pattern: /(?:product\s*family|family)\s*[:#-]\s*([^\n|]{2,100})/i,
    confidence: 90,
  },
  {
    field: 'ORDERING_CODE',
    pattern: /(?:ordering\s*code|article\s*(?:no\.?|number)|model)\s*[:#-]\s*([^\s\n|]{2,100})/i,
    confidence: 95,
  },
  {
    field: 'QUANTITY',
    pattern: /(?:quantity|qty\.?)\s*[:#-]?\s*([0-9]+(?:\.[0-9]+)?)/i,
    unit: 'No.',
    basis: 'PROJECT_TOTAL',
    confidence: 94,
  },
  {
    field: 'WATTAGE',
    pattern: /(?:wattage|power)\s*[:#-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(W|W\/m)\b/i,
    confidence: 95,
  },
  {
    field: 'LUMENS',
    pattern: /(?:lumens?|luminous\s*flux)\s*[:#-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(lm|lm\/m)\b/i,
    confidence: 95,
  },
  {
    field: 'CCT',
    pattern: /(?:CCT|colo(?:u)?r\s*temperature)\s*[:#-]?\s*([0-9]{4})\s*K\b/i,
    unit: 'K',
    confidence: 96,
  },
  {
    field: 'BEAM',
    pattern: /(?:beam(?:\s*angle)?|optic)\s*[:#-]?\s*([^\n|]{2,50})/i,
    confidence: 90,
  },
  {
    field: 'LOCATION',
    pattern: /(?:location|room|area)\s*[:#-]\s*([^\n|]{2,100})/i,
    confidence: 87,
  },
];

function normalized(value: string): string | number {
  const trimmed = value.trim();
  return /^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)
    ? Number(trimmed)
    : trimmed.replaceAll(/\s+/g, ' ');
}

export class LightingDocumentExtractionService {
  public extract(
    classification: DocumentClassification,
    pages: readonly ExtractedPdfPage[],
    methods: ReadonlyMap<number, 'NATIVE_TEXT' | 'OCR'>,
  ): DocumentExtractionValue[] {
    const values: DocumentExtractionValue[] = [];
    const rules =
      classification === 'DIALUX_CALCULATION_REPORT'
        ? dialuxRules
        : classification === 'LUMINAIRE_SCHEDULE' ||
            classification === 'BOQ_QTO' ||
            classification === 'PRODUCT_DATASHEET'
          ? scheduleRules
          : [];
    for (const page of pages) {
      if (page.text.trim()) {
        values.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: page.text.slice(0, 20_000),
          normalizedValue: null,
          canonicalField: 'PAGE_TEXT',
          unit: null,
          basis: null,
          method: methods.get(page.pageNumber) ?? 'NATIVE_TEXT',
          confidence: methods.get(page.pageNumber) === 'OCR' ? 70 : 100,
          adapterId: 'GENERIC_PDF_TEXT',
          extractorVersion: '1',
          warnings: [],
        });
      }
      for (const rule of rules) {
        const match = rule.pattern.exec(page.text);
        if (!match?.[1]) continue;
        const matchedUnit = match[2]?.trim() ?? rule.unit ?? null;
        values.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: match[0].slice(0, 500),
          normalizedValue: normalized(match[1]),
          canonicalField: rule.field,
          unit: matchedUnit,
          basis: rule.basis ?? null,
          method: methods.get(page.pageNumber) ?? 'NATIVE_TEXT',
          confidence:
            methods.get(page.pageNumber) === 'OCR'
              ? Math.max(50, rule.confidence - 15)
              : rule.confidence,
          adapterId:
            classification === 'DIALUX_CALCULATION_REPORT'
              ? 'DIALUX_ENGLISH_V1'
              : classification === 'PRODUCT_DATASHEET'
                ? 'PRODUCT_DATASHEET_V1'
                : 'LIGHTING_SCHEDULE_V1',
          extractorVersion: '1',
          warnings: [],
        });
      }
    }
    return values;
  }
}
