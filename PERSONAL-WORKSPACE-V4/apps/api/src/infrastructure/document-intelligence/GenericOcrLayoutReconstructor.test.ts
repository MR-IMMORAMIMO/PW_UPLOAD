import { describe, expect, it } from 'vitest';
import {
  GenericOcrLayoutReconstructor,
  isValueLikeCell,
  type ReconstructedOcrPage,
} from './GenericOcrLayoutReconstructor';
import type { OcrWord } from './LocalOcrAdapter';

const PAGE_WIDTH = 1800;
const PAGE_HEIGHT = 2330;

function word(
  text: string,
  x: number,
  y: number,
  width = 50,
  height = 24,
  confidence = 90,
): OcrWord {
  return { text, confidence, bbox: { x, y, width, height } };
}

function reconstruct(words: readonly OcrWord[]): ReconstructedOcrPage {
  return new GenericOcrLayoutReconstructor().reconstruct({
    pageNumber: 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    words,
  });
}

function canonicalLines(page: ReconstructedOcrPage): string[] {
  return page.lines.flatMap((line) => line.canonical.split('\n'));
}

describe('GenericOcrLayoutReconstructor', () => {
  it('A: reconstructs a single key/value column into label | value rows', () => {
    const page = reconstruct([
      word('Power', 100, 200),
      word('13', 340, 200, 30),
      word('W', 378, 200, 30),
      word('System', 100, 250),
      word('power', 185, 250, 60),
      word('13.4', 340, 250, 40),
      word('W', 388, 250, 30),
    ]);
    expect(canonicalLines(page)).toEqual(['Power | 13 W', 'System power | 13.4 W']);
    expect(page.tableRows).toBe(2);
  });

  it('B: keeps two parallel technical columns separated (no cross-column merging)', () => {
    const page = reconstruct([
      // Photometric (left, x=100)
      word('CCT', 100, 400, 50),
      word('(K)', 160, 400, 30),
      word('3000', 355, 400, 50),
      word('CRI', 100, 450, 40),
      word('90', 355, 450, 30),
      // Electrical (right, x=650)
      word('Forward', 650, 400, 70),
      word('voltage', 730, 400, 60),
      word('17.8', 880, 400, 40),
      word('V', 930, 400, 25),
      word('LED', 650, 450, 40),
      word('current', 700, 450, 60),
      word('700', 880, 450, 40),
      word('mA', 930, 450, 35),
    ]);
    const lines = canonicalLines(page);
    // Each visual row must become TWO independent table rows (left + right).
    expect(lines).toContain('CCT (K) | 3000');
    expect(lines).toContain('CRI | 90');
    expect(lines).toContain('Forward voltage | 17.8 V');
    expect(lines).toContain('LED current | 700 mA');
    // The merged single-line form must never appear.
    expect(lines).not.toContain('CCT (K) 3000 Forward voltage 17.8 V');
    expect(page.tableRows).toBe(4);
  });

  it('C: splits a four-cell technical row into two independent label/value rows', () => {
    const page = reconstruct([
      word('CCT', 100, 500, 50),
      word('3000', 355, 500, 50),
      word('K', 412, 500, 25),
      word('Forward', 650, 500, 70),
      word('voltage', 730, 500, 60),
      word('17.8', 880, 500, 40),
      word('V', 928, 500, 25),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('CCT | 3000 K');
    expect(lines).toContain('Forward voltage | 17.8 V');
    expect(page.tableRows).toBe(2);
  });

  it('D: preserves a product title line and a standalone ordering code line', () => {
    const page = reconstruct([
      word('Easy', 100, 380, 50),
      word('Kap', 160, 380, 40),
      word('Ø', 210, 380, 25),
      word('80', 240, 380, 30),
      word('Plus', 280, 380, 40),
      word('Fixed', 330, 380, 45),
      word('Optic', 385, 380, 45),
      word('Medium', 440, 380, 60),
      word('05.7430.74', 100, 420, 90),
    ]);
    const lines = canonicalLines(page);
    expect(lines[0]).toBe('Easy Kap Ø 80 Plus Fixed Optic Medium');
    expect(lines[1]).toBe('05.7430.74');
    // The standalone code line must NOT be table-joined.
    expect(page.lines.find((line) => line.canonical === '05.7430.74')?.tableRow).toBe(false);
  });

  it('E: reconstructs a physical table (Colour | Black, Recessed depth (mm) | 150)', () => {
    const page = reconstruct([
      word('Colour', 100, 600, 60),
      word('Black', 355, 600, 50),
      word('Recessed', 100, 650, 80),
      word('depth', 190, 650, 50),
      word('(mm)', 250, 650, 40),
      word('150', 355, 650, 35),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('Colour | Black');
    expect(lines).toContain('Recessed depth (mm) | 150');
  });

  it('F: never turns unlabeled drawing annotations into specification rows', () => {
    const page = reconstruct([
      word('Ø75', 900, 1000, 40),
      word('95', 1050, 1050, 30),
      word('Ø80', 980, 1150, 40),
      word('275', 900, 1200, 40),
    ]);
    const lines = canonicalLines(page);
    // All drawing numbers are unlabeled: no table rows, plain lines only.
    expect(page.tableRows).toBe(0);
    for (const line of page.lines) {
      expect(line.canonical).not.toContain('|');
    }
    expect(lines).toContain('Ø75');
    expect(lines).toContain('95');
  });

  it('G: keeps accessory power-supply rows out of primary system-power binding', () => {
    const page = reconstruct([
      word('Power', 100, 800, 60),
      word('supply', 170, 800, 60),
      word('13-20W', 355, 800, 60),
      word('Power', 100, 850, 60),
      word('supply', 170, 850, 60),
      word('15-30W', 355, 850, 60),
    ]);
    // Reconstructed rows are generic label/value pairs; the semantic layer
    // decides whether "Power supply | 13-20W" matches SYSTEM_POWER (it does
    // not: the rule requires "system power" vocabulary, and capability/
    // accessory language is not exact configuration).
    const lines = canonicalLines(page);
    expect(lines).toContain('Power supply | 13-20W');
    expect(lines).toContain('Power supply | 15-30W');
  });

  it('H: preserves IP internal/external as two distinct evidence rows', () => {
    const page = reconstruct([
      word('IP', 100, 900, 30),
      word('internal', 140, 900, 60),
      word('20', 355, 900, 30),
      word('IP', 100, 950, 30),
      word('external', 140, 950, 60),
      word('54', 355, 950, 30),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('IP internal | 20');
    expect(lines).toContain('IP external | 54');
    // Never collapsed into a single row or a single IP value.
    expect(lines).not.toContain('IP internal | 20 | IP external | 54');
    expect(page.tableRows).toBe(2);
  });

  it('I: groups rows stably under noisy word geometry (shifted baselines/heights)', () => {
    const page = reconstruct([
      word('CCT', 100, 400, 50, 24, 90),
      word('(K)', 160, 398, 30, 20, 85),
      word('3000', 355, 402, 50, 28, 95),
      word('CRI', 100, 452, 40, 22, 88),
      word('90', 355, 448, 30, 30, 92),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('CCT (K) | 3000');
    expect(lines).toContain('CRI | 90');
  });

  it('J: splits same-Y text across a large horizontal gutter into two columns', () => {
    const page = reconstruct([
      word('CCT', 100, 700, 50),
      word('3000', 355, 700, 50),
      word('K', 412, 700, 25),
      word('Dimmable', 1000, 700, 90),
      word('Yes', 1200, 700, 40),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('CCT | 3000 K');
    expect(lines).toContain('Dimmable | Yes');
    // Never merged into one line.
    expect(lines).not.toContain('CCT 3000 K Dimmable Yes');
  });

  it('K: keeps a narrow true label/value gap on the same line (not split)', () => {
    const page = reconstruct([
      word('Beam', 100, 300, 50),
      word('angle', 158, 300, 45),
      word('25°', 215, 300, 35),
    ]);
    // Narrow gaps do not create cells: the words stay on ONE line, and the
    // existing delimiter-free semantic rule parses "Beam angle 25°" safely.
    expect(canonicalLines(page)).toEqual(['Beam angle 25°']);
    expect(page.tableRows).toBe(0);
  });

  it('L: does not attach repeated headers or page footers to technical rows', () => {
    const page = reconstruct([
      word('Easy', 100, 380, 50),
      word('Kap', 160, 380, 40),
      word('Photometric', 100, 500, 100),
      word('CCT', 100, 550, 50),
      word('3000', 355, 550, 50),
      word('K', 412, 550, 25),
      // Page footer at the bottom of the page.
      word('https://professional.flos.com', 100, 2200, 300),
      word('05.7430.74', 1549, 2200, 90),
      word('©2022', 100, 2260, 60),
      word('Flos', 170, 2260, 40),
      word('1/4', 1626, 2260, 30),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('CCT | 3000 K');
    // Footer text stays on its own lines, never attached to the technical row.
    expect(lines.some((line) => line.startsWith('https://professional.flos.com'))).toBe(true);
    // © is stripped as OCR noise; the line starts with "2022 Flos"
    expect(lines.some((line) => line.startsWith('2022 Flos'))).toBe(true);
    const cctLine = page.lines.find((line) => line.canonical === 'CCT | 3000 K')!;
    expect(cctLine.bbox.y).toBe(550);
  });

  it('propagates minimum word confidence to the row', () => {
    const page = reconstruct([
      word('CCT', 100, 400, 50, 24, 92),
      word('3000', 355, 400, 50, 24, 55),
    ]);
    const row = page.lines.find((line) => line.tableRow)!;
    expect(row.confidence).toBe(55);
    expect(row.cells[1]!.confidence).toBe(55);
  });

  it('never upgrades low-confidence critical values to a structured row', () => {
    const page = reconstruct([
      word('CCT', 100, 400, 50, 24, 90),
      word('3000', 355, 400, 50, 24, 20),
    ]);
    // Right cell confidence 20 < 40: no table row is emitted (the semantic
    // layer will never see an unsafe binding).
    expect(page.tableRows).toBe(0);
  });

  it('is deterministic for identical input', () => {
    const words = [word('CCT', 100, 400, 50), word('3000', 355, 400, 50)];
    const a = reconstruct(words);
    const b = reconstruct(words);
    expect(canonicalLines(a)).toEqual(canonicalLines(b));
    expect(a.columnBands).toEqual(b.columnBands);
  });

  it('detects column bands from repeated x-start alignment', () => {
    const page = reconstruct([
      word('CCT', 100, 400, 50),
      word('3000', 355, 400, 50),
      word('CRI', 100, 450, 40),
      word('90', 355, 450, 30),
    ]);
    expect(page.columnBands.length).toBeGreaterThanOrEqual(2);
    expect(page.columnBands[0]!.xStart).toBeLessThan(200);
    expect(page.columnBands[1]!.xStart).toBeGreaterThan(300);
  });

  it('M: caps line height to prevent cascading merges of parallel rows', () => {
    // Simulates a page where a drawing annotation (y=1000, h=80) would
    // otherwise cascade-merge with table rows below it.
    const page = reconstruct([
      word('Beam', 100, 300, 50),
      word('angle', 158, 300, 45),
      word('25°', 215, 300, 35),
      // Drawing annotation far below but with overlapping y due to height
      word('Ø75', 900, 1000, 40, 80),
      word('CCT', 100, 1100, 50),
      word('3000', 355, 1100, 50),
    ]);
    const lines = canonicalLines(page);
    // The drawing annotation must NOT merge with the CCT row.
    expect(lines).toContain('Beam angle 25°');
    expect(lines.some((l) => l.includes('CCT'))).toBe(true);
    expect(lines.some((l) => l.includes('Ø75'))).toBe(true);
    // The CCT row and the Ø75 must be on separate lines.
    expect(lines.some((l) => l.includes('Ø75') && l.includes('CCT'))).toBe(false);
  });

  it('N: strips trademark/copyright OCR noise from cell text but preserves degree symbol', () => {
    const page = reconstruct([word('Beam®', 100, 300, 50), word('25°', 180, 300, 35)]);
    // The ® is stripped from cell text, but ° is preserved.
    const beamLine = page.lines.find((l) => l.canonical.includes('Beam'));
    expect(beamLine?.cells.some((c) => c.text.includes('25°'))).toBe(true);
    expect(beamLine?.cells.some((c) => c.text.includes('®'))).toBe(false);
  });

  it('O: recognizes Symmetric as a value-like cell for light distribution rows', () => {
    const page = reconstruct([
      word('Light', 100, 700, 50),
      word('distribution', 160, 700, 80),
      word('Symmetric', 355, 700, 90),
    ]);
    const lines = canonicalLines(page);
    expect(lines).toContain('Light distribution | Symmetric');
  });
});

describe('isValueLikeCell', () => {
  it('accepts numeric/unit values, yes/no, colors, and IP codes', () => {
    expect(isValueLikeCell('13 W')).toBe(true);
    expect(isValueLikeCell('3000')).toBe(true);
    expect(isValueLikeCell('25°')).toBe(true);
    expect(isValueLikeCell('17.8 V')).toBe(true);
    expect(isValueLikeCell('700 mA')).toBe(true);
    expect(isValueLikeCell('Yes')).toBe(true);
    expect(isValueLikeCell('Black')).toBe(true);
    expect(isValueLikeCell('IP54')).toBe(true);
    expect(isValueLikeCell('>90')).toBe(true);
    expect(isValueLikeCell('Symmetric')).toBe(true);
    expect(isValueLikeCell('Asymmetric')).toBe(true);
    expect(isValueLikeCell('Direct')).toBe(true);
    expect(isValueLikeCell('Wide flood')).toBe(true);
  });
  it('rejects labels and long text', () => {
    expect(isValueLikeCell('CCT')).toBe(false);
    expect(isValueLikeCell('Forward voltage')).toBe(false);
    expect(isValueLikeCell('Easy Kap Ø 80')).toBe(false);
    expect(isValueLikeCell('')).toBe(false);
  });
});

it('keeps three adjacent label/value pairs separate despite small baseline shifts', () => {
  const lines = canonicalLines(
    reconstruct([
      word('Power', 50, 100),
      word('12', 250, 102),
      word('CCT', 550, 100),
      word('3000', 750, 102),
      word('CRI', 1050, 101),
      word('90', 1250, 100),
    ]),
  );
  expect(lines).toEqual(['Power | 12', 'CCT | 3000', 'CRI | 90']);
});
