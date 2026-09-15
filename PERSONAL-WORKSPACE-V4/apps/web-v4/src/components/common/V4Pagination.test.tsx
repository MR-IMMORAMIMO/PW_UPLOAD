/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { V4Pagination, v4PaginationTokens } from './V4Pagination';

describe('v4PaginationTokens', () => {
  it.each([0, 1, 2, 3, 20])('handles pageCount %s deterministically', (pageCount) => {
    expect(v4PaginationTokens(pageCount, 0)).toEqual(expect.any(Array));
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'keeps pageCount 8 current %s unique and ascending',
    (current) => {
      const numbers = v4PaginationTokens(8, current).filter(
        (token): token is number => typeof token === 'number',
      );
      expect(numbers).toEqual([...new Set(numbers)]);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      expect(numbers).toContain(current);
      expect(numbers[0]).toBe(0);
      expect(numbers.at(-1)).toBe(7);
    },
  );

  it.each([
    [0, [0, 1, 2, 3, 4, 5, 'ellipsis', 7]],
    [1, [0, 1, 2, 3, 4, 5, 'ellipsis', 7]],
    [2, [0, 1, 2, 3, 4, 5, 'ellipsis', 7]],
    [3, [0, 1, 2, 3, 4, 5, 'ellipsis', 7]],
    [4, [0, 'ellipsis', 2, 3, 4, 5, 6, 7]],
    [5, [0, 'ellipsis', 2, 3, 4, 5, 6, 7]],
    [6, [0, 'ellipsis', 2, 3, 4, 5, 6, 7]],
    [7, [0, 'ellipsis', 2, 3, 4, 5, 6, 7]],
  ] as const)('uses stable pageCount 8 tokens for current page %s', (current, expected) => {
    expect(v4PaginationTokens(8, current)).toEqual(expected);
  });
});

describe('V4Pagination', () => {
  it('exposes the current page and navigates without interactive ellipses', () => {
    const onChange = vi.fn();
    render(<V4Pagination pageCount={8} currentPage={3} onChange={onChange} ariaLabel="Pages" />);
    expect(screen.getByRole('button', { current: 'page' })).toHaveTextContent('4');
    expect(screen.getByText('…')).not.toHaveAttribute('role', 'button');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('does not render a navigation landmark for zero or one page', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <V4Pagination pageCount={0} currentPage={0} onChange={onChange} ariaLabel="Pages" />,
    );
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    rerender(<V4Pagination pageCount={1} currentPage={0} onChange={onChange} ariaLabel="Pages" />);
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
  });
});
