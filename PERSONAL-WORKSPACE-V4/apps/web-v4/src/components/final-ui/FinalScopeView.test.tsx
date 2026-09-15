/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seedProjects } from '../../../../../packages/test-data/src/index';
import FinalScopeView, { type FinalScopeBinding } from './FinalScopeView';

function binding(): FinalScopeBinding {
  return {
    project: { ...seedProjects[0]!, luxRequirements: '300 lux' },
    workspace: {
      scopeItems: [
        { id: 'scope-1', code: 'LightingLayout', label: 'Actual lighting layout', custom: false },
      ],
      deliverables: [
        {
          id: 'output-1',
          title: 'Actual schedule',
          required: true,
          serviceCode: 'LuminaireSchedule',
        },
      ],
      requirements: [{ title: 'CCT', details: '3000K' }],
      scopeNotes: [
        {
          id: 'note-1',
          type: 'Exclusion',
          text: 'Survey excluded',
          updatedAt: '2026-09-01T10:00:00Z',
        },
      ],
      tags: [
        { id: 'tag-1', label: 'Actual tag', colorKey: 'teal', updatedAt: '2026-09-01T10:00:00Z' },
      ],
      folderProfile: 'Actual folder profile',
    } as FinalScopeBinding['workspace'],
    edit: vi.fn(),
    addTag: vi.fn(),
    editTag: vi.fn(),
    editNote: vi.fn(),
    editSetupNotes: vi.fn(),
    editRequirements: vi.fn(),
    addNote: vi.fn(),
    addRequirement: vi.fn(),
    editRequirement: vi.fn(),
    pending: false,
  };
}
describe('Final Scope data binding', () => {
  it('renders only persisted scope, deliverables, requirements, and notes', () => {
    render(<FinalScopeView binding={binding()} />);
    expect(screen.getByText('Actual lighting layout')).toBeVisible();
    expect(screen.getByText('Actual schedule')).toBeVisible();
    expect(screen.getByText('300 lux')).toBeVisible();
    expect(screen.getByText('3000K')).toBeVisible();
    expect(screen.getByText('Survey excluded')).toBeVisible();
    expect(screen.queryByText('Scientechnic LLC')).not.toBeInTheDocument();
    expect(screen.queryByText('On-site Support')).not.toBeInTheDocument();
    expect(screen.queryByText('50,000 Hours (L80)')).not.toBeInTheDocument();
  });
  it('opens existing editors with exact record identity', () => {
    const data = binding();
    render(<FinalScopeView binding={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    expect(data.edit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(data.addTag).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Actual tag' }));
    expect(data.editTag).toHaveBeenCalledWith(data.workspace.tags[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Exclusions Survey excluded' }));
    expect(data.editNote).toHaveBeenCalledWith(data.workspace.scopeNotes[0]);
  });
});
