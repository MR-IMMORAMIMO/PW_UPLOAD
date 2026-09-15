import { randomUUID } from 'node:crypto';
import type { DocumentExtractionValue } from '@scli/domain';
import type { ExtractedPdfPage } from './PdfExtractionAdapter.js';

/**
 * Narrow deterministic ERCO manufacturer Datasheet adapter.
 *
 * This adapter activates ONLY from strong PDF content signatures. It never
 * activates from filename, folder name, or the Project Manufacturer field.
 * It emits evidence over the shared semantic evidence model so the existing
 * verification pipeline can consume it unchanged.
 */
export const ERCO_ADAPTER_ID = 'ERCO_DATASHEET_V1';

const ERCO_BRAND = /\berco\b/i;

/** ERCO-specific vocabulary that is strong evidence of an ERCO Datasheet. */
const ERCO_VOCABULARY: ReadonlyArray<RegExp> = Object.freeze([
  ERCO_BRAND,
  /art\.?\s*no\.?/i,
  /connected\s+load/i,
  /luminous\s+flux\s+of\s+the\s+luminaire/i,
  /colour\s+rendition\s+index\s+cri/i,
  /fresnel\s+lens/i,
  /led\s+module/i,
  /casambi/i,
  /\bip\s*[0-9]{2,3}\b/i,
  // ERCO article codes (letter + 7 digits) are a strong structural signature
  // of an ERCO Datasheet when they appear as product-title tokens.
  /^[A-Z][0-9]{7}\b/m,
]);

/** Recognized qualitative optic / distribution terms (never numeric angles). */
const DISTRIBUTION_TERMS: ReadonlyArray<string> = Object.freeze([
  'wide flood',
  'narrow flood',
  'extra wide flood',
  'medium flood',
  'flood',
  'wide',
  'narrow spot',
  'very narrow spot',
  'spot',
  'narrow',
  'asymmetric',
  'symmetric',
  'wall wash',
  'wallwasher',
  'batwing',
  'linear',
]);

function clean(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

export class ErcoDatasheetAdapter {
  public static readonly version = 'erco-datasheet-v3';

  /**
   * Content-gated activation. Requires at least two distinct ERCO-specific
   * vocabulary signatures to avoid false activation from a stray brand mention.
   */
  public detect(pages: readonly ExtractedPdfPage[]): boolean {
    const joined = pages.map((page) => page.text).join('\n');
    const vocabularyHits = ERCO_VOCABULARY.filter((pattern) => pattern.test(joined)).length;
    return vocabularyHits >= 2;
  }

  public extract(
    pages: readonly ExtractedPdfPage[],
    methods: ReadonlyMap<number, 'NATIVE_TEXT' | 'OCR'>,
  ): DocumentExtractionValue[] {
    const results: DocumentExtractionValue[] = [];
    for (const page of pages) {
      const method = methods.get(page.pageNumber) ?? 'NATIVE_TEXT';
      const lines = page.text.split(/\r?\n/).map(clean).filter(Boolean);

      // Manufacturer brand signature. The real ERCO PDF carries brand evidence
      // but not a conventional "Manufacturer: ERCO" key/value row, so we emit a
      // brand-signature evidence type with page/context provenance.
      const brandLine = lines.find((line) => ERCO_BRAND.test(line));
      if (brandLine) {
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: brandLine.slice(0, 500),
          normalizedValue: 'ERCO',
          canonicalField: 'MANUFACTURER',
          unit: null,
          basis: 'PRODUCT_IDENTITY',
          method,
          confidence: 90,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: [
            'LABEL:Manufacturer',
            'EVIDENCE_TYPE:MANUFACTURER_BRAND_SIGNATURE',
            `CONTEXT:${brandLine.slice(0, 300)}`,
          ],
        });
      }

      // ERCO article product-title structure. The real PDF repeats the article
      // number as the leading token of product-title lines, e.g.:
      //   A2000427 White (RAL9002)
      //   A2000427 LED module: 9.3W 1636lm 3000K warm white
      // The article token is a single ERCO-style code (letter + 7 digits) and
      // is extracted from PDF content only — never from the filename. A bare
      // article line (no trailing content) is owned by the flattened-table
      // path and is not re-emitted here.
      for (const line of lines) {
        const article = line.match(/^([A-Z][0-9]{7})\s+\S/);
        if (!article?.[1]) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: article[1],
          canonicalField: 'ORDERING_CODE',
          unit: null,
          basis: 'PRODUCT_IDENTITY',
          method,
          confidence: 92,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: [
            'LABEL:Ordering Code',
            'EVIDENCE_TYPE:ARTICLE_PRODUCT_TITLE',
            `CONTEXT:${line.slice(0, 300)}`,
          ],
        });
      }

      // ERCO footer product-title structure. The real PDF repeats the
      // commercial product name in the page footer bound to the article, e.g.:
      //   E Iku Downlight
      //   Iku Downlight
      //   A2000427
      // The footer line is a commercial model/product name, never an ordering
      // code. It is extracted from PDF content only — never from the filename.
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        const footer = line.match(/^E\s+([A-Z][a-zA-Z0-9 &+./-]{2,60})$/);
        if (!footer?.[1]) continue;
        // The footer must be article-bound: the article code appears on the
        // same page (typically the footer line below the product name).
        const pageHasArticle = lines.some((candidate) => /^[A-Z][0-9]{7}\b/.test(candidate));
        if (!pageHasArticle) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: footer[1].toLocaleUpperCase('en'),
          canonicalField: 'MODEL',
          unit: null,
          basis: 'PRODUCT_IDENTITY',
          method,
          confidence: 90,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: [
            'LABEL:Model',
            'EVIDENCE_TYPE:FOOTER_PRODUCT_TITLE',
            `CONTEXT:${line.slice(0, 300)}`,
          ],
        });
      }

      // ERCO article-bound finish. The real PDF presents the finish bound to
      // the exact article in the product-title line, e.g.:
      //   A2000427 White (RAL9002)
      // The finish is extracted only when the line is article-bound.
      for (const line of lines) {
        const finish = line.match(/^[A-Z][0-9]{7}\s+([A-Z][a-zA-Z0-9 &+./()-]{2,60})$/);
        if (!finish?.[1]) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: finish[1].toLocaleUpperCase('en'),
          canonicalField: 'BODY_COLOR',
          unit: null,
          basis: 'ENCLOSURE',
          method,
          confidence: 92,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: [
            'LABEL:Body Color / Finish',
            'EVIDENCE_TYPE:ARTICLE_BOUND_FINISH',
            `CONTEXT:${line.slice(0, 300)}`,
          ],
        });
      }

      // ERCO exact supplied control. The real PDF states the exact control
      // gear supplied with the article, e.g.:
      //   Includes ERCO Casambi control gear.
      // This is exact configuration evidence, never an optional capability.
      for (const line of lines) {
        const control =
          line.match(/^Includes\s+(?:ERCO\s+)?(.+?)\s+control\s+gear\.?$/i) ??
          (page.pageNumber === 1 ? line.match(/^(DALI-?2)$/i) : null);
        if (!control?.[1]) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: control[1].toLocaleUpperCase('en'),
          canonicalField: 'CONTROL',
          unit: null,
          basis: 'CONTROL',
          method,
          confidence: 94,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: [
            'LABEL:Control / Dimming',
            'EVIDENCE_TYPE:EXACT_SUPPLIED_CONTROL',
            `CONTEXT:${line.slice(0, 300)}`,
          ],
        });
      }

      // ERCO emergency capability. The real PDF states approval for emergency
      // use, e.g.:
      //   Approved for use as emergency lighting according to IEC / EN 60598-2-22.
      // This is capability/approval evidence, never exact Project emergency
      // configuration. It is emitted with a CAPABILITY_ONLY warning and a
      // confidence below the HIGH threshold so it can never be adopted or
      // produce a hard conflict.
      for (const line of lines) {
        const emergency = line.match(
          /^Approved\s+for\s+use\s+as\s+(.+?)\s+according\s+to\s+(.+)$/i,
        );
        if (!emergency?.[1]) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: emergency[1],
          canonicalField: 'EMERGENCY',
          unit: null,
          basis: 'EMERGENCY',
          method,
          confidence: 60,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: [
            'LABEL:Emergency',
            'EVIDENCE_TYPE:EMERGENCY_APPROVAL',
            'CAPABILITY_ONLY',
            `CONTEXT:${line.slice(0, 300)}`,
          ],
        });
      }

      // ERCO IP icon/text structure. The real PDF presents a standalone
      // "IP 20" specification line AND an embedded compound line
      // (e.g. "C 3 W IP 20"). The generic parser cannot bind either because
      // the value regex requires the "IP" prefix; the ERCO adapter owns this
      // structural context. Never confused with IK.
      for (const line of lines) {
        const ip = line.match(/\bIP\s*([0-9]{2,3})\b/i);
        if (!ip?.[1]) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: `IP${ip[1]}`,
          canonicalField: 'IP_RATING',
          unit: null,
          basis: 'ENCLOSURE',
          method,
          confidence: 92,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: ['LABEL:IP Rating', `CONTEXT:${line.slice(0, 300)}`],
        });
      }

      // ERCO light distribution structure: "Fresnel lens <qualitative term>".
      // This is a qualitative optic term, never a numeric beam angle.
      for (const line of lines) {
        const fresnel = line.match(/fresnel\s+lens\s+(.+)/i);
        if (!fresnel?.[1]) continue;
        const term = DISTRIBUTION_TERMS.find((candidate) =>
          fresnel[1]!.toLocaleLowerCase('en').includes(candidate),
        );
        if (!term) continue;
        results.push({
          id: randomUUID(),
          versionId: '',
          pageNumber: page.pageNumber,
          region: null,
          rawValue: line.slice(0, 500),
          normalizedValue: term.toLocaleUpperCase('en'),
          canonicalField: 'LIGHT_DISTRIBUTION',
          unit: null,
          basis: 'OPTIC',
          method,
          confidence: 92,
          adapterId: ERCO_ADAPTER_ID,
          extractorVersion: ErcoDatasheetAdapter.version,
          warnings: ['LABEL:Light Distribution', `CONTEXT:${line.slice(0, 300)}`],
        });
      }

      // ERCO compound LED module block. The real PDF presents:
      //   LED module
      //   9.3 W
      //   1636 lm
      //   3000 K
      //   warm white
      // Each semantic subtype is preserved independently. The "LED module"
      // label anchors the block; the following lines carry LED power, LED flux,
      // and CCT. This never substitutes LED power for system power or LED flux
      // for luminaire flux.
      for (let index = 0; index < lines.length; index += 1) {
        if (!/^led\s+module$/i.test(lines[index]!)) continue;
        const block = lines.slice(index + 1, index + 6);
        const power = block.find((line) => /^[0-9]+(?:\.[0-9]+)?\s*w\b/i.test(line));
        const flux = block.find((line) => /^[0-9][0-9 ,.]*\s*lm\b/i.test(line));
        const cct = block.find((line) => /^[0-9]{4}\s*k\b/i.test(line));
        if (power) {
          results.push({
            id: randomUUID(),
            versionId: '',
            pageNumber: page.pageNumber,
            region: null,
            rawValue: `LED module / ${power}`,
            normalizedValue: Number(power.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]),
            canonicalField: 'LED_POWER',
            unit: 'W',
            basis: 'LIGHT_SOURCE',
            method,
            confidence: 94,
            adapterId: ERCO_ADAPTER_ID,
            extractorVersion: ErcoDatasheetAdapter.version,
            warnings: ['LABEL:LED Power', `CONTEXT:LED module / ${power}`],
          });
        }
        if (flux) {
          results.push({
            id: randomUUID(),
            versionId: '',
            pageNumber: page.pageNumber,
            region: null,
            rawValue: `LED module / ${flux}`,
            normalizedValue: Number(flux.replaceAll(',', '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]),
            canonicalField: 'LED_FLUX',
            unit: 'lm',
            basis: 'LIGHT_SOURCE',
            method,
            confidence: 94,
            adapterId: ERCO_ADAPTER_ID,
            extractorVersion: ErcoDatasheetAdapter.version,
            warnings: ['LABEL:LED Flux', `CONTEXT:LED module / ${flux}`],
          });
        }
        if (cct) {
          results.push({
            id: randomUUID(),
            versionId: '',
            pageNumber: page.pageNumber,
            region: null,
            rawValue: `LED module / ${cct}`,
            normalizedValue: Number(cct.match(/[0-9]{4}/)?.[0]),
            canonicalField: 'CCT',
            unit: 'K',
            basis: 'LIGHT_SOURCE',
            method,
            confidence: 94,
            adapterId: ERCO_ADAPTER_ID,
            extractorVersion: ErcoDatasheetAdapter.version,
            warnings: ['LABEL:CCT', `CONTEXT:LED module / ${cct}`],
          });
        }
      }
      // ERCO inline compound LED module specification. The real PDF also
      // presents the compound on ONE line, e.g.:
      //   LED module: 9.3W 1636lm 3000K warm white
      //   A2000427 LED module: 9.3W 1636lm 3000K warm white
      // Each semantic subtype is preserved independently and never substitutes
      // LED power for system power or LED flux for luminaire flux.
      for (const line of lines) {
        const inline = line.match(/led\s+module\s*:\s*(.+)$/i);
        if (!inline?.[1]) continue;
        const block = [inline[1]];
        const power = block
          .map((candidate) => candidate.match(/[0-9]+(?:\.[0-9]+)?\s*w\b/i)?.[0])
          .find(Boolean);
        const flux = block
          .map((candidate) => candidate.match(/[0-9][0-9 ,.]*\s*lm\b/i)?.[0])
          .find(Boolean);
        const cct = block.map((candidate) => candidate.match(/[0-9]{4}\s*k\b/i)?.[0]).find(Boolean);
        if (power) {
          results.push({
            id: randomUUID(),
            versionId: '',
            pageNumber: page.pageNumber,
            region: null,
            rawValue: `LED module / ${power}`,
            normalizedValue: Number(power.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]),
            canonicalField: 'LED_POWER',
            unit: 'W',
            basis: 'LIGHT_SOURCE',
            method,
            confidence: 94,
            adapterId: ERCO_ADAPTER_ID,
            extractorVersion: ErcoDatasheetAdapter.version,
            warnings: ['LABEL:LED Power', `CONTEXT:LED module / ${power}`],
          });
        }
        if (flux) {
          results.push({
            id: randomUUID(),
            versionId: '',
            pageNumber: page.pageNumber,
            region: null,
            rawValue: `LED module / ${flux}`,
            normalizedValue: Number(flux.replaceAll(',', '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]),
            canonicalField: 'LED_FLUX',
            unit: 'lm',
            basis: 'LIGHT_SOURCE',
            method,
            confidence: 94,
            adapterId: ERCO_ADAPTER_ID,
            extractorVersion: ErcoDatasheetAdapter.version,
            warnings: ['LABEL:LED Flux', `CONTEXT:LED module / ${flux}`],
          });
        }
        if (cct) {
          results.push({
            id: randomUUID(),
            versionId: '',
            pageNumber: page.pageNumber,
            region: null,
            rawValue: `LED module / ${cct}`,
            normalizedValue: Number(cct.match(/[0-9]{4}/)?.[0]),
            canonicalField: 'CCT',
            unit: 'K',
            basis: 'LIGHT_SOURCE',
            method,
            confidence: 94,
            adapterId: ERCO_ADAPTER_ID,
            extractorVersion: ErcoDatasheetAdapter.version,
            warnings: ['LABEL:CCT', `CONTEXT:LED module / ${cct}`],
          });
        }
      }
    }
    return results;
  }
}
