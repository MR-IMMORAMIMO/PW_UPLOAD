/** @vitest-environment jsdom */
/**
 * V4ProjectContextHeader focused component tests.
 *
 *   K. Project Context Header distinguishes Design Stage correctly (never
 *      labeled as Project Status).
 *   L. Project Code/Name/Client/Type/Due Date render from provided data.
 *   M. Due-soon/overdue semantic state derivation renders the right class.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { V4ProjectContextHeader, type V4ProjectContextHeaderData } from './V4ProjectContextHeader';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

const baseData: V4ProjectContextHeaderData = {
  projectCode: 'SCT-1042',
  projectName: 'Riverside HQ Lighting',
  clientName: 'Riverside Properties',
  projectType: 'Hospitality',
  designStage: 'DetailedDesign',
  requiredDeliveryDate: '2026-09-01T00:00:00Z',
  now: FIXED_NOW,
};

describe('V4ProjectContextHeader', () => {
  it('renders code/name/client/type/due date from provided canonical data (L)', () => {
    render(<V4ProjectContextHeader data={baseData} />);
    expect(screen.getByTestId('v4-pch-code')).toHaveTextContent('SCT-1042');
    expect(screen.getByTestId('v4-pch-name')).toHaveTextContent('Riverside HQ Lighting');
    expect(screen.getByTestId('v4-pch-client')).toHaveTextContent('Riverside Properties');
    expect(screen.getByTestId('v4-pch-type')).toHaveTextContent('Hospitality');
    expect(screen.getByTestId('v4-pch-stage')).toHaveTextContent('DetailedDesign');
  });

  it('labels the field as Design Stage, not Project Status (K)', () => {
    render(<V4ProjectContextHeader data={baseData} />);
    const stageField = screen.getByTestId('v4-pch-stage').closest('.v4-pch__field');
    expect(stageField).toBeTruthy();
    expect(within(stageField as HTMLElement).getByText('Design Stage')).toBeInTheDocument();
    expect(screen.queryByText('Project Status')).not.toBeInTheDocument();
  });

  it('derives and applies the due-soon semantic state (M)', () => {
    render(
      <V4ProjectContextHeader
        data={{ ...baseData, requiredDeliveryDate: '2026-08-16T00:00:00Z' }}
      />,
    );
    const due = screen.getByTestId('v4-pch-due');
    expect(due).toHaveAttribute('data-due-state', 'soon');
    expect(due.className).toContain('v4-pch__value--due-soon');
  });

  it('derives and applies the overdue semantic state (M)', () => {
    render(
      <V4ProjectContextHeader
        data={{ ...baseData, requiredDeliveryDate: '2026-08-01T00:00:00Z' }}
      />,
    );
    const due = screen.getByTestId('v4-pch-due');
    expect(due).toHaveAttribute('data-due-state', 'overdue');
    expect(due.className).toContain('v4-pch__value--due-overdue');
  });

  it('renders a neutral empty value for a missing due date (no fabrication)', () => {
    render(<V4ProjectContextHeader data={{ ...baseData, requiredDeliveryDate: null }} />);
    const due = screen.getByTestId('v4-pch-due');
    expect(due).toHaveAttribute('data-due-state', 'neutral');
    expect(due).toHaveTextContent('—');
  });

  it('renders neutral placeholders for missing client/type/stage (no fabrication)', () => {
    render(
      <V4ProjectContextHeader
        data={{
          projectCode: 'SCT-0000',
          projectName: 'Project',
          clientName: null,
          projectType: null,
          designStage: null,
          requiredDeliveryDate: null,
          now: FIXED_NOW,
        }}
      />,
    );
    expect(screen.getByTestId('v4-pch-client')).toHaveTextContent('—');
    expect(screen.getByTestId('v4-pch-type')).toHaveTextContent('—');
    expect(screen.getByTestId('v4-pch-stage')).toHaveTextContent('—');
  });

  it('H1: exposes all six independent metadata labels', () => {
    render(<V4ProjectContextHeader data={baseData} />);
    for (const label of [
      'Project Code',
      'Project Name',
      'Client',
      'Project Type',
      'Design Stage',
      'Due Date',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('H1: Project Name has an explicit label and strong value cell', () => {
    render(<V4ProjectContextHeader data={baseData} />);
    const nameField = screen.getByTestId('v4-pch-name').closest('.v4-pch__field');
    expect(nameField).toBeTruthy();
    expect(within(nameField as HTMLElement).getByText('Project Name')).toBeInTheDocument();
    expect(screen.getByTestId('v4-pch-name').className).toContain('v4-pch__value--name');
  });
});
