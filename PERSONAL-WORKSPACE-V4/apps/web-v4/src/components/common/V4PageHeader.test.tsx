/** @vitest-environment jsdom */
/**
 * V4PageHeader focused component tests.
 *
 *   N. PageHeader title/subtitle/actions slots work.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { V4PageHeader } from './V4PageHeader';

describe('V4PageHeader', () => {
  it('renders title and description (N)', () => {
    render(<V4PageHeader title="Shell Foundation" description="Operational description." />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shell Foundation');
    expect(screen.getByTestId('v4-page-header-desc')).toHaveTextContent('Operational description.');
  });

  it('renders the optional icon (N)', () => {
    render(<V4PageHeader title="Projects" icon={FileText} />);
    expect(screen.getByTestId('v4-page-header').querySelector('svg')).toBeInTheDocument();
  });

  it('renders action slots (N)', () => {
    render(<V4PageHeader title="Actions" actions={<button type="button">New Action</button>} />);
    expect(screen.getByRole('button', { name: 'New Action' })).toBeInTheDocument();
  });

  it('omits subtitle when none provided', () => {
    render(<V4PageHeader title="Only Title" />);
    expect(screen.queryByTestId('v4-page-header-desc')).not.toBeInTheDocument();
  });
});
