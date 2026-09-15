import { randomUUID } from 'node:crypto';
import type { DocumentExtractionValue } from '@scli/domain';
import type { ExtractedPdfPage } from './PdfExtractionAdapter.js';
import { ErcoDatasheetAdapter } from './ErcoDatasheetAdapter.js';

export const LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION = 'luminaire-datasheet-semantic-v11';

type Method = 'NATIVE_TEXT' | 'NATIVE_TABLE' | 'OCR';

interface SemanticRule {
  field: string;
  labels: RegExp;
  value: RegExp;
  unit: string | null;
  basis: string | null;
  label: string;
  /**
   * When true, the short-form labels (e.g. "colour", "color") are guarded in
   * delimiter-free context: the trailing value must not contain words like
   * "rendition", "rendering", "temperature", "index" that indicate the short
   * label is a prefix of a longer compound term, not a standalone color label.
   */
  shortFormGuard?: boolean;
}

const rules: readonly SemanticRule[] = Object.freeze([
  {
    field: 'MANUFACTURER',
    labels: /^(?:manufacturer|brand|make)$/i,
    value: /([a-z0-9][a-z0-9 &.+_-]{1,80})/i,
    unit: null,
    basis: 'PRODUCT_IDENTITY',
    label: 'Manufacturer',
  },
  {
    field: 'ORDERING_CODE',
    labels:
      /^(?:ordering code|order code|article (?:no\.?|number)|art\.?\s*no\.?|catalogue (?:no\.?|number)|sku)$/i,
    value: /([a-z0-9][a-z0-9._/-]{1,100})/i,
    unit: null,
    basis: 'PRODUCT_IDENTITY',
    label: 'Ordering Code',
  },
  {
    field: 'PRODUCT_FAMILY',
    labels: /^(?:product family|family|series)$/i,
    value: /([^|;]{2,100})/i,
    unit: null,
    basis: 'SUPPORTING_IDENTITY',
    label: 'Product Family',
  },
  {
    field: 'VARIANT_LABEL',
    labels: /^(?:variant|product variant|version)$/i,
    value: /([^|;]{2,100})/i,
    unit: null,
    basis: 'SUPPORTING_IDENTITY',
    label: 'Variant',
  },
  {
    field: 'SYSTEM_POWER',
    labels: /^(?:system power|luminaire power|fixture power|total power|connected load)$/i,
    value: /([0-9]+(?:\.[0-9]+)?)\s*(w)(?!\s*\/\s*m)\b/i,
    unit: 'W',
    basis: 'LUMINAIRE_SYSTEM',
    label: 'System Power',
  },
  {
    field: 'INPUT_POWER',
    labels: /^(?:input power|rated input power)$/i,
    value: /([0-9]+(?:\.[0-9]+)?)\s*(w)(?!\s*\/\s*m)\b/i,
    unit: 'W',
    basis: 'INPUT',
    label: 'Input Power',
  },
  {
    field: 'LED_POWER',
    labels: /^(?:led power|source power|light source power|module power)$/i,
    value: /([0-9]+(?:\.[0-9]+)?)\s*(w)(?!\s*\/\s*m)\b/i,
    unit: 'W',
    basis: 'LIGHT_SOURCE',
    label: 'LED Power',
  },
  {
    field: 'POWER_PER_METRE',
    labels: /^(?:power per metre|power per meter|linear power)$/i,
    value: /([0-9]+(?:\.[0-9]+)?)\s*(w\s*\/\s*m)\b/i,
    unit: 'W/m',
    basis: 'LINEAR',
    label: 'Power per metre',
  },
  {
    field: 'LUMINAIRE_FLUX',
    labels:
      /^(?:luminaire flux|delivered flux|fixture output|luminaire output|lumen output|luminous flux of the luminaire)$/i,
    value: /([0-9][0-9 ,.]*?)\s*(lm)(?!\s*\/\s*m)\b/i,
    unit: 'lm',
    basis: 'LUMINAIRE_DELIVERED',
    label: 'Luminaire Flux',
  },
  {
    field: 'LED_FLUX',
    labels: /^(?:led flux|source flux|light source flux|module flux)$/i,
    value: /([0-9][0-9 ,.]*?)\s*(lm)(?!\s*\/\s*m)\b/i,
    unit: 'lm',
    basis: 'LIGHT_SOURCE',
    label: 'LED Flux',
  },
  {
    field: 'FLUX_PER_METRE',
    labels: /^(?:flux per metre|flux per meter|linear flux)$/i,
    value: /([0-9][0-9 ,.]*?)\s*(lm\s*\/\s*m)\b/i,
    unit: 'lm/m',
    basis: 'LINEAR',
    label: 'Flux per metre',
  },
  {
    field: 'CCT',
    labels: /^(?:cct|correlated colo(?:u)?r temperature|colo(?:u)?r temperature)$/i,
    value: /([0-9]{4})\s*(k)\b/i,
    unit: 'K',
    basis: 'LIGHT_SOURCE',
    label: 'CCT',
  },
  {
    field: 'CRI',
    labels:
      /^(?:cri|cr|colo(?:u)?r rendering index(?:\s+cri)?|colo(?:u)?r rendition index(?:\s+cri)?|ra)$/i,
    value: /((?:>|>=|≥)?\s*[0-9]{2,3})\b/i,
    unit: null,
    basis: 'LIGHT_SOURCE',
    label: 'CRI',
  },
  {
    field: 'BEAM_ANGLE',
    labels: /^(?:beam angle|beam)$/i,
    value: /([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:°|deg(?:rees?)?)/i,
    unit: 'deg',
    basis: 'BEAM',
    label: 'Beam Angle',
  },
  {
    field: 'LIGHT_DISTRIBUTION',
    labels: /^(?:light distribution|distribution|optic|beam distribution)$/i,
    value: /([a-z][a-z0-9 &+/-]{2,60})/i,
    unit: null,
    basis: 'OPTIC',
    label: 'Light Distribution',
  },
  {
    field: 'FIELD_ANGLE',
    labels: /^(?:field angle)$/i,
    value: /([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:°|deg(?:rees?)?)/i,
    unit: 'deg',
    basis: 'FIELD',
    label: 'Field Angle',
  },
  {
    field: 'TILT_ANGLE',
    labels: /^(?:tilt angle|tilt)$/i,
    value: /([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:°|deg(?:rees?)?)/i,
    unit: 'deg',
    basis: 'TILT',
    label: 'Tilt Angle',
  },
  {
    field: 'IP_RATING',
    labels: /^(?:ip|ip rating|ingress protection)$/i,
    value: /(ip\s*[0-9]{2,3})\b/i,
    unit: null,
    basis: 'ENCLOSURE',
    label: 'IP Rating',
  },
  {
    field: 'IK_RATING',
    labels: /^(?:ik|ik rating|impact resistance)$/i,
    value: /(ik\s*[0-9]{2})\b/i,
    unit: null,
    basis: 'ENCLOSURE',
    label: 'IK Rating',
  },
  {
    field: 'DIMENSIONS',
    labels: /^(?:dimensions?|product dimensions?|size|overall dimensions?)$/i,
    value: /((?:ø\s*)?[0-9]+(?:\.[0-9]+)?(?:\s*[x×]\s*[0-9]+(?:\.[0-9]+)?){1,2}\s*mm)\b/i,
    unit: 'mm',
    basis: 'DIMENSION',
    label: 'Dimensions',
  },
  {
    field: 'MODEL',
    labels: /^(?:model|product name|commercial name|product designation|type designation)$/i,
    value: /([a-z0-9\u00d8][a-z0-9 \u00d8&+./_()-]{1,80})/i,
    unit: null,
    basis: 'PRODUCT_IDENTITY',
    label: 'Model',
  },
  {
    field: 'BODY_COLOR',
    labels:
      /^(?:body color|body colour|finish|housing color|housing colour|mounting ring color|mounting ring colour|colour|color)$/i,
    value: /([a-z][a-z0-9 &+./()-]{1,60})/i,
    unit: null,
    basis: 'ENCLOSURE',
    label: 'Body Color / Finish',
    // Short labels "colour"/"color" must only bind color/finish values in
    // delimiter-free context, not "Colour rendition index CRI" etc.
    shortFormGuard: true,
  },
  {
    field: 'CUTOUT',
    labels:
      /^(?:cut-?out|ceiling cut-?out|ceiling opening|mounting opening|recessed opening|opening diameter|cutout diameter)$/i,
    value: /((?:ø\s*)?[0-9]+(?:\.[0-9]+)?(?:\s*[x×]\s*[0-9]+(?:\.[0-9]+)?)?\s*mm)\b/i,
    unit: 'mm',
    basis: 'DIMENSION',
    label: 'Cutout',
  },
  {
    field: 'RECESSED_DEPTH',
    labels: /^(?:recessed depth|recess depth|installation depth|mounting depth)$/i,
    value: /([0-9]+(?:\.[0-9]+)?)\s*mm\b/i,
    unit: 'mm',
    basis: 'DIMENSION',
    label: 'Recessed Depth',
  },
  {
    field: 'CONTROL',
    labels: /^(?:control|control gear|control system)$/i,
    value: /([a-z0-9][a-z0-9 &+./%()-]{1,60})/i,
    unit: null,
    basis: 'CONTROL',
    label: 'Control / Dimming',
  },
  {
    field: 'DIMMING_METHOD',
    labels: /^(?:dimming method|dimming)$/i,
    value: /([a-z0-9][a-z0-9 &+./()-]{1,40})/i,
    unit: null,
    basis: 'CONTROL',
    label: 'Dimming Method',
  },
  {
    field: 'DIMMING_RANGE',
    labels: /^(?:dimming range|dimming)$/i,
    value: /([0-9]+%?\s*-\s*[0-9]+%)/i,
    unit: null,
    basis: 'CONTROL',
    label: 'Dimming Range',
  },
  {
    field: 'DRIVER',
    labels: /^(?:driver|control gear|gear|ballast|led driver)$/i,
    value: /([a-z0-9][a-z0-9 &+./()-]{1,60})/i,
    unit: null,
    basis: 'DRIVER',
    label: 'Driver',
  },
  {
    field: 'EMERGENCY',
    labels:
      /^(?:emergency|emergency lighting|emergency version|emergency operation|maintained emergency)$/i,
    value: /([a-z0-9][a-z0-9 &+./(),-]{1,60})/i,
    unit: null,
    basis: 'EMERGENCY',
    label: 'Emergency',
  },
]);

function clean(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

/**
 * Generic unit-in-label handling: technical tables frequently carry the unit
 * in the label cell ("CCT (K)", "Recessed depth (mm)") while the value cell
 * is a bare number. The parenthesized unit suffix is stripped ONLY for label
 * matching; the value rules below accept a bare number only when the label
 * provably carried the matching unit.
 */
const LABEL_UNIT_SUFFIX = /\(\s*([a-zµ%°/]{1,6})\s*\)\s*$/i;

function stripUnitFromLabel(label: string): string {
  return clean(label).replace(LABEL_UNIT_SUFFIX, '').trim();
}

/**
 * Relaxed value patterns used ONLY when the label cell carried the unit
 * (e.g. "CCT (K) | 3000"): the value is matched without requiring its unit.
 * Fields whose units are structurally meaningful (CUTOUT/DIMENSIONS mm,
 * W/m, lm/m) are deliberately NOT relaxed - an unlabeled bare number must
 * never become a dimension.
 */
const RELAXED_VALUE_PATTERN: Readonly<Partial<Record<string, RegExp>>> = Object.freeze({
  SYSTEM_POWER: /([0-9]+(?:\.[0-9]+)?)/,
  INPUT_POWER: /([0-9]+(?:\.[0-9]+)?)/,
  LED_POWER: /([0-9]+(?:\.[0-9]+)?)/,
  LUMINAIRE_FLUX: /([0-9]+(?:[ ,.][0-9]+)*)/,
  LED_FLUX: /([0-9]+(?:[ ,.][0-9]+)*)/,
  CCT: /([0-9]{4})/,
  CRI: /((?:>|>=|≥)?\s*[0-9]{2,3})\b/,
  BEAM_ANGLE: /([0-9]{1,3}(?:\.[0-9]+)?)/,
  FIELD_ANGLE: /([0-9]{1,3}(?:\.[0-9]+)?)/,
  TILT_ANGLE: /([0-9]{1,3}(?:\.[0-9]+)?)/,
  RECESSED_DEPTH: /([0-9]+(?:\.[0-9]+)?)/,
});

function labelCarriesUnit(raw: string, rule: SemanticRule): boolean {
  if (!rule.unit) return false;
  const labelPart = raw.split(/[:|/]/)[0] ?? raw;
  const suffix = labelPart.match(LABEL_UNIT_SUFFIX);
  if (!suffix?.[1]) return false;
  return unitTokenMatches(rule, suffix[1]);
}

function unitTokenMatches(rule: SemanticRule, token: string): boolean {
  const unitToken = (rule.unit ?? '').toLowerCase().replace(/\s+/g, '');
  const candidate = token.toLowerCase().replace(/\s+/g, '');
  if (unitToken.length === 0) return false;
  if (candidate === unitToken) return true;
  if (unitToken === 'w/m' && candidate === 'w/m') return true;
  if (unitToken === 'deg' && candidate === '°') return true;
  return false;
}

function valuePattern(rule: SemanticRule, unitInLabel: boolean): RegExp {
  if (!unitInLabel) return rule.value;
  return RELAXED_VALUE_PATTERN[rule.field] ?? rule.value;
}

function normalized(field: string, value: string): string | number {
  const cleanValue = clean(value).replaceAll(',', '');
  if (['SYSTEM_POWER', 'INPUT_POWER', 'LED_POWER', 'POWER_PER_METRE'].includes(field)) {
    return Number(cleanValue.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
  }
  if (
    [
      'LUMINAIRE_FLUX',
      'LED_FLUX',
      'FLUX_PER_METRE',
      'CCT',
      'BEAM_ANGLE',
      'FIELD_ANGLE',
      'TILT_ANGLE',
      'RECESSED_DEPTH',
    ].includes(field)
  ) {
    return Number(cleanValue.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
  }
  return cleanValue.toLocaleUpperCase('en').replaceAll(/\s+/g, ' ');
}

function splitCells(line: string): string[] {
  if (line.includes('|')) return line.split('|').map(clean).filter(Boolean);
  if (line.includes('\t')) return line.split('\t').map(clean).filter(Boolean);
  return line
    .split(/\s{2,}/)
    .map(clean)
    .filter(Boolean);
}

function labelAndValue(line: string): { label: string; value: string } | null {
  const colon = line.match(/^\s*([^:|]{2,80})\s*[:#]\s*(.+?)\s*$/);
  if (colon?.[1] && colon[2]) return { label: clean(colon[1]), value: clean(colon[2]) };
  const cells = splitCells(line);
  return cells.length === 2 ? { label: cells[0]!, value: cells[1]! } : null;
}

/** Finds the semantic rule for a label, tolerating a parenthesized unit suffix
 *  and common OCR label normalization (missing closing parenthesis, prefix
 *  noise, @ → Ø). */
function ruleForLabel(label: string, rules: readonly SemanticRule[]): SemanticRule | undefined {
  // Normalize first (restores missing closing paren), then strip unit suffix
  const normalized = normalizeLabel(label);
  return rules.find((candidate) => candidate.labels.test(stripUnitFromLabel(normalized)));
}

/**
 * Normalizes common OCR label-level corruption that prevents semantic matching
 * without altering the value side. Each normalization is structural and
 * manufacturer-agnostic:
 * - Restores a missing closing parenthesis on labels like "CCT (K" → "CCT (K)"
 *   so stripUnitFromLabel can extract the unit.
 * - Strips leading non-alphanumeric OCR noise (icons, arrows, bullets) that
 *   tesseract paints before the actual label text.
 * - Replaces the OCR @ with Ø in identity/title contexts (never in values).
 */
function normalizeLabel(label: string): string {
  let result = clean(label);
  // Restore missing closing parenthesis: "CCT (K" → "CCT (K)"
  result = result.replace(/(\w)\s*\(([^)]*)$/, '$1 ($2)');
  // Strip leading non-alphanumeric noise characters
  result = result.replace(/^[^\p{L}\p{N}]+/u, '');
  return result;
}

/**
 * Same-line delimiter-free label/value. Matches a known label immediately
 * followed by its value on the same line with no colon or separator, e.g.
 * "Connected load 10.6 W" or "CCT (K) 3000". Only fires for labels that are
 * exact known vocabulary so it never guesses an unlabeled number.
 */
function labelAndValueDelimiterFree(
  line: string,
  rules: readonly SemanticRule[],
): { rule: SemanticRule; value: string; unitInLabel: boolean } | null {
  // Normalize common OCR label corruption before attempting delimiter-free
  // matching. This restores missing closing parentheses on labels like
  // "CCT (K 3000" so the unit-in-label extraction can fire.
  const normalizedLine = line.replace(/(\w)\s*\(([^)]*?)(?=\s+\S)/g, '$1 ($2)');
  for (const rule of rules) {
    // Strip the rule's own ^...$ anchors so the label can be followed by a value.
    const labelSource = rule.labels.source.replace(/^\^/, '').replace(/\$$/, '');
    // Allow an optional parenthesized unit between the label and its value
    // (e.g. "CCT (K) 3000" from a reconstructed table row). Also allow an
    // optional ">" / ">=" / "≥" after the label (e.g. "CRI> 90" from a
    // compound summary line).
    const match = normalizedLine.match(
      new RegExp(
        `^(${labelSource})\\s*(?:\\(\\s*([a-zµ%°/]{1,6})\\s*\\))?\\s*(?:>\\s*=?|≥)?\\s+(.+)$`,
        'i',
      ),
    );
    if (!match?.[3]) continue;
    const unitInLabel = match[2] !== undefined && unitTokenMatches(rule, match[2]);
    // Short-form guard: "colour"/"color" must not bind compound terms like
    // "Colour rendition index CRI" as a body color value.
    if (
      rule.shortFormGuard &&
      /\b(?:rendition|rendering|temperature|index|deviation)\b/i.test(match[3])
    ) {
      continue;
    }
    if (rule.field === 'DIMMING_METHOD' && /^(?:range|interface)\b/i.test(match[3])) continue;
    if (rule.field === 'DRIVER' && /^by\b/i.test(match[3])) continue;
    // The value must actually satisfy the rule's value pattern to avoid
    // treating arbitrary trailing text as a technical value. When the label
    // carried the unit, the relaxed pattern accepts a bare number.
    if (!valuePattern(rule, unitInLabel).test(match[3])) continue;
    // Ordering codes are single tokens. A multi-word trailing phrase (e.g.
    // the real ERCO melanopic table header "Art. no. Spectrum MR MDER") is
    // not an article identity and must never be bound as one.
    if (rule.field === 'ORDERING_CODE' && /\s/.test(match[3])) continue;
    // Regulatory identifiers ("Model identifier: 3000073333") are not
    // commercial model names and must never be bound as MODEL evidence.
    if (rule.field === 'MODEL' && /^(?:identifier|number)\b/i.test(match[3])) continue;
    return { rule, value: clean(match[3]), unitInLabel };
  }
  return null;
}

/**
 * Adjacent-line label/value. When a line is exactly a known label and the
 * following line carries a value that satisfies the rule, bind them together.
 * Example: "Beam angle" then "C0 55°", or "CCT (K)" then "3000".
 */
function adjacentLabelValue(
  lines: readonly string[],
  index: number,
  rules: readonly SemanticRule[],
): { rule: SemanticRule; value: string; raw: string; unitInLabel: boolean } | null {
  const label = clean(lines[index] ?? '');
  const next = clean(lines[index + 1] ?? '');
  if (!label || !next) return null;
  const rule = rules.find((candidate) =>
    candidate.labels.test(stripUnitFromLabel(normalizeLabel(label))),
  );
  if (!rule) return null;
  // Single-column ordering-code tables are handled by extractTable with exact
  // row provenance; skip them here to avoid duplicate evidence.
  if (rule.field === 'ORDERING_CODE') return null;
  const unitInLabel = labelCarriesUnit(label, rule);
  if (!valuePattern(rule, unitInLabel).test(next)) return null;
  return { rule, value: next, raw: `${label} / ${next}`, unitInLabel };
}

function optionsFor(rule: SemanticRule, value: string, unitInLabel = false): string[] {
  const pattern = valuePattern(rule, unitInLabel);
  const matches = [
    ...value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)),
  ]
    .map((match) => clean(match[0] ?? ''))
    .filter(Boolean);
  return [...new Set(matches.map((item) => String(normalized(rule.field, item))))];
}

function ocrEvidenceFor(page: ExtractedPdfPage, raw: string, value?: string) {
  const regions = page.ocrRegions ?? [];
  // Prefer the region that matches the extracted VALUE (e.g. the "3000"
  // value cell rather than the "CCT (K)" label cell in a structured row).
  if (value) {
    const valueNeedle = clean(value).toLocaleLowerCase('en');
    if (valueNeedle) {
      // First try: the region text contains the value
      const exactRegions = regions.filter(
        (region) => valueNeedle === clean(region.text).toLocaleLowerCase('en'),
      );
      if (exactRegions.length === 1) return exactRegions[0];
      // Second try: the value is a substring of the region text (e.g. the
      // value "05743074" is inside the cell "Wl 05743074")
      const escaped = valueNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bounded = new RegExp(`(?:^|[^a-z0-9.,])${escaped}(?=$|[^a-z0-9.,])`, 'i');
      const containedRegions = regions.filter((region) => bounded.test(clean(region.text)));
      if (containedRegions.length === 1) return containedRegions[0];
      const candidates = exactRegions.length ? exactRegions : containedRegions;
      const label = clean(raw)
        .toLowerCase()
        .split(valueNeedle)[0]
        ?.replace(/[|/:]+$/, '')
        .trim();
      const labelRegions = label
        ? regions.filter((region) => clean(region.text).toLowerCase() === label)
        : [];
      const positioned = candidates.filter((candidate) =>
        labelRegions.some(
          (labelRegion) =>
            labelRegion.region.x < candidate.region.x &&
            Math.abs(labelRegion.region.y - candidate.region.y) <=
              Math.max(labelRegion.region.height, candidate.region.height) / 2,
        ),
      );
      if (positioned.length === 1) return positioned[0];
    }
  }
  const needle = clean(raw).toLocaleLowerCase('en');
  const exact = regions.filter((region) => needle === clean(region.text).toLocaleLowerCase('en'));
  return exact.length === 1 ? exact[0] : undefined;
}

/**
 * Capability language that describes what a product CAN do or what is
 * AVAILABLE as an option/accessory. Such evidence must never be treated as
 * the exact supplied Project configuration (control, driver, emergency).
 */
const CAPABILITY_LANGUAGE: ReadonlyArray<RegExp> = Object.freeze([
  /compatible\s+with/i,
  /available\s+with/i,
  /optional/i,
  /accessory/i,
  /can\s+be\s+controlled\s+by/i,
  /control\s+via/i,
  /supports?/i,
  /possible\s+on\s+request/i,
  /approved\s+for\s+use\s+as/i,
  /according\s+to/i,
]);

function isCapabilityOnly(raw: string, field: string): boolean {
  if (!['CONTROL', 'DRIVER', 'EMERGENCY'].includes(field)) return false;
  return CAPABILITY_LANGUAGE.some((pattern) => pattern.test(raw));
}

function value(
  page: ExtractedPdfPage,
  method: Method,
  rule: SemanticRule,
  raw: string,
  sourceValue: string,
  rowCode?: string,
  unitInLabel = false,
): DocumentExtractionValue | null {
  if (rule.field === 'BODY_COLOR' && /^RGB(?:W)?$/i.test(sourceValue.trim())) return null;
  const matched = sourceValue.match(valuePattern(rule, unitInLabel));
  if (!matched?.[0]) return null;
  const candidates = optionsFor(rule, sourceValue, unitInLabel);
  const ambiguous = candidates.length > 1;
  const capabilityOnly = isCapabilityOnly(raw, rule.field);
  const warnings = [
    `LABEL:${rule.label}`,
    `CONTEXT:${clean(raw).slice(0, 300)}`,
    ...(rowCode ? [`PRODUCT_ROW:${rowCode}`] : []),
    ...(ambiguous ? [`AMBIGUOUS_OPTIONS:${candidates.join('|')}`] : []),
    ...(capabilityOnly ? ['CAPABILITY_ONLY'] : []),
    ...(unitInLabel ? ['UNIT_IN_LABEL'] : []),
  ];
  const ocrEvidence = method === 'OCR' ? ocrEvidenceFor(page, raw, matched[0]) : undefined;
  if (method === 'OCR') {
    for (const review of page.ocrNumericReviews ?? []) {
      if (
        ocrEvidence?.region &&
        review.region.x >= ocrEvidence.region.x - 4 &&
        review.region.x <= ocrEvidence.region.x + ocrEvidence.region.width &&
        Math.abs(review.region.y - ocrEvidence.region.y) <=
          Math.max(review.region.height, ocrEvidence.region.height) &&
        review.primary === matched[0].trim().replace(/\s*(?:W|lm|K|°)$/i, '')
      )
        warnings.push(`OCR_SECOND_READING:${review.status}:${review.primary}:${review.secondary}`);
    }
  }
  const baseConfidence =
    method === 'OCR'
      ? Math.max(0, Math.min(92, Math.round(ocrEvidence?.confidence ?? 0)))
      : method === 'NATIVE_TABLE'
        ? 98
        : 94;
  return {
    id: randomUUID(),
    versionId: '',
    pageNumber: page.pageNumber,
    region: ocrEvidence?.region ?? null,
    rawValue: clean(raw).slice(0, 500),
    normalizedValue: normalized(rule.field, matched[0]),
    canonicalField: rule.field,
    unit: rule.unit,
    basis: rule.basis,
    method,
    // Capability-only evidence is capped below the HIGH threshold so it can
    // never be adopted as exact Project configuration or produce a hard
    // conflict. It remains visible as supporting evidence.
    confidence: capabilityOnly
      ? Math.min(60, baseConfidence)
      : ambiguous
        ? Math.min(65, baseConfidence)
        : baseConfidence,
    adapterId: 'LUMINAIRE_DATASHEET_SEMANTIC',
    extractorVersion: LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION,
    warnings,
  };
}

function extractTable(
  page: ExtractedPdfPage,
  lines: readonly string[],
  method: Method,
): DocumentExtractionValue[] {
  const results: DocumentExtractionValue[] = [];
  for (let headerIndex = 0; headerIndex < lines.length - 1; headerIndex += 1) {
    const headers = splitCells(lines[headerIndex]!);
    if (
      headers.length < 2 ||
      !headers.some((header) => /ordering|order code|article|art\.?\s*no/i.test(header))
    ) {
      continue;
    }
    const mapped = headers.map((header) =>
      rules.find((rule) => rule.labels.test(stripUnitFromLabel(normalizeLabel(header)))),
    );
    if (!mapped.some(Boolean)) continue;
    for (let rowIndex = headerIndex + 1; rowIndex < lines.length; rowIndex += 1) {
      const cells = splitCells(lines[rowIndex]!);
      if (cells.length !== headers.length) break;
      const codeIndex = mapped.findIndex((rule) => rule?.field === 'ORDERING_CODE');
      const rowCode = codeIndex >= 0 ? clean(cells[codeIndex] ?? '') : '';
      if (!rowCode) break;
      for (let index = 0; index < mapped.length; index += 1) {
        const rule = mapped[index];
        if (!rule) continue;
        const extracted = value(
          page,
          method === 'OCR' ? 'OCR' : 'NATIVE_TABLE',
          rule,
          `${headers[index]}: ${cells[index]} | row ${rowCode}`,
          cells[index] ?? '',
          rowCode,
        );
        if (extracted) results.push(extracted);
      }
    }
    break;
  }
  // Single-column flattened article table: a header line that is exactly an
  // ordering-code label followed by the article value on the next line.
  // Example: "Art. no." then "A2000427".
  for (let headerIndex = 0; headerIndex < lines.length - 1; headerIndex += 1) {
    const header = clean(lines[headerIndex]!);
    const rule = rules.find(
      (candidate) => candidate.field === 'ORDERING_CODE' && candidate.labels.test(header),
    );
    if (!rule) continue;
    const valueLine = clean(lines[headerIndex + 1]!);
    if (!rule.value.test(valueLine)) continue;
    // Ordering codes are single tokens. A multi-word next line (e.g. the real
    // ERCO melanopic table header "Art. no. Spectrum MR MDER") is not an
    // article identity and must never be bound as one.
    if (/\s/.test(valueLine)) continue;
    const extracted = value(
      page,
      method === 'OCR' ? 'OCR' : 'NATIVE_TABLE',
      rule,
      `${header}: ${valueLine} | row ${valueLine}`,
      valueLine,
      valueLine,
    );
    if (extracted) results.push(extracted);
  }
  return results;
}

/**
 * Ordering code pattern: dots, digits, and hyphens. Must start with a digit
 * and contain at least one dot or hyphen segment separator. Digits-only
 * tokens shorter than 5 characters (page numbers, dates) are rejected.
 */
const ORDERING_CODE_LIKE = /^\d[\d.-]*\d$/;

/**
 * Relaxed code-like extraction from a cell that may contain OCR prefix noise.
 * Example: "Wl 05743074" → extracts "05743074" as a candidate code token.
 * The token must be 5+ digits and be the longest digit-run in the cell.
 * Does NOT extract digits from letter-prefixed tokens like "A2000427" (ERCO
 * article codes that start with a letter are handled by the ERCO adapter).
 */
function extractCodeTokenFromCell(text: string): string | null {
  const trimmed = clean(text);
  // Find all digit-runs (possibly with dots/hyphens) that are NOT preceded by
  // a letter (i.e. standalone numeric tokens, not letter-prefixed codes).
  const matches = trimmed.match(/(?:^|\s)(\d[\d.-]*\d)(?=\s|$)/g);
  if (!matches) return null;
  // Extract just the digit portion from each match (strip leading space)
  const codes = matches.map((m) => m.trim());
  // Pick the longest match
  const longest = codes.sort((a, b) => b.length - a.length)[0]!;
  if (longest.length < 5) return null;
  // If it has segment separators, it's clearly a code
  if (/[.-]/.test(longest)) return longest;
  // Bare 7-8 digit number: could be a code with stripped dots. Accept only
  // if it's 7+ digits (rules out page numbers, dates, short dimensions).
  if (longest.length >= 7 && /^\d{7,}$/.test(longest)) return longest;
  return null;
}

/**
 * A product-identity token is a standalone code-like string that is NOT:
 * - a page number (e.g. "1/4", "2/4")
 * - a year/date (e.g. "2022", "12/5/2025")
 * - a bare dimension (e.g. "80", "150")
 * - a regulatory identifier (e.g. "62471")
 * - a VAT/tax number (e.g. "00290820174")
 */
function isProductCodeLike(text: string): boolean {
  const trimmed = clean(text);
  if (trimmed.length < 5) return false;
  if (!ORDERING_CODE_LIKE.test(trimmed)) return false;
  // Must contain at least one segment separator (dot or hyphen)
  if (!/[.-]/.test(trimmed)) return false;
  // Reject page numbers like "1/4" (contain slash)
  if (/\//.test(trimmed)) return false;
  return true;
}

/**
 * A title-like line has at least 3 word-like tokens and is not a URL, not a
 * footer/copyright, not a code-only line, and not a colon-delimited label.
 */
function isTitleLike(text: string): boolean {
  const trimmed = clean(text);
  if (trimmed.length < 10) return false;
  if (/:\/\//.test(trimmed)) return false;
  if (/^(?:©|https?)/i.test(trimmed)) return false;
  if (/^[\d\s.°-]+$/.test(trimmed)) return false;
  // Must have at least 3 word-like tokens (letters)
  const wordTokens = trimmed.split(/\s+/).filter((t) => /[A-Za-z]{2,}/.test(t));
  if (wordTokens.length < 3) return false;
  // Must not be a colon-delimited label/value (those are handled separately)
  if (/^[^:|]{2,80}[:#]\s/.test(trimmed)) return false;
  return true;
}

/**
 * Bounded region: the first 1/4 of the page (by line count) is the header/
 * product identity region. A title line and a code-like sibling must both
 * fall within this bounded region.
 */
const IDENTITY_REGION_LINE_FRACTION = 0.25;

/** Footer/page-number exclusion patterns for the product identity block. */
const FOOTER_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?:©|https?:|professional\.|info@)/i,
  /\b\d+\/\d+$/, // page numbers like "1/4"
  /\bP\.?\s*IVA\b/i, // VAT numbers
  /\b\d{4}\s+\d{2}\/\d{2}\/\d{4}\b/, // dates
];

function isFooterLike(text: string): boolean {
  const trimmed = clean(text);
  return FOOTER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Extracts a generic product identity block: a title-like line and an adjacent
 * code-like sibling line within a bounded header region. Manufacturer-agnostic.
 * Does NOT scan the entire page for code-like tokens.
 *
 * Safety:
 * - Both lines must be in the first 25% of the page (header/identity region).
 * - The title must be title-like (3+ word tokens, not a URL/footer/label).
 * - The code must be code-like (starts with digit, has segment separators).
 * - Footers, page numbers, dates, URLs, and copyright lines are excluded.
 * - The filename contributes zero authority.
 * - Only fires when BOTH a title and a code are found: a title without a code
 *   is not a product identity block (it could be a section heading).
 */
function extractProductIdentityBlock(
  page: ExtractedPdfPage,
  lines: readonly string[],
  method: Method,
): DocumentExtractionValue[] {
  const results: DocumentExtractionValue[] = [];
  if (lines.length < 2) return results;
  const bound = Math.max(3, Math.ceil(lines.length * IDENTITY_REGION_LINE_FRACTION));
  const region = lines.slice(0, bound);

  let titleLine: string | null = null;
  let titleIndex = -1;
  for (let index = 0; index < region.length; index += 1) {
    const candidate = clean(region[index]!);
    if (isFooterLike(candidate)) continue;
    if (isTitleLike(candidate)) {
      titleLine = candidate;
      titleIndex = index;
      break;
    }
  }
  if (!titleLine || titleIndex < 0) return results;

  // Search for a code-like sibling within ±2 lines of the title. Accept both
  // standalone code-like lines and cells that contain a code-like token with
  // OCR prefix noise (e.g. "Wl 05743074" → code "05743074").
  const searchStart = Math.max(0, titleIndex - 2);
  const searchEnd = Math.min(region.length, titleIndex + 3);
  let codeLine: string | null = null;
  for (let index = searchStart; index < searchEnd; index += 1) {
    if (index === titleIndex) continue;
    const candidate = clean(region[index]!);
    if (isFooterLike(candidate)) continue;
    if (isProductCodeLike(candidate)) {
      codeLine = candidate;
      break;
    }
    // Try extracting a code token from a noisy cell
    const codeToken = extractCodeTokenFromCell(candidate);
    if (codeToken) {
      codeLine = codeToken;
      break;
    }
  }

  // Product identity block requires BOTH a title and a code-like sibling.
  // A title alone could be a section heading ("Schematic light drawing",
  // "Accessories & Power Supply") and must not be bound as MODEL.
  if (!codeLine) return results;

  // Emit MODEL from the title line. Strip trailing OCR noise tokens that
  // were split into a separate cell (e.g. "L=—]", icons, arrows). A trailing
  // token with non-alphanumeric characters (other than Ø) is noise.
  if (titleLine) {
    const titleRule = rules.find((r) => r.field === 'MODEL')!;
    // Normalize @ → Ø for product names with diameter symbols
    const normalizedTitle = titleLine.replace(/\s*@\s*/g, ' Ø ');
    // Strip trailing noise tokens: "Easy Kap Ø 80 Plus Fixed Optic Medium L=—]"
    // → "Easy Kap Ø 80 Plus Fixed Optic Medium". A noise token is a short
    // trailing token that contains non-alphanumeric characters (excluding Ø
    // and standard word characters).
    const tokens = normalizedTitle.split(/\s+/).filter(Boolean);
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1]!;
      // A clean word token: letters, digits, Ø, +, /, -, parentheses only
      if (/^[\p{L}\p{N}Ø+./()-]+$/u.test(last)) break;
      tokens.pop();
    }
    const modelValue = clean(tokens.join(' '));
    if (modelValue.length < 3) return results;
    const extracted = value(
      page,
      method,
      titleRule,
      `Product identity title: ${titleLine}`,
      modelValue,
      undefined,
      false,
    );
    if (extracted) results.push(extracted);
  }

  // Emit ORDERING_CODE from the code-like sibling
  if (codeLine) {
    const codeRule = rules.find((r) => r.field === 'ORDERING_CODE')!;
    const extracted = value(
      page,
      method,
      codeRule,
      `Product identity code: ${codeLine}`,
      codeLine,
      codeLine,
    );
    if (extracted) results.push(extracted);
  }

  return results;
}

/**
 * Extracts label/value pairs from structured OCR table rows whose label cell
 * lost a closing parenthesis or whose label was slightly corrupted by OCR.
 * This is a generic post-processing pass on canonical "label | value" lines
 * that the labelAndValue function could not match.
 *
 * Example: "CCT (K | 3000" — the label "CCT (K" is normalized to "CCT (K)"
 * so stripUnitFromLabel can extract the unit, then the rule matches.
 */
function extractStructuredOcrPairs(
  page: ExtractedPdfPage,
  lines: readonly string[],
  method: Method,
): DocumentExtractionValue[] {
  const results: DocumentExtractionValue[] = [];
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(clean).filter(Boolean);
    if (cells.length !== 2) continue;
    const [rawLabel, rawValue] = cells as [string, string];
    // Normalize label first (restores missing closing paren), then strip unit
    const normalized = normalizeLabel(rawLabel);
    const label = stripUnitFromLabel(normalized);
    const rule = rules.find((candidate) => candidate.labels.test(label));
    if (!rule) continue;
    // Check if label carries unit (use the normalized label with restored paren)
    const unitInLabel = labelCarriesUnit(normalized, rule);
    if (!valuePattern(rule, unitInLabel).test(rawValue)) continue;
    const extracted = value(page, method, rule, line, rawValue, undefined, unitInLabel);
    if (extracted) results.push(extracted);
  }
  return results;
}

/**
 * Extracts label/value pairs from a compound summary line where multiple
 * technical fields are joined by a delimiter. Example:
 * "LED- LED array - 13W - 822lm - 3000K - CRI> 90 - Beam 25"
 *
 * Each segment is tested against existing semantic rules using the
 * delimiter-free matcher. This is generic: it works for any dash-separated
 * technical summary, not just FLOS.
 */
function extractCompoundSummary(
  page: ExtractedPdfPage,
  line: string,
  method: Method,
): DocumentExtractionValue[] {
  const results: DocumentExtractionValue[] = [];
  // Split on " - " (dash with spaces) as the compound delimiter
  const segments = line
    .split(/\s+-\s+/)
    .map(clean)
    .filter(Boolean);
  if (segments.length < 3) return results;
  for (const segment of segments) {
    // Try delimiter-free matching on each segment (handles "Beam 25", "3000K")
    const match = labelAndValueDelimiterFree(segment, rules);
    if (match) {
      const extracted = value(
        page,
        method,
        match.rule,
        `Compound summary: ${segment}`,
        match.value,
        undefined,
        match.unitInLabel,
      );
      if (extracted) results.push(extracted);
      continue;
    }
    // Try colon-delimited matching (handles "Beam Angle: 25°")
    const pair = labelAndValue(segment);
    if (pair) {
      const rule = ruleForLabel(pair.label, rules);
      if (rule) {
        const unitInLabel = labelCarriesUnit(pair.label, rule);
        const extracted = value(
          page,
          method,
          rule,
          `Compound summary: ${segment}`,
          pair.value,
          undefined,
          unitInLabel,
        );
        if (extracted) results.push(extracted);
        continue;
      }
    }
    // Try delimiter-free matching with relaxed value patterns: in a compound
    // technical summary, a bare number after a known label is safe to bind
    // using the relaxed pattern (e.g. "Beam 25" → BEAM_ANGLE 25, "CCT 3000K"
    // already matched above, but "Beam 25" needs the relaxed pattern because
    // the degree symbol is absent). The confidence is NOT raised — the OCR
    // evidence confidence governs the final score.
    const relaxedMatch = matchCompoundSegmentRelaxed(segment, rules);
    if (relaxedMatch) {
      const extracted = value(
        page,
        method,
        relaxedMatch.rule,
        `Compound summary: ${segment}`,
        relaxedMatch.value,
        undefined,
        true,
      );
      if (extracted) results.push(extracted);
    }
  }
  return results;
}

/**
 * Relaxed compound segment matcher: tries each rule's label at the start of
 * the segment and accepts the relaxed value pattern (bare numbers without
 * units). Used ONLY inside compound summary lines where the dash-separated
 * technical context makes a bare number after a known label unambiguous.
 */
function matchCompoundSegmentRelaxed(
  segment: string,
  rules: readonly SemanticRule[],
): { rule: SemanticRule; value: string } | null {
  const segmentClean = clean(segment);
  for (const rule of rules) {
    if (!RELAXED_VALUE_PATTERN[rule.field]) continue;
    const labelSource = rule.labels.source.replace(/^\^/, '').replace(/\$$/, '');
    const match = segmentClean.match(
      new RegExp(
        `^(${labelSource})\\s*(?:\\(\\s*([a-zµ%°/]{1,6})\\s*\\))?\\s*(?:>\\s*=?|≥)?\\s*(.+)$`,
        'i',
      ),
    );
    if (!match?.[3]) continue;
    const relaxed = RELAXED_VALUE_PATTERN[rule.field]!;
    if (!relaxed.test(match[3])) continue;
    if (rule.field === 'ORDERING_CODE' && /\s/.test(match[3])) continue;
    if (rule.field === 'MODEL' && /^(?:identifier|number)\b/i.test(match[3])) continue;
    return { rule, value: clean(match[3]) };
  }
  return null;
}

/** FLOS printed specification labels; product codes come from printed content, never paths. */
function extractFlosSpecifications(
  page: ExtractedPdfPage,
  method: Method,
): DocumentExtractionValue[] {
  const results: DocumentExtractionValue[] = [];
  const text = page.text;
  const emit = (
    field: string,
    raw: string,
    source: string,
    unitInLabel = false,
    warning?: string,
  ) => {
    const rule = rules.find((candidate) => candidate.field === field)!;
    const item = value(page, method, rule, raw, source, undefined, unitInLabel);
    if (item) {
      if (warning) {
        item.warnings = [...item.warnings, warning];
        item.confidence = Math.min(item.confidence, 60);
      }
      results.push(item);
    }
  };
  if (page.pageNumber === 1) {
    const brand = text.match(/(?:Designed by FLOS[^\n]*|professional[. ]flos\.com)/i);
    if (brand) emit('MANUFACTURER', brand[0], 'FLOS');
    // Read the printed code after the URL, not the product slug inside the URL.
    const footer = text.match(
      /professional[. ]flos\.com\/[^\s]+\s+((?:F[A-Z0-9]{7,}|\d{2}\.\d{4}\.\d{2})[A-Z]?(?:\.[A-Z])?)\s*$/im,
    );
    const header = text.match(
      /^(?:[^\n]*?\s)?((?:F[A-Z0-9]{7,}|\d{2}\.\d{4}\.\d{2})[A-Z]?(?:\.[A-Z])?)\s+(?:Black|White|Anthracite|Matte)/im,
    );
    const code = footer ?? header;
    if (code?.[1]) emit('ORDERING_CODE', code[0], code[1]);
    const title = text.match(/([^\n]+)\nDesigned by /i);
    if (title?.[1]) emit('MODEL', title[1], title[1]);
    const summary = text.match(/^LED\s*-\s*[^\n]*?\s-\s*([0-9]+(?:\.[0-9]+)?)W\b/im);
    if (summary?.[1]) emit('LED_POWER', summary[0], `${summary[1]}W`);
  }
  const numeric: Array<[string, RegExp]> = [
    ['SYSTEM_POWER', /\bSystem power\s*\(W\)\s*\|?\s*([0-9]+(?:\.[0-9]+)?)/gi],
    ['LED_POWER', /(?:^|\n|\|)\s*Power\s*\(W\)\s*\|?\s*([0-9]+(?:\.[0-9]+)?)/gi],
    ['LUMINAIRE_FLUX', /\bLumen Output\s*\([lI]m[)}]\s*\|?\s*([0-9]+(?:\.[0-9]+)?)/gi],
    ['LED_FLUX', /\bSource flux\s*\([lI]m[)}]\s*\|?\s*([0-9]+(?:\.[0-9]+)?)/gi],
    ['BEAM_ANGLE', /\bBeam angle C(?:0-180|90-270)\s*\([°º]\)\s*\|?\s*([0-9]+(?:\.[0-9]+)?)/gi],
    ['RECESSED_DEPTH', /\bRecessed depth\s*\(mm\)\s*\|?\s*([0-9]+(?:\.[0-9]+)?)/gi],
  ];
  for (const [field, pattern] of numeric) {
    for (const match of text.matchAll(pattern)) {
      emit(field, match[0], match[1]!, true);
    }
  }
  for (const match of text.matchAll(/\bIP\s+(internal|external)\s*\|?\s*([0-9]{2})\b/gi)) {
    emit('IP_RATING', match[0], `IP${match[2]}`);
    const item = results.at(-1);
    if (item) item.warnings = [...item.warnings, `IP_SCOPE:${match[1]!.toUpperCase()}`];
  }
  for (const match of text.matchAll(
    /\bColour\s*\|?\s*(Matte Stainless Steel|Black|White|Anthracite)\b/gi,
  )) {
    emit('BODY_COLOR', match[0], match[1]!);
  }
  for (const match of text.matchAll(
    /\bPower supply\s*\|?\s*(Remote excluded|Remote included|Integrated)\b/gi,
  )) {
    emit('DRIVER', match[0], match[1]!);
  }
  const integrated = text.match(/\bIntegrated\s+[0-9/]+V\s+power supply/i);
  if (integrated) emit('DRIVER', integrated[0], 'Integrated');
  const excluded = text.match(/Power supply not included/i);
  if (excluded) emit('DRIVER', excluded[0], 'Remote excluded');
  // A list of compatible drivers is a choice, not a supplied control configuration.
  const multiple = /Non Dimmable,|Dimmable DALI [12],/i.test(text);
  for (const match of text.matchAll(
    /\bPower supply type\s*\|?\s*(Non Dimmable|Dimmable DALI [12])\b/gi,
  )) {
    emit(
      'CONTROL',
      match[0],
      match[1]!,
      false,
      multiple ? 'CONFIGURATION_CHOICE_REQUIRED' : undefined,
    );
  }
  return results;
}

export class LuminaireDatasheetSemanticExtractionService {
  private readonly erco = new ErcoDatasheetAdapter();

  public extract(
    pages: readonly ExtractedPdfPage[],
    methods: ReadonlyMap<number, 'NATIVE_TEXT' | 'OCR'>,
  ): DocumentExtractionValue[] {
    const results: DocumentExtractionValue[] = [];
    // Accessories remain in document evidence but never become the attached product.
    const productPages = pages.filter(
      (page) =>
        page.pageNumber === 1 ||
        !page.text
          .split(/\r?\n/)
          .some((line) => /^\s*Accessories(?:\s*(?:&|and)\s*Power\s*Supply)?\s*$/i.test(line)),
    );
    const ercoActive = this.erco.detect(productPages);
    const flosActive = productPages.some((page) => /professional[. ]flos\.com/i.test(page.text));
    for (const page of productPages) {
      const method = methods.get(page.pageNumber) ?? 'NATIVE_TEXT';
      const lines = page.text.split(/\r?\n/).map(clean).filter(Boolean);
      results.push(...extractTable(page, lines, method));
      // Product identity block: extract MODEL and ORDERING_CODE from a bounded
      // header region when no explicit labels are present. Manufacturer-agnostic.
      if (page.pageNumber === 1 && !flosActive)
        results.push(...extractProductIdentityBlock(page, lines, method));
      if (flosActive) results.push(...extractFlosSpecifications(page, method));
      // Catalogue variants stay scoped to their printed row code. Merged/common
      // power and optic cells are deliberately not guessed from neighbouring rows.
      if (/#\s+Color\s+Lumen\s+LED\s+Watt\s+Power\s+Beam/i.test(page.text)) {
        for (const match of page.text.matchAll(
          /^([A-Z0-9][A-Z0-9.-]{5,})\s+([0-9]{4})K\s+[^\n]*?\s+([0-9]+)\s*lm\b/gim,
        )) {
          for (const [field, source] of [
            ['ORDERING_CODE', match[1]!],
            ['CCT', `${match[2]}K`],
          ] as const) {
            const item = value(
              page,
              method,
              rules.find((rule) => rule.field === field)!,
              match[0],
              source,
              match[1],
            );
            if (item) results.push(item);
          }
          const flux = value(
            page,
            method,
            rules.find((rule) => rule.field === 'LUMINAIRE_FLUX')!,
            match[0],
            `${match[3]}lm`,
            match[1],
          );
          if (flux) {
            flux.confidence = Math.min(60, flux.confidence);
            flux.basis = 'UNSPECIFIED';
            flux.warnings = [...flux.warnings, 'FLUX_BASIS_UNSPECIFIED'];
            results.push(flux);
          }
        }
      }
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        // 1. Colon / cell-separated label:value
        const pair = labelAndValue(line);
        if (pair) {
          const rule = ruleForLabel(pair.label, rules);
          if (rule) {
            const unitInLabel = labelCarriesUnit(pair.label, rule);
            const extracted = value(page, method, rule, line, pair.value, undefined, unitInLabel);
            if (extracted) results.push(extracted);
            continue;
          }
        }
        // 2. Same-line delimiter-free label/value (e.g. "Connected load 10.6 W")
        const delimiterFree = labelAndValueDelimiterFree(line, rules);
        if (delimiterFree) {
          const extracted = value(
            page,
            method,
            delimiterFree.rule,
            line,
            delimiterFree.value,
            undefined,
            delimiterFree.unitInLabel,
          );
          if (extracted) results.push(extracted);
          continue;
        }
        // 3. Adjacent-line label/value (e.g. "Beam angle" then "C0 55°")
        const adjacent = adjacentLabelValue(lines, index, rules);
        if (adjacent) {
          const extracted = value(
            page,
            method,
            adjacent.rule,
            adjacent.raw,
            adjacent.value,
            undefined,
            adjacent.unitInLabel,
          );
          if (extracted) results.push(extracted);
          continue;
        }
        // 4. Compound summary line (e.g. "LED array - 13W - 822lm - 3000K")
        if (line.includes(' - ') && line.split(/\s+-\s+/).filter(Boolean).length >= 3) {
          results.push(...extractCompoundSummary(page, line, method));
        }
      }
      // 5. Structured OCR pairs: post-process canonical "label | value" lines
      //    whose label was slightly corrupted (missing closing parenthesis, etc.)
      results.push(...extractStructuredOcrPairs(page, lines, method));
    }
    if (ercoActive) {
      results.push(...this.erco.extract(productPages, methods));
    }
    // A contradictory source must not certify one value just because the table matches it.
    const sourcePowers = results.filter(
      (item) => item.canonicalField === 'LED_POWER' && typeof item.normalizedValue === 'number',
    );
    for (const item of results) {
      if (
        item.canonicalField === 'SYSTEM_POWER' &&
        typeof item.normalizedValue === 'number' &&
        sourcePowers.some(
          (source) =>
            typeof source.normalizedValue === 'number' &&
            source.normalizedValue > Number(item.normalizedValue) &&
            source.warnings.find((warning) => warning.startsWith('PRODUCT_ROW:')) ===
              item.warnings.find((warning) => warning.startsWith('PRODUCT_ROW:')),
        )
      ) {
        item.confidence = Math.min(item.confidence, 60);
        item.warnings = [...item.warnings, 'SOURCE_POWER_EXCEEDS_SYSTEM_POWER'];
      }
    }
    const unique = new Map<string, DocumentExtractionValue>();
    for (const item of results) {
      if (
        item.canonicalField === 'LUMINAIRE_FLUX' &&
        typeof item.normalizedValue === 'number' &&
        results.some(
          (source) =>
            source.canonicalField === 'LED_FLUX' &&
            typeof source.normalizedValue === 'number' &&
            source.normalizedValue < Number(item.normalizedValue) &&
            source.warnings.find((w) => w.startsWith('PRODUCT_ROW:')) ===
              item.warnings.find((w) => w.startsWith('PRODUCT_ROW:')),
        )
      ) {
        item.confidence = Math.min(item.confidence, 60);
        item.warnings = [...item.warnings, 'ENGINEERING_LUMINAIRE_FLUX_EXCEEDS_SOURCE'];
      }
      if (
        item.canonicalField === 'DRIVER' &&
        results.some(
          (other) =>
            other.canonicalField === 'DRIVER' &&
            other.normalizedValue !== item.normalizedValue &&
            other.warnings.find((w) => w.startsWith('PRODUCT_ROW:')) ===
              item.warnings.find((w) => w.startsWith('PRODUCT_ROW:')),
        )
      ) {
        item.confidence = Math.min(item.confidence, 60);
        item.warnings = [...item.warnings, 'ENGINEERING_DRIVER_LOCATIONS_DISAGREE'];
      }
    }
    for (const item of results) {
      if (
        flosActive &&
        item.canonicalField === 'IP_RATING' &&
        !item.warnings.some((warning) => warning.startsWith('IP_SCOPE:'))
      )
        continue;
      if (
        item.method === 'OCR' &&
        (typeof item.normalizedValue === 'number' ||
          ['ORDERING_CODE', 'MODEL', 'IP_RATING'].includes(item.canonicalField))
      ) {
        // Real thin-font PDFs can lose decimal points at high OCR confidence.
        // Recognition confidence alone is not engineering verification.
        item.confidence = Math.min(item.confidence, 75);
        item.warnings = [...item.warnings, 'OCR_VALUE_REQUIRES_VISUAL_REVIEW'];
      }
      const row = item.warnings.find((warning) => warning.startsWith('PRODUCT_ROW:')) ?? '';
      // The dedupe key deliberately excludes the page number: the same field
      // found with the same value on different pages (e.g. native + OCR or a
      // repeated spec table) is the same semantic evidence and must never be
      // emitted as duplicate rows.
      const key = `${row}|${item.canonicalField}|${String(item.normalizedValue)}`;
      const current = unique.get(key);
      if (!current) {
        unique.set(key, item);
        continue;
      }
      // Native/OCR precedence: prefer higher-confidence evidence; on a tie,
      // OCR evidence wins deterministically (it is derived from the rendered
      // page, which is the most faithful reading when native text quality is
      // in doubt). Same field+value is never duplicated.
      const ocrPreference = item.method === 'OCR' && current.method !== 'OCR' ? 1 : 0;
      if (
        item.confidence > current.confidence ||
        (item.confidence === current.confidence && ocrPreference > 0)
      ) {
        unique.set(key, item);
      }
    }
    return [...unique.values()];
  }
}
