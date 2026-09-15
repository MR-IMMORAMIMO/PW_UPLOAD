/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = [
  readFileSync(resolve(here, '../../styles/v4-tokens.css'), 'utf8'),
  readFileSync(resolve(here, '../../styles-v4.css'), 'utf8'),
].join('\n');
const page = readFileSync(resolve(here, './SettingsWorkspace.tsx'), 'utf8');

describe('Settings visual and scope contracts', () => {
  it('uses an aligned two-column desktop grid that stacks without document X overflow', () => {
    expect(css).toMatch(
      /\.v4-settings__grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /\.v4-settings__grid\[data-section='general'\][\s\S]*?grid-template-areas:\s*'workspace identity'\s*'catalogues appearance'/,
    );
    expect(css).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.v4-settings__grid\[data-section='general'\] \{\s*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(/\.v4-settings__grid \{[\s\S]*?align-items: stretch;/);
    expect(css).toMatch(/\.v4-settings \{[\s\S]*?min-width: 0;/);
    expect(css).not.toMatch(/\.v4-settings \{[^}]*overflow-x:\s*(?:auto|scroll)/);
  });

  it('isolates Data & Backup full width and paginates without collection Y scrolling', () => {
    expect(page).toContain('className="v4-settings-card--backup"');
    expect(page).toContain('BACKUPS_PER_PAGE = 8');
    expect(page).toContain('ariaLabel="Recent Backups pages"');
    expect(css).toMatch(/\.v4-settings-card--backup \{\s*grid-area: backup;/);
    expect(css).toMatch(
      /\.v4-settings__grid\[data-section='data'\] \{[\s\S]*?grid-template-areas: 'backup';/,
    );
    expect(page).toContain("type SettingsSection = 'general' | 'data'");
    expect(page).toContain('aria-label="Settings sections"');
    expect(css).toMatch(
      /\.v4-settings__backup-table \{[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: visible;/,
    );
    expect(css).not.toMatch(/\.v4-settings__backups \{[^}]*overflow-y:\s*(?:auto|scroll)/);
  });

  it('contains only the five approved settings group headings', () => {
    for (const allowed of [
      'Workspace',
      'Identity & Branding',
      'Catalogues',
      'Data & Backup',
      'Appearance',
    ])
      expect(page).toContain(`title="${allowed}"`);
    for (const forbidden of [
      'Integrations',
      'Notifications',
      'System Information',
      'Update & Version',
      'Typography',
      'Density',
      'Scope Defaults',
      'Output Defaults',
      'Project Code',
    ])
      expect(page).not.toContain(`title="${forbidden}"`);
  });

  it('keeps restore behind a dedicated confirmation drawer and no desktop restart call', () => {
    expect(page).toContain('title="Restore backup"');
    expect(page).toContain('Restore workspace');
    expect(page).toContain('Restart required');
    expect(page).not.toContain('.restart(');
  });

  it('keeps semantic danger/warning/success tokens independent of the accent', () => {
    expect(css).toMatch(/--v4-success:\s*#22c55e;/);
    expect(css).toMatch(/--v4-warning:\s*#f59e0b;/);
    expect(css).toMatch(/--v4-danger:\s*#ef4444;/);
    expect(css).toMatch(/--v4-info:\s*#3b82f6;/);
    // The accent family is the only token surface the accent setting may drive.
    expect(css).toMatch(/--v4-accent-soft:\s*color-mix\(in srgb, var\(--v4-accent\)/);
  });

  it('does not write a legacy theme key from the accent surface', () => {
    expect(page).not.toContain("localStorage.setItem('scli.theme'");
    expect(page).not.toContain('scli.theme');
  });
});
