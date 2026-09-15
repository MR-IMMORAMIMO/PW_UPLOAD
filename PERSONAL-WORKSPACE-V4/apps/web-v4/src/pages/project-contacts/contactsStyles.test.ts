import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  fileURLToPath(await import.meta.resolve('../../styles-v4.css')),
  'utf8',
);

describe('Contacts responsive style contract', () => {
  it('uses the locked desktop workspace columns and bounded three-row contact composition', () => {
    expect(styles).toMatch(
      /\.v4-contacts__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(/s,
    );
    expect(styles).toMatch(/\.v4-contacts__workspace\s*\{[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(
      /\.v4-contacts__groups\s*\{[^}]*height:\s*100%[^}]*grid-template-columns:\s*repeat\(2,[^}]*grid-template-rows:\s*minmax\(0, 1\.12fr\) minmax\(0, 0\.83fr\) minmax\(0, 0\.77fr\)/s,
    );
    expect(styles).toMatch(
      /\.v4-contacts__group\[data-role='client'\]\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1/s,
    );
    expect(styles).toMatch(
      /\.v4-contacts__group\[data-role='consultant'\]\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1/s,
    );
    expect(styles).toMatch(
      /\.v4-contacts__group\[data-role='contractor'\]\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2/s,
    );
    expect(styles).toMatch(
      /\.v4-contacts__group\[data-role='internal-team'\]\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*3/s,
    );
  });

  it('keeps overflow inside stretched cards while the shell owns the viewport', () => {
    expect(styles).toMatch(/\.v4-contacts__workspace\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(styles).toMatch(/\.v4-contacts__group-rows\s*\{[^}]*overflow-y:\s*auto/s);
    expect(styles).not.toMatch(/\.v4-contacts[^}]*100vh/s);
  });

  it('stretches the relationship column and gives Key Relationship the remaining track', () => {
    expect(styles).toMatch(
      /\.v4-contacts__relationship\s*\{[^}]*height:\s*100%[^}]*grid-template-rows:\s*minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\)/s,
    );
    expect(styles).toMatch(
      /\.v4-contacts__group,\s*\.v4-contacts__side-card\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0[^}]*flex-direction:\s*column/s,
    );
  });

  it('styles the Sales Representative relationship card from Project authority', () => {
    expect(styles).toMatch(/\.v4-contacts__sales-label\s*\{[^}]*text-transform:\s*uppercase/s);
    expect(styles).toMatch(/\.v4-contacts__sales-email\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });

  it('stacks content and relationship cards without horizontal overflow at narrow widths', () => {
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.v4-contacts__workspace,[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 960px\)[\s\S]*?\.v4-contacts__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.v4-contacts__groups,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.v4-contacts__group\[data-role='client'\],[\s\S]*?grid-column:\s*auto;[\s\S]*?grid-row:\s*auto/,
    );
    expect(styles).toMatch(/\.v4-contacts\s*\{[^}]*min-width:\s*0/s);
  });
});
