import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import DOMMatrixShim from '@thednp/dommatrix';
import type {
  DatasheetComparisonField,
  DatasheetComparisonStatus,
  DatasheetFieldExtraction,
  LocalFileClassification,
  LocalIntelligenceFieldKey,
  LocalIntelligenceOverview,
  LuminaireDatasheetAnalysis,
  LuminaireRecord,
  Project,
  ProjectFolderFileCategory,
  ProjectFolderFileItem,
  ProjectFolderIndex,
  ProjectQualityCheck,
  ProjectWorkspace,
} from '@scli/domain';

const engine = 'SCLI Local Intelligence 1.0' as const;
const maxPdfBytes = 100 * 1024 * 1024;
let pdfParserModule: Promise<typeof import('pdf-parse')> | null = null;

async function loadPdfParser(): Promise<typeof import('pdf-parse')> {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    Object.defineProperty(globalThis, 'DOMMatrix', {
      value: DOMMatrixShim as unknown as typeof globalThis.DOMMatrix,
      configurable: true,
      writable: true,
    });
  }
  pdfParserModule ??= import('pdf-parse');
  return pdfParserModule;
}

interface PdfTextPage {
  pageNumber: number;
  text: string;
}

export interface PdfTextDocument {
  pageCount: number;
  pages: PdfTextPage[];
}

export type PdfTextExtractor = (filePath: string, maxPages: number) => Promise<PdfTextDocument>;

interface ExtractionPattern {
  regex: RegExp;
  confidence: number;
}

interface FieldRule {
  fieldKey: LocalIntelligenceFieldKey;
  label: string;
  patterns: ExtractionPattern[];
}

const fieldRules: FieldRule[] = [
  {
    fieldKey: 'manufacturer',
    label: 'Manufacturer',
    patterns: [
      {
        regex: /\b(?:manufacturer|brand|make)\s*[:#-]\s*([a-z0-9][a-z0-9 &.+_-]{1,80})/i,
        confidence: 94,
      },
    ],
  },
  {
    fieldKey: 'model',
    label: 'Model',
    patterns: [
      {
        regex:
          /\b(?:model|product\s*(?:code|reference)|ordering\s*code|article\s*(?:no\.?|number)|catalogue\s*(?:no\.?|number))\s*[:#-]\s*([a-z0-9][a-z0-9 ./_-]{1,90})/i,
        confidence: 95,
      },
    ],
  },
  {
    fieldKey: 'wattage',
    label: 'Wattage',
    patterns: [
      {
        regex:
          /\b(?:system\s*)?(?:power|wattage|input\s*power|luminaire\s*wattage|connected\s*load)\s*[:#-]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:w|watts?)(?:\s*[/,|-]\s*[0-9]+(?:\.[0-9]+)?\s*(?:w|watts?))*)/i,
        confidence: 96,
      },
    ],
  },
  {
    fieldKey: 'lumens',
    label: 'Lumen Output',
    patterns: [
      {
        regex:
          /\b(?:luminous\s*flux(?:\s*of\s*the\s*luminaire)?|luminaire\s*flux|light\s*output|fixture\s*output|lumens?)\s*[:#-]?\s*([0-9][0-9 ,.]*\s*lm)\b/i,
        confidence: 95,
      },
    ],
  },
  {
    fieldKey: 'lightColor',
    label: 'CCT',
    patterns: [
      {
        regex:
          /\b(?:cct|correlated\s*colo(?:u)?r\s*temperature|colo(?:u)?r\s*temperature)\s*[:#-]?\s*((?:[0-9]{4}\s*k)(?:\s*[/,|-]\s*[0-9]{4}\s*k)*)/i,
        confidence: 97,
      },
      {
        regex: /\bled\s*module\s*:[^\n]{0,100}?([0-9]{4}\s*k)\b/i,
        confidence: 93,
      },
    ],
  },
  {
    fieldKey: 'cri',
    label: 'CRI',
    patterns: [
      {
        regex:
          /\b(?:cri|colo(?:u)?r\s*rendering\s*index|ra)\s*[:#-]?\s*((?:>|≥|>=)?\s*[0-9]{2,3}(?:\s*[/,|-]\s*(?:>|≥|>=)?\s*[0-9]{2,3})*)/i,
        confidence: 96,
      },
    ],
  },
  {
    fieldKey: 'beamAngle',
    label: 'Beam Angle',
    patterns: [
      {
        regex:
          /\b(?:beam\s*angle|beam|optic)\s*[:#-]?\s*((?:[0-9]{1,3}(?:\.[0-9]+)?\s*(?:°|deg(?:rees?)?))(?:\s*[/,|-]\s*[0-9]{1,3}(?:\.[0-9]+)?\s*(?:°|deg(?:rees?)?))*)/i,
        confidence: 94,
      },
      {
        regex:
          /\b(narrow\s*spot|spot|flood|wide\s*flood|oval\s*flood|wallwash(?:er)?|wide\s*beam|medium\s*beam)\b/i,
        confidence: 82,
      },
    ],
  },
  {
    fieldKey: 'ipRating',
    label: 'IP Rating',
    patterns: [
      {
        regex: /\b(?:ip\s*rating|ingress\s*protection)\s*[:#-]?\s*(ip\s*[0-9]{2,3})\b/i,
        confidence: 97,
      },
      {
        regex: /\bprotection\s*mode\s*(ip\s*[0-9]{2,3})\b/i,
        confidence: 96,
      },
      { regex: /\b(ip\s*[0-9]{2,3})\b/i, confidence: 84 },
    ],
  },
  {
    fieldKey: 'mounting',
    label: 'Mounting',
    patterns: [
      {
        regex:
          /\b(?:mounting|installation|mounting\s*type)\s*[:#-]\s*(recessed|surface(?:\s*mounted)?|pendant|suspended|track(?:\s*mounted)?|wall(?:\s*mounted)?|floor(?:\s*mounted)?|ground(?:\s*recessed)?)/i,
        confidence: 93,
      },
    ],
  },
  {
    fieldKey: 'cutout',
    label: 'Cut-out',
    patterns: [
      {
        regex:
          /\b(?:cut\s*-?\s*out|ceiling\s*cutout|aperture)\s*[:#-]?\s*((?:ø|dia(?:meter)?\.?\s*)?[0-9]+(?:\.[0-9]+)?(?:\s*[x×]\s*[0-9]+(?:\.[0-9]+)?)?\s*mm)/i,
        confidence: 96,
      },
    ],
  },
  {
    fieldKey: 'driver',
    label: 'Driver',
    patterns: [
      {
        regex:
          /\b(?:driver|control\s*gear|power\s*supply)\s*[:#-]\s*(integral|integrated|remote|external|included|excluded|constant\s*(?:current|voltage)[a-z0-9 /_-]*)/i,
        confidence: 91,
      },
    ],
  },
  {
    fieldKey: 'control',
    label: 'Control / Dimming',
    patterns: [
      {
        regex:
          /\b(?:control|dimming|dimmable|protocol)\s*[:#-]?\s*(dali(?:-2)?|0\s*-?\s*10\s*v|1\s*-?\s*10\s*v|triac|phase\s*(?:cut|dimming)|leading\s*edge|trailing\s*edge|dmx|casambi|on\s*[/|-]\s*off|non\s*-?\s*dimmable)/i,
        confidence: 94,
      },
    ],
  },
  {
    fieldKey: 'emergency',
    label: 'Emergency',
    patterns: [
      {
        regex:
          /\b(?:emergency|emergency\s*duration)\s*[:#-]\s*(no|none|yes|available|[0-9]+\s*(?:h|hr|hour|hours))/i,
        confidence: 91,
      },
    ],
  },
  {
    fieldKey: 'dimensions',
    label: 'Dimensions',
    patterns: [
      {
        regex:
          /\b(?:dimensions?|size|overall\s*dimensions?)\s*[:#-]\s*((?:ø\s*)?[0-9]+(?:\.[0-9]+)?(?:\s*[x×]\s*[0-9]+(?:\.[0-9]+)?){1,2}\s*mm)/i,
        confidence: 91,
      },
    ],
  },
  {
    fieldKey: 'bodyColorFinish',
    label: 'Body Color / Finish',
    patterns: [
      {
        regex:
          /\b(?:body\s*colo(?:u)?r|finish|housing\s*colo(?:u)?r|colo(?:u)?r\s*finish)\s*[:#-]\s*([a-z][a-z0-9 /_-]{1,60})/i,
        confidence: 90,
      },
    ],
  },
];

const statusKeys: DatasheetComparisonStatus[] = [
  'Matched',
  'Mismatch',
  'MissingSchedule',
  'MissingDatasheet',
  'NeedsReview',
];

function cleanValue(value: string): string {
  return value
    .replaceAll(/\s+/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .trim()
    .replace(/[.;,:-]+$/, '')
    .trim();
}

function evidenceLine(value: string): string {
  const cleaned = cleanValue(value);
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

function expandAlternatives(fieldKey: LocalIntelligenceFieldKey, value: string): string[] {
  const patterns: Partial<Record<LocalIntelligenceFieldKey, RegExp>> = {
    wattage: /[0-9]+(?:\.[0-9]+)?\s*(?:w|watts?)/gi,
    lumens: /[0-9][0-9 ,.]*\s*lm\b/gi,
    lightColor: /[0-9]{4}\s*k\b/gi,
    cri: /(?:>|≥|>=)?\s*[0-9]{2,3}/g,
    beamAngle: /[0-9]{1,3}(?:\.[0-9]+)?\s*(?:°|deg(?:rees?)?)/gi,
    ipRating: /ip\s*[0-9]{2,3}/gi,
  };
  const pattern = patterns[fieldKey];
  if (!pattern) return [cleanValue(value)];
  const matches = [...value.matchAll(pattern)].map((match) => cleanValue(match[0] ?? ''));
  return matches.length ? matches : [cleanValue(value)];
}

function normalizedValue(fieldKey: LocalIntelligenceFieldKey, value: string): string {
  const lower = value.toLowerCase().replaceAll('≥', '>=').replaceAll(/\s+/g, ' ').trim();
  if (['wattage', 'lumens', 'lightColor', 'beamAngle', 'ipRating'].includes(fieldKey)) {
    const numbers = [...lower.matchAll(/[0-9]+(?:\.[0-9]+)?/g)]
      .map((match) => String(Number(match[0])))
      .sort()
      .join('|');
    if (numbers) return numbers;
  }
  if (fieldKey === 'cri') {
    const number = lower.match(/[0-9]{2,3}/)?.[0] ?? '';
    return number;
  }
  return lower.replaceAll(/[^a-z0-9]+/g, '');
}

function extractionForRule(rule: FieldRule, pages: PdfTextPage[]): DatasheetFieldExtraction | null {
  const findings: Array<{
    value: string;
    confidence: number;
    pageNumber: number;
    evidence: string;
  }> = [];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map(cleanValue).filter(Boolean);
    for (const line of lines) {
      for (const pattern of rule.patterns) {
        const match = line.match(pattern.regex);
        const captured = match?.[1];
        if (!captured) continue;
        for (const alternative of expandAlternatives(rule.fieldKey, captured)) {
          if (!alternative) continue;
          findings.push({
            value: alternative,
            confidence: pattern.confidence,
            pageNumber: page.pageNumber,
            evidence: evidenceLine(line),
          });
        }
      }
    }
  }
  if (!findings.length) return null;
  const sortedFindings = findings.sort((left, right) => right.confidence - left.confidence);
  const strongestConfidence = sortedFindings[0]?.confidence ?? 0;
  const relevantFindings = sortedFindings.filter(
    (finding) => finding.confidence >= strongestConfidence - 4,
  );
  const unique = new Map<string, (typeof findings)[number]>();
  for (const finding of relevantFindings) {
    const key = normalizedValue(rule.fieldKey, finding.value);
    if (key && !unique.has(key)) unique.set(key, finding);
  }
  const alternatives = [...unique.values()].map((finding) => finding.value).slice(0, 6);
  const best = [...unique.values()][0] ?? findings[0]!;
  const ambiguous = alternatives.length > 1;
  return {
    fieldKey: rule.fieldKey,
    label: rule.label,
    value: ambiguous ? alternatives.join(' / ') : best.value,
    alternatives,
    confidence: Math.max(35, best.confidence - (ambiguous ? 28 : 0)),
    pageNumber: best.pageNumber,
    evidence: best.evidence,
    ambiguous,
  };
}

export function extractDatasheetFields(pages: PdfTextPage[]): DatasheetFieldExtraction[] {
  return fieldRules
    .map((rule) => extractionForRule(rule, pages))
    .filter((field): field is DatasheetFieldExtraction => Boolean(field));
}

function emptyCounts(): Record<DatasheetComparisonStatus, number> {
  return Object.fromEntries(statusKeys.map((status) => [status, 0])) as Record<
    DatasheetComparisonStatus,
    number
  >;
}

export function compareLuminaireWithDatasheet(
  luminaire: LuminaireRecord,
  extracted: DatasheetFieldExtraction[],
): { comparisons: DatasheetComparisonField[]; counts: Record<DatasheetComparisonStatus, number> } {
  const extractedByKey = new Map(extracted.map((field) => [field.fieldKey, field]));
  const comparisons: DatasheetComparisonField[] = [];
  const counts = emptyCounts();
  for (const rule of fieldRules) {
    const scheduleValue = cleanValue(String(luminaire[rule.fieldKey] ?? ''));
    const field = extractedByKey.get(rule.fieldKey);
    if (!scheduleValue && !field) continue;
    let status: DatasheetComparisonStatus;
    if (!field) status = 'MissingDatasheet';
    else if (field.ambiguous) status = 'NeedsReview';
    else if (!scheduleValue) status = 'MissingSchedule';
    else {
      status =
        normalizedValue(rule.fieldKey, scheduleValue) ===
        normalizedValue(rule.fieldKey, field.value)
          ? 'Matched'
          : 'Mismatch';
    }
    counts[status] += 1;
    comparisons.push({
      fieldKey: rule.fieldKey,
      label: rule.label,
      value: field?.value ?? '',
      alternatives: field?.alternatives ?? [],
      confidence: field?.confidence ?? 0,
      pageNumber: field?.pageNumber ?? 0,
      evidence: field?.evidence ?? '',
      ambiguous: field?.ambiguous ?? false,
      scheduleValue,
      status,
    });
  }
  return { comparisons, counts };
}

export async function extractPdfText(filePath: string, maxPages: number): Promise<PdfTextDocument> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new Error('The selected datasheet is not a file.');
  if (fileStats.size > maxPdfBytes)
    throw new Error('The PDF is larger than the 100 MB local limit.');
  const buffer = await readFile(filePath);
  const { PDFParse } = await loadPdfParser();
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ first: maxPages });
    return {
      pageCount: result.total,
      pages: result.pages.map((page) => ({ pageNumber: page.num, text: page.text })),
    };
  } finally {
    await parser.destroy();
  }
}

function unavailableAnalysis(
  luminaire: LuminaireRecord,
  status: LuminaireDatasheetAnalysis['status'],
  message: string,
): LuminaireDatasheetAnalysis {
  return {
    luminaireId: luminaire.id,
    tag: luminaire.tag,
    datasheetPath: luminaire.datasheetPath,
    fileName: luminaire.datasheetPath ? path.basename(luminaire.datasheetPath) : '',
    analyzedAt: new Date().toISOString(),
    engine,
    privacyMode: 'LocalOnly',
    status,
    message,
    pageCount: 0,
    textAvailable: false,
    comparisons: [],
    counts: emptyCounts(),
  };
}

function categoryScores(text: string): Array<[ProjectFolderFileCategory, number, string]> {
  const normalized = text.toLowerCase();
  const definitions: Array<[ProjectFolderFileCategory, RegExp[], string]> = [
    [
      'Datasheets',
      [/data\s*sheet/g, /technical\s*data/g, /product\s*specification/g, /luminous\s*flux/g],
      'product specification language',
    ],
    [
      'Dialux',
      [/dialux/g, /illuminance/g, /calculation\s*results/g, /maintenance\s*factor/g],
      'lighting calculation language',
    ],
    [
      'Schedules',
      [/luminaire\s*schedule/g, /fixture\s*schedule/g, /lighting\s*schedule/g, /luminaire\s*type/g],
      'luminaire schedule language',
    ],
    [
      'TechnicalBoq',
      [/bill\s*of\s*quantit/g, /\bboq\b/g, /item\s*description/g, /unit\s*quantity/g],
      'technical BOQ language',
    ],
    [
      'MeetingMinutes',
      [/meeting\s*minutes/g, /minutes\s*of\s*meeting/g, /attendees/g, /decisions/g],
      'meeting record language',
    ],
    [
      'Drawings',
      [
        /lighting\s*layout/g,
        /reflected\s*ceiling\s*plan/g,
        /drawing\s*number/g,
        /\bscale\s*1\s*:/g,
      ],
      'drawing and layout language',
    ],
    [
      'Renderings',
      [/rendering/g, /visuali[sz]ation/g, /perspective\s*view/g, /3d\s*view/g],
      'rendering and visualization language',
    ],
  ];
  return definitions
    .map(([category, patterns, reason]) => {
      const matches = patterns.reduce(
        (total, pattern) => total + Math.min(normalized.match(pattern)?.length ?? 0, 3),
        0,
      );
      return [category, matches, reason] as [ProjectFolderFileCategory, number, string];
    })
    .sort((left, right) => right[1] - left[1]);
}

function pathClassification(item: ProjectFolderFileItem): LocalFileClassification {
  return {
    itemId: item.id,
    fileName: item.fileName,
    relativePath: item.relativePath,
    currentCategory: item.category,
    suggestedCategory: item.category,
    confidence: item.confidence,
    source: 'Path',
    reason: `Classified from the folder path and ${item.extension || 'file'} extension.`,
    changed: false,
  };
}

function check(
  key: string,
  label: string,
  detail: string,
  severity: ProjectQualityCheck['severity'],
  passed: boolean,
): ProjectQualityCheck {
  return { key, label, detail, severity, passed };
}

function readinessScore(checks: ProjectQualityCheck[]): number {
  const severityWeight: Record<ProjectQualityCheck['severity'], number> = {
    Info: 1,
    Warning: 2,
    Blocking: 3,
  };
  const total = checks.reduce((sum, item) => sum + severityWeight[item.severity], 0);
  const passed = checks.reduce(
    (sum, item) => sum + (item.passed ? severityWeight[item.severity] : 0),
    0,
  );
  return total ? Math.round((passed / total) * 100) : 100;
}

export class LocalIntelligenceService {
  public constructor(private readonly pdfExtractor: PdfTextExtractor = extractPdfText) {}

  public async analyzeDatasheet(luminaire: LuminaireRecord): Promise<LuminaireDatasheetAnalysis> {
    const selectedPath = luminaire.datasheetPath.trim();
    if (!selectedPath) {
      return unavailableAnalysis(luminaire, 'Unavailable', 'Link an official PDF datasheet first.');
    }
    if (/^https?:\/\//i.test(selectedPath)) {
      return unavailableAnalysis(
        luminaire,
        'Unsupported',
        'Save the official PDF locally before analysis. Web files are never uploaded or fetched.',
      );
    }
    if (path.extname(selectedPath).toLowerCase() !== '.pdf') {
      return unavailableAnalysis(
        luminaire,
        'Unsupported',
        'Local analysis currently supports PDF datasheets.',
      );
    }
    if (!existsSync(selectedPath)) {
      return unavailableAnalysis(
        luminaire,
        'Unavailable',
        'The linked PDF cannot be found on this device.',
      );
    }
    try {
      const document = await this.pdfExtractor(selectedPath, 40);
      const textAvailable = document.pages.some((page) => cleanValue(page.text).length >= 30);
      if (!textAvailable) {
        return {
          ...unavailableAnalysis(
            luminaire,
            'NeedsReview',
            'No selectable text was found. This may be a scanned PDF and needs manual review.',
          ),
          pageCount: document.pageCount,
        };
      }
      const extracted = extractDatasheetFields(document.pages);
      const { comparisons, counts } = compareLuminaireWithDatasheet(luminaire, extracted);
      const needsReview = counts.NeedsReview > 0 || extracted.length === 0;
      return {
        luminaireId: luminaire.id,
        tag: luminaire.tag,
        datasheetPath: selectedPath,
        fileName: path.basename(selectedPath),
        analyzedAt: new Date().toISOString(),
        engine,
        privacyMode: 'LocalOnly',
        status: needsReview ? 'NeedsReview' : 'Ready',
        message: extracted.length
          ? `${extracted.length} technical field(s) were found locally.`
          : 'Selectable text was found, but no supported technical fields could be identified.',
        pageCount: document.pageCount,
        textAvailable: true,
        comparisons,
        counts,
      };
    } catch (error) {
      return unavailableAnalysis(
        luminaire,
        'Unavailable',
        error instanceof Error ? error.message : 'The PDF could not be analyzed locally.',
      );
    }
  }

  private async classifyFile(item: ProjectFolderFileItem): Promise<LocalFileClassification> {
    const fallback = pathClassification(item);
    if (
      item.confidence >= 80 ||
      item.extension !== '.pdf' ||
      item.availability === 'Unavailable' ||
      item.sizeBytes > 25 * 1024 * 1024 ||
      !existsSync(item.filePath)
    ) {
      return fallback;
    }
    try {
      const document = await this.pdfExtractor(item.filePath, 2);
      const text = document.pages.map((page) => page.text).join('\n');
      const [best] = categoryScores(text);
      if (!best || best[1] < 2) return fallback;
      const confidence = Math.min(96, 62 + best[1] * 7);
      return {
        ...fallback,
        suggestedCategory: best[0],
        confidence,
        source: 'PdfText',
        reason: `The first PDF pages contain ${best[2]}.`,
        changed: best[0] !== item.category,
      };
    } catch {
      return fallback;
    }
  }

  public async overview(
    project: Project,
    workspace: ProjectWorkspace,
    folderIndex: ProjectFolderIndex,
  ): Promise<LocalIntelligenceOverview> {
    const linkedDatasheets = workspace.luminaires.filter((item) =>
      item.datasheetPath.trim(),
    ).length;
    const missingDatasheets = workspace.luminaires.length - linkedDatasheets;
    const requiredFields = workspace.lightingPackage.scheduleColumns
      .filter((column) => column.requiredForIssue)
      .map((column) => column.fieldKey);
    const rowsMissingRequired = workspace.luminaires.filter((luminaire) =>
      requiredFields.some(
        (field) => !String(luminaire[field as keyof LuminaireRecord] ?? '').trim(),
      ),
    ).length;
    const unavailableDatasheets = workspace.luminaires.filter(
      (item) =>
        item.datasheetPath &&
        !/^https?:\/\//i.test(item.datasheetPath) &&
        !existsSync(item.datasheetPath),
    ).length;
    const checks: ProjectQualityCheck[] = [
      check(
        'local-folder',
        'Project folder connected',
        workspace.folderPath
          ? 'The local project folder is connected.'
          : 'Connect the project folder before final issue.',
        'Blocking',
        Boolean(workspace.folderPath),
      ),
      check(
        'local-luminaires',
        'Luminaire schedule has rows',
        workspace.luminaires.length
          ? `${workspace.luminaires.length} luminaire row(s) are available.`
          : 'Add or import the luminaire schedule.',
        'Blocking',
        workspace.luminaires.length > 0,
      ),
      check(
        'local-datasheets',
        'Official datasheets linked',
        missingDatasheets
          ? `${missingDatasheets} luminaire(s) have no linked datasheet.`
          : 'Every luminaire has a linked datasheet.',
        'Warning',
        missingDatasheets === 0 && workspace.luminaires.length > 0,
      ),
      check(
        'local-datasheet-files',
        'Linked datasheet files are available',
        unavailableDatasheets
          ? `${unavailableDatasheets} linked local PDF(s) cannot be found.`
          : 'All linked local datasheet files are available.',
        'Blocking',
        unavailableDatasheets === 0,
      ),
      check(
        'local-required-fields',
        'Required schedule values are complete',
        rowsMissingRequired
          ? `${rowsMissingRequired} luminaire row(s) are missing required issue values.`
          : 'Required issue fields are complete.',
        'Blocking',
        rowsMissingRequired === 0,
      ),
      check(
        'local-file-index',
        'Project files have been scanned',
        folderIndex.indexedAt
          ? `${folderIndex.fileCount} project file(s) are indexed.`
          : 'Run Scan Project Files so local intelligence can classify available documents.',
        'Info',
        Boolean(folderIndex.indexedAt),
      ),
      ...workspace.health.checks
        .filter((item) => !['folder', 'datasheets'].includes(item.key))
        .map((item) => ({ ...item, key: `workspace-${item.key}` })),
    ];

    const candidates = folderIndex.items
      .filter((item) => item.confidence < 80)
      .sort((left, right) => left.confidence - right.confidence)
      .slice(0, 8);
    const fileClassifications = await Promise.all(
      folderIndex.items
        .filter((item) => item.confidence >= 80)
        .slice(0, 80)
        .map((item) => Promise.resolve(pathClassification(item)))
        .concat(candidates.map((item) => this.classifyFile(item))),
    );
    const classificationsNeedingReview = fileClassifications.filter(
      (item) => item.changed || item.confidence < 70,
    ).length;
    const failedChecks = checks.filter((item) => !item.passed);
    const warnings = failedChecks
      .filter((item) => item.severity !== 'Info')
      .map((item) => item.detail)
      .slice(0, 5);
    const nextActions: string[] = [];
    if (workspace.health.blockingRequirements)
      nextActions.push(`Resolve ${workspace.health.blockingRequirements} blocking requirement(s).`);
    if (workspace.health.overdueActions)
      nextActions.push(`Close or reschedule ${workspace.health.overdueActions} overdue action(s).`);
    if (missingDatasheets)
      nextActions.push(`Link ${missingDatasheets} missing official datasheet(s).`);
    if (rowsMissingRequired)
      nextActions.push(`Complete required values in ${rowsMissingRequired} luminaire row(s).`);
    if (!folderIndex.indexedAt) nextActions.push('Scan the connected project folder.');
    if (classificationsNeedingReview)
      nextActions.push(`Review ${classificationsNeedingReview} uncertain file classification(s).`);
    if (!nextActions.length)
      nextActions.push('No critical gap was detected. Continue the planned design work.');
    const score = readinessScore(checks);
    return {
      projectId: project.id,
      generatedAt: new Date().toISOString(),
      engine,
      privacyMode: 'LocalOnly',
      readinessScore: score,
      checks,
      brief: {
        headline: `${project.projectCode} is ${score >= 85 ? 'nearly ready' : score >= 60 ? 'progressing with gaps' : 'not ready to issue'}.`,
        summary: `${project.projectName} is ${project.progressPercent}% complete with ${workspace.luminaires.length} luminaire(s), ${linkedDatasheets} linked datasheet(s), and ${folderIndex.fileCount} indexed project file(s).`,
        nextActions: nextActions.slice(0, 5),
        warnings,
      },
      fileClassifications,
      stats: {
        luminaireCount: workspace.luminaires.length,
        linkedDatasheets,
        missingDatasheets,
        indexedFiles: folderIndex.fileCount,
        classificationsNeedingReview,
      },
    };
  }
}
