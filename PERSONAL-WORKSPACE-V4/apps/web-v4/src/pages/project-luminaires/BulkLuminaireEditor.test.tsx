/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BulkLuminaireEditor } from './BulkLuminaireEditor';
import { emptyLuminaire } from './LuminaireEditor';
import type { LuminaireRecord } from '@scli/domain';
import { stubMatchMedia } from '../../test-utils/renderV4';
const api = vi.hoisted(() => ({
  projectWorkspace: vi.fn(),
  updateLuminaire: vi.fn(),
  deleteLuminaire: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const record = (id: string): LuminaireRecord => ({
  ...emptyLuminaire,
  id,
  projectId: 'p1',
  tag: id,
  manufacturer: 'Existing',
  model: 'Original model',
  orderingCode: 'ORDER-' + id,
  quantity: 2,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
it('updates only chosen fields against fresh records and retries failures without repeating saved rows', async () => {
  stubMatchMedia();
  const rows = [record('A'), record('B')];
  api.projectWorkspace.mockResolvedValue({
    luminaires: rows.map((row) => ({ ...row, model: 'Concurrent model change', quantity: 7 })),
  });
  api.updateLuminaire
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('Library field is protected'))
    .mockResolvedValueOnce({});
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <BulkLuminaireEditor
      projectId="p1"
      records={rows}
      mode="edit"
      onClose={vi.fn()}
      onChanged={refresh}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Change location' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'location' }), {
    target: { value: 'Lobby' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected fields' }));
  await screen.findByText('B — Library field is protected');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Apply selected fields' })).not.toBeDisabled(),
  );
  expect(api.updateLuminaire).toHaveBeenNthCalledWith(
    1,
    'p1',
    'A',
    expect.objectContaining({
      location: 'Lobby',
      model: 'Concurrent model change',
      quantity: 7,
      orderingCode: 'ORDER-A',
      tag: 'A',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const guard = screen.getByRole('alertdialog', { name: 'Unsaved bulk changes' });
  expect(guard).toBeVisible();
  fireEvent.click(within(guard).getByRole('button', { name: 'Continue editing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected fields' }));
  await screen.findByText('B — Saved');
  expect(api.updateLuminaire.mock.calls.map((call) => call[1])).toEqual(['A', 'B', 'B']);
  expect(api.deleteLuminaire).not.toHaveBeenCalled();
});
it('removal waits for explicit confirmation and affects only selected project identities', async () => {
  stubMatchMedia();
  api.deleteLuminaire.mockResolvedValue({});
  render(
    <BulkLuminaireEditor
      projectId="p1"
      records={[record('B')]}
      mode="remove"
      onClose={vi.fn()}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(api.deleteLuminaire).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: 'Remove selected luminaires' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from project' }));
  await screen.findByText('B — Removed');
  expect(api.deleteLuminaire).toHaveBeenCalledExactlyOnceWith('p1', 'B');
});
