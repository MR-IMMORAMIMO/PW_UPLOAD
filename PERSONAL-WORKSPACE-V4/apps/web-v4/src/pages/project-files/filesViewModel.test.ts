import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '@scli/domain';
import {
  buildFileRows,
  documentCategoryLabels,
  fileNameFromPath,
  filterFileRows,
  formatUpdatedAt,
  presenceOptions,
} from './filesViewModel';

const doc = (overrides: Partial<ProjectDocument> = {}): ProjectDocument => ({
  id: 'doc-1',
  projectId: 'proj-1',
  category: 'Drawing',
  documentNumber: 'L-101',
  title: 'Ground Floor Lighting Layout',
  revision: 'REV_01',
  status: 'Working',
  filePath: 'C:\\Projects\\L-101.dwg',
  issuedTo: '',
  issueDate: null,
  notes: '',
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
  ...overrides,
});

describe('filesViewModel', () => {
  it('maps canonical categories to user-friendly labels while preserving persisted values', () => {
    expect(documentCategoryLabels.LuxReport).toBe('DIALux / Lux Report');
    expect(documentCategoryLabels.Drawing).toBe('Drawing');
    expect(documentCategoryLabels.Visualization).toBe('Visualization');
    expect(documentCategoryLabels.Datasheet).toBe('Datasheet');
    expect(documentCategoryLabels.Other).toBe('Other');
  });

  it('derives a display file name from an absolute Windows path', () => {
    expect(fileNameFromPath('C:\\Projects\\L-101.dwg')).toBe('L-101.dwg');
    expect(fileNameFromPath('C:/Projects/Sub/L-101.dwg')).toBe('L-101.dwg');
    expect(fileNameFromPath('')).toBe('');
  });

  it('builds rows with server-computed presence state', () => {
    const rows = buildFileRows(
      [doc()],
      [{ documentId: 'doc-1', state: 'Current', note: 'Available locally.' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.presence.state).toBe('Present');
    expect(rows[0]?.presence.note).toBe('Available locally.');
    expect(rows[0]?.categoryLabel).toBe('Drawing');
    expect(rows[0]?.fileName).toBe('L-101.dwg');
  });

  it('defaults to NotGenerated when no fileCenter presence is available', () => {
    const rows = buildFileRows([doc()], []);
    expect(rows[0]?.presence.state).toBe('NotGenerated');
  });

  it('filters rows by query, category, and presence', () => {
    const rows = buildFileRows(
      [
        doc({ id: 'a', title: 'Layout', category: 'Drawing', filePath: 'C:\\a.dwg' }),
        doc({ id: 'b', title: 'Report', category: 'LuxReport', filePath: 'C:\\b.pdf' }),
      ],
      [
        { documentId: 'a', state: 'Current', note: '' },
        { documentId: 'b', state: 'Missing', note: 'gone' },
      ],
    );
    expect(filterFileRows(rows, { query: 'layout', category: '', presence: '' })).toHaveLength(1);
    expect(filterFileRows(rows, { query: '', category: 'LuxReport', presence: '' })).toHaveLength(
      1,
    );
    expect(filterFileRows(rows, { query: '', category: '', presence: 'Missing' })).toHaveLength(1);
    expect(filterFileRows(rows, { query: '', category: '', presence: 'Present' })).toHaveLength(1);
  });

  it('exposes presence filter options', () => {
    const options = presenceOptions();
    expect(options.map((option) => option.value)).toEqual([
      '',
      'Present',
      'Missing',
      'Outdated',
      'NotGenerated',
    ]);
  });

  it('formats updated timestamps truthfully', () => {
    expect(formatUpdatedAt('2026-08-02T09:00:00.000Z')).not.toBe('—');
    expect(formatUpdatedAt('not-a-date')).toBe('—');
  });
});
