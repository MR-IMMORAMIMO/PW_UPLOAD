/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { V4FilterSelect } from './V4FilterSelect';

const options = [
  { value: 'open', label: 'Open', tone: 'info' as const },
  { value: 'waiting', label: 'Waiting', tone: 'warning' as const },
  { value: 'done', label: 'Completed', tone: 'success' as const },
];

describe('V4FilterSelect', () => {
  it('uses an accessible themed listbox with selected semantic state', () => {
    render(
      <V4FilterSelect
        label="Status"
        value="waiting"
        options={options}
        onChange={vi.fn()}
        variant="status"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Status' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('data-tone', 'warning');
    expect(trigger).toHaveClass('v4-filter-select__trigger');
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Waiting' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('supports keyboard opening, arrow selection, Escape, and outside close', () => {
    const onChange = vi.fn();
    render(<V4FilterSelect label="Status" value="open" options={options} onChange={onChange} />);

    const trigger = screen.getByRole('button', { name: 'Status' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('waiting');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('option', { name: 'Open' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
