/**
 * Native Text Quality Gate (P5C universal PDF normalization).
 *
 * Decides whether a PDF page's native extracted text is semantically usable
 * or whether OCR must run. The gate evaluates QUALITY, not merely quantity:
 * a page can contain thousands of native characters while the text is
 * undecodable glyph garbage (Type3 fonts, missing ToUnicode maps, custom
 * encodings). Such pages must be classified OCR-required.
 *
 * The gate is deliberately conservative and deterministic. It takes ONLY the
 * page text as input - never the filename, manufacturer, or any document-level
 * hint - so the same logic applies to every manufacturer. There is no
 * "if manufacturer === X then force OCR" rule anywhere in this module.
 *
 * Signals:
 * - printable-character ratio (ASCII + Latin-1)
 * - control-character ratio (C0/C1, excluding whitespace)
 * - replacement/private-use/suspicious Unicode ratio
 * - word-like token ratio (tokens containing real ASCII words)
 * - readable-line ratio (for HYBRID detection)
 *
 * Font metadata (Type3 fonts, missing ToUnicode) is NOT required: combined
 * text-level evidence is sufficient and is what the current PDF stack safely
 * exposes. Font metadata may be added later as a supporting signal only.
 */

export type PageReadingMode = 'NATIVE_GOOD' | 'NATIVE_CORRUPTED' | 'IMAGE_ONLY' | 'HYBRID';
export type NativeTextDecision = 'NATIVE_GOOD' | 'OCR_REQUIRED';

export interface NativeTextQualityAssessment {
  /** Total non-whitespace code points on the page. */
  nativeTextCharacterCount: number;
  /** Fraction of code points that are printable ASCII or Latin-1. */
  printableRatio: number;
  /** Fraction of code points that are C0/C1 control characters (whitespace excluded). */
  controlRatio: number;
  /** Fraction of whitespace-split tokens that look like real English-like words. */
  wordLikeTokenRatio: number;
  /** Fraction of tokens containing an unusually long unbroken letter run (glyph-soup signature). */
  longLetterTokenRatio: number;
  /** Fraction of code points that are replacement/private-use/specials Unicode. */
  suspiciousGlyphRatio: number;
  /** Fraction of non-empty lines that pass the line-level readability check. */
  readableLineRatio: number;
  /** Deterministic composite readability score 0..100 (informational). */
  readabilityScore: number;
  readingMode: PageReadingMode;
  decision: NativeTextDecision;
}

const SUSPICIOUS_GLYPH = /[\uFFFD\uE000-\uF8FF\uFFF0-\uFFFF]/;
const WHITESPACE = /[\t\n\r\u0020]/;
/** An English-like word: 2-20 ASCII letters with at least one vowel. */
const WORD_LIKE = /^[A-Za-z]{2,20}$/;
const HAS_VOWEL = /[aeiou]/i;
/** Glyph-soup signature: an unbroken letter run longer than any real word. */
const LONG_LETTER_RUN = /[A-Za-z]{22,}/;

/** Minimum share of readable lines for a failing page to be HYBRID rather than NATIVE_CORRUPTED. */
const HYBRID_READABLE_LINE_RATIO = 0.25;
const HYBRID_MIN_READABLE_LINES = 2;
/** Pages with this many or more characters cannot pass on word-ratio alone. */
const MEANINGFUL_CHARACTER_COUNT = 40;
const MAX_CONTROL_RATIO = 0.12;
const MAX_SUSPICIOUS_RATIO = 0.08;
const MIN_PRINTABLE_RATIO = 0.5;
const MIN_WORD_LIKE_TOKEN_RATIO = 0.25;
const MAX_LONG_LETTER_TOKEN_RATIO = 0.1;
/** Sparse pages: very little text of any kind still requires OCR (old <80-char behavior). */
const MIN_USABLE_CHARACTER_COUNT = 80;

function isControlCodePoint(code: number): boolean {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f)
  );
}

/**
 * Line-level readability: a line is readable when it contains real ASCII words
 * or is a recognized technical evidence line (IP codes, RAL codes, units,
 * technical labels). Used for HYBRID classification and never for hard facts.
 */
export function lineIsReadable(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  for (const ch of trimmed) {
    if (isControlCodePoint(ch.codePointAt(0) ?? 0)) return false;
    if (SUSPICIOUS_GLYPH.test(ch)) return false;
  }
  const words = trimmed.match(/[A-Za-z]{2,}/g);
  if ((words ?? []).length >= 2) return true;
  return /(ip\s*[0-9]{2,3}\b|(?:Ø|ø)\s*[0-9]+(?:\.[0-9]+)?|\b\d+(?:\.\d+)?\s*(?:mm|W|lm|K|°)\b|\bral\s*[0-9]{4,5}\b|\b(?:cct|cri|beam|flux|power)\b)/i.test(
    trimmed,
  );
}

function isPrintable(codePoint: number): boolean {
  return (codePoint >= 0x21 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff);
}

/**
 * Deterministic quality assessment of a single page's native text.
 *
 * Decision rules (applied in order, all conservative):
 * 1. No usable text at all -> IMAGE_ONLY / OCR_REQUIRED (existing scanned-PDF support).
 * 2. Excessive control characters -> corrupted (typical bad-encoding output).
 * 3. Excessive suspicious Unicode (replacement / private use) -> corrupted.
 * 4. Very low printable ratio -> corrupted (mojibake or exotic glyph soup).
 * 5. High character count but almost no word-like tokens -> corrupted garbage.
 * 6. A failing page with a meaningful readable-line share -> HYBRID.
 * 7. Otherwise -> NATIVE_GOOD (native accepted, OCR must NOT run).
 */
export function assessNativeTextQuality(text: string): NativeTextQualityAssessment {
  const codePoints = [...text];
  const total = codePoints.length;
  let printableCount = 0;
  let controlCount = 0;
  let suspiciousCount = 0;
  let nonWhitespaceCount = 0;
  for (const ch of codePoints) {
    const code = ch.codePointAt(0) ?? 0;
    if (isPrintable(code)) printableCount += 1;
    if (isControlCodePoint(code)) controlCount += 1;
    if (SUSPICIOUS_GLYPH.test(ch)) suspiciousCount += 1;
    if (!WHITESPACE.test(ch)) nonWhitespaceCount += 1;
  }
  const printableRatio = nonWhitespaceCount === 0 ? 0 : printableCount / nonWhitespaceCount;
  const controlRatio = total === 0 ? 0 : controlCount / total;
  const suspiciousGlyphRatio = total === 0 ? 0 : suspiciousCount / total;

  // Some PDFs position disclaimer letters individually. They are readable typography,
  // not broken encoding; do not let that footer drown out intact specification rows.
  // Character/control checks above still inspect the entire unmodified text.
  const scoringText = text
    .split(/\r?\n/)
    .filter((line) => {
      const parts = line.trim().split(/\s+/);
      return !(
        parts.length >= 20 &&
        parts.filter((part) => /^[A-Za-z]$/.test(part)).length / parts.length > 0.8
      );
    })
    .join('\n');
  const tokens = scoringText.split(/\s+/).filter(Boolean);
  let wordLikeTokens = 0;
  let longLetterTokens = 0;
  for (const token of tokens) {
    if (LONG_LETTER_RUN.test(token)) {
      longLetterTokens += 1;
      continue;
    }
    if (WORD_LIKE.test(token) && HAS_VOWEL.test(token)) wordLikeTokens += 1;
  }
  const wordLikeTokenRatio = tokens.length === 0 ? 0 : wordLikeTokens / tokens.length;
  const longLetterTokenRatio = tokens.length === 0 ? 0 : longLetterTokens / tokens.length;

  const lines = text.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const readableLines = nonEmptyLines.filter(lineIsReadable).length;
  const readableLineRatio = nonEmptyLines.length === 0 ? 0 : readableLines / nonEmptyLines.length;

  const readabilityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 *
          (0.45 * wordLikeTokenRatio +
            0.35 * printableRatio +
            0.2 * (1 - controlRatio) -
            0.1 * suspiciousGlyphRatio -
            0.15 * longLetterTokenRatio),
      ),
    ),
  );

  const base = {
    nativeTextCharacterCount: nonWhitespaceCount,
    printableRatio,
    controlRatio,
    wordLikeTokenRatio,
    longLetterTokenRatio,
    suspiciousGlyphRatio,
    readableLineRatio,
    readabilityScore,
  };

  // 1. No usable text -> image-only page: OCR must run (preserves scanned-PDF support).
  if (text.trim().length === 0) {
    return { ...base, readingMode: 'IMAGE_ONLY', decision: 'OCR_REQUIRED' };
  }
  // 2.-6. Quality failures, regardless of character quantity.
  let corrupted = false;
  if (controlRatio > MAX_CONTROL_RATIO) corrupted = true;
  else if (suspiciousGlyphRatio > MAX_SUSPICIOUS_RATIO) corrupted = true;
  else if (printableRatio < MIN_PRINTABLE_RATIO) corrupted = true;
  else if (longLetterTokenRatio > MAX_LONG_LETTER_TOKEN_RATIO) corrupted = true;
  else if (
    nonWhitespaceCount >= MEANINGFUL_CHARACTER_COUNT &&
    wordLikeTokenRatio < MIN_WORD_LIKE_TOKEN_RATIO
  ) {
    corrupted = true;
  }
  if (corrupted) {
    // A failing page with a meaningful readable-line share is HYBRID:
    // readable native headings/rows coexist with unreadable embedded text.
    const hybrid =
      readableLines >= HYBRID_MIN_READABLE_LINES && readableLineRatio >= HYBRID_READABLE_LINE_RATIO;
    return {
      ...base,
      readingMode: hybrid ? 'HYBRID' : 'NATIVE_CORRUPTED',
      decision: 'OCR_REQUIRED',
    };
  }
  // 7. Sparse pages with no readable structure: too little readable text of
  //    any kind (preserves the old <80-char OCR behavior for scan fragments).
  //    A short page whose tokens are real words is accepted - quantity alone
  //    never triggers OCR.
  if (
    nonWhitespaceCount < MIN_USABLE_CHARACTER_COUNT &&
    wordLikeTokenRatio < MIN_WORD_LIKE_TOKEN_RATIO
  ) {
    return { ...base, readingMode: 'IMAGE_ONLY', decision: 'OCR_REQUIRED' };
  }
  // 8. Healthy native text: never OCR unnecessarily.
  return { ...base, readingMode: 'NATIVE_GOOD', decision: 'NATIVE_GOOD' };
}
