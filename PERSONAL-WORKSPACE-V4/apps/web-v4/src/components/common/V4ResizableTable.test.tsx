import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V4ResizableTable } from './V4ResizableTable';
import { Th } from '../final-ui/ds/TablePrimitives';

function Example({
  name = 'projects',
  sort = () => undefined,
}: {
  name?: string;
  sort?: () => void;
}) {
  return (
    <V4ResizableTable tableKey={name}>
      <thead>
        <tr>
          <th onClick={sort}>Name</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Example</td>
          <td>Planning</td>
        </tr>
      </tbody>
    </V4ResizableTable>
  );
}
describe('Persisted table column controls', () => {
  it('provides resize handles for the shared composed header component', () => {
    render(
      <V4ResizableTable tableKey="composed">
        <thead>
          <tr>
            <Th>Ordering Code</Th>
            <Th>Model</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ABC</td>
            <td>Fixture</td>
          </tr>
        </tbody>
      </V4ResizableTable>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Ordering Code column' }), {
      key: 'ArrowRight',
    });
    expect(JSON.parse(localStorage.getItem('sct:table-widths:v1:composed')!)).toMatchObject({
      'Ordering Code': 116,
    });
  });
  it('does not insert reset controls into a headerless inspector property table', () => {
    render(
      <V4ResizableTable tableKey="inspector">
        <tbody>
          <tr>
            <td>Model</td>
            <td>Fixture</td>
          </tr>
        </tbody>
      </V4ResizableTable>,
    );
    expect(
      screen.queryByRole('button', { name: 'Reset inspector column widths' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Fixture')).toBeVisible();
  });
  beforeEach(() => localStorage.clear());
  it('resizes by keyboard without triggering sorting, restores widths, and resets each table independently', () => {
    const sort = vi.fn();
    const view = render(<Example sort={sort} />);
    const control = screen.getByRole('button', { name: 'Resize Name column' });
    fireEvent.keyDown(control, { key: 'ArrowRight' });
    fireEvent.click(control);
    expect(sort).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('sct:table-widths:v1:projects')!)).toEqual({
      Name: 116,
    });
    view.unmount();
    const restored = render(<Example />);
    expect(screen.getByRole('table').querySelector('col')).toHaveStyle({ width: '116px' });
    restored.unmount();
    const other = render(<Example name="luminaires" />);
    expect(screen.getByRole('button', { name: 'Reset luminaires column widths' })).toBeDisabled();
    other.unmount();
    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset projects column widths' }));
    expect(screen.getByRole('table').querySelector('col')).toBeNull();
  });
  it('rejects malformed saved widths and respects minimum widths', () => {
    localStorage.setItem('sct:table-widths:v1:projects', '{"Name":"100000", "Status":-5}');
    render(<Example />);
    const control = screen.getByRole('button', { name: 'Resize Name column' });
    for (let count = 0; count < 10; count++) fireEvent.keyDown(control, { key: 'ArrowLeft' });
    expect(JSON.parse(localStorage.getItem('sct:table-widths:v1:projects')!).Name).toBe(72);
  });
});
