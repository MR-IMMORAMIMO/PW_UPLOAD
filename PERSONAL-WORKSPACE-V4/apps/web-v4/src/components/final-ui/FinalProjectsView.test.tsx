/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedProjects } from '../../../../../packages/test-data/src/index';
import { renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import type { ProjectsWorkspaceBinding } from '../../pages/projects/ProjectsWorkspaceController';
import FinalProjectsView from './FinalProjectsView';

const mock = vi.hoisted(() => ({
  personalSettings: vi.fn(),
  finalUiPreferences: vi.fn(),
  updateFinalUiPreference: vi.fn(),
  updateProject: vi.fn(),
  updatePersonalSettings: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api: mock }));
const project = {
  ...seedProjects[0]!,
  projectName: 'Persisted Project',
  status: 'Planning' as const,
  priority: 'Low' as const,
};
function binding(): ProjectsWorkspaceBinding {
  return {
    projects: [project],
    activeProjectId: null,
    loading: false,
    error: null,
    feedback: null,
    retry: vi.fn(),
    newProject: vi.fn(),
    callbacks: {
      onOpen: vi.fn(),
      onEdit: vi.fn(),
      onOpenFolder: vi.fn(),
      onArchive: vi.fn(),
      onRestore: vi.fn(),
      onRemove: vi.fn(),
      onMove: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  stubMatchMedia();
  mock.personalSettings.mockResolvedValue({ projectRoot: '' });
  mock.finalUiPreferences.mockResolvedValue({ schemaVersion: 1, items: [] });
  mock.updateFinalUiPreference.mockResolvedValue({ schemaVersion: 1, items: [] });
});
afterEach(() => {
  vi.useRealTimers();
  delete window.scliDesktop;
});
describe('Final Projects binding', () => {
  it('restores the same owner filters after leaving and returning; isolates another owner', async () => {
    const data = { ...binding(), preferenceScope: 'owner-one' };
    const view = renderV4(<FinalProjectsView binding={data} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), {
      target: { value: 'Persisted' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
      target: { value: 'Low' },
    });
    view.unmount();
    const returned = renderV4(<FinalProjectsView binding={data} />);
    expect(screen.getByRole('textbox', { name: 'Search projects' })).toHaveValue('Persisted');
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveValue('Low');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('textbox', { name: 'Search projects' })).toHaveValue('');
    returned.unmount();
    renderV4(<FinalProjectsView binding={{ ...data, preferenceScope: 'owner-two' }} />);
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveValue('All Priorities');
  });
  it('matches the Dashboard week by business date, excludes undated/closed projects and clears the drilldown', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'));
    const data = binding();
    data.projects = [
      { ...project, id: 'today', projectName: 'Due today', requiredDeliveryDate: '2026-09-12' },
      { ...project, id: 'end', projectName: 'Week boundary', requiredDeliveryDate: '2026-09-19' },
      { ...project, id: 'later', projectName: 'Next week', requiredDeliveryDate: '2026-09-20' },
      { ...project, id: 'undated', projectName: 'No due date', requiredDeliveryDate: '' },
      {
        ...project,
        id: 'closed',
        projectName: 'Closed project',
        status: 'Completed',
        requiredDeliveryDate: '2026-09-12',
      },
    ];
    renderV4(<FinalProjectsView binding={data} />, ['/projects?dashboard=dueThisWeek']);
    expect(screen.getByRole('button', { name: 'Actions for Due today' })).toBeVisible();
    expect(screen.getByText('Week boundary')).toBeVisible();
    for (const name of ['Next week', 'No due date', 'Closed project'])
      expect(screen.queryByRole('button', { name: `Actions for ${name}` })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('Active Projects');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    for (const name of ['Next week', 'No due date', 'Closed project'])
      expect(screen.getByRole('button', { name: `Actions for ${name}` })).toBeVisible();
  });
  it('opens canonical identity and records a real visit without inferring identity from the code', async () => {
    const data = binding();
    renderV4(<FinalProjectsView binding={data} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(data.callbacks.onOpen).toHaveBeenCalledWith(project);
    await waitFor(() =>
      expect(mock.updateFinalUiPreference).toHaveBeenCalledWith({
        kind: 'PROJECT',
        targetId: project.id,
        markViewed: true,
      }),
    );
    expect(screen.queryByText('MY BEST TEST PROJECT')).not.toBeInTheDocument();
  });
  it('filters names and canonical priorities and restores the full list on Clear', async () => {
    renderV4(<FinalProjectsView binding={binding()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
      target: { value: 'High' },
    });
    expect(screen.getByText('No projects match these filters.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Persisted Project')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search projects' }), {
      target: { value: 'persisted' },
    });
    expect(screen.getByText('Persisted Project')).toBeVisible();
  });
  it('persists favorites through the backend instead of mutating a fixture', async () => {
    renderV4(<FinalProjectsView binding={binding()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Favorite project' }));
    await waitFor(() =>
      expect(mock.updateFinalUiPreference).toHaveBeenCalledWith({
        kind: 'PROJECT',
        targetId: project.id,
        favorite: true,
      }),
    );
  });
  it('delegates a board move to canonical transition validation without claiming local success', async () => {
    const data = binding();
    renderV4(<FinalProjectsView binding={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    const card = screen.getByRole('button', { name: 'Open Persisted Project' });
    fireEvent.dragStart(card);
    fireEvent.drop(screen.getByRole('group', { name: 'In Progress projects' }));
    expect(data.callbacks.onMove).toHaveBeenCalledWith(project, 'InProgress');
    expect(
      within(screen.getByRole('group', { name: 'Planning projects' })).getByText(
        'Persisted Project',
      ),
    ).toBeVisible();
  });
  it('uses the preserved editor and real create flow', () => {
    const data = binding();
    renderV4(<FinalProjectsView binding={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Persisted Project' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Project' }));
    expect(data.callbacks.onEdit).toHaveBeenCalledWith(project);
    fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
    expect(data.newProject).toHaveBeenCalledOnce();
  });
  it('sorts only the chosen Board column and starts all column additions through the Planning wizard', async () => {
    const data = binding();
    data.projects = [
      {
        ...project,
        id: 'b',
        projectName: 'Beta',
        priority: 'High',
        requiredDeliveryDate: '2026-09-15',
      },
      {
        ...project,
        id: 'a',
        projectName: 'Alpha',
        priority: 'Low',
        requiredDeliveryDate: '2026-09-20',
      },
    ];
    renderV4(<FinalProjectsView binding={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    const column = screen.getByRole('group', { name: 'Planning projects' });
    for (const [sort, names] of [
      ['Name', ['Open Alpha', 'Open Beta']],
      ['Priority', ['Open Beta', 'Open Alpha']],
      ['Due Date', ['Open Beta', 'Open Alpha']],
    ] as const) {
      fireEvent.click(within(column).getByRole('button', { name: 'Sort Planning projects' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: sort }));
      expect(
        within(column)
          .getAllByRole('button', { name: /^Open / })
          .map((item) => item.getAttribute('aria-label')),
      ).toEqual(names);
    }
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Completed projects' })).getByRole('button', {
        name: /Add project/,
      }),
    );
    expect(data.newProject).toHaveBeenCalledOnce();
    expect(mock.updateProject).not.toHaveBeenCalled();
  });
  it('selects and saves an absent project root before opening it, without overwriting other settings', async () => {
    const selectFolder = vi.fn().mockResolvedValue('D:\\Disposable Projects');
    const openPath = vi.fn().mockResolvedValue('');
    window.scliDesktop = { selectFolder, openPath };
    mock.updatePersonalSettings.mockImplementation(async () => {
      mock.personalSettings.mockResolvedValue({ projectRoot: 'D:\\Disposable Projects' });
    });
    renderV4(<FinalProjectsView binding={binding()} />);
    const button = screen.getByRole('button', { name: 'Open Folder' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(openPath).toHaveBeenCalledWith('D:\\Disposable Projects'));
    expect(mock.updatePersonalSettings).toHaveBeenCalledWith({
      projectRoot: 'D:\\Disposable Projects',
    });
    fireEvent.click(button);
    await waitFor(() => expect(openPath).toHaveBeenCalledTimes(2));
    expect(selectFolder).toHaveBeenCalledOnce();
  });
  it('does not open or persist a root when the picker is cancelled', async () => {
    const openPath = vi.fn();
    window.scliDesktop = { selectFolder: vi.fn().mockResolvedValue(null), openPath };
    renderV4(<FinalProjectsView binding={binding()} />);
    const button = screen.getByRole('button', { name: 'Open Folder' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(window.scliDesktop?.selectFolder).toHaveBeenCalledOnce());
    expect(openPath).not.toHaveBeenCalled();
    expect(mock.updatePersonalSettings).not.toHaveBeenCalled();
  });
  it('opens the row folder by project identity through both the icon and action menu', async () => {
    const data = binding();
    data.projects = [{ ...project, projectFolderPath: 'D:\\Disposable Project' }];
    renderV4(<FinalProjectsView binding={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open folder for Persisted Project' }));
    expect(data.callbacks.onOpenFolder).toHaveBeenCalledWith(data.projects[0]);
    expect(data.callbacks.onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Persisted Project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open Folder' }));
    expect(data.callbacks.onOpenFolder).toHaveBeenCalledTimes(2);
  });
});
