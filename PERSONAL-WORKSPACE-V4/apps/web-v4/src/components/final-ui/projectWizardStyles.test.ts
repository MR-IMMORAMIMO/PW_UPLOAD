import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/final-ui/projectWizard.css'),
  'utf8',
);

describe('New Project floating workspace sizing contract', () => {
  it('keeps editor/help floats content-sized', () => {
    expect(css).toMatch(/\.v4-floating-workspace\.v4-editor-float\s*\{[^}]*width:\s*min\(680px,[^}]*height:\s*auto/s);
    expect(css).toMatch(/\.v4-editor-float \.v4-floating-workspace__body\s*\{[^}]*overflow:\s*auto/s);
  });

  it('keeps the folder preview bounded instead of using the near-full-screen default', () => {
    expect(css).toMatch(
      /\.v4-floating-workspace:has\(> \.v4-floating-workspace__body > \.project-folder-tree\)\s*\{[^}]*width:\s*min\(760px,[^}]*height:\s*auto/s,
    );
  });

  it('keeps the one-field custom deliverable editor compact', () => {
    expect(css).toContain("input[maxlength='120']");
    expect(css).toMatch(/width:\s*min\(520px, calc\(100vw - 40px\)\)/);
  });
});
