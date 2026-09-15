import { describe, expect, it } from 'vitest';
import {
  actionCategoryIconKeys,
  normalizeCatalogLabel,
  normalizedCatalogIdentity,
  projectTagColorKeys,
  v4PaletteColorKeys,
} from './index';

describe('Action Category foundation vocabulary', () => {
  it('shares the seven-color palette without changing the Project Tag export', () => {
    expect(v4PaletteColorKeys).toEqual(['teal', 'blue', 'purple', 'gold', 'green', 'red', 'slate']);
    expect(projectTagColorKeys).toBe(v4PaletteColorKeys);
  });

  it('uses normalized display labels and a case-insensitive persistence identity', () => {
    expect(normalizeCatalogLabel('  Lighting    Design  ')).toBe('Lighting Design');
    expect(normalizedCatalogIdentity('  DESIGN  ')).toBe('design');
  });

  it('keeps a curated application-owned icon vocabulary', () => {
    expect(actionCategoryIconKeys).toHaveLength(32);
    expect(actionCategoryIconKeys).toContain('lightbulb');
    expect(actionCategoryIconKeys).toContain('upload');
    expect(actionCategoryIconKeys).not.toContain('CircleDashed');
  });
});
