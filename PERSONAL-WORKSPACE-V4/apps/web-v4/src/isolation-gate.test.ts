/**
 * V4 hard-isolation gate.
 *
 * Mechanically verifies that apps/web-v4 does not import presentation code from
 * apps/web. Enforcement strategy: ESLint `no-restricted-imports` on the
 * apps/web-v4 package (see eslint.config.js). This test additionally scans the
 * V4 source files for any forbidden apps/web presentation import patterns as a
 * belt-and-braces structural guard.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V4_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Forbidden apps/web presentation import patterns (relative or bare). */
const FORBIDDEN_PATTERNS = [
  /from ['"]apps\/web/,
  /from ['"]\.\.\/web/,
  /from ['"]\.\.\/\.\.\/web/,
  /from ['"]@scli\/web/,
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...collectSourceFiles(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full);
  }
  return files;
}

describe('V4 hard-isolation gate', () => {
  it('rejects/ flags any apps/web presentation import in V4 sources (M)', () => {
    const sourceFiles = collectSourceFiles(V4_ROOT).filter(
      (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
    );
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations = sourceFiles.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      const offendingLines = content
        .split('\n')
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => FORBIDDEN_PATTERNS.some((pattern) => pattern.test(line)));
      return offendingLines.map(({ line, index }) => `${file}:${index}: ${line.trim()}`);
    });

    expect(violations).toEqual([]);
  });

  it('does not import the legacy stylesheet (16)', () => {
    const sourceFiles = collectSourceFiles(V4_ROOT);
    const cssViolations = sourceFiles.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      const offendingLines = content
        .split('\n')
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => /styles\.css/.test(line) && /from|import/.test(line));
      return offendingLines.map(({ line, index }) => `${file}:${index}: ${line.trim()}`);
    });
    expect(cssViolations).toEqual([]);
  });
});
