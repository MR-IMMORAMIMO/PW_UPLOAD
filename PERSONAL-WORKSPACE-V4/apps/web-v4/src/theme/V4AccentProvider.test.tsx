/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  V4AccentProvider,
  V4_ACCENT_CHOICES,
  applyV4Accent,
  isV4AccentPreset,
  resolveV4AccentTokens,
} from './V4AccentProvider';

const apiMock = vi.hoisted(() => ({ personalSettings: vi.fn() }));
vi.mock('../api/environment', () => ({ api: apiMock }));

function renderProvider(accentColor?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  apiMock.personalSettings.mockResolvedValue({
    projectRoot: 'D:\\SCT Workspace\\Projects',
    defaultFolderProfile: 'Full Lighting Design',
    defaultInputMode: 'Manual',
    autoOpenProjectFolder: true,
    designerName: 'Mohamed',
    companyName: 'SCT Lighting Design',
    companyLogoPath: '',
    accentColor: accentColor ?? '#008C95',
    timeZone: 'Asia/Dubai',
    backupRetention: 30,
    updatedAt: '2026-08-18T08:00:00.000Z',
  });
  return render(
    <QueryClientProvider client={client}>
      <V4AccentProvider>
        <div data-testid="child">content</div>
      </V4AccentProvider>
    </QueryClientProvider>,
  );
}

describe('V4AccentProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.removeProperty('--v4-accent');
    document.documentElement.style.removeProperty('--v4-action-primary');
    document.documentElement.style.removeProperty('--v4-action-primary-foreground');
  });

  it('applies the persisted accent preset to the V4 token surface', async () => {
    renderProvider('#2563EB');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#2563EB'),
    );
    expect(document.documentElement.style.getPropertyValue('--v4-action-primary')).toBe('#2563EB');
    expect(document.documentElement.style.getPropertyValue('--v4-action-primary-foreground')).toBe(
      '#FFFFFF',
    );
  });

  it('restores the stylesheet default when the persisted accent is not an allowed preset', async () => {
    renderProvider('#123456');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe(''),
    );
  });

  it('leaves the stylesheet default in place when no accent is persisted', async () => {
    renderProvider('');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe(''),
    );
  });

  it('never writes a legacy theme key', async () => {
    renderProvider('#9333EA');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#9333EA'),
    );
    expect(window.localStorage.getItem('scli.theme')).toBeNull();
    expect(window.localStorage.getItem('scli.v4.theme')).toBeNull();
  });
});

describe('applyV4Accent', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--v4-accent');
    document.documentElement.style.removeProperty('--v4-action-primary');
    document.documentElement.style.removeProperty('--v4-action-primary-foreground');
  });

  it('applies only the allowed presets (case-insensitive)', () => {
    for (const preset of ['#008C95', '#2563EB', '#9333EA', '#EA580C', '#DC2626', '#475569']) {
      applyV4Accent(preset);
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe(preset);
    }
    applyV4Accent('#008c95');
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#008c95');
    expect(document.documentElement.style.getPropertyValue('--v4-action-primary')).toBe('#006E75');
  });

  it.each(V4_ACCENT_CHOICES)(
    'applies Settings swatch %s with a readable action companion',
    (color) => {
      const root = document.documentElement;
      root.style.setProperty('--v4-success', '#15803d');
      root.style.setProperty('--v4-warning', '#a16207');
      applyV4Accent(color);
      expect(root.style.getPropertyValue('--v4-accent')).toBe(color);
      expect(root.style.getPropertyValue('--v4-action-primary')).toBe(
        resolveV4AccentTokens(color).actionPrimary,
      );
      expect(root.style.getPropertyValue('--v4-action-primary-foreground')).toBe('#FFFFFF');
      expect(root.style.getPropertyValue('--v4-success')).toBe('#15803d');
      expect(root.style.getPropertyValue('--v4-warning')).toBe('#a16207');
      root.style.removeProperty('--v4-success');
      root.style.removeProperty('--v4-warning');
    },
  );

  it('rejects arbitrary unsupported accent values', () => {
    for (const unsupported of ['#123456', 'red', 'rgb(0,0,0)', '']) {
      applyV4Accent(unsupported);
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--v4-action-primary')).toBe('');
    }
  });

  it('clears the override when given undefined', () => {
    applyV4Accent('#EA580C');
    applyV4Accent(undefined);
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('');
  });
});

describe('resolveV4AccentTokens', () => {
  it('keeps raw accents independent and returns vetted filled-action companions', () => {
    expect(resolveV4AccentTokens('#008C95')).toEqual({
      raw: '#008C95',
      actionPrimary: '#006E75',
      actionPrimaryForeground: '#FFFFFF',
    });
    expect(resolveV4AccentTokens('#EA580C').actionPrimary).toBe('#C2410C');
    expect(resolveV4AccentTokens('#9333EA').actionPrimary).toBe('#7E22CE');
  });
});

describe('isV4AccentPreset', () => {
  it('accepts exactly the six Settings presets and rejects everything else', () => {
    for (const preset of ['#008C95', '#2563EB', '#9333EA', '#EA580C', '#DC2626', '#475569']) {
      expect(isV4AccentPreset(preset)).toBe(true);
    }
    for (const unsupported of ['#123456', '#008C9', 'teal', 42, null, undefined]) {
      expect(isV4AccentPreset(unsupported)).toBe(false);
    }
  });
});
