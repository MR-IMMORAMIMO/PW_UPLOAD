/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppUser, Project, ProjectScopeItem, ProjectWorkspace } from '@scli/domain';
import { V4ProjectEditWorkspace } from './V4ProjectEditWorkspace';

vi.mock('../../api/environment', () => ({
  api: {
    projectStorageHealth: vi.fn().mockResolvedValue({
      projectId: '00000000-0000-4000-8000-000000000001',
      state: 'DISCONNECTED',
      reason: 'NOT_CONFIGURED',
      projectPath: null,
      workspacePath: null,
      canonicalPath: null,
      marker: null,
      canOpenFolder: false,
      canReconnect: true,
      canAdoptLegacy: false,
      checkedAt: '2026-08-23T00:00:00.000Z',
    }),
  },
}));

const project = {
  id: '00000000-0000-4000-8000-000000000001',
  projectCode: '001_SCT_TEST',
  projectName: 'Test Project',
  clientName: 'Client',
  crmReference: null,
  commercialValueMinor: null,
  commercialCurrency: null,
  projectType: 'Commercial',
  designStage: 'Concept',
  requiredDeliveryDate: '2026-09-01',
  siteLocation: 'Dubai',
  lightingScope: 'Interior lighting',
  luxRequirements: '',
  drawingReference: '',
  description: '',
  priority: 'Normal',
  complexity: 'Medium',
  estimatedHours: 24,
  salesOwnerId: '00000000-0000-4000-8000-000000000002',
  version: 3,
} as Project;
const workspace = {
  services: ['LuminaireSchedule'],
  scopeItems: [
    { id: 'scope-1', code: 'LuminaireSchedule', label: 'Luminaire Schedule', custom: false },
  ],
  lightingPackage: { inputMode: 'Later' },
} as unknown as ProjectWorkspace & { scopeItems: ProjectScopeItem[] };
const actor = { id: '00000000-0000-4000-8000-000000000003', role: 'Admin' } as AppUser;

function renderWorkspace() {
  const onClose = vi.fn();
  const onSave = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <button type="button">Edit Project trigger</button>
      <V4ProjectEditWorkspace
        open
        project={project}
        workspace={workspace}
        projectTypes={[
          { id: 'type-1', name: 'Commercial', isActive: true, createdAt: '', updatedAt: '' },
        ]}
        salesUsers={[]}
        actor={actor}
        saving={false}
        error={null}
        saved={false}
        onClose={onClose}
        onSave={onSave}
      />
    </QueryClientProvider>,
  );
  return { onClose, onSave };
}

describe('V4ProjectEditWorkspace', () => {
  it('renders the complete structural sections and read-only identity', () => {
    renderWorkspace();
    expect(screen.getByRole('dialog', { name: 'Edit Project' })).toBeInTheDocument();
    for (const heading of [
      'Project Details',
      'Client / Commercial References',
      'Schedule / Priority / Classification',
      'Scope & Services',
      'Storage / Folder',
      'Notes / Additional Information',
      'Read-only Identity',
    ])
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText('001_SCT_TEST')).toBeInTheDocument();
    expect(screen.queryByLabelText('Project Code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('keeps continuous typing focus and submits one complete atomic command', async () => {
    const user = userEvent.setup();
    const { onSave } = renderWorkspace();
    const name = screen.getByLabelText('Project Name');
    await user.click(name);
    await user.type(name, 'ABC');
    expect(name).toHaveValue('Test ProjectABC');
    expect(document.activeElement).toBe(name);
    await user.keyboard('{Backspace}{Backspace}{Backspace}');
    expect(name).toHaveValue('Test Project');
    await user.type(name, ' Updated');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'Test Project Updated',
        expectedVersion: 3,
        luminaireInputMode: 'Later',
        scopeItems: expect.any(Array),
      }),
    );
  });

  it('intercepts Escape for dirty changes and returns focus after discard', () => {
    const { onClose } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Changed Client' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Discard changes' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
