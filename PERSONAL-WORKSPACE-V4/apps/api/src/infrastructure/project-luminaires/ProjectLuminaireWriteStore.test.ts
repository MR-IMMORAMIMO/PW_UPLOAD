import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ProjectLuminaireWriteStore } from './ProjectLuminaireWriteStore';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-27T08:00:00.000Z');

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  value.exec('PRAGMA foreign_keys = ON');
  for (const migration of PRODUCTION_MIGRATIONS) {
    value.exec(
      migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
        ? 'PRAGMA foreign_keys = OFF'
        : 'PRAGMA foreign_keys = ON',
    );
    value.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
    migration.up({
      database: value,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => NOW },
    });
    value.exec('COMMIT');
    value.exec('PRAGMA foreign_keys = ON');
  }
  return value;
}

const input = (tag: string) => ({
  tag,
  category: 'Downlight',
  imagePath: '',
  description: 'Existing description',
  manufacturer: 'ERCO',
  model: 'Iku',
  productType: '',
  variantLabel: '',
  orderingCode: 'A2000427',
  wattage: '10.6 W',
  lumens: '900 lm',
  lightColor: '3000 K',
  cri: '90',
  beamAngle: '24°',
  ipRating: 'IP44',
  mounting: 'Recessed',
  cutout: '75 mm',
  driver: '',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: '',
  location: 'Lobby',
  unit: 'No.',
  quantity: 1,
  notes: 'Keep',
  sourceName: 'Test',
  dimensions: '',
  bodyColorFinish: 'White',
});

describe('ProjectLuminaireWriteStore', () => {
  it('stores new Tags canonically and blocks case-insensitive Project collisions', () => {
    const db = database();
    const store = new ProjectLuminaireWriteStore(
      db,
      () => NOW,
      () => '22222222-2222-4222-8222-222222222222',
    );
    const created = store.create(PROJECT_ID, input('  dl01 '));
    expect(created).toMatchObject({ tag: 'DL01', rowVersion: 1 });
    expect(() => store.create(PROJECT_ID, input('Dl01'))).toThrow(/already used/i);
  });

  it('applies sparse CAS once and preserves all omitted fields', () => {
    const db = database();
    const store = new ProjectLuminaireWriteStore(db, () => NOW);
    const created = store.create(PROJECT_ID, input('DL01'));
    const updated = store.patch(
      PROJECT_ID,
      created.id,
      1,
      'dl01',
      [
        { field: 'location', before: 'Lobby', after: 'Main Lobby' },
        { field: 'quantity', before: 1, after: 2.5 },
      ],
      false,
    );
    expect(updated).toMatchObject({
      location: 'Main Lobby',
      quantity: 2.5,
      notes: 'Keep',
      rowVersion: 2,
    });
    expect(() => store.patch(PROJECT_ID, created.id, 1, 'DL01', [], false)).toThrow(
      /changed after review/i,
    );
  });

  it('persists ordering_code separately from model and preserves model on ordering-code change', () => {
    const db = database();
    const store = new ProjectLuminaireWriteStore(db, () => NOW);
    const created = store.create(PROJECT_ID, input('DL01'));
    expect(created).toMatchObject({ orderingCode: 'A2000427', model: 'Iku' });
    const updated = store.patch(
      PROJECT_ID,
      created.id,
      1,
      'DL01',
      [{ field: 'orderingCode', before: 'A2000427', after: 'A2000428' }],
      false,
    );
    expect(updated).toMatchObject({ orderingCode: 'A2000428', model: 'Iku', rowVersion: 2 });
    const row = db
      .prepare('SELECT ordering_code, model FROM project_luminaires WHERE id=?')
      .get(created.id) as { ordering_code: string; model: string };
    expect(row).toEqual({ ordering_code: 'A2000428', model: 'Iku' });
  });

  it('allows only Project-owned fields for a linked target and keeps no-op versions stable', () => {
    const db = database();
    const store = new ProjectLuminaireWriteStore(db, () => NOW);
    const created = store.create(PROJECT_ID, input('DL01'));
    expect(store.patch(PROJECT_ID, created.id, 1, 'DL01', [], true).rowVersion).toBe(1);
    expect(() =>
      store.patch(
        PROJECT_ID,
        created.id,
        1,
        'DL01',
        [{ field: 'wattage', before: '10.6 W', after: '12 W' }],
        true,
      ),
    ).toThrow(/Library-linked/i);
  });
});
