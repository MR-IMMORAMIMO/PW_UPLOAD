/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { actionCategoryIconKeys } from '@scli/domain';
import {
  actionCategoryIconCatalog,
  actionCategoryIconFor,
  fallbackActionCategoryIcon,
} from './actionCategoryIconCatalog';

describe('actionCategoryIconCatalog', () => {
  it('maps every persisted stable key without dynamic library lookup', () => {
    expect([...actionCategoryIconCatalog.keys()]).toEqual([...actionCategoryIconKeys]);
    for (const key of actionCategoryIconKeys) expect(actionCategoryIconFor(key)).toBeDefined();
  });

  it('returns the safe fallback for invalid persisted legacy data', () => {
    expect(actionCategoryIconFor('arbitrary-lucide-export')).toBe(fallbackActionCategoryIcon);
  });
});
