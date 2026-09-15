import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/styles-v4.css'), 'utf8');

describe('V4 Work Session visual contracts', () => {
  it('keeps the tracking strip thin and inside the flex-owned shell height', () => {
    const stripRule = styles.match(/\.v4-work-session-strip\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(stripRule).toContain('min-height: 40px');
    expect(stripRule).toContain('flex: 0 0 40px');
    expect(stripRule).not.toMatch(/100(?:d)?vh/);
  });

  it('uses approved running, paused, inactive, and destructive treatments', () => {
    expect(styles).toContain(".v4-work-session-anchor[data-state='RUNNING']");
    expect(styles).toContain(".v4-work-session-anchor[data-state='PAUSED']");
    expect(styles).toContain(".v4-work-session-anchor[data-mode='minimal']");
    expect(styles).toContain('.v4-work-session-control--stop');
  });

  it('has bounded narrow adaptations and no Work Session horizontal overflow authority', () => {
    expect(styles).toContain('@media (max-width: 760px)');
    expect(styles).toContain('@media (max-width: 520px)');
    expect(styles).not.toMatch(/\.v4-work-session[^{]*\{[^}]*overflow-x:\s*(auto|scroll)/);
  });

  it('removes tray motion for both V4 and operating-system reduced-motion preferences', () => {
    expect(styles).toContain(':root.v4-reduced-motion .v4-work-session-tray');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
