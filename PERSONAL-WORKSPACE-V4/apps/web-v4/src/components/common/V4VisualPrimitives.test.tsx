/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { V4Button } from './V4Button';
import { V4Field } from './V4Field';
import { V4InspectorFrame, V4InspectorMetadata, V4InspectorSection } from './V4Inspector';
import { V4Row } from './V4Row';
import { V4StatePanel } from './V4StatePanel';
import { V4Toolbar } from './V4Toolbar';
import { V4VerificationStatePill } from './V4VerificationState';

describe('Phase 3C visual primitives', () => {
  it.each(['primary', 'secondary', 'tertiary', 'danger', 'icon'] as const)(
    'renders the %s button variant without changing native button semantics',
    (variant) => {
      render(<V4Button variant={variant}>Action</V4Button>);
      expect(screen.getByRole('button', { name: 'Action' })).toHaveClass(`v4-button--${variant}`);
    },
  );

  it('renders field label, help, error, read-only and disabled visual contracts', () => {
    const { rerender } = render(
      <V4Field label="Project name" controlId="project-name" helpText="Canonical name">
        <input id="project-name" />
      </V4Field>,
    );
    expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    expect(screen.getByText('Canonical name')).toHaveClass('v4-field__message');
    rerender(
      <V4Field label="Project name" errorText="Name is required" readOnly disabled>
        <span>—</span>
      </V4Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(screen.getByText('Project name').closest('.v4-field')).toHaveAttribute(
      'data-read-only',
      'true',
    );
  });

  it('renders row selection, metadata and trailing slots', () => {
    render(
      <V4Row selected metadata="Updated today" trailing={<button>Open</button>}>
        REV-03
      </V4Row>,
    );
    expect(screen.getByText('REV-03').closest('.v4-row')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Updated today')).toHaveClass('v4-row__metadata');
  });

  it('renders optional toolbar regions', () => {
    render(<V4Toolbar left="Filters" right={<button>New</button>} />);
    expect(screen.getByRole('toolbar', { name: 'Page tools' })).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('renders the shared Inspector family and metadata semantics', () => {
    render(
      <V4InspectorFrame title="Revision details" footer={<button>Close</button>}>
        <V4InspectorSection title="Metadata">
          <V4InspectorMetadata>
            <div>
              <dt>Status</dt>
              <dd>Current</dd>
            </div>
          </V4InspectorMetadata>
        </V4InspectorSection>
      </V4InspectorFrame>,
    );
    expect(screen.getByRole('complementary')).toHaveClass('v4-inspector');
    expect(screen.getByRole('heading', { name: 'Metadata' })).toBeInTheDocument();
  });

  it('renders bounded state and verification semantics', () => {
    render(
      <>
        <V4StatePanel icon={AlertTriangle} title="Unavailable" message="Try again." tone="error" />
        <V4VerificationStatePill state="LEGACY_UNVERIFIED" />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByText('LEGACY_UNVERIFIED')).toHaveAttribute('data-variant', 'warning');
  });
});
