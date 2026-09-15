import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyLuminaire } from '../project-luminaires/LuminaireEditor';
import { TechnicalProjectFieldEditor } from './TechnicalProjectFieldEditor';
const update = vi.hoisted(() => vi.fn());
vi.mock('../../api/environment', () => ({ api: { updateProjectTechnicalField: update } }));
afterEach(() => {
  cleanup();
  update.mockReset();
});
function mount(selectedField?: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TechnicalProjectFieldEditor
        {...(selectedField ? { selectedField } : {})}
        luminaire={{
          ...emptyLuminaire,
          id: 'luminaire',
          projectId: 'project',
          rowVersion: 7,
          createdAt: '2026-09-10T00:00:00Z',
          updatedAt: '2026-09-10T00:00:00Z',
        }}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Edit Project value here'));
  if (!selectedField)
    fireEvent.change(screen.getByLabelText('Project field'), { target: { value: 'wattage' } });
  fireEvent.change(screen.getByLabelText('Project value'), { target: { value: '13.4 W' } });
}
it('opens and locks the selected field instead of defaulting to another field', () => {
  mount('lumens');
  expect(screen.getByLabelText('Project field')).toHaveValue('lumens');
  expect(screen.getByLabelText('Project field')).toBeDisabled();
});
it('saves exactly one Project field with the observed row version without a Datasheet', async () => {
  update.mockResolvedValue({});
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Save Project value' }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith('project', 'luminaire', {
      fieldKey: 'wattage',
      value: '13.4 W',
      expectedRowVersion: 7,
    }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Project value saved.');
});
it('shows a stale or Library protection error without reporting success', async () => {
  update.mockRejectedValue(new Error('Library-controlled field'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Save Project value' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Library-controlled field');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
