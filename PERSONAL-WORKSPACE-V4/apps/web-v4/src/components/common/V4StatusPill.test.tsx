/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { V4StatusPill } from './V4StatusPill';

describe('V4StatusPill', () => {
  it.each(['neutral', 'info', 'success', 'warning', 'critical', 'inactive', 'danger'] as const)(
    'renders the %s semantic variant accessibly',
    (variant) => {
      render(<V4StatusPill variant={variant}>Included</V4StatusPill>);
      expect(screen.getByText('Included')).toHaveClass('v4-status-pill');
      expect(screen.getByText('Included')).toHaveAttribute('data-variant', variant);
    },
  );
});
