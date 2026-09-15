import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  fileURLToPath(new URL('./projectWizard.css', import.meta.url)),
  'utf8',
);

describe('project wizard dialog sizing contracts', () => {
  it('keeps editor dialogs compact', () => {
    expect(css).toContain('.v4-floating-workspace.v4-editor-float');
    expect(css).toContain('width: min(600px, calc(100vw - 40px));');
  });

  it('keeps template browser wider than simple editors', () => {
    expect(css).toContain(
      '.v4-floating-workspace.v4-editor-float:has(.v4-wizard-template-browser)',
    );
    expect(css).toContain('width: min(820px, calc(100vw - 40px));');
  });

  it('keeps project folder preview bounded', () => {
    expect(css).toContain('.project-folder-tree');
    expect(css).toContain('width: min(760px, calc(100vw - 40px));');
  });

  it('keeps custom deliverable editor compact and scroll-safe', () => {
    expect(css).toContain("input[maxlength='120']");
    expect(css).toContain('overflow: auto;');
  });
});
