/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { V4RowTrailing } from './V4RowTrailing';
import { V4StatusPill } from './V4StatusPill';

describe('V4RowTrailing', () => {
  it('keeps status and contextual action in the shared trailing slot', () => {
    render(
      <V4RowTrailing>
        <V4StatusPill variant="success">Included</V4StatusPill>
        <button type="button">More</button>
      </V4RowTrailing>,
    );
    expect(screen.getByText('Included').parentElement).toHaveClass('v4-row-trailing');
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });
});
