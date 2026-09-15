import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DatasheetFieldConfirmation } from './DatasheetFieldConfirmation';
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../api/environment', () => ({ api: { confirmLuminaireDatasheetField: confirm } }));
afterEach(() => {
  cleanup();
  confirm.mockReset();
});
const row = {
  fieldKey: 'wattage' as const,
  datasheetValue: '134 W',
  pageNumber: 1,
  verificationFingerprint: 'a'.repeat(64),
};
function mount(evidenceSeen: boolean, onSaved = vi.fn(), identityMismatch = false) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DatasheetFieldConfirmation
        projectId="project"
        luminaireId="luminaire"
        row={row}
        evidenceSeen={evidenceSeen}
        onSaved={onSaved}
        identityMismatch={identityMismatch}
      />
    </QueryClientProvider>,
  );
}
it('cannot confirm until the current evidence has been opened', () => {
  mount(false);
  fireEvent.click(screen.getByText('Confirm value from Datasheet'));
  expect(
    screen.getByRole('checkbox', { name: 'I checked this value against the displayed PDF page.' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save reviewed reading' })).toBeDisabled();
  expect(confirm).not.toHaveBeenCalled();
});
it('requests identity acceptance only for an actual identity mismatch', () => {
  const view = mount(true);
  fireEvent.click(screen.getByText('Confirm value from Datasheet'));
  expect(screen.queryByRole('checkbox', { name: /I confirm this Datasheet belongs/ })).toBeNull();
  view.unmount();
  mount(true, vi.fn(), true);
  fireEvent.click(screen.getByText('Confirm value from Datasheet'));
  expect(screen.getByRole('checkbox', { name: /I confirm this Datasheet belongs/ })).toBeEnabled();
});
it('saves the reviewed value and reuses the operation identity after an uncertain error', async () => {
  const saved = vi.fn();
  confirm.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({});
  mount(true, saved);
  fireEvent.click(screen.getByText('Confirm value from Datasheet'));
  fireEvent.change(screen.getByLabelText('Reviewed Datasheet value'), {
    target: { value: '13.4 W' },
  });
  fireEvent.change(screen.getByLabelText('Review note'), {
    target: { value: 'Printed system power checked.' },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'I checked this value against the displayed PDF page.' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed reading' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed reading' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(confirm.mock.calls[0]?.[2]).toMatchObject({
    value: '13.4 W',
    verificationFingerprint: row.verificationFingerprint,
    pageNumber: 1,
  });
  expect(confirm.mock.calls[0]?.[2].operationId).toBe(confirm.mock.calls[1]?.[2].operationId);
});
