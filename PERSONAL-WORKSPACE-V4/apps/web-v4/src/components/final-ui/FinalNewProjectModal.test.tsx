/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import FinalNewProjectModal from './FinalNewProjectModal';
import { projectWizardIssues } from './projectWizardReadiness';
import type { ProjectWizardDraft } from '@scli/contracts';

const mocks = vi.hoisted(() => ({
  personalSettings: vi.fn(),
  projectTypes: vi.fn(),
  salesUsers: vi.fn(),
  me: vi.fn(),
  users: vi.fn(),
  projects: vi.fn(),
  folderProfiles: vi.fn(),
  createProject: vi.fn(),
  createSalesContact: vi.fn(),
  request: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api: mocks, apiRequest: mocks.request }));
const profile = {
  name: 'First template',
  folders: [{ name: 'Design', children: [{ name: 'Drawings', children: [] }] }],
  outputFolders: {},
};
let saved: ProjectWizardDraft | null;
beforeEach(() => {
  vi.resetAllMocks();
  stubMatchMedia();
  saved = null;
  mocks.personalSettings.mockResolvedValue({
    projectRoot: 'C:\\Disposable',
    defaultFolderProfile: profile.name,
  });
  mocks.projectTypes.mockResolvedValue([{ name: 'Lighting Layout', isActive: true }]);
  mocks.salesUsers.mockResolvedValue([]);
  mocks.me.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000001',
    role: 'Admin',
    displayName: 'Designer',
    email: 'designer@example.test',
    isActive: true,
  });
  mocks.users.mockResolvedValue([]);
  mocks.projects.mockResolvedValue([]);
  mocks.folderProfiles.mockResolvedValue([
    profile,
    { ...profile, name: 'Second template', folders: [{ name: 'Other', children: [] }] },
  ]);
  mocks.request.mockImplementation(
    async (url: string, input?: { method?: string; body?: ProjectWizardDraft }) => {
      if (url.endsWith('project-directory')) return [];
      if (input?.method === 'PUT') {
        saved = input.body!;
        return saved;
      }
      return saved;
    },
  );
});
async function renderWizard() {
  const onClose = vi.fn();
  const rendered = renderV4(<FinalNewProjectModal open origin={null} onClose={onClose} />);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'projectType' })).toHaveTextContent(
      'Lighting Layout',
    ),
  );
  return { ...rendered, onClose };
}
async function toSchedule() {
  fireEvent.change(screen.getByRole('textbox', { name: 'projectName' }), {
    target: { value: 'Wizard Project' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'clientName' }), {
    target: { value: 'Client' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'projectType' }), {
    target: { value: 'Lighting Layout' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Scope & Services' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Scope Summary' }), {
    target: { value: 'Required scope' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Schedule' }));
}
describe('Friday New Project agreements', () => {
  it('autosaves edited inputs without creating a project and resumes the acknowledged draft', async () => {
    const view = await renderWizard();
    fireEvent.change(screen.getByRole('textbox', { name: 'projectName' }), {
      target: { value: 'Autosaved project' },
    });
    await waitFor(() => expect(saved?.fields.projectName).toBe('Autosaved project'), {
      timeout: 3500,
    });
    expect(mocks.createProject).not.toHaveBeenCalled();
    await screen.findByText('Draft saved automatically');
    view.unmount();
    await renderWizard();
    expect(screen.getByRole('textbox', { name: 'projectName' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Resume saved draft' }));
    expect(screen.getByRole('textbox', { name: 'projectName' })).toHaveValue('Autosaved project');
  });
  it('preserves a previous draft until explicitly resumed or saved over', async () => {
    const first = await renderWizard();
    fireEvent.change(screen.getByRole('textbox', { name: 'projectName' }), {
      target: { value: 'Keep this draft' },
    });
    await waitFor(() => expect(saved?.fields.projectName).toBe('Keep this draft'), {
      timeout: 3500,
    });
    first.unmount();
    await renderWizard();
    fireEvent.change(screen.getByRole('textbox', { name: 'projectName' }), {
      target: { value: 'Different project' },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(saved?.fields.projectName).toBe('Keep this draft');
  });
  it('retains inputs after a failed autosave and lets manual save retry', async () => {
    await renderWizard();
    mocks.request.mockRejectedValueOnce(new Error('Disk unavailable'));
    fireEvent.change(screen.getByRole('textbox', { name: 'projectName' }), {
      target: { value: 'Recover inputs' },
    });
    await screen.findByText('Draft not saved — use Save as Draft to retry', {}, { timeout: 3500 });
    expect(screen.getByRole('textbox', { name: 'projectName' })).toHaveValue('Recover inputs');
    const header = screen.getByRole('heading', { name: 'New Project' }).closest('header')!;
    fireEvent.click(within(header).getByRole('button', { name: 'Save as Draft' }));
    await waitFor(() => expect(saved?.fields.projectName).toBe('Recover inputs'));
  });
  it('opens a local code example without creating a project or saving a draft', async () => {
    await renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'View example' }));
    const example = screen.getByRole('dialog', { name: 'Project code example' });
    expect(within(example).getByText(/001_SCT/)).toBeVisible();
    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(saved).toBeNull();
  });
  it('uses a small milestone editor, preserves warning dates and saves an unsubmitted draft', async () => {
    await renderWizard();
    await toSchedule();
    fireEvent.click(screen.getByRole('button', { name: /Add milestone/i }));
    const editor = screen.getByRole('dialog', { name: 'Milestone' });
    expect(editor).toHaveClass('v4-wizard-small-editor');
    fireEvent.change(within(editor).getByLabelText('Name'), {
      target: { value: 'Client approval' },
    });
    fireEvent.change(within(editor).getByLabelText('Target Date'), {
      target: { value: '2027-03-22' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(editor).not.toBeInTheDocument());
    const header = screen.getByRole('button', { name: 'Close New Project' }).parentElement!;
    fireEvent.click(within(header).getByRole('button', { name: 'Save as Draft' }));
    await waitFor(() => expect(saved?.step).toBe(3));
    expect(saved?.setup.schedule.milestones[0]?.name).toBe('Client approval');
    expect(saved?.setup.deliverables).toEqual([]);
    expect(saved?.setup.designServices).toEqual([]);
    expect(saved?.setup.documentation).toEqual([]);
    expect(saved?.setup.standards).toEqual(['IES RP-7', 'ASHRAE 90.1', 'IECC 2021', 'ADA 2010']);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
  it('previews another folder template without selecting it until Use template', async () => {
    await renderWizard();
    await toSchedule();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Project Structure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse all templates' }));
    const dialog = screen.getByRole('dialog', { name: 'Structure templates' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Second template' }));
    expect(within(dialog).getByText('Other')).toBeVisible();
    expect(mocks.createProject).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'folderProfile' })).toHaveValue('Second template');
  });
  it('does not mark blank optional values as invalid but rejects money and date conflicts', () => {
    const fields = { projectName: 'P', clientName: 'C', projectType: 'Lighting Layout' };
    expect(Object.values(projectWizardIssues(fields, 'Scope')).flat()).toEqual([]);
    expect(
      projectWizardIssues({ ...fields, commercialValue: '12' }, 'Scope').information,
    ).toHaveLength(1);
    expect(
      projectWizardIssues(
        { ...fields, startDate: '2027-03-22', completionDate: '2027-03-21' },
        'Scope',
      ).schedule,
    ).toHaveLength(1);
  });
});
