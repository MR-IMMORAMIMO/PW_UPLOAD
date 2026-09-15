/**
 * V4 accent-color provider.
 *
 * Bridges the persisted personal `accentColor` setting into the V4 CSS token
 * surface. Raw accent remains the display/category colour; the action colour
 * is a vetted darker companion used only by filled controls with white text.
 *
 * Contract:
 *   - Only the presets allowed by the Settings UI are applied. Any other value
 *     (including an empty string) leaves the stylesheet default in place.
 *   - The provider never writes a legacy theme key and never touches the
 *     Light/Dark/System preference (`scli.v4.theme` stays the only theme
 *     storage key).
 *   - Semantic tokens (`--v4-success`, `--v4-warning`, `--v4-danger`,
 *     `--v4-info`, `--v4-neutral`) are never modified.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/environment';

/** The exact presets the Settings UI presents (single authority for V4). */
export const V4_ACCENT_CHOICES = [
  '#0d9488',
  '#3b82f6',
  '#7c3aed',
  '#f97316',
  '#ef4444',
  '#6b7280',
] as const;

export const V4_ACCENT_PRESETS = [
  ...V4_ACCENT_CHOICES,
  '#008C95',
  '#2563EB',
  '#9333EA',
  '#EA580C',
  '#DC2626',
  '#475569',
] as const;

export type V4AccentPreset = (typeof V4_ACCENT_PRESETS)[number];

export interface V4AccentTokens {
  raw: string;
  actionPrimary: string;
  actionPrimaryForeground: '#FFFFFF';
}

const V4_ACCENT_ACTIONS: Record<V4AccentPreset, string> = {
  '#0d9488': '#0F766E',
  '#3b82f6': '#2563EB',
  '#7c3aed': '#6D28D9',
  '#f97316': '#C2410C',
  '#ef4444': '#DC2626',
  '#6b7280': '#4B5563',
  '#008C95': '#006E75',
  '#2563EB': '#2563EB',
  '#9333EA': '#7E22CE',
  '#EA580C': '#C2410C',
  '#DC2626': '#DC2626',
  '#475569': '#475569',
};

export function isV4AccentPreset(value: unknown): value is V4AccentPreset {
  return (
    typeof value === 'string' &&
    V4_ACCENT_PRESETS.some((preset) => preset.toLowerCase() === value.toLowerCase())
  );
}

export function resolveV4AccentTokens(accent: V4AccentPreset): V4AccentTokens {
  const canonical = V4_ACCENT_PRESETS.find(
    (preset) => preset.toLowerCase() === accent.toLowerCase(),
  ) as V4AccentPreset;
  return {
    raw: accent,
    actionPrimary: V4_ACCENT_ACTIONS[canonical],
    actionPrimaryForeground: '#FFFFFF',
  };
}

/** Applies the persisted accent to the V4 token surface. */
export function applyV4Accent(accent: string | undefined): void {
  const root = document.documentElement;
  if (isV4AccentPreset(accent)) {
    const tokens = resolveV4AccentTokens(accent);
    root.style.setProperty('--v4-accent', tokens.raw);
    root.style.setProperty('--v4-action-primary', tokens.actionPrimary);
    root.style.setProperty('--v4-action-primary-foreground', tokens.actionPrimaryForeground);
  } else {
    root.style.removeProperty('--v4-accent');
    root.style.removeProperty('--v4-action-primary');
    root.style.removeProperty('--v4-action-primary-foreground');
  }
}

export function V4AccentProvider({ children }: { children: React.ReactNode }) {
  const settings = useQuery({ queryKey: ['v4', 'settings'], queryFn: api.personalSettings });

  useEffect(() => {
    applyV4Accent(settings.data?.accentColor);
  }, [settings.data?.accentColor]);

  return children;
}
