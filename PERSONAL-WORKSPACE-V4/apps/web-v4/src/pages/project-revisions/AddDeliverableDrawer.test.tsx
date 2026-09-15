import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectDocument } from '@scli/domain';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { AddDeliverableDrawer } from './AddDeliverableDrawer';
beforeEach(stubMatchMedia);
afterEach(cleanupV4);
it('adds selected visible files sequentially and retries only the failed remainder', async () => {
  const add = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('Second file unavailable'))
    .mockResolvedValueOnce({});
  renderV4(
    <AddDeliverableDrawer
      open
      revisionLabel="REV_03"
      documents={
        [
          { id: 'd1', title: 'First.pdf', filePath: 'First.pdf' },
          { id: 'd2', title: 'Second.pdf', filePath: 'Second.pdf' },
        ] as ProjectDocument[]
      }
      datasheets={[]}
      onClose={vi.fn()}
      onAddDocument={add}
      onAddDatasheet={vi.fn()}
      pending={false}
      error={null}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all visible available files' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add selected files' }));
  await screen.findByRole('alert');
  expect(add.mock.calls.map((call) => call[0])).toEqual(['d1', 'd2']);
  expect(screen.getByRole('checkbox', { name: 'Select First.pdf' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Select Second.pdf' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Add selected files' }));
  await waitFor(() => expect(add.mock.calls.map((call) => call[0])).toEqual(['d1', 'd2', 'd2']));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Select Second.pdf' })).toBeDisabled(),
  );
});
