/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { ClipboardList } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { V4SectionTitle } from './V4SectionTitle';

describe('V4SectionTitle', () => {
  it('renders a semantic icon, heading, optional description, and action', () => {
    render(
      <V4SectionTitle
        icon={ClipboardList}
        title="Project Scope"
        description="Active services."
        action={<button type="button">Edit</button>}
        tone="scope"
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Project Scope' })).toBeInTheDocument();
    expect(screen.getByText('Active services.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(document.querySelector('.v4-section-title__icon')).toBeInTheDocument();
  });

  it('uses the no-tile icon structure', () => {
    const { container } = render(<V4SectionTitle icon={ClipboardList} title="Scope" />);
    expect(container.querySelector('.v4-section-title__icon')).toBeInstanceOf(SVGElement);
    expect(container.querySelector('.v4-section-title__icon-tile')).toBeNull();
  });
});
