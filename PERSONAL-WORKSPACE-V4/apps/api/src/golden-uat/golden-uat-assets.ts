/**
 * Golden UAT fixture — synthetic fixture asset generation.
 *
 * Generates small, fixture-owned placeholder files at SEED RUNTIME inside the
 * fixture-owned project folder area. These are intentionally NOT copyrighted
 * manufacturer documents and NOT real company/client data. They exist only so
 * the canonical file/attachment linking authority has real local files to point
 * at (datasheets, images, register documents).
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

/** Builds a minimal, structurally valid single-page PDF with a correct xref table. */
export function buildMinimalPdf(title: string, body: string): Buffer {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
  );
  const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(title)}) Tj ET\nBT /F1 10 Tf 72 700 Td (${escapePdfText(body)}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

/** Builds a small solid-color PNG placeholder (e.g. a product image). */
export function buildPlaceholderPng(
  width: number,
  height: number,
  rgb: [number, number, number],
): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = rgb[0];
    png.data[index + 1] = rgb[1];
    png.data[index + 2] = rgb[2];
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

export interface GoldenUatAssetSet {
  /** Absolute path to the fixture-owned folder root. */
  root: string;
  datasheetPaths: Record<string, string>;
  imagePaths: Record<string, string>;
  documentPaths: Record<'drawing' | 'meetingMinutes', string>;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Golden fixture path escapes its owned root: ${target}`);
  }
}

/** Read-only collision preflight used before a multi-file fixture write begins. */
export function preflightGoldenFixtureFile(
  rootInput: string,
  targetInput: string,
  bytes: Buffer,
): void {
  const root = path.resolve(rootInput);
  const target = path.resolve(targetInput);
  assertContained(root, target);
  if (!existsSync(target)) return;
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Golden fixture path is not an owned regular file: ${target}`);
  }
  if (sha256(readFileSync(target)) !== sha256(bytes)) {
    throw new Error(`HASH_MISMATCH: refusing to overwrite conflicting fixture bytes at ${target}`);
  }
}

/**
 * Hash-before-overwrite fixture writer. Existing exact bytes are an idempotent
 * no-op; a filename collision with different bytes fails closed. Symlinks and
 * non-files are never followed or replaced.
 */
export function writeGoldenFixtureFile(
  rootInput: string,
  targetInput: string,
  bytes: Buffer,
): void {
  const lexicalRoot = path.resolve(rootInput);
  const lexicalTarget = path.resolve(targetInput);
  assertContained(lexicalRoot, lexicalTarget);
  preflightGoldenFixtureFile(lexicalRoot, lexicalTarget, bytes);
  mkdirSync(lexicalRoot, { recursive: true });
  mkdirSync(path.dirname(lexicalTarget), { recursive: true });
  const root = realpathSync(lexicalRoot);
  const realParent = realpathSync(path.dirname(lexicalTarget));
  const target = path.join(realParent, path.basename(lexicalTarget));
  assertContained(root, target);
  if (existsSync(target)) {
    const stats = lstatSync(target);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Golden fixture path is not an owned regular file: ${target}`);
    }
    const actual = sha256(readFileSync(target));
    const expected = sha256(bytes);
    if (actual !== expected) {
      throw new Error(
        `HASH_MISMATCH: refusing to overwrite conflicting fixture bytes at ${target}`,
      );
    }
    return;
  }
  writeFileSync(target, bytes, { flag: 'wx' });
}

/**
 * Creates the fixture-owned folder root and writes synthetic assets for the
 * luminaire datasheet/image matrix and the register documents. Returns absolute
 * paths keyed by luminaire tag / document key.
 */
export function createGoldenUatAssets(root: string): GoldenUatAssetSet {
  const canonicalRoot = path.resolve(root);
  mkdirSync(path.join(root, '06_DATASHEETS'), { recursive: true });
  mkdirSync(path.join(root, '05_RENDERS'), { recursive: true });
  mkdirSync(path.join(root, '01_INPUT', 'CAD'), { recursive: true });
  mkdirSync(path.join(root, '07_SUPPORTING_DOCUMENTS'), { recursive: true });

  const datasheetPaths: Record<string, string> = {};
  const imagePaths: Record<string, string> = {};
  const documentPaths: Record<string, string> = {};

  // Datasheets: DL01, WL01, SP01, EX01, BL01 present; DL02, LN01, FL01 missing.
  const datasheetTags = ['DL01', 'WL01', 'SP01', 'EX01', 'BL01'];
  for (const tag of datasheetTags) {
    const filePath = path.join(root, '06_DATASHEETS', `${tag}_datasheet.pdf`);
    writeGoldenFixtureFile(
      canonicalRoot,
      filePath,
      buildMinimalPdf(`${tag} Datasheet`, `Synthetic Golden UAT datasheet for luminaire ${tag}.`),
    );
    datasheetPaths[tag] = filePath;
  }

  // Images: DL01, DL02, SP01, EX01, BL01 present; WL01, LN01, FL01 missing.
  const imageTags = ['DL01', 'DL02', 'SP01', 'EX01', 'BL01'];
  for (const tag of imageTags) {
    const filePath = path.join(root, '05_RENDERS', `${tag}_product.png`);
    writeGoldenFixtureFile(canonicalRoot, filePath, buildPlaceholderPng(320, 240, [4, 180, 204]));
    imagePaths[tag] = filePath;
  }

  // Register documents (fixture-owned, real files).
  const drawingPath = path.join(root, '01_INPUT', 'CAD', 'L-101_Lighting_Layout.dwg');
  writeGoldenFixtureFile(
    canonicalRoot,
    drawingPath,
    Buffer.from('SCT Golden UAT synthetic drawing placeholder.\n', 'utf8'),
  );
  documentPaths['drawing'] = drawingPath;

  const minutesPath = path.join(root, '07_SUPPORTING_DOCUMENTS', 'Meeting_Minutes_Kickoff.txt');
  writeGoldenFixtureFile(
    canonicalRoot,
    minutesPath,
    Buffer.from('SCT Golden UAT synthetic meeting minutes placeholder.\n', 'utf8'),
  );
  documentPaths['meetingMinutes'] = minutesPath;

  return { root: realpathSync(canonicalRoot), datasheetPaths, imagePaths, documentPaths };
}
