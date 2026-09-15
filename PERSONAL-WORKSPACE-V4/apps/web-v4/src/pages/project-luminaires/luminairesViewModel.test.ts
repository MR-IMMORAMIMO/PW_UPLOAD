import { describe, expect, it } from 'vitest';
import type { LuminaireRecord } from '@scli/domain';
import {
  filterLuminaires,
  luminaireCompleteness,
  luminaireFileName,
  luminaireIdentity,
  luminaireImageSource,
  nextSelectionAfterDelete,
} from './luminairesViewModel';

const luminaire = (id: string, overrides: Partial<LuminaireRecord> = {}): LuminaireRecord => ({
  id,
  projectId: 'p1',
  tag: id.toUpperCase(),
  category: 'Downlight',
  imagePath: 'C:\\fixtures\\product.png',
  description: 'Downlight',
  manufacturer: 'Philips',
  model: 'CoreLine',
  wattage: '20 W',
  lumens: '1800 lm',
  lightColor: '3000 K',
  cri: 'CRI 90',
  beamAngle: '60°',
  ipRating: 'IP20',
  mounting: 'Recessed',
  cutout: '150 mm',
  driver: '700mA',
  control: 'On/Off',
  emergency: 'No',
  datasheetPath: 'C:\\fixtures\\data.pdf',
  location: 'Office',
  unit: 'No.',
  quantity: 12,
  notes: 'Note',
  sourceName: '',
  dimensions: '168 × 90 mm',
  bodyColorFinish: 'White',
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('luminairesViewModel', () => {
  it('derives display-only completeness without inventing persisted status', () => {
    expect(luminaireCompleteness(luminaire('a'))).toBe('Complete');
    expect(luminaireCompleteness(luminaire('b', { datasheetPath: '' }))).toBe('Missing DS');
    expect(luminaireCompleteness(luminaire('c', { imagePath: '' }))).toBe('Review');
  });

  it('maps identity, filenames and Windows image paths for presentation', () => {
    expect(luminaireIdentity(luminaire('a'))).toBe('Philips - CoreLine');
    expect(luminaireFileName('C:\\fixture\\DL01.pdf')).toBe('DL01.pdf');
    expect(luminaireImageSource('C:\\fixture\\DL01.png')).toBe('file:///C:/fixture/DL01.png');
  });

  it('filters canonical fields and assets and selects a safe neighbor after delete', () => {
    const items = [
      luminaire('a'),
      luminaire('b', { category: 'Linear', datasheetPath: '' }),
      luminaire('c', { imagePath: '' }),
    ];
    expect(filterLuminaires(items, 'linear', 'all', '')).toEqual([items[1]]);
    expect(filterLuminaires(items, '', 'missing-datasheet', '')).toEqual([items[1]]);
    expect(filterLuminaires(items, '', 'missing-image', '')).toEqual([items[2]]);
    expect(nextSelectionAfterDelete(items, 'b')).toBe('c');
    expect(nextSelectionAfterDelete(items, 'c')).toBe('b');
  });
});
